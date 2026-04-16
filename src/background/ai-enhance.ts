import type { AIEnhancedReport, NormalizedFigmaProps, ExtractedElement } from '../shared/types'
import { callClaude } from './claude-api'
import { cssColorToHex, parsePx } from '../shared/color-utils'

const SYSTEM_PROMPT = `You are an expert design QA tester. You find every difference between a Figma design and its live web implementation.

You will receive:
1. **Figma property table**: Exact values from the design file (font sizes, weights, colors, spacing)
2. **DOM property table**: Computed CSS values from the live page
3. **Two screenshots**: First = LIVE PAGE, Second = FIGMA DESIGN
4. **Figma text list**: All text from the design

## YOUR PROCESS (follow this order):

### Step 1: COMPARE THE DATA TABLES (this is your primary job)
Go through EVERY text element in the Figma table. Find the matching text in the DOM table (match by the text content). Compare:
- **font-size**: If Figma says 14px and DOM says 16px → REPORT IT
- **font-weight**: If Figma says 600 and DOM says 400 → REPORT IT
- **color**: If hex values differ → REPORT IT

Then compare containers: fill colors, border-radius, padding values.

Report ALL differences found in the data, even small ones like 1-2px. These are precise measurements, not guesses.

### Step 2: CHECK TEXT CONTENT
For each text in the Figma text list, verify it appears on the live page. Report any missing or changed text.

### Step 3: USE SCREENSHOTS FOR EXTRAS
Look at the screenshots for things NOT in the data: layout issues, alignment, missing elements, visual inconsistencies.

## FORMAT:
- Use exact values: "font-size is **16px**, should be **14px**"
- Use exact hex: "color is **#485a68**, should be **#12334c**"
- Name the specific element: "Name field label", not "a label"
- For CSS fixes, use the DOM selector from the table

Respond ONLY with valid JSON (no markdown fences):
{
  "summary": "2-3 sentence overview.",
  "groupedFindings": [
    {
      "title": "Element name",
      "description": "One finding per line:\\n- font-size is **16px**, should be **14px**\\n- font-weight is **400**, should be **600**",
      "discrepancyIds": [],
      "cssFix": ".selector {\\n  font-size: 14px;\\n}"
    }
  ],
  "visualDiffNotes": "Layout/alignment observations from screenshots."
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
  let message = `Find every difference between the Figma design and the live page.

**STEP 1**: Compare the two property tables below. Match elements by their text content. Report every value that differs.
**STEP 2**: Check the text content list against the page.
**STEP 3**: Look at the screenshots (image 1 = live page, image 2 = Figma) for layout/visual issues not in the data.

${buildFigmaPropertiesTable(figmaNodes)}

${buildDomPropertiesTable(domElements)}`

  // Add Figma text content for content verification
  const textNodes = figmaNodes.filter(n => n.type === 'TEXT' && n.textContent && n.textContent.trim().length > 2)
  if (textNodes.length > 0) {
    message += `\n## Figma text content (verify each appears on the live page)\n`
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
