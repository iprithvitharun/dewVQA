import type {
  MatchedPair,
  NormalizedFigmaProps,
  ExtractedElement,
  FigmaDiscrepancy,
  FigmaComparisonReport,
  Severity,
  ViolationCategory,
  ElementMeta,
} from '../shared/types'
import { cssColorToHex, parsePx, hexToRgb } from '../shared/color-utils'

let discrepancyCounter = 0

/** RGB Euclidean distance between two hex colors */
function colorDistance(hex1: string, hex2: string): number {
  const a = hexToRgb(hex1)
  const b = hexToRgb(hex2)
  if (!a || !b) return 999
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)
}

/** Check if a Figma node is a structural container with no visual properties */
function isStructuralNode(figma: NormalizedFigmaProps): boolean {
  return !figma.fillColor && !figma.strokeColor && figma.fontSize === undefined && figma.type !== 'TEXT'
}

function nextId(): string {
  discrepancyCounter++
  return `FD-${String(discrepancyCounter).padStart(3, '0')}`
}

function buildElementMeta(el: ExtractedElement): ElementMeta {
  return {
    selector: el.selector,
    tagName: el.tagName,
    textContent: el.textContent.slice(0, 60),
    description: el.description || `<${el.tagName.toLowerCase()}>`,
    role: el.role || el.tagName.toLowerCase(),
    accessibleName: el.accessibleName || '',
    region: el.region || '',
    parentContext: el.parentContext || '',
    dew: el.dew,
  }
}

/** Adjust severity down one level for low-confidence matches */
function adjustSeverity(severity: Severity, confidence: number): Severity {
  if (confidence >= 0.6) return severity
  const downgrade: Record<Severity, Severity> = {
    blocker: 'high',
    high: 'medium',
    medium: 'low',
    low: 'low',
  }
  return downgrade[severity]
}

// ─── Individual Comparisons ───────────────────────────────────

function compareFillColor(
  figma: NormalizedFigmaProps,
  dom: ExtractedElement,
  confidence: number
): FigmaDiscrepancy | null {
  // For TEXT nodes, fillColor maps to CSS color, not background
  if (figma.type === 'TEXT') return null

  // If Figma has no fill, skip — the DOM bg is likely inherited
  if (!figma.fillColor) return null

  const domHex = cssColorToHex(dom.styles.backgroundColor)
  if (!domHex) return null

  // Skip if DOM background is inherited and matches common defaults
  if (dom.styles.inheritedBg && (domHex === '#ffffff' || domHex === '#000000')) return null

  if (domHex === figma.fillColor) return null

  // Skip trivially close colors (rounding artifacts, < 2 distance)
  const dist = colorDistance(domHex, figma.fillColor)
  if (dist < 2) return null

  // Downgrade barely perceptible differences to low
  const baseSeverity: Severity = dist < 10 ? 'low' : 'high'

  return {
    id: nextId(),
    property: 'background-color',
    figmaValue: figma.fillColor,
    domValue: `${dom.styles.backgroundColor} (${domHex})`,
    severity: adjustSeverity(baseSeverity, confidence),
    category: 'color',
    element: buildElementMeta(dom),
    figmaNodeName: figma.name,
    figmaNodeId: figma.nodeId,
    suggestion: `Background color should be ${figma.fillColor} per Figma design.`,
    matchConfidence: confidence,
  }
}

function compareTextColor(
  figma: NormalizedFigmaProps,
  dom: ExtractedElement,
  confidence: number
): FigmaDiscrepancy | null {
  if (figma.type !== 'TEXT' || !figma.fillColor) return null

  const domHex = cssColorToHex(dom.styles.color)
  if (!domHex) return null

  if (domHex === figma.fillColor) return null

  const dist = colorDistance(domHex, figma.fillColor)
  if (dist < 2) return null

  const baseSeverity: Severity = dist < 10 ? 'low' : 'high'

  return {
    id: nextId(),
    property: 'color',
    figmaValue: figma.fillColor,
    domValue: `${dom.styles.color} (${domHex})`,
    severity: adjustSeverity(baseSeverity, confidence),
    category: 'color',
    element: buildElementMeta(dom),
    figmaNodeName: figma.name,
    figmaNodeId: figma.nodeId,
    suggestion: `Text color should be ${figma.fillColor} per Figma design.`,
    matchConfidence: confidence,
  }
}

function compareStrokeColor(
  figma: NormalizedFigmaProps,
  dom: ExtractedElement,
  confidence: number
): FigmaDiscrepancy | null {
  // Skip when Figma has no stroke — DOM border is likely a browser default
  if (!figma.strokeColor) return null

  const domHex = cssColorToHex(dom.styles.borderColor)
  if (!domHex) return null

  if (domHex === figma.strokeColor) return null

  const dist = colorDistance(domHex, figma.strokeColor)
  if (dist < 2) return null

  const baseSeverity: Severity = dist < 10 ? 'low' : 'medium'

  return {
    id: nextId(),
    property: 'border-color',
    figmaValue: figma.strokeColor,
    domValue: `${dom.styles.borderColor} (${domHex})`,
    severity: adjustSeverity(baseSeverity, confidence),
    category: 'color',
    element: buildElementMeta(dom),
    figmaNodeName: figma.name,
    figmaNodeId: figma.nodeId,
    suggestion: `Border color should be ${figma.strokeColor} per Figma design.`,
    matchConfidence: confidence,
  }
}

function compareFontSize(
  figma: NormalizedFigmaProps,
  dom: ExtractedElement,
  confidence: number
): FigmaDiscrepancy | null {
  if (figma.fontSize === undefined) return null

  const domSize = parsePx(dom.styles.fontSize)
  if (domSize === 0) return null

  const diff = Math.abs(domSize - figma.fontSize)
  if (diff <= 1) return null

  return {
    id: nextId(),
    property: 'font-size',
    figmaValue: `${figma.fontSize}px`,
    domValue: `${domSize}px`,
    severity: adjustSeverity(diff > 2 ? 'high' : 'medium', confidence),
    category: 'typography',
    element: buildElementMeta(dom),
    figmaNodeName: figma.name,
    figmaNodeId: figma.nodeId,
    suggestion: `Font size should be ${figma.fontSize}px per Figma design (currently ${domSize}px).`,
    matchConfidence: confidence,
  }
}

function compareFontWeight(
  figma: NormalizedFigmaProps,
  dom: ExtractedElement,
  confidence: number
): FigmaDiscrepancy | null {
  if (figma.fontWeight === undefined) return null

  const domWeight = parseInt(dom.styles.fontWeight, 10)
  if (!domWeight) return null

  if (domWeight === figma.fontWeight) return null

  return {
    id: nextId(),
    property: 'font-weight',
    figmaValue: `${figma.fontWeight}`,
    domValue: `${domWeight}`,
    severity: adjustSeverity('medium', confidence),
    category: 'typography',
    element: buildElementMeta(dom),
    figmaNodeName: figma.name,
    figmaNodeId: figma.nodeId,
    suggestion: `Font weight should be ${figma.fontWeight} per Figma design (currently ${domWeight}).`,
    matchConfidence: confidence,
  }
}

function compareFontFamily(
  figma: NormalizedFigmaProps,
  dom: ExtractedElement,
  confidence: number
): FigmaDiscrepancy | null {
  if (!figma.fontFamily) return null

  const domFamily = dom.styles.fontFamily.toLowerCase()
  const figmaFamily = figma.fontFamily.toLowerCase()

  // Direct containment check
  if (domFamily.includes(figmaFamily)) return null

  // Handle "Inter Variable" vs "Inter" — strip common suffixes
  const figmaBase = figmaFamily.replace(/\s*(variable|var)\s*/gi, '').trim()
  if (domFamily.includes(figmaBase)) return null

  return {
    id: nextId(),
    property: 'font-family',
    figmaValue: figma.fontFamily,
    domValue: dom.styles.fontFamily,
    severity: adjustSeverity('high', confidence),
    category: 'typography',
    element: buildElementMeta(dom),
    figmaNodeName: figma.name,
    figmaNodeId: figma.nodeId,
    suggestion: `Font family should include "${figma.fontFamily}" per Figma design.`,
    matchConfidence: confidence,
  }
}

function compareBorderRadius(
  figma: NormalizedFigmaProps,
  dom: ExtractedElement,
  confidence: number
): FigmaDiscrepancy | null {
  if (figma.borderRadius === undefined) return null

  const domRadius = parsePx(dom.styles.borderTopLeftRadius)
  const diff = Math.abs(domRadius - figma.borderRadius)
  if (diff <= 0.5) return null

  return {
    id: nextId(),
    property: 'border-radius',
    figmaValue: `${figma.borderRadius}px`,
    domValue: `${domRadius}px`,
    severity: adjustSeverity('medium', confidence),
    category: 'border-radius',
    element: buildElementMeta(dom),
    figmaNodeName: figma.name,
    figmaNodeId: figma.nodeId,
    suggestion: `Border radius should be ${figma.borderRadius}px per Figma design (currently ${domRadius}px).`,
    matchConfidence: confidence,
  }
}

function comparePadding(
  figma: NormalizedFigmaProps,
  dom: ExtractedElement,
  confidence: number
): FigmaDiscrepancy[] {
  // Only compare padding for auto-layout frames
  if (!figma.layoutMode) return []

  const results: FigmaDiscrepancy[] = []
  const sides: { figmaKey: keyof NormalizedFigmaProps; domKey: keyof ExtractedElement['styles']; label: string }[] = [
    { figmaKey: 'paddingTop', domKey: 'paddingTop', label: 'padding-top' },
    { figmaKey: 'paddingRight', domKey: 'paddingRight', label: 'padding-right' },
    { figmaKey: 'paddingBottom', domKey: 'paddingBottom', label: 'padding-bottom' },
    { figmaKey: 'paddingLeft', domKey: 'paddingLeft', label: 'padding-left' },
  ]

  for (const side of sides) {
    const figmaVal = figma[side.figmaKey] as number | undefined
    if (figmaVal === undefined) continue

    const domVal = parsePx(dom.styles[side.domKey] as string)
    const diff = Math.abs(domVal - figmaVal)
    if (diff <= 1) continue

    results.push({
      id: nextId(),
      property: side.label,
      figmaValue: `${figmaVal}px`,
      domValue: `${domVal}px`,
      severity: adjustSeverity(diff > 4 ? 'medium' : 'low', confidence),
      category: 'spacing',
      element: buildElementMeta(dom),
      figmaNodeName: figma.name,
      figmaNodeId: figma.nodeId,
      suggestion: `${side.label} should be ${figmaVal}px per Figma design (currently ${domVal}px).`,
      matchConfidence: confidence,
    })
  }

  return results
}

function compareGap(
  figma: NormalizedFigmaProps,
  dom: ExtractedElement,
  confidence: number
): FigmaDiscrepancy | null {
  if (figma.itemSpacing === undefined || !figma.layoutMode) return null

  const domGap = parsePx(dom.styles.gap)
  const diff = Math.abs(domGap - figma.itemSpacing)
  if (diff <= 1) return null

  return {
    id: nextId(),
    property: 'gap',
    figmaValue: `${figma.itemSpacing}px`,
    domValue: `${domGap}px`,
    severity: adjustSeverity(diff > 4 ? 'medium' : 'low', confidence),
    category: 'spacing',
    element: buildElementMeta(dom),
    figmaNodeName: figma.name,
    figmaNodeId: figma.nodeId,
    suggestion: `Gap should be ${figma.itemSpacing}px per Figma design (currently ${domGap}px).`,
    matchConfidence: confidence,
  }
}

function compareBorderWidth(
  figma: NormalizedFigmaProps,
  dom: ExtractedElement,
  confidence: number
): FigmaDiscrepancy | null {
  if (figma.borderWidth === undefined) return null

  const domWidth = parsePx(dom.styles.borderWidth)
  if (domWidth === figma.borderWidth) return null

  return {
    id: nextId(),
    property: 'border-width',
    figmaValue: `${figma.borderWidth}px`,
    domValue: `${domWidth}px`,
    severity: adjustSeverity('medium', confidence),
    category: 'spacing',
    element: buildElementMeta(dom),
    figmaNodeName: figma.name,
    figmaNodeId: figma.nodeId,
    suggestion: `Border width should be ${figma.borderWidth}px per Figma design (currently ${domWidth}px).`,
    matchConfidence: confidence,
  }
}

// ─── Content comparison ───────────────────────────────────

/**
 * Normalize text for comparison — handles invisible differences between
 * Figma and DOM that look identical to the eye:
 * - Smart quotes → straight quotes
 * - Em/en dashes → hyphens
 * - Non-breaking spaces → regular spaces
 * - Collapse all whitespace
 */
function normalizeTextForComparison(text: string): string {
  return text
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // smart single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')   // smart double quotes
    .replace(/[\u2013\u2014]/g, '-')                // en/em dashes
    .replace(/[\u00A0\u2000-\u200A\u202F\u205F]/g, ' ') // non-breaking & special spaces
    .replace(/[\u200B\u200C\u200D\uFEFF]/g, '')    // zero-width characters
    .replace(/\s+/g, ' ')                            // collapse whitespace
    .trim()
}

/**
 * Direct text comparison — independent of element matching.
 * For each Figma TEXT node, search the entire DOM text to see if it exists.
 * No element matching = no false positives from bad matches.
 */
function directTextComparison(
  figmaNodes: NormalizedFigmaProps[],
  domElements: ExtractedElement[]
): FigmaDiscrepancy[] {
  const results: FigmaDiscrepancy[] = []

  // Collect all DOM text (normalized) for searching
  const allDomText = domElements
    .map((el) => normalizeTextForComparison(el.textContent))
    .filter((t) => t.length > 0)

  // Also build one big concatenated page text for substring search
  const pageText = allDomText.join(' ')
  const pageAlpha = pageText.replace(/[^a-z0-9]/gi, '').toLowerCase()

  // Check each Figma TEXT node
  const textNodes = figmaNodes.filter(
    (n) => n.type === 'TEXT' && n.textContent && n.textContent.trim().length > 2
  )

  for (const fNode of textNodes) {
    const figmaRaw = fNode.textContent!.trim()
    const figmaNorm = normalizeTextForComparison(figmaRaw)
    const figmaAlpha = figmaNorm.replace(/[^a-z0-9]/gi, '').toLowerCase()

    if (figmaAlpha.length < 3) continue // skip very short text like "-", "/", etc.

    // Check 1: exact normalized match in any DOM element
    const exactMatch = allDomText.some((dt) => dt === figmaNorm)
    if (exactMatch) continue

    // Check 2: alphanumeric match (handles quote/apostrophe variants)
    const alphaMatch = allDomText.some((dt) =>
      dt.replace(/[^a-z0-9]/gi, '').toLowerCase() === figmaAlpha
    )
    if (alphaMatch) continue

    // Check 3: text exists as substring in page text (handles split across elements)
    if (pageAlpha.includes(figmaAlpha)) continue

    // Check 4: capitalization difference — same letters, different case
    const figmaLower = figmaNorm.toLowerCase()
    const capMatch = allDomText.some((dt) => dt.toLowerCase() === figmaLower)
    if (capMatch) {
      const domVersion = allDomText.find((dt) => dt.toLowerCase() === figmaLower) || ''
      results.push({
        id: nextId(),
        property: 'text-content (capitalization)',
        figmaValue: `"${truncate(figmaRaw, 80)}"`,
        domValue: `"${truncate(domVersion, 80)}"`,
        severity: 'medium',
        category: 'content',
        element: { selector: '', tagName: '', textContent: domVersion.slice(0, 60), description: `Text in page`, role: 'text', accessibleName: '', region: '', parentContext: '' },
        figmaNodeName: fNode.name,
        figmaNodeId: fNode.nodeId,
        suggestion: `Text capitalization differs from Figma design.`,
        matchConfidence: 1.0,
      })
      continue
    }

    // Text is genuinely missing from the page
    results.push({
      id: nextId(),
      property: 'text-content (missing)',
      figmaValue: `"${truncate(figmaRaw, 80)}"`,
      domValue: '(not found on page)',
      severity: 'high',
      category: 'content',
      element: { selector: '', tagName: '', textContent: '', description: 'Missing from page', role: 'text', accessibleName: '', region: '', parentContext: '' },
      figmaNodeName: fNode.name,
      figmaNodeId: fNode.nodeId,
      suggestion: `This text from Figma was not found on the page.`,
      matchConfidence: 1.0,
    })
  }

  return results
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

/** Simple string similarity (0-1) based on common character bigrams */
function stringSimilarity(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0

  const bigramsA = new Set<string>()
  for (let i = 0; i < a.length - 1; i++) bigramsA.add(a.slice(i, i + 2))

  let matches = 0
  for (let i = 0; i < b.length - 1; i++) {
    if (bigramsA.has(b.slice(i, i + 2))) matches++
  }

  const total = (a.length - 1) + (b.length - 1)
  return (2 * matches) / total
}

// ─── Main Comparison ──────────────────────────────────────────

export function runFigmaComparison(
  matchedPairs: MatchedPair[],
  unmatchedFigma: NormalizedFigmaProps[],
  unmatchedDom: ExtractedElement[],
  figmaUrl: string,
  pageUrl: string,
  totalFigmaNodes: number,
  totalDomElements: number,
  allFigmaNodes: NormalizedFigmaProps[],
  allDomElements: ExtractedElement[]
): FigmaComparisonReport {
  discrepancyCounter = 0
  const discrepancies: FigmaDiscrepancy[] = []

  // ─── Visual comparisons (via matched pairs) ────────────────

  for (const pair of matchedPairs) {
    const { figmaNode, domElement, matchConfidence } = pair

    // Skip structural containers with no visual properties
    if (isStructuralNode(figmaNode)) continue

    const fillDisc = compareFillColor(figmaNode, domElement, matchConfidence)
    if (fillDisc) discrepancies.push(fillDisc)

    const textDisc = compareTextColor(figmaNode, domElement, matchConfidence)
    if (textDisc) discrepancies.push(textDisc)

    // Border color/width comparisons removed — too noisy, CSS border
    // inheritance and browser defaults produce too many false positives

    // Font-size comparison removed — too many false positives from
    // element mismatches and CSS inheritance. Rely on AI visual diff instead.

    // Font-weight comparison removed — element matching produces false positives.
    // AI visual diff catches real typography issues more reliably.

    // Font-family comparison removed — browser fallback chains always differ

    const radiusDisc = compareBorderRadius(figmaNode, domElement, matchConfidence)
    if (radiusDisc) discrepancies.push(radiusDisc)

    const paddingDiscs = comparePadding(figmaNode, domElement, matchConfidence)
    discrepancies.push(...paddingDiscs)

    const gapDisc = compareGap(figmaNode, domElement, matchConfidence)
    if (gapDisc) discrepancies.push(gapDisc)

  }

  // ─── Direct text comparison (independent of matching) ──────
  // For each Figma TEXT node, check if its text exists anywhere in the DOM.
  // No element matching needed — just a straight text search.
  const contentDiscs = directTextComparison(allFigmaNodes, allDomElements)
  discrepancies.push(...contentDiscs)

  const summary: Record<Severity, number> = {
    blocker: 0,
    high: 0,
    medium: 0,
    low: 0,
  }
  for (const d of discrepancies) {
    summary[d.severity]++
  }

  return {
    figmaUrl,
    pageUrl,
    timestamp: new Date().toISOString(),
    totalFigmaNodes,
    totalDomElements,
    matchedPairs: matchedPairs.length,
    unmatchedFigmaNodes: unmatchedFigma.map((n) => `${n.name} (${n.type})`),
    unmatchedDomElements: unmatchedDom.map((el) => el.description || el.selector).slice(0, 20),
    discrepancies,
    summary,
  }
}
