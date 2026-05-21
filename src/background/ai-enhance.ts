import type { AIEnhancedReport, NormalizedFigmaProps, ExtractedElement } from '../shared/types'
import { callClaude } from './claude-api'
import { cssColorToHex, parsePx } from '../shared/color-utils'

const SYSTEM_PROMPT = `You are an expert design QA tester. You find every difference between a Figma design and its live web implementation — visual AND textual.

You will receive:
1. **Figma property table**: Exact values from the design file (font sizes, weights, colors, spacing)
2. **DOM property table**: Computed CSS values from the live page
3. **Two screenshots**: First = LIVE PAGE, Second = FIGMA DESIGN
4. **Figma text list**: All text from the design

## PRIORITY ELEMENTS — INSPECT THESE FIRST AND DOUBLE-CHECK
Before anything else, scan both screenshots for these high-visibility interactive elements and verify BOTH their color AND their copy with extra scrutiny. A mismatch here is always worth reporting, even if subtle:
- **Primary & secondary buttons** (background, border, text color, label wording, padding)
- **Radio buttons & checkboxes** (control fill/border, label text and color, selected vs. unselected state)
- **Search bars & input fields** (border color, background, placeholder copy, placeholder color)
- **Links and clickable text** (color, underline, hover affordance)
- **Tabs & segmented controls** (active vs. inactive color, label copy)
- **Modal/dialog titles and CTAs** (title text + color, primary button label + background)
- **Toggles and switches** (on/off color, label)
- **Form labels and helper text** (color, exact wording)
- **Tags, badges, and pills** (background, text color, label)

For every priority element you find on the page, emit at least one groupedFinding even if only one property differs. Do not skip a priority element just because the difference looks minor — these are the elements users notice first.

## YOUR PROCESS (follow this order):

### Step 1: COMPARE THE DATA TABLES
Go through EVERY text element in the Figma table. Find the matching text in the DOM table (match by the text content). Compare:
- **font-size**: If Figma says 14px and DOM says 16px → REPORT IT
- **font-weight**: If Figma says 600 and DOM says 400 → REPORT IT
- **color**: If hex values differ → REPORT IT

Then compare containers: fill colors, border-radius, padding values.

Report ALL differences found in the data, even small ones like 1-2px.

### Step 2: COMPARE COPY VISIBLE IN BOTH SCREENSHOTS (very important — do not skip)
Read the actual text rendered in BOTH screenshots and compare wording. Cover:
- Headings, titles, modal/dialog labels
- Button labels and link text
- Form field labels, helper text, **input placeholders**, error messages
- Empty-state copy, tooltips, badges, tags
- Radio/checkbox option labels
- Section subtitles and instructional microcopy

For every copy mismatch, emit a groupedFinding whose title starts with **"Copy:"** (e.g. "Copy: Add button label"). In the description, quote both versions verbatim:
- description: "Figma says **\\"Add ticket\\"**, live page says **\\"Add\\"**"

### Step 3: IGNORE DUMMY / TEST DATA
The live page is a sandbox with seed data that does NOT match the design's mock content. Do NOT flag these as copy mismatches:
- Ticket IDs and reference numbers (#INC-8, #ember5421, INC-1234, T-001)
- User names, email addresses, avatars
- Dates, times, timestamps, "X hours ago", "Today", relative times
- Counts and numeric values that come from data ("141 days left", "8 tickets")
- Lorem ipsum, sample subjects/descriptions, placeholder rows in lists/tables
- Sample tags, sample categories that obviously come from a database
- Any text that looks generated, randomised, or environment-specific

Only flag copy that is part of the **product chrome** — the static UI strings the design system controls. When in doubt, ask: "Would this text be the same for every customer?" If no, skip it.

### Step 4: USE SCREENSHOTS FOR LAYOUT EXTRAS
Look at the screenshots for things not covered above: spacing, alignment, missing elements, ordering, icon differences.

## FORMAT:
- Use exact values: "font-size is **16px**, should be **14px**"
- Use exact hex: "color is **#485a68**, should be **#12334c**"
- Name the specific element: "Name field label", not "a label"
- For CSS fixes, use the DOM selector from the table. Copy fixes don't need a cssFix — leave it as an empty string.

Respond ONLY with valid JSON (no markdown fences):
{
  "summary": "2-3 sentence overview that explicitly mentions copy issues if any exist.",
  "groupedFindings": [
    {
      "title": "Element name (prefix with 'Copy:' for wording mismatches)",
      "description": "One finding per line:\\n- font-size is **16px**, should be **14px**\\n- Figma says **\\"Add ticket\\"**, live page says **\\"Add\\"**",
      "discrepancyIds": [],
      "cssFix": ".selector {\\n  font-size: 14px;\\n}"
    }
  ],
  "visualDiffNotes": "Layout/alignment observations from screenshots — NOT copy issues (those go in groupedFindings)."
}`

/**
 * Build a concise Figma properties table for the prompt.
 */
function buildFigmaPropertiesTable(nodes: NormalizedFigmaProps[]): string {
  const lines: string[] = ['## Figma design properties (exact values)\n']

  // Text nodes
  const textNodes = nodes.filter(n => n.type === 'TEXT' && n.textContent && n.textContent.trim().length > 1)
  if (textNodes.length > 0) {
    lines.push('### Text elements')
    lines.push('| Text | Font Size | Font Weight | Color |')
    lines.push('|------|-----------|-------------|-------|')
    for (const n of textNodes.slice(0, 40)) {
      const text = n.textContent!.trim().slice(0, 50)
      const size = n.fontSize ? `${n.fontSize}px` : '-'
      const weight = n.fontWeight ? `${n.fontWeight}` : '-'
      const color = n.fillColor || '-'
      lines.push(`| ${text} | ${size} | ${weight} | ${color} |`)
    }
    lines.push('')
  }

  // Containers with visual properties
  const containers = nodes.filter(n =>
    n.type !== 'TEXT' && (n.fillColor || n.strokeColor || n.borderRadius || n.layoutMode)
  )
  if (containers.length > 0) {
    lines.push('### Containers/components')
    lines.push('| Name | Fill | Border Radius | Padding (T/R/B/L) | Gap |')
    lines.push('|------|------|---------------|-------------------|-----|')
    for (const n of containers.slice(0, 30)) {
      const fill = n.fillColor || '-'
      const radius = n.borderRadius !== undefined ? `${n.borderRadius}px` : '-'
      const padding = n.layoutMode
        ? `${n.paddingTop ?? '-'}/${n.paddingRight ?? '-'}/${n.paddingBottom ?? '-'}/${n.paddingLeft ?? '-'}`
        : '-'
      const gap = n.itemSpacing !== undefined ? `${n.itemSpacing}px` : '-'
      lines.push(`| ${n.name.slice(0, 30)} | ${fill} | ${radius} | ${padding} | ${gap} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/**
 * Build a concise DOM properties table for the prompt.
 */
function buildDomPropertiesTable(elements: ExtractedElement[]): string {
  const lines: string[] = ['## Live page properties (computed CSS)\n']

  // Only include elements with text content or meaningful visual properties
  const meaningful = elements.filter(el => {
    if (el.textContent && el.textContent.trim().length > 1) return true
    const bg = cssColorToHex(el.styles.backgroundColor)
    if (bg && bg !== '#ffffff' && bg !== '#000000') return true
    return false
  })

  if (meaningful.length === 0) return ''

  lines.push('| Element | Selector | Font Size | Font Weight | Color | Background | Border Radius |')
  lines.push('|---------|----------|-----------|-------------|-------|------------|---------------|')

  for (const el of meaningful.slice(0, 50)) {
    const desc = (el.description || el.tagName).slice(0, 25)
    const selector = el.selector.split(' > ').slice(-2).join(' > ').slice(0, 35)
    const fontSize = parsePx(el.styles.fontSize) ? `${parsePx(el.styles.fontSize)}px` : '-'
    const fontWeight = el.styles.fontWeight || '-'
    const color = cssColorToHex(el.styles.color) || '-'
    const bg = cssColorToHex(el.styles.backgroundColor)
    const bgStr = (bg && bg !== '#ffffff') ? bg : '-'
    const radius = parsePx(el.styles.borderTopLeftRadius) ? `${parsePx(el.styles.borderTopLeftRadius)}px` : '-'
    lines.push(`| ${desc} | ${selector} | ${fontSize} | ${fontWeight} | ${color} | ${bgStr} | ${radius} |`)
  }

  lines.push('')
  return lines.join('\n')
}

/**
 * Run AI visual comparison with property data for exact values.
 */
export async function runAIComparison(
  apiKey: string,
  pageScreenshot: string,
  figmaScreenshot: string,
  figmaNodes: NormalizedFigmaProps[],
  domElements: ExtractedElement[],
  pageUrl: string,
  figmaUrl: string,
): Promise<AIEnhancedReport> {
  const images: { base64: string; mediaType: string }[] = []

  const pageBase64 = pageScreenshot.replace(/^data:image\/\w+;base64,/, '')
  images.push({ base64: pageBase64, mediaType: 'image/png' })

  const figmaBase64 = figmaScreenshot.replace(/^data:image\/\w+;base64,/, '')
  images.push({ base64: figmaBase64, mediaType: 'image/png' })

  // Build the message with property data first, screenshots second
  let message = `Find every difference between the Figma design and the live page — visual properties AND copy.

**PRIORITY**: Buttons (primary + secondary), radio buttons, checkboxes, search bars, input fields, links, tabs, modal CTAs, toggles, tags/badges. For each of these on the page, verify BOTH color AND copy and report any mismatch — even small ones. These are the elements users notice first; do not skip them.

**STEP 1**: Compare the property tables below. Report every value that differs.
**STEP 2**: Compare the COPY visible in both screenshots (image 1 = live page, image 2 = Figma). For every wording mismatch on a UI string, emit a groupedFinding with title starting "Copy:". Quote both versions.
**STEP 3**: IGNORE seed/dummy data. The live page is a sandbox — do not flag ticket IDs, user names, dates, counts, sample subjects, or anything that looks like database content. Only flag static product strings.
**STEP 4**: Use the screenshots for layout/alignment issues not in the data.

${buildFigmaPropertiesTable(figmaNodes)}

${buildDomPropertiesTable(domElements)}`

  // Add Figma text content for content verification
  const textNodes = figmaNodes.filter(n => n.type === 'TEXT' && n.textContent && n.textContent.trim().length > 2)
  if (textNodes.length > 0) {
    message += `\n## Figma text content (compare each to what's visible on the live page screenshot)\nFor each line below, check whether the live page renders the same wording for the same UI element. Skip lines that look like sample data (IDs, names, dates, counts).\n`
    for (const n of textNodes) {
      message += `- "${n.textContent!.trim()}"\n`
    }
  }

  const responseText = await callClaude(
    apiKey,
    SYSTEM_PROMPT,
    message,
    images
  )

  try {
    return JSON.parse(responseText) as AIEnhancedReport
  } catch {
    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]) as AIEnhancedReport
    }
    return {
      summary: responseText.slice(0, 500),
      groupedFindings: [],
    }
  }
}

/**
 * Fetch a Figma frame screenshot as base64 data URL.
 */
export async function fetchFigmaScreenshot(
  fileKey: string,
  nodeId: string,
  figmaToken: string
): Promise<string | null> {
  try {
    const url = `https://api.figma.com/v1/images/${fileKey}?ids=${encodeURIComponent(nodeId)}&format=png&scale=2`
    const response = await fetch(url, {
      headers: { 'X-Figma-Token': figmaToken },
    })

    if (!response.ok) return null

    const data = await response.json()
    const imageUrl = data.images?.[nodeId]
    if (!imageUrl) return null

    const imageResponse = await fetch(imageUrl)
    if (!imageResponse.ok) return null

    const blob = await imageResponse.blob()
    return new Promise<string>((resolve) => {
      const reader = new FileReader()
      reader.onloadend = () => resolve(reader.result as string)
      reader.readAsDataURL(blob)
    })
  } catch {
    return null
  }
}
