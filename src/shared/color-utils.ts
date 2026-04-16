/**
 * Color conversion and contrast utilities for VQA comparisons.
 */

/** Parse CSS rgb/rgba string to [r, g, b, a] */
export function parseRgb(
  color: string
): [number, number, number, number] | null {
  // rgb(R, G, B) or rgba(R, G, B, A)
  const match = color.match(
    /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)/
  )
  if (!match) return null
  return [
    parseInt(match[1], 10),
    parseInt(match[2], 10),
    parseInt(match[3], 10),
    match[4] !== undefined ? parseFloat(match[4]) : 1,
  ]
}

/** Convert [r, g, b] to lowercase hex string like #ff00aa */
export function rgbToHex(r: number, g: number, b: number): string {
  const toHex = (n: number) => n.toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/** Parse a hex string to [r, g, b] */
export function hexToRgb(hex: string): [number, number, number] | null {
  const clean = hex.replace('#', '')
  if (clean.length === 3) {
    return [
      parseInt(clean[0] + clean[0], 16),
      parseInt(clean[1] + clean[1], 16),
      parseInt(clean[2] + clean[2], 16),
    ]
  }
  if (clean.length === 6) {
    return [
      parseInt(clean.slice(0, 2), 16),
      parseInt(clean.slice(2, 4), 16),
      parseInt(clean.slice(4, 6), 16),
    ]
  }
  return null
}

/** Relative luminance per WCAG 2.2 */
export function relativeLuminance(r: number, g: number, b: number): number {
  const [rs, gs, bs] = [r / 255, g / 255, b / 255].map((c) =>
    c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  )
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/** WCAG contrast ratio between two colors */
export function contrastRatio(
  rgb1: [number, number, number],
  rgb2: [number, number, number]
): number {
  const l1 = relativeLuminance(...rgb1)
  const l2 = relativeLuminance(...rgb2)
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

/** Check if contrast meets WCAG 2.2 AA for given font size */
export function meetsWcagAA(
  ratio: number,
  fontSizePx: number,
  isBold: boolean
): boolean {
  const isLargeText =
    fontSizePx >= 24 || (fontSizePx >= 18.66 && isBold)
  return isLargeText ? ratio >= 3 : ratio >= 4.5
}

/** Parse a CSS color value to hex. Handles rgb(), rgba(), and hex. */
export function cssColorToHex(color: string): string | null {
  if (!color || color === 'transparent' || color === 'rgba(0, 0, 0, 0)') {
    return null
  }

  // Already hex
  if (color.startsWith('#')) {
    return color.toLowerCase()
  }

  const rgba = parseRgb(color)
  if (!rgba) return null

  return rgbToHex(rgba[0], rgba[1], rgba[2])
}

/** Find the closest value in a sorted array */
export function findClosest(value: number, sorted: number[]): number {
  let closest = sorted[0]
  let minDiff = Math.abs(value - closest)
  for (const v of sorted) {
    const diff = Math.abs(value - v)
    if (diff < minDiff) {
      minDiff = diff
      closest = v
    }
  }
  return closest
}

/** Parse px string to number (e.g. "16px" -> 16) */
export function parsePx(value: string): number {
  return parseFloat(value) || 0
}
