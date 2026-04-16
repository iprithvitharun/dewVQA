import type { NormalizedFigmaProps, ExtractedElement, MatchedPair, FigmaBoundingBox } from '../shared/types'

interface MatchResult {
  matched: MatchedPair[]
  unmatchedFigma: NormalizedFigmaProps[]
  unmatchedDom: ExtractedElement[]
}

/** Leaf HTML tags that represent content, not containers */
const LEAF_TAGS = new Set(['SPAN', 'P', 'A', 'STRONG', 'EM', 'B', 'I', 'LABEL', 'CODE', 'SMALL'])

/** Check if a Figma node is a structural container with no visual properties */
function isStructuralContainer(node: NormalizedFigmaProps): boolean {
  if (node.type === 'TEXT') return false
  if (node.type === 'COMPONENT' || node.type === 'INSTANCE') return false
  return !node.fillColor && !node.strokeColor && !node.borderRadius
}

/**
 * Match Figma nodes to DOM elements using a multi-pass waterfall strategy.
 *
 * Pass 1: Text content matching (highest confidence)
 * Pass 2: Component name matching (medium confidence)
 * Pass 3: Positional matching via bounding box IoU (lower confidence)
 */
export function matchFigmaToDom(
  figmaNodes: NormalizedFigmaProps[],
  domElements: ExtractedElement[],
  frameBox: FigmaBoundingBox,
  rootRect: { x: number; y: number; width: number; height: number }
): MatchResult {
  const matched: MatchedPair[] = []
  const usedFigma = new Set<string>()  // nodeId
  const usedDom = new Set<number>()    // index

  // ─── Pass 1: Text content matching ──────────────────────────

  const textFigmaNodes = figmaNodes.filter(
    (n) => n.type === 'TEXT' && n.textContent && n.textContent.trim().length > 0
  )

  for (const fNode of textFigmaNodes) {
    if (usedFigma.has(fNode.nodeId)) continue

    const figmaText = normalizeText(fNode.textContent!)
    if (!figmaText) continue

    // Find exact matches — prefer leaf elements over containers
    // (containers concatenate all child text, producing false matches)
    const figmaAlpha = toAlphanumeric(figmaText)
    const exactMatches: number[] = []
    for (let i = 0; i < domElements.length; i++) {
      if (usedDom.has(i)) continue
      const domText = normalizeText(domElements[i].textContent)
      // Match on exact text OR alphanumeric-only (handles quote/apostrophe variants)
      if (domText === figmaText || toAlphanumeric(domText) === figmaAlpha) {
        exactMatches.push(i)
      }
    }

    // If we have both leaf and container matches, prefer leaves
    if (exactMatches.length > 1) {
      const leafMatches = exactMatches.filter(i => {
        const tag = domElements[i].tagName
        return LEAF_TAGS.has(tag) || tag === 'BUTTON' || tag === 'H1' || tag === 'H2' || tag === 'H3' || tag === 'H4'
      })
      if (leafMatches.length > 0) {
        exactMatches.length = 0
        exactMatches.push(...leafMatches)
      }
    }

    if (exactMatches.length === 1) {
      matched.push({
        figmaNode: fNode,
        domElement: domElements[exactMatches[0]],
        matchConfidence: 1.0,
        matchMethod: 'text-exact',
      })
      usedFigma.add(fNode.nodeId)
      usedDom.add(exactMatches[0])
    } else if (exactMatches.length > 1) {
      const best = pickClosestByPosition(
        fNode, exactMatches, domElements, frameBox, rootRect
      )
      if (best !== null) {
        matched.push({
          figmaNode: fNode,
          domElement: domElements[best],
          matchConfidence: 0.9,
          matchMethod: 'text-exact',
        })
        usedFigma.add(fNode.nodeId)
        usedDom.add(best)
      }
    } else {
      // Try fuzzy match — only for longer text, and require similar lengths
      // to avoid matching "Tickets" inside a full paragraph
      if (figmaText.length >= 8) {
        for (let i = 0; i < domElements.length; i++) {
          if (usedDom.has(i)) continue
          const domText = normalizeText(domElements[i].textContent)
          if (!domText || domText.length < 4) continue

          // Length ratio check: don't match a short string inside a much longer one
          const lenRatio = Math.min(figmaText.length, domText.length) / Math.max(figmaText.length, domText.length)
          if (lenRatio < 0.5) continue // skip if one is >2x the length of the other

          if (domText.includes(figmaText) || figmaText.includes(domText)) {
            matched.push({
              figmaNode: fNode,
              domElement: domElements[i],
              matchConfidence: 0.7,
              matchMethod: 'text-fuzzy',
            })
            usedFigma.add(fNode.nodeId)
            usedDom.add(i)
            break
          }
        }
      }
    }
  }

  // ─── Pass 2: Component name matching ────────────────────────

  const NAME_TO_TAGS: Record<string, string[]> = {
    'button': ['BUTTON'],
    'header': ['HEADER'],
    'navigation': ['NAV'],
    'nav': ['NAV'],
    'footer': ['FOOTER'],
    'input': ['INPUT'],
    'image': ['IMG'],
    'link': ['A'],
    'heading': ['H1', 'H2', 'H3', 'H4', 'H5', 'H6'],
    'checkbox': ['INPUT'],
    'icon': ['SVG'],
  }

  for (const fNode of figmaNodes) {
    if (usedFigma.has(fNode.nodeId)) continue
    if (fNode.type === 'TEXT') continue

    const nameLower = fNode.name.toLowerCase()
    const matchTags = NAME_TO_TAGS[nameLower]
    if (!matchTags) continue

    // Collect ALL matching DOM elements, then pick the spatially closest
    const candidates: number[] = []
    for (let i = 0; i < domElements.length; i++) {
      if (usedDom.has(i)) continue
      const el = domElements[i]

      const tagMatch = matchTags.includes(el.tagName)
      const testIdMatch = el.dew?.componentType?.toLowerCase() === nameLower
      const roleMatch = el.role === nameLower

      if (tagMatch || testIdMatch || roleMatch) {
        candidates.push(i)
      }
    }

    if (candidates.length > 0) {
      // Pick the closest by position instead of just the first
      const best = candidates.length === 1
        ? candidates[0]
        : pickClosestByPosition(fNode, candidates, domElements, frameBox, rootRect) ?? candidates[0]

      matched.push({
        figmaNode: fNode,
        domElement: domElements[best],
        matchConfidence: 0.75,
        matchMethod: 'component-name',
      })
      usedFigma.add(fNode.nodeId)
      usedDom.add(best)
    }
  }

  // ─── Pass 3: Positional matching (IoU) ──────────────────────

  const remainingFigma = figmaNodes.filter((n) => !usedFigma.has(n.nodeId))
  const remainingDomIndices: number[] = []
  for (let i = 0; i < domElements.length; i++) {
    if (!usedDom.has(i)) remainingDomIndices.push(i)
  }

  if (frameBox.width > 0 && frameBox.height > 0 && rootRect.width > 0 && rootRect.height > 0) {
    const candidates: { fIdx: number; dIdx: number; iou: number }[] = []

    for (let fi = 0; fi < remainingFigma.length; fi++) {
      const fNode = remainingFigma[fi]
      if (fNode.x === undefined || fNode.y === undefined || !fNode.width || !fNode.height) continue

      // Skip structural containers — they shouldn't match via position
      if (isStructuralContainer(fNode)) continue

      const fNorm = {
        x1: fNode.x / frameBox.width,
        y1: fNode.y / frameBox.height,
        x2: (fNode.x + fNode.width) / frameBox.width,
        y2: (fNode.y + fNode.height) / frameBox.height,
      }
      const fArea = fNode.width * fNode.height

      for (const di of remainingDomIndices) {
        if (usedDom.has(di)) continue
        const el = domElements[di]

        // Reject container-to-leaf mismatches
        if (fNode.type === 'TEXT' && (!el.textContent || el.textContent.trim().length === 0)) continue
        if (isStructuralContainer(fNode) && LEAF_TAGS.has(el.tagName)) continue

        // Size similarity check — reject if one is >4x the area of the other
        const dArea = el.rect.width * el.rect.height
        if (fArea > 0 && dArea > 0) {
          const areaRatio = Math.max(fArea, dArea) / Math.min(fArea, dArea)
          if (areaRatio > 4) continue
        }

        const dNorm = {
          x1: (el.rect.x - rootRect.x) / rootRect.width,
          y1: (el.rect.y - rootRect.y) / rootRect.height,
          x2: (el.rect.x - rootRect.x + el.rect.width) / rootRect.width,
          y2: (el.rect.y - rootRect.y + el.rect.height) / rootRect.height,
        }

        const iou = computeIoU(fNorm, dNorm)
        if (iou > 0.5) {
          candidates.push({ fIdx: fi, dIdx: di, iou })
        }
      }
    }

    candidates.sort((a, b) => b.iou - a.iou)
    const usedFigmaPos = new Set<number>()
    const usedDomPos = new Set<number>()

    for (const c of candidates) {
      if (usedFigmaPos.has(c.fIdx) || usedDomPos.has(c.dIdx)) continue

      matched.push({
        figmaNode: remainingFigma[c.fIdx],
        domElement: domElements[c.dIdx],
        matchConfidence: Math.min(c.iou * 0.8, 0.7),
        matchMethod: 'position',
      })
      usedFigma.add(remainingFigma[c.fIdx].nodeId)
      usedDom.add(c.dIdx)
      usedFigmaPos.add(c.fIdx)
      usedDomPos.add(c.dIdx)
    }
  }

  // ─── Collect unmatched ──────────────────────────────────────

  const unmatchedFigma = figmaNodes.filter((n) => !usedFigma.has(n.nodeId))
  const unmatchedDom = domElements.filter((_, i) => !usedDom.has(i))

  return { matched, unmatchedFigma, unmatchedDom }
}

// ─── Helpers ──────────────────────────────────────────────────

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Strip everything except letters and numbers for fuzzy matching */
function toAlphanumeric(text: string): string {
  return text.replace(/[^a-z0-9]/gi, '').toLowerCase()
}

function pickClosestByPosition(
  fNode: NormalizedFigmaProps,
  domIndices: number[],
  domElements: ExtractedElement[],
  frameBox: FigmaBoundingBox,
  rootRect: { x: number; y: number; width: number; height: number }
): number | null {
  if (fNode.x === undefined || fNode.y === undefined) {
    return domIndices[0]
  }
  if (frameBox.width === 0 || rootRect.width === 0) {
    return domIndices[0]
  }

  const fxNorm = fNode.x / frameBox.width
  const fyNorm = fNode.y / frameBox.height

  let bestIdx: number | null = null
  let bestDist = Infinity

  for (const di of domIndices) {
    const el = domElements[di]
    const dxNorm = (el.rect.x - rootRect.x) / rootRect.width
    const dyNorm = (el.rect.y - rootRect.y) / rootRect.height
    const dist = Math.sqrt((fxNorm - dxNorm) ** 2 + (fyNorm - dyNorm) ** 2)
    if (dist < bestDist) {
      bestDist = dist
      bestIdx = di
    }
  }

  return bestIdx
}

function computeIoU(
  a: { x1: number; y1: number; x2: number; y2: number },
  b: { x1: number; y1: number; x2: number; y2: number }
): number {
  const interX1 = Math.max(a.x1, b.x1)
  const interY1 = Math.max(a.y1, b.y1)
  const interX2 = Math.min(a.x2, b.x2)
  const interY2 = Math.min(a.y2, b.y2)

  if (interX1 >= interX2 || interY1 >= interY2) return 0

  const interArea = (interX2 - interX1) * (interY2 - interY1)
  const areaA = (a.x2 - a.x1) * (a.y2 - a.y1)
  const areaB = (b.x2 - b.x1) * (b.y2 - b.y1)
  const unionArea = areaA + areaB - interArea

  return unionArea > 0 ? interArea / unionArea : 0
}
