import type {
  TokenDatabase,
  ComponentSpecDatabase,
  ComponentRule,
  ExtractedElement,
  Violation,
  VqaReport,
  Severity,
  ViolationCategory,
} from '../shared/types'
import {
  cssColorToHex,
  parsePx,
  findClosest,
  parseRgb,
  hexToRgb,
  contrastRatio,
  meetsWcagAA,
} from '../shared/color-utils'

let violationCounter = 0
let componentSpecs: ComponentSpecDatabase | null = null

export function setComponentSpecs(specs: ComponentSpecDatabase) {
  componentSpecs = specs
}

function nextId(): string {
  violationCounter++
  return `VQA-${String(violationCounter).padStart(3, '0')}`
}

function violation(
  category: ViolationCategory,
  severity: Severity,
  property: string,
  actual: string,
  expected: string,
  suggestion: string,
  element: ExtractedElement
): Violation {
  return {
    id: nextId(),
    category,
    severity,
    property,
    actual,
    expected,
    suggestion,
    element: {
      selector: element.selector,
      tagName: element.tagName,
      textContent: element.textContent.slice(0, 60),
      description: element.description || `<${element.tagName.toLowerCase()}>`,
      role: element.role || element.tagName.toLowerCase(),
      accessibleName: element.accessibleName || '',
      region: element.region || '',
      parentContext: element.parentContext || '',
      dew: element.dew,
    },
  }
}

// ─── Component spec lookup ──────────────────────────────────

/**
 * Look up what token a specific component+variant+state should use for a CSS property.
 * Returns the matching rules, or empty array if no component spec match.
 */
function lookupComponentRules(
  el: ExtractedElement,
  cssProperty: string
): ComponentRule[] {
  if (!componentSpecs?.lookup || !el.dew?.isDewComponent) return []

  const comp = el.dew.componentName.toLowerCase()
  const variant = el.dew.componentVariant || 'default'
  const state = el.dew.componentState || 'normal'

  // Map CSS property to spec property names
  const propMapping: Record<string, string> = {
    'color': 'color',
    'background-color': 'background-color',
    'border-color': 'border-color',
  }
  const specProp = propMapping[cssProperty] || cssProperty

  const compLookup = componentSpecs.lookup[comp]
  if (!compLookup) return []

  // Try exact variant, then fall back to 'default'
  const variantLookup = compLookup[variant] || compLookup['default']
  if (!variantLookup) return []

  // Try exact state, then fall back to 'normal' or 'default'
  const stateLookup = variantLookup[state] || variantLookup['normal'] || variantLookup['default']
  if (!stateLookup) return []

  return stateLookup[specProp] || []
}

/**
 * Build a component-specific suggestion string.
 */
function componentSuggestion(
  rules: ComponentRule[],
  cssProperty: string
): { expected: string; suggestion: string } | null {
  if (rules.length === 0) return null

  // Filter to actual color tokens (not shadows)
  const colorRules = rules.filter(r => r.cssVar.startsWith('--color-'))
  if (colorRules.length === 0) return null

  const rule = colorRules[0]
  const hexPart = rule.hex ? ` (${rule.hex})` : ''
  const compLabel = `${rule.component} (${rule.variant}, ${rule.state})`

  return {
    expected: `${rule.cssVar}${hexPart}`,
    suggestion: `${compLabel} ${cssProperty} should be \`${rule.cssVar}\`${hexPart} per Dew spec.`,
  }
}

// ─── Closest token matching (for non-Dew elements) ─────────

/** Map CSS property to relevant token prefixes */
const PROPERTY_TOKEN_PREFIXES: Record<string, string[]> = {
  'color': ['--color-text-'],
  'background-color': ['--color-fill-'],
  'border-color': ['--color-boundary-'],
}

/** RGB Euclidean distance */
function colorDistance(
  a: [number, number, number],
  b: [number, number, number]
): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
  )
}

/**
 * Find the closest semantic token for a given hex color, filtered by CSS property type.
 */
function findClosestToken(
  hex: string,
  cssProperty: string,
  db: TokenDatabase
): { cssVar: string; hex: string; distance: number } | null {
  const targetRgb = hexToRgb(hex)
  if (!targetRgb) return null

  const prefixes = PROPERTY_TOKEN_PREFIXES[cssProperty]
  // Filter tokens to relevant category, or search all if no mapping
  const candidates = db.semanticTokens.filter((t) => {
    if (!t.hex || t.hex === '#000000') return false
    if (!prefixes) return t.cssVar.startsWith('--color-')
    return prefixes.some((p) => t.cssVar.startsWith(p))
  })

  let best: { cssVar: string; hex: string; distance: number } | null = null

  for (const token of candidates) {
    const tokenRgb = hexToRgb(token.hex)
    if (!tokenRgb) continue
    const dist = colorDistance(targetRgb, tokenRgb)
    if (!best || dist < best.distance) {
      best = { cssVar: token.cssVar, hex: token.hex, distance: Math.round(dist) }
    }
  }

  return best
}

// ─── Color checks ───────────────────────────────────────────

function checkColor(
  prop: string,
  value: string,
  db: TokenDatabase,
  el: ExtractedElement,
  violations: Violation[]
): void {
  const hex = cssColorToHex(value)
  if (!hex) return

  // Check against semantic tokens first, then palette
  const semanticMatches = db.reverseHex[hex]
  if (semanticMatches && semanticMatches.length > 0) return

  const paletteMatches = db.paletteReverseHex[hex]

  // Try component-specific suggestion (for Dew components)
  const rules = lookupComponentRules(el, prop)
  const compSuggestion = componentSuggestion(rules, prop)

  // For non-Dew elements, find closest matching token
  const closestToken = !compSuggestion ? findClosestToken(hex, prop, db) : null
  const closestSuggestion = closestToken
    ? {
        expected: `${closestToken.cssVar} (${closestToken.hex})`,
        suggestion: `Not a Dew component. Closest match: \`${closestToken.cssVar}\` (${closestToken.hex}).`,
      }
    : null

  // Pick the best suggestion: component spec > closest token > generic
  const bestExpected = compSuggestion?.expected || closestSuggestion?.expected || 'A Dew design token color'
  const bestSuggestion = compSuggestion?.suggestion || closestSuggestion?.suggestion || 'This color does not match any Dew token.'

  if (paletteMatches && paletteMatches.length > 0) {
    violations.push(
      violation(
        'color',
        'medium',
        prop,
        `${value} (${hex}) — palette: ${paletteMatches.join(', ')}`,
        compSuggestion?.expected || 'A semantic token (--color-*)',
        compSuggestion?.suggestion ||
          closestSuggestion?.suggestion ||
          `Use a semantic token instead of raw palette reference. Palette match: ${paletteMatches.join(', ')}`,
        el
      )
    )
    return
  }

  // Not in any token
  violations.push(
    violation(
      'color',
      'high',
      prop,
      `${value} (${hex})`,
      bestExpected,
      bestSuggestion,
      el
    )
  )
}

// ─── Spacing checks ─────────────────────────────────────────

function checkSpacing(
  prop: string,
  value: string,
  db: TokenDatabase,
  el: ExtractedElement,
  violations: Violation[]
): void {
  const px = parsePx(value)
  if (px === 0) return

  if (db.spacing.scale.includes(px)) return

  const closest = findClosest(px, db.spacing.scale)
  const diff = Math.abs(px - closest)

  if (diff <= 1) return

  violations.push(
    violation(
      'spacing',
      diff <= 2 ? 'low' : 'medium',
      prop,
      `${px}px`,
      `${closest}px (nearest token)`,
      `Spacing ${px}px is not on the Dew scale. Use ${closest}px ($number-${closest}).`,
      el
    )
  )
}

// ─── Border-radius checks ───────────────────────────────────

function checkBorderRadius(
  value: string,
  db: TokenDatabase,
  el: ExtractedElement,
  violations: Violation[]
): void {
  const px = parsePx(value)
  if (px === 0) return

  if (db.borderRadius.values.includes(px)) return

  const closest = findClosest(px, db.borderRadius.values)
  violations.push(
    violation(
      'border-radius',
      'medium',
      'border-radius',
      `${px}px`,
      `${closest}px (nearest token)`,
      `Border-radius ${px}px is not a Dew token value. Use ${closest}px.`,
      el
    )
  )
}

// ─── Typography checks ──────────────────────────────────────

function checkTypography(
  el: ExtractedElement,
  db: TokenDatabase,
  violations: Violation[]
): void {
  const { fontFamily, fontSize, fontWeight } = el.styles

  if (fontFamily && !fontFamily.toLowerCase().includes('inter')) {
    violations.push(
      violation(
        'typography',
        'high',
        'font-family',
        fontFamily,
        db.typography.fontFamily,
        `Font should be "${db.typography.fontFamily}".`,
        el
      )
    )
  }

  const size = parsePx(fontSize)
  if (size > 0 && !db.typography.validSizes.includes(size)) {
    const closest = findClosest(size, db.typography.validSizes)
    violations.push(
      violation(
        'typography',
        'medium',
        'font-size',
        `${size}px`,
        `${closest}px (nearest valid size)`,
        `Font size ${size}px is not in the Dew type scale.`,
        el
      )
    )
  }

  const weight = parseInt(fontWeight, 10)
  if (weight && !db.typography.validWeights.includes(weight)) {
    violations.push(
      violation(
        'typography',
        'low',
        'font-weight',
        `${weight}`,
        db.typography.validWeights.join(' | '),
        `Font weight ${weight} is not a standard Dew weight.`,
        el
      )
    )
  }
}

// ─── Contrast checks ────────────────────────────────────────

function checkContrast(
  el: ExtractedElement,
  violations: Violation[]
): void {
  const fgRgba = parseRgb(el.styles.color)
  const bgRgba = parseRgb(el.styles.backgroundColor)

  if (!fgRgba || !bgRgba) return
  if (bgRgba[3] < 0.1) return

  const fgRgb: [number, number, number] = [fgRgba[0], fgRgba[1], fgRgba[2]]
  const bgRgb: [number, number, number] = [bgRgba[0], bgRgba[1], bgRgba[2]]

  const ratio = contrastRatio(fgRgb, bgRgb)
  const size = parsePx(el.styles.fontSize)
  const isBold = parseInt(el.styles.fontWeight, 10) >= 600

  if (!meetsWcagAA(ratio, size, isBold)) {
    violations.push(
      violation(
        'contrast',
        'blocker',
        'color / background-color',
        `${ratio.toFixed(2)}:1`,
        size >= 24 || (size >= 18.66 && isBold) ? '3:1 (large text)' : '4.5:1 (normal text)',
        `Contrast ratio ${ratio.toFixed(2)}:1 fails WCAG 2.2 AA. Increase contrast between text and background.`,
        el
      )
    )
  }
}

// ─── Main scan ──────────────────────────────────────────────

export function runComparison(
  elements: ExtractedElement[],
  db: TokenDatabase,
  pageUrl: string
): VqaReport {
  violationCounter = 0
  const violations: Violation[] = []

  for (const el of elements) {
    const s = el.styles

    checkColor('color', s.color, db, el, violations)
    checkColor('background-color', s.backgroundColor, db, el, violations)
    checkColor('border-color', s.borderColor, db, el, violations)

    checkSpacing('padding-top', s.paddingTop, db, el, violations)
    checkSpacing('padding-right', s.paddingRight, db, el, violations)
    checkSpacing('padding-bottom', s.paddingBottom, db, el, violations)
    checkSpacing('padding-left', s.paddingLeft, db, el, violations)
    checkSpacing('gap', s.gap, db, el, violations)

    checkBorderRadius(s.borderTopLeftRadius, db, el, violations)

    const textTags = [
      'P', 'SPAN', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'A', 'BUTTON', 'LABEL', 'LI', 'TD', 'TH', 'CAPTION',
    ]
    if (
      textTags.includes(el.tagName) ||
      (el.textContent && el.textContent.trim().length > 0)
    ) {
      checkTypography(el, db, violations)
    }

    if (el.textContent && el.textContent.trim().length > 0) {
      checkContrast(el, violations)
    }
  }

  const summary: Record<Severity, number> = {
    blocker: 0,
    high: 0,
    medium: 0,
    low: 0,
  }
  for (const v of violations) {
    summary[v.severity]++
  }

  return {
    url: pageUrl,
    timestamp: new Date().toISOString(),
    totalElements: elements.length,
    violations,
    summary,
  }
}
