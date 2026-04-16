/**
 * Parses Dew component spec.md files and extracts structured token rules.
 *
 * Handles two token formats found in specs:
 *   - Slash-path: "Color/Fill/Brand" → "--color-fill-brand"
 *   - CSS var:    "--color-fill-brand" (used directly)
 *
 * Output: component-specs.json with rules per component/variant/state/property
 */

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

const COMPONENTS_ROOT = resolve(
  __dirname,
  '../../fw/fw-dew/packages/dew-components/src/lib/components'
)
const TOKEN_DB_PATH = resolve(__dirname, '../src/data/token-database.json')
const OUTPUT_PATH = resolve(__dirname, '../src/data/component-specs.json')

interface ComponentRule {
  component: string
  variant: string
  state: string
  property: string
  tokenPath: string
  cssVar: string
  hex: string
}

interface TokenDB {
  palette: Record<string, string>
  semanticTokens: { cssVar: string; hex: string }[]
}

// ─── Token path conversion ──────────────────────────────────

/**
 * Convert slash-path token names to CSS variable names.
 * "Color/Fill/Brand" → "--color-fill-brand"
 * "Color/Boundary/Border/Mildest" → "--color-boundary-border-mildest"
 * "Color/Fill/Semantic/Error/Bold" → "--color-fill-semantic-error-bold"
 */
function tokenPathToCssVar(path: string): string {
  return '--' + path.toLowerCase().replace(/\//g, '-')
}

/**
 * If input is already a CSS var (starts with --), return as-is.
 * Otherwise treat as slash-path and convert.
 */
function normalizeToken(token: string): string {
  token = token.trim()
  if (token.startsWith('--')) return token
  if (token.includes('/')) return tokenPathToCssVar(token)
  return token
}

/**
 * Resolve a CSS var name to its hex value using the token database.
 */
function resolveHex(cssVar: string, tokenDb: TokenDB): string {
  const entry = tokenDb.semanticTokens.find((t) => t.cssVar === cssVar)
  return entry?.hex || ''
}

// ─── Spec parsing ───────────────────────────────────────────

/**
 * Extract token references from a cell value.
 * Handles: "Color/Fill/Brand", "--color-fill-brand",
 * "Color/Fill/Brand + Opacity/Half", "none", composite values with "+"
 * Returns array of {token, cssVar} pairs
 */
function extractTokensFromCell(cell: string): { token: string; cssVar: string }[] {
  if (!cell || cell.trim() === 'none' || cell.trim() === '-' || cell.trim() === '—') {
    return []
  }

  const results: { token: string; cssVar: string }[] = []

  // Split by "+" to handle composite values like "Color/Fill/Brand + Opacity/Half"
  // Also split by "," for comma-separated tokens
  const parts = cell.split(/[+,]/).map((s) => s.trim())

  for (const part of parts) {
    // Skip non-token text
    if (!part) continue
    if (/^(none|focus indicator|focus|underline|underlined text|no underline|\d+px)$/i.test(part)) continue
    if (/^(outer|inner)$/i.test(part)) continue

    // Match CSS var format: --color-fill-brand
    const cssVarMatch = part.match(/(--[a-z][a-z0-9-]+)/i)
    if (cssVarMatch) {
      results.push({ token: cssVarMatch[1], cssVar: cssVarMatch[1] })
      continue
    }

    // Match slash-path format: Color/Fill/Brand, also handles "shadow-xs", "Opacity/Half"
    const slashMatch = part.match(/([A-Z][a-zA-Z]+(?:\/[A-Za-z-]+)+)/i)
    if (slashMatch) {
      const cssVar = normalizeToken(slashMatch[1])
      results.push({ token: slashMatch[1], cssVar })
      continue
    }

    // Match standalone shadow tokens: shadow-xs, shadow-sm, shadow-active-button
    const shadowMatch = part.match(/(shadow-[a-z-]+)/i)
    if (shadowMatch) {
      results.push({ token: shadowMatch[1], cssVar: shadowMatch[1] })
      continue
    }
  }

  return results
}

/**
 * Map column headers to CSS property categories.
 */
function headerToProperty(header: string): string {
  const h = header.toLowerCase().trim()
  if (h.includes('fill') || h.includes('background') || h.includes('bg')) return 'background-color'
  if (h.includes('text') && !h.includes('decoration')) return 'color'
  if (h.includes('icon')) return 'color'
  if (h.includes('border') || h.includes('boundary')) return 'border-color'
  if (h.includes('effect') || h.includes('shadow')) return 'border-color' // combined column
  if (h.includes('additional')) return 'misc'
  return 'misc'
}

/**
 * Infer variant from section heading.
 * "### 6.3 Primary Button States" → "primary"
 * "### Colors: Unchecked State" → "unchecked"
 */
function inferVariant(heading: string): string {
  const h = heading.toLowerCase()

  // Button-style: "6.3 Primary Button States"
  const btnMatch = h.match(/(primary|secondary|link|destructive|custom|icon|hyperlink|dropdown|split)/i)
  if (btnMatch) return btnMatch[1].toLowerCase()

  // Checkbox-style: "Colors: Unchecked State"
  const stateMatch = h.match(/:\s*(unchecked|checked|indeterminate|default|active|inactive)/i)
  if (stateMatch) return stateMatch[1].toLowerCase()

  return 'default'
}

/**
 * Parse a markdown table and extract rules.
 */
function parseStateTable(
  component: string,
  variant: string,
  tableLines: string[],
  tokenDb: TokenDB
): ComponentRule[] {
  const rules: ComponentRule[] = []

  if (tableLines.length < 3) return rules // need header + separator + at least 1 row

  // Parse header
  const headerCells = tableLines[0]
    .split('|')
    .map((c) => c.trim())
    .filter(Boolean)

  // Skip separator line (index 1)
  // Parse data rows
  for (let i = 2; i < tableLines.length; i++) {
    const cells = tableLines[i]
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean)

    if (cells.length < 2) continue

    // First cell is the state name
    const state = cells[0].replace(/`/g, '').trim().toLowerCase()
    if (!state) continue

    // Process each subsequent cell
    for (let j = 1; j < cells.length && j < headerCells.length; j++) {
      const header = headerCells[j]
      const cellValue = cells[j]
      const property = headerToProperty(header)

      const tokens = extractTokensFromCell(cellValue)
      for (const { token, cssVar } of tokens) {
        const hex = resolveHex(cssVar, tokenDb)
        rules.push({
          component,
          variant,
          state,
          property,
          tokenPath: token,
          cssVar,
          hex,
        })
      }
    }
  }

  return rules
}

/**
 * Parse a component's spec.md and extract all token rules.
 */
function parseSpecFile(
  filePath: string,
  componentName: string,
  tokenDb: TokenDB
): ComponentRule[] {
  const content = readFileSync(filePath, 'utf-8')
  const lines = content.split('\n')
  const allRules: ComponentRule[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // Look for section headings that contain state tables
    const headingMatch = line.match(/^#{2,4}\s+(.+)/)
    if (headingMatch) {
      const heading = headingMatch[1]

      // Check if this section likely contains a state table
      const isStateSection =
        /state|color|visual|token/i.test(heading) &&
        !/typography|sizing|spacing|shadow|decomposition|overview|prop|api|accessibility|keyboard|interaction|responsive|edge|verified|anatomy/i.test(heading)

      if (isStateSection) {
        // Look for a table starting within the next few lines
        let j = i + 1
        while (j < lines.length && j < i + 5) {
          if (lines[j].startsWith('|')) {
            // Found a table — collect all table lines
            const tableLines: string[] = []
            while (j < lines.length && lines[j].startsWith('|')) {
              tableLines.push(lines[j])
              j++
            }

            // Check if this table has a State column and token columns
            const header = tableLines[0].toLowerCase()
            if (header.includes('state') && (header.includes('token') || header.includes('color') || header.includes('fill') || header.includes('text') || header.includes('border') || header.includes('background') || header.includes('icon') || header.includes('bg'))) {
              const variant = inferVariant(heading)
              const rules = parseStateTable(componentName, variant, tableLines, tokenDb)
              allRules.push(...rules)
            }

            break
          }
          j++
        }
      }
    }
    i++
  }

  return allRules
}

// ─── Main ───────────────────────────────────────────────────

function main() {
  console.log('Building component spec database...')

  // Load token database for hex resolution
  const tokenDb: TokenDB = JSON.parse(readFileSync(TOKEN_DB_PATH, 'utf-8'))

  const allRules: ComponentRule[] = []
  let componentCount = 0

  // Scan all component directories for spec.md
  const componentDirs = readdirSync(COMPONENTS_ROOT, { withFileTypes: true })
    .filter((d) => d.isDirectory())

  for (const dir of componentDirs) {
    const specPath = resolve(COMPONENTS_ROOT, dir.name, 'Docs', 'spec.md')
    if (!existsSync(specPath)) continue

    const rules = parseSpecFile(specPath, dir.name, tokenDb)
    if (rules.length > 0) {
      console.log(`  ${dir.name}: ${rules.length} rules`)
      allRules.push(...rules)
      componentCount++
    }
  }

  // Build a lookup structure: component -> variant -> state -> property -> rule
  const lookup: Record<string, Record<string, Record<string, Record<string, ComponentRule[]>>>> = {}

  for (const rule of allRules) {
    const comp = rule.component.toLowerCase()
    const variant = rule.variant
    const state = rule.state
    const prop = rule.property

    if (!lookup[comp]) lookup[comp] = {}
    if (!lookup[comp][variant]) lookup[comp][variant] = {}
    if (!lookup[comp][variant][state]) lookup[comp][variant][state] = {}
    if (!lookup[comp][variant][state][prop]) lookup[comp][variant][state][prop] = []
    lookup[comp][variant][state][prop].push(rule)
  }

  const output = {
    rules: allRules,
    lookup,
    meta: {
      componentCount,
      totalRules: allRules.length,
      generatedAt: new Date().toISOString(),
    },
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2))
  console.log(`\n  ${componentCount} components, ${allRules.length} total rules`)
  console.log(`  Written to ${OUTPUT_PATH}`)
  console.log('Done.')
}

main()
