/**
 * Parses Dew Design System SCSS sources and generates a JSON token database.
 *
 * Sources:
 *   - _palette.scss  → raw hex values
 *   - light/_base.scss → semantic CSS custom properties
 *   - variables.scss  → spacing, border-radius, opacity, shadows
 */

import { readFileSync, writeFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))

// Paths to Dew Design System SCSS sources
const DEW_STYLES_ROOT = resolve(
  __dirname,
  '../../fw/fw-dew/packages/dew-styles/src/styles'
)
const PALETTE_PATH = resolve(DEW_STYLES_ROOT, 'colors/_palette.scss')
const BASE_PATH = resolve(DEW_STYLES_ROOT, 'colors/dew/light/_base.scss')
const VARIABLES_PATH = resolve(DEW_STYLES_ROOT, 'numbers/variables.scss')

const OUTPUT_PATH = resolve(__dirname, '../src/data/token-database.json')

// ─── Parse palette ──────────────────────────────────────────────

function parsePalette(content: string): Record<string, string> {
  const palette: Record<string, string> = {}
  // Match: $VariableName: #hexvalue;
  const re = /^\$([A-Za-z0-9_-]+):\s*(#[0-9a-fA-F]{3,8});/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(content)) !== null) {
    palette[match[1]] = match[2].toLowerCase()
  }
  return palette
}

// ─── Parse semantic tokens (light/_base.scss) ───────────────────

interface SemanticToken {
  cssVar: string
  paletteRef: string
  hex: string
  alpha?: number
}

function parseSemanticTokens(
  content: string,
  palette: Record<string, string>
): SemanticToken[] {
  const tokens: SemanticToken[] = []

  // Match: --css-var-name: #{palette.$PaletteRef};
  const solidRe = /--([a-z][a-z0-9-]*):\s*#\{palette\.\$([A-Za-z0-9_-]+)\}/g
  let match: RegExpExecArray | null
  while ((match = solidRe.exec(content)) !== null) {
    const cssVar = `--${match[1]}`
    const paletteRef = match[2]
    const hex = palette[paletteRef] || '#000000'
    tokens.push({ cssVar, paletteRef, hex })
  }

  // Match: --css-var-name: #{rgba(palette.$PaletteRef, alpha)};
  const rgbaRe =
    /--([a-z][a-z0-9-]*):\s*#\{rgba\(palette\.\$([A-Za-z0-9_-]+),\s*([\d.]+)\)\}/g
  while ((match = rgbaRe.exec(content)) !== null) {
    const cssVar = `--${match[1]}`
    const paletteRef = match[2]
    const alpha = parseFloat(match[3])
    const hex = palette[paletteRef] || '#000000'
    tokens.push({ cssVar, paletteRef, hex, alpha })
  }

  return tokens
}

// ─── Parse spacing / border-radius / opacity / shadows ──────────

function parseVariables(content: string) {
  const spacing: Record<string, number> = {}
  const borderRadius: Record<string, number> = {}
  const opacity: Record<string, number> = {}
  const shadows: Record<string, string> = {}
  const fontWeights: Record<string, number> = {}

  for (const line of content.split('\n')) {
    const trimmed = line.trim()

    // Spacing: $number-N: Npx;
    const spacingMatch = trimmed.match(
      /^\$(number-\d+):\s*(\d+)px;/
    )
    if (spacingMatch) {
      spacing[spacingMatch[1]] = parseInt(spacingMatch[2], 10)
      continue
    }

    // Border-radius: $number-br-*: Npx;
    const brMatch = trimmed.match(
      /^\$(number-br-[a-z]+):\s*(\d+)px;/
    )
    if (brMatch) {
      borderRadius[brMatch[1]] = parseInt(brMatch[2], 10)
      continue
    }

    // Opacity: $number-opacity-*: N;
    const opacityMatch = trimmed.match(
      /^\$(number-opacity-[a-z0-9]+):\s*([\d.]+);/
    )
    if (opacityMatch) {
      opacity[opacityMatch[1]] = parseFloat(opacityMatch[2])
      continue
    }

    // Box shadows: $box-shadow-*: value;
    const shadowMatch = trimmed.match(
      /^\$(box-shadow-[a-z0-9-]+):\s*(.+);/
    )
    if (shadowMatch) {
      shadows[shadowMatch[1]] = shadowMatch[2]
      continue
    }

    // Font weights
    const fwMatch = trimmed.match(
      /^\$(font-weight-[a-z-]+):\s*(\d+);/
    )
    if (fwMatch) {
      fontWeights[fwMatch[1]] = parseInt(fwMatch[2], 10)
      continue
    }
  }

  return { spacing, borderRadius, opacity, shadows, fontWeights }
}

// ─── Build reverse hex lookup ───────────────────────────────────

function buildReverseHexMap(
  tokens: SemanticToken[]
): Record<string, string[]> {
  const map: Record<string, string[]> = {}
  for (const t of tokens) {
    if (t.alpha !== undefined) continue // skip rgba tokens for reverse lookup
    const hex = t.hex.toLowerCase()
    if (!map[hex]) map[hex] = []
    map[hex].push(t.cssVar)
  }
  return map
}

// ─── Main ───────────────────────────────────────────────────────

function main() {
  console.log('Building Dew token database...')

  const paletteContent = readFileSync(PALETTE_PATH, 'utf-8')
  const baseContent = readFileSync(BASE_PATH, 'utf-8')
  const varsContent = readFileSync(VARIABLES_PATH, 'utf-8')

  const palette = parsePalette(paletteContent)
  console.log(`  Parsed ${Object.keys(palette).length} palette colors`)

  const semanticTokens = parseSemanticTokens(baseContent, palette)
  console.log(`  Parsed ${semanticTokens.length} semantic tokens`)

  const { spacing, borderRadius, opacity, shadows, fontWeights } =
    parseVariables(varsContent)
  console.log(
    `  Parsed ${Object.keys(spacing).length} spacing, ${Object.keys(borderRadius).length} border-radius, ${Object.keys(shadows).length} shadow tokens`
  )

  const reverseHex = buildReverseHexMap(semanticTokens)

  // Also add palette values to reverse lookup
  const paletteReverseHex: Record<string, string[]> = {}
  for (const [name, hex] of Object.entries(palette)) {
    const h = hex.toLowerCase()
    if (!paletteReverseHex[h]) paletteReverseHex[h] = []
    paletteReverseHex[h].push(`$${name}`)
  }

  const spacingScale = Object.values(spacing).sort((a, b) => a - b)
  const borderRadiusValues = Object.values(borderRadius).sort((a, b) => a - b)

  const db = {
    palette,
    semanticTokens: semanticTokens.map((t) => ({
      cssVar: t.cssVar,
      paletteRef: `$${t.paletteRef}`,
      hex: t.hex,
      ...(t.alpha !== undefined ? { alpha: t.alpha } : {}),
    })),
    reverseHex,
    paletteReverseHex,
    spacing: {
      tokens: spacing,
      scale: spacingScale,
    },
    borderRadius: {
      tokens: borderRadius,
      values: borderRadiusValues,
    },
    opacity,
    shadows,
    fontWeights,
    typography: {
      fontFamily: 'Inter Variable',
      validSizes: [12, 14, 16, 18, 20, 24, 28, 32],
      validWeights: [400, 500, 600, 700],
    },
  }

  writeFileSync(OUTPUT_PATH, JSON.stringify(db, null, 2))
  console.log(`  Written to ${OUTPUT_PATH}`)
  console.log('Done.')
}

main()
