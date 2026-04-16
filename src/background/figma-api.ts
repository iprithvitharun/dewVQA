import type { FigmaFrameRef, FigmaNode, NormalizedFigmaProps, FigmaBoundingBox, FigmaPaint } from '../shared/types'
import { rgbToHex } from '../shared/color-utils'

// ─── URL Parsing ──────────────────────────────────────────────

/**
 * Parse a Figma URL to extract fileKey and nodeId.
 *
 * Supported formats:
 *   https://figma.com/design/ABC123/FileName?node-id=456-789
 *   https://www.figma.com/design/ABC123/FileName?node-id=456-789
 *   https://figma.com/design/ABC123/branch/BRANCH/FileName?node-id=456-789
 *   https://figma.com/file/ABC123/FileName?node-id=456-789
 */
export function parseFigmaUrl(url: string): FigmaFrameRef | null {
  try {
    const parsed = new URL(url)
    if (!parsed.hostname.endsWith('figma.com')) return null

    const segments = parsed.pathname.split('/').filter(Boolean)
    // /design/:fileKey/... or /file/:fileKey/...
    const typeIndex = segments.findIndex(s => s === 'design' || s === 'file')
    if (typeIndex === -1 || !segments[typeIndex + 1]) return null

    let fileKey: string

    // Check for branch URLs: /design/:fileKey/branch/:branchKey/...
    const branchIndex = segments.indexOf('branch')
    if (branchIndex !== -1 && segments[branchIndex + 1]) {
      fileKey = segments[branchIndex + 1]
    } else {
      fileKey = segments[typeIndex + 1]
    }

    // Node ID from query param (dash-separated in URL, colon-separated in API)
    const nodeIdParam = parsed.searchParams.get('node-id')
    if (!nodeIdParam) return null

    const nodeId = nodeIdParam.replace(/-/g, ':')

    return { fileKey, nodeId }
  } catch {
    return null
  }
}

// ─── Token Storage ────────────────────────────────────────────

export async function getFigmaToken(): Promise<string | null> {
  const result = await chrome.storage.local.get('figmaToken')
  return result.figmaToken || null
}

export async function setFigmaToken(token: string): Promise<void> {
  await chrome.storage.local.set({ figmaToken: token })
}

export async function clearFigmaToken(): Promise<void> {
  await chrome.storage.local.remove('figmaToken')
}

// ─── API Fetch ────────────────────────────────────────────────

/**
 * Fetch the Figma node tree for a given frame reference.
 * Returns the root node of the requested subtree.
 */
export async function fetchFigmaNodes(
  ref: FigmaFrameRef,
  token: string
): Promise<FigmaNode> {
  const url = `https://api.figma.com/v1/files/${ref.fileKey}/nodes?ids=${encodeURIComponent(ref.nodeId)}`

  const response = await fetch(url, {
    headers: { 'X-Figma-Token': token },
  })

  if (!response.ok) {
    if (response.status === 403) {
      throw new Error('Invalid Figma token or no access to this file.')
    }
    if (response.status === 404) {
      throw new Error('Figma file or node not found. Check the URL.')
    }
    if (response.status === 429) {
      throw new Error('Figma API rate limit reached. Wait a moment and try again.')
    }
    throw new Error(`Figma API error: ${response.status} ${response.statusText}`)
  }

  const data = await response.json()

  // Response shape: { nodes: { "nodeId": { document: FigmaNode } } }
  const nodeEntry = data.nodes?.[ref.nodeId]
  if (!nodeEntry?.document) {
    throw new Error(`Node ${ref.nodeId} not found in Figma response.`)
  }

  return nodeEntry.document as FigmaNode
}

// ─── Tree Flattening ──────────────────────────────────────────

/** Extract hex color from the first visible SOLID paint */
function extractSolidColor(paints?: FigmaPaint[]): string | null {
  if (!paints) return null
  for (const paint of paints) {
    if (paint.type !== 'SOLID') continue
    if (paint.visible === false) continue
    if (!paint.color) continue

    const r = Math.round(paint.color.r * 255)
    const g = Math.round(paint.color.g * 255)
    const b = Math.round(paint.color.b * 255)
    return rgbToHex(r, g, b)
  }
  return null
}

/** Node types that are decorative/structural and shouldn't be compared */
const SKIP_TYPES = new Set([
  'VECTOR', 'LINE', 'BOOLEAN_OPERATION', 'SLICE',
  'CONNECTOR', 'SHAPE_WITH_TEXT', 'STICKY', 'STAMP',
  'ELLIPSE', // decorative circles, dots
])

/** Minimum size (px) for a node to be considered meaningful */
const MIN_NODE_SIZE = 8

/**
 * Check if a node has any meaningful visual properties worth comparing.
 * Nodes with no fill, no stroke, no text, and no layout are noise.
 */
function hasMeaningfulProps(node: FigmaNode): boolean {
  // TEXT nodes are always meaningful (if they have content)
  if (node.type === 'TEXT' && node.characters && node.characters.trim().length > 0) return true

  // Has visible fill (not just white/transparent on a pure wrapper)
  if (node.fills?.some(f => f.type === 'SOLID' && f.visible !== false && f.color)) return true

  // Has visible stroke
  if (node.strokes?.some(f => f.type === 'SOLID' && f.visible !== false && f.color)) return true

  // Is an auto-layout container (spacing matters)
  if (node.layoutMode && node.layoutMode !== 'NONE') return true

  // Has border radius
  if (node.cornerRadius && node.cornerRadius > 0) return true

  // Is a COMPONENT or INSTANCE (always meaningful)
  if (node.type === 'COMPONENT' || node.type === 'INSTANCE') return true

  // Pure wrapper FRAMEs with no visual properties → skip
  // (they're just positioning containers)
  return false
}

/**
 * Check if a FRAME is just a wrapper around a single TEXT child with the same bounds.
 * If so, the FRAME is redundant — keep only the TEXT.
 */
function isRedundantTextWrapper(node: FigmaNode): boolean {
  if (node.type !== 'FRAME' && node.type !== 'GROUP') return false
  if (!node.children || node.children.length !== 1) return false
  const child = node.children[0]
  if (child.type !== 'TEXT') return false
  // Check if bounds are roughly the same
  if (node.absoluteBoundingBox && child.absoluteBoundingBox) {
    const parentBox = node.absoluteBoundingBox
    const childBox = child.absoluteBoundingBox
    const widthDiff = Math.abs(parentBox.width - childBox.width)
    const heightDiff = Math.abs(parentBox.height - childBox.height)
    if (widthDiff < 4 && heightDiff < 4) return true
  }
  return false
}

/**
 * Recursively walk a Figma node tree and normalize each visible node
 * into a flat array of NormalizedFigmaProps.
 *
 * Filters out decorative/noise nodes (vectors, tiny shapes, nodes without
 * meaningful visual properties) to keep the comparison focused.
 *
 * @param node - Current Figma node
 * @param frameOrigin - The absoluteBoundingBox of the root frame (for relative positioning)
 * @param isRoot - Whether this is the root node (always included)
 */
export function flattenFigmaTree(
  node: FigmaNode,
  frameOrigin?: FigmaBoundingBox,
  isRoot: boolean = true
): NormalizedFigmaProps[] {
  const results: NormalizedFigmaProps[] = []

  // Skip invisible nodes
  if (node.visible === false) return results

  // Skip decorative node types (but still recurse into GROUP children)
  if (!isRoot && SKIP_TYPES.has(node.type)) {
    if (node.type !== 'VECTOR' && node.type !== 'LINE' && node.type !== 'ELLIPSE' && node.children) {
      for (const child of node.children) {
        results.push(...flattenFigmaTree(child, frameOrigin || node.absoluteBoundingBox, false))
      }
    }
    return results
  }

  // Skip redundant text wrappers — keep only the TEXT child
  if (!isRoot && isRedundantTextWrapper(node)) {
    const origin = frameOrigin || node.absoluteBoundingBox
    for (const child of node.children!) {
      results.push(...flattenFigmaTree(child, origin, false))
    }
    return results
  }

  // Skip tiny nodes (icons paths, decorative dots, etc.)
  if (!isRoot && node.absoluteBoundingBox) {
    const { width, height } = node.absoluteBoundingBox
    if (width < MIN_NODE_SIZE && height < MIN_NODE_SIZE) return results
  }

  // Use the first node's bounding box as the frame origin if not provided
  const origin = frameOrigin || node.absoluteBoundingBox

  // Only include this node if it has meaningful visual properties
  if (isRoot || hasMeaningfulProps(node)) {
    const props: NormalizedFigmaProps = {
      nodeId: node.id,
      name: node.name,
      type: node.type,
    }

    // Colors
    const fillColor = extractSolidColor(node.fills)
    if (fillColor) props.fillColor = fillColor

    const strokeColor = extractSolidColor(node.strokes)
    if (strokeColor) props.strokeColor = strokeColor

    // Typography (TEXT nodes only)
    if (node.type === 'TEXT' && node.style) {
      props.fontSize = node.style.fontSize
      props.fontWeight = node.style.fontWeight
      props.fontFamily = node.style.fontFamily
      if (node.style.lineHeightPx) props.lineHeight = node.style.lineHeightPx
      if (node.style.letterSpacing) props.letterSpacing = node.style.letterSpacing
      props.textContent = node.characters || ''
    }

    // Spacing (auto-layout frames)
    if (node.layoutMode && node.layoutMode !== 'NONE') {
      props.layoutMode = node.layoutMode
      if (node.paddingTop !== undefined) props.paddingTop = node.paddingTop
      if (node.paddingRight !== undefined) props.paddingRight = node.paddingRight
      if (node.paddingBottom !== undefined) props.paddingBottom = node.paddingBottom
      if (node.paddingLeft !== undefined) props.paddingLeft = node.paddingLeft
      if (node.itemSpacing !== undefined) props.itemSpacing = node.itemSpacing
    }

    // Border radius
    if (node.rectangleCornerRadii) {
      props.cornerRadii = node.rectangleCornerRadii
      props.borderRadius = node.rectangleCornerRadii[0]
    } else if (node.cornerRadius !== undefined && node.cornerRadius > 0) {
      props.borderRadius = node.cornerRadius
    }

    // Border width
    if (node.strokeWeight !== undefined && node.strokeWeight > 0) {
      props.borderWidth = node.strokeWeight
    }

    // Dimensions & position (relative to frame origin)
    if (node.absoluteBoundingBox && origin) {
      const box = node.absoluteBoundingBox
      props.width = Math.round(box.width)
      props.height = Math.round(box.height)
      props.x = Math.round(box.x - origin.x)
      props.y = Math.round(box.y - origin.y)
    }

    // Opacity
    if (node.opacity !== undefined && node.opacity < 1) {
      props.opacity = node.opacity
    }

    results.push(props)
  }

  // Always recurse into children (even if this node was skipped)
  if (node.children) {
    for (const child of node.children) {
      results.push(...flattenFigmaTree(child, origin, false))
    }
  }

  return results
}
