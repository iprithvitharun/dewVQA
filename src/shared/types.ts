// ─── Token Database Types ────────────────────────────────────

export interface TokenDatabase {
  palette: Record<string, string>
  semanticTokens: SemanticTokenEntry[]
  reverseHex: Record<string, string[]>
  paletteReverseHex: Record<string, string[]>
  spacing: {
    tokens: Record<string, number>
    scale: number[]
  }
  borderRadius: {
    tokens: Record<string, number>
    values: number[]
  }
  opacity: Record<string, number>
  shadows: Record<string, string>
  fontWeights: Record<string, number>
  typography: {
    fontFamily: string
    validSizes: number[]
    validWeights: number[]
  }
}

export interface SemanticTokenEntry {
  cssVar: string
  paletteRef: string
  hex: string
  alpha?: number
}

// ─── Extracted Styles ────────────────────────────────────────

export interface DewComponentInfo {
  /** Whether this element is (or is inside) a Dew component */
  isDewComponent: boolean
  /** Component type from data-testid, e.g. "button", "icon-button", "checkbox" */
  componentType: string
  /** Variant from data-variant, e.g. "primary", "secondary" */
  componentVariant: string
  /** Size from data-size, e.g. "default", "mini" */
  componentSize: string
  /** Inferred current state: "normal", "disabled", "loading", "active" */
  componentState: string
  /** The component name for spec lookup, e.g. "Button", "Checkbox" */
  componentName: string
}

export interface ExtractedElement {
  selector: string
  tagName: string
  textContent: string
  /** Human-readable description built at extraction time */
  description: string
  role: string
  accessibleName: string
  region: string
  parentContext: string
  /** Dew component identity (if detected) */
  dew?: DewComponentInfo
  rect: { x: number; y: number; width: number; height: number }
  styles: ExtractedStyles
}

// ─── Component Spec Types ────────────────────────────────────

export interface ComponentRule {
  component: string
  variant: string
  state: string
  property: string
  tokenPath: string
  cssVar: string
  hex: string
}

export interface ComponentSpecDatabase {
  rules: ComponentRule[]
  lookup: Record<string, Record<string, Record<string, Record<string, ComponentRule[]>>>>
  meta: { componentCount: number; totalRules: number; generatedAt: string }
}

export interface ExtractedStyles {
  color: string
  backgroundColor: string
  fontSize: string
  fontWeight: string
  fontFamily: string
  lineHeight: string
  letterSpacing: string
  paddingTop: string
  paddingRight: string
  paddingBottom: string
  paddingLeft: string
  marginTop: string
  marginRight: string
  marginBottom: string
  marginLeft: string
  gap: string
  borderRadius: string
  borderTopLeftRadius: string
  borderTopRightRadius: string
  borderBottomRightRadius: string
  borderBottomLeftRadius: string
  borderColor: string
  borderWidth: string
  boxShadow: string
  opacity: string
  display: string
  alignItems: string
  justifyContent: string
  /** Whether backgroundColor is inherited from parent (not explicitly set) */
  inheritedBg?: boolean
}

// ─── Violations ─────────────────────────────────────────────

export type Severity = 'blocker' | 'high' | 'medium' | 'low'

export type ViolationCategory =
  | 'color'
  | 'spacing'
  | 'typography'
  | 'border-radius'
  | 'contrast'
  | 'shadow'
  | 'content'

export interface ElementMeta {
  selector: string
  tagName: string
  textContent: string
  /** Human-readable description, e.g. "Button with 'Export' label" */
  description: string
  /** Role or type hint: "button", "input", "heading", "icon", "image", "link", "container", "text" */
  role: string
  /** aria-label, title, alt, or placeholder if present */
  accessibleName: string
  /** Position region: "top-left", "top-right", "center", etc. */
  region: string
  /** Nearest identifiable parent context, e.g. "inside .header-primary" */
  parentContext: string
  /** Dew component identity (if detected) */
  dew?: DewComponentInfo
}

export interface Violation {
  id: string
  category: ViolationCategory
  severity: Severity
  property: string
  actual: string
  expected: string
  suggestion: string
  element: ElementMeta
}

export interface VqaReport {
  url: string
  timestamp: string
  totalElements: number
  violations: Violation[]
  summary: Record<Severity, number>
}

// ─── Chrome Message Types ────────────────────────────────────

export type MessageType =
  | 'SCAN_PAGE'
  | 'SCAN_RESULT'
  | 'PICK_ELEMENT'
  | 'ELEMENT_PICKED'
  | 'TOGGLE_OVERLAY'
  | 'GET_REPORT'
  | 'REPORT_READY'

export interface ScanPageMessage {
  type: 'SCAN_PAGE'
  selector?: string // optional CSS selector to scope the scan
}

export interface ScanResultMessage {
  type: 'SCAN_RESULT'
  elements: ExtractedElement[]
}

export interface PickElementMessage {
  type: 'PICK_ELEMENT'
  active: boolean
}

export interface ElementPickedMessage {
  type: 'ELEMENT_PICKED'
  element: ExtractedElement
}

export interface ToggleOverlayMessage {
  type: 'TOGGLE_OVERLAY'
  violations: Violation[]
  visible: boolean
}

export interface GetReportMessage {
  type: 'GET_REPORT'
}

export interface ReportReadyMessage {
  type: 'REPORT_READY'
  report: VqaReport
}

export interface FigmaCompareMessage {
  type: 'FIGMA_COMPARE'
  figmaUrl: string
  selector?: string
}

export interface FigmaCompareResultMessage {
  type: 'FIGMA_COMPARE_RESULT'
  report: FigmaComparisonReport
}

export interface FigmaCompareErrorMessage {
  type: 'FIGMA_COMPARE_ERROR'
  error: string
}

export type Message =
  | ScanPageMessage
  | ScanResultMessage
  | PickElementMessage
  | ElementPickedMessage
  | ToggleOverlayMessage
  | GetReportMessage
  | ReportReadyMessage
  | FigmaCompareMessage
  | FigmaCompareResultMessage
  | FigmaCompareErrorMessage

// ─── Figma API Types ────────────────────────────────────────

export interface FigmaColor {
  r: number // 0-1
  g: number // 0-1
  b: number // 0-1
  a: number // 0-1
}

export interface FigmaPaint {
  type: 'SOLID' | 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'IMAGE'
  color?: FigmaColor
  opacity?: number
  visible?: boolean
}

export interface FigmaTypeStyle {
  fontSize: number
  fontWeight: number
  fontFamily: string
  lineHeightPx: number
  letterSpacing: number
  textCase?: 'ORIGINAL' | 'UPPER' | 'LOWER' | 'TITLE'
  textAlignHorizontal?: string
  textAlignVertical?: string
}

export interface FigmaBoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export interface FigmaEffect {
  type: 'DROP_SHADOW' | 'INNER_SHADOW' | 'LAYER_BLUR' | 'BACKGROUND_BLUR'
  visible: boolean
  color?: FigmaColor
  offset?: { x: number; y: number }
  radius?: number
  spread?: number
}

export interface FigmaNode {
  id: string
  name: string
  type: string
  children?: FigmaNode[]
  fills?: FigmaPaint[]
  strokes?: FigmaPaint[]
  strokeWeight?: number
  cornerRadius?: number
  rectangleCornerRadii?: [number, number, number, number]
  style?: FigmaTypeStyle
  characters?: string
  absoluteBoundingBox?: FigmaBoundingBox
  paddingLeft?: number
  paddingRight?: number
  paddingTop?: number
  paddingBottom?: number
  itemSpacing?: number
  layoutMode?: 'HORIZONTAL' | 'VERTICAL' | 'NONE'
  opacity?: number
  visible?: boolean
  effects?: FigmaEffect[]
}

/** Parsed from a Figma URL */
export interface FigmaFrameRef {
  fileKey: string
  nodeId: string // colon-separated, e.g. "456:789"
}

/** Normalized properties extracted from a FigmaNode for comparison */
export interface NormalizedFigmaProps {
  nodeId: string
  name: string
  type: string
  textContent?: string
  fillColor?: string   // hex
  strokeColor?: string // hex
  fontSize?: number
  fontWeight?: number
  fontFamily?: string
  lineHeight?: number
  letterSpacing?: number
  paddingTop?: number
  paddingRight?: number
  paddingBottom?: number
  paddingLeft?: number
  itemSpacing?: number
  layoutMode?: string
  borderRadius?: number
  cornerRadii?: [number, number, number, number]
  borderWidth?: number
  width?: number
  height?: number
  x?: number // relative to frame origin
  y?: number // relative to frame origin
  opacity?: number
}

/** A matched pair of Figma node and DOM element */
export interface MatchedPair {
  figmaNode: NormalizedFigmaProps
  domElement: ExtractedElement
  matchConfidence: number // 0-1
  matchMethod: 'text-exact' | 'text-fuzzy' | 'position' | 'component-name'
}

/** A discrepancy between Figma and DOM */
export interface FigmaDiscrepancy {
  id: string
  property: string
  figmaValue: string
  domValue: string
  severity: Severity
  category: ViolationCategory
  element: ElementMeta
  figmaNodeName: string
  figmaNodeId: string
  suggestion: string
  matchConfidence: number
}

/** AI-enhanced report from Claude */
export interface AIGroupedFinding {
  title: string
  description: string
  discrepancyIds: string[]
  cssFix: string
}

export interface AIEnhancedReport {
  summary: string
  groupedFindings: AIGroupedFinding[]
  visualDiffNotes?: string
}

/** Full comparison report */
export interface FigmaComparisonReport {
  figmaUrl: string
  pageUrl: string
  timestamp: string
  totalFigmaNodes: number
  totalDomElements: number
  matchedPairs: number
  unmatchedFigmaNodes: string[]
  unmatchedDomElements: string[]
  discrepancies: FigmaDiscrepancy[]
  summary: Record<Severity, number>
  aiEnhancement?: AIEnhancedReport
}
