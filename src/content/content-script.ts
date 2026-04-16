import type {
  ExtractedElement,
  ExtractedStyles,
  ElementMeta,
  DewComponentInfo,
  Message,
  Violation,
} from '../shared/types'

// ─── DOM Style Extraction ────────────────────────────────────

function getCssSelector(el: Element): string {
  if (el.id) return `#${el.id}`
  const parts: string[] = []
  let current: Element | null = el
  while (current && current !== document.body) {
    let selector = current.tagName.toLowerCase()
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/).slice(0, 2)
      if (classes.length > 0 && classes[0]) {
        selector += '.' + classes.join('.')
      }
    }
    parts.unshift(selector)
    current = current.parentElement
  }
  return parts.join(' > ')
}

function extractStyles(el: Element): ExtractedStyles {
  const cs = getComputedStyle(el)

  // Detect inherited background: if same as parent's, it's likely inherited
  let inheritedBg = false
  const bg = cs.backgroundColor
  const parent = el.parentElement
  if (parent) {
    const parentBg = getComputedStyle(parent).backgroundColor
    if (bg === parentBg) {
      // Same as parent — check if this element has no explicit background set
      const inlineHasBg = (el as HTMLElement).style?.backgroundColor
      if (!inlineHasBg) {
        inheritedBg = true
      }
    }
  }

  return {
    color: cs.color,
    backgroundColor: bg,
    fontSize: cs.fontSize,
    fontWeight: cs.fontWeight,
    fontFamily: cs.fontFamily,
    lineHeight: cs.lineHeight,
    letterSpacing: cs.letterSpacing,
    paddingTop: cs.paddingTop,
    paddingRight: cs.paddingRight,
    paddingBottom: cs.paddingBottom,
    paddingLeft: cs.paddingLeft,
    marginTop: cs.marginTop,
    marginRight: cs.marginRight,
    marginBottom: cs.marginBottom,
    marginLeft: cs.marginLeft,
    gap: cs.gap,
    borderRadius: cs.borderRadius,
    borderTopLeftRadius: cs.borderTopLeftRadius,
    borderTopRightRadius: cs.borderTopRightRadius,
    borderBottomRightRadius: cs.borderBottomRightRadius,
    borderBottomLeftRadius: cs.borderBottomLeftRadius,
    borderColor: cs.borderColor,
    borderWidth: cs.borderWidth,
    boxShadow: cs.boxShadow,
    opacity: cs.opacity,
    display: cs.display,
    alignItems: cs.alignItems,
    justifyContent: cs.justifyContent,
    inheritedBg,
  }
}

// ─── Rich Element Metadata ───────────────────────────────────

/** Get the semantic role of an element */
function getElementRole(el: Element): string {
  const tag = el.tagName.toLowerCase()
  const role = el.getAttribute('role')
  const type = (el as HTMLInputElement).type

  if (role) return role
  if (tag === 'button' || type === 'button' || type === 'submit') return 'button'
  if (tag === 'a') return 'link'
  if (tag === 'input' || tag === 'textarea' || tag === 'select') return 'input'
  if (tag === 'img') return 'image'
  if (tag === 'svg' || el.closest('svg')) return 'icon'
  if (/^h[1-6]$/.test(tag)) return 'heading'
  if (tag === 'nav') return 'navigation'
  if (tag === 'header') return 'header'
  if (tag === 'footer') return 'footer'
  if (tag === 'table') return 'table'
  if (tag === 'th') return 'column-header'
  if (tag === 'td') return 'cell'
  if (tag === 'tr') return 'row'
  if (tag === 'li') return 'list-item'
  if (tag === 'label') return 'label'
  if (tag === 'span' || tag === 'p') return 'text'
  if (tag === 'section' || tag === 'div') return 'container'
  return tag
}

/** Get the accessible name from aria/title/alt/placeholder */
function getAccessibleName(el: Element): string {
  return (
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.getAttribute('alt') ||
    el.getAttribute('placeholder') ||
    el.getAttribute('aria-labelledby') && getTextById(el.getAttribute('aria-labelledby')!) ||
    ''
  )
}

function getTextById(id: string): string {
  const target = document.getElementById(id)
  return target?.textContent?.trim().slice(0, 40) || ''
}

/** Get the direct text content of an element (not children's text) */
function getOwnText(el: Element): string {
  let text = ''
  for (const child of el.childNodes) {
    if (child.nodeType === Node.TEXT_NODE) {
      text += child.textContent || ''
    }
  }
  return text.trim().slice(0, 50)
}

/** Determine which screen region the element is in */
function getRegion(rect: DOMRect): string {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const cx = rect.x + rect.width / 2
  const cy = rect.y + rect.height / 2

  const col = cx < vw * 0.33 ? 'left' : cx > vw * 0.66 ? 'right' : 'center'
  const row = cy < vh * 0.33 ? 'top' : cy > vh * 0.66 ? 'bottom' : 'middle'

  if (row === 'middle' && col === 'center') return 'center'
  if (row === 'middle') return col
  if (col === 'center') return row
  return `${row}-${col}`
}

/** Find the nearest meaningful parent for context */
function getParentContext(el: Element): string {
  let current = el.parentElement
  let depth = 0
  while (current && current !== document.body && depth < 6) {
    // Check for meaningful identifiers
    if (current.id) return `inside #${current.id}`

    const role = current.getAttribute('role')
    if (role && !['presentation', 'none'].includes(role)) {
      return `inside [role="${role}"]`
    }

    const tag = current.tagName.toLowerCase()
    if (['nav', 'header', 'footer', 'main', 'aside', 'section', 'form', 'table'].includes(tag)) {
      const label = current.getAttribute('aria-label')
      return label ? `inside ${tag} "${label}"` : `inside <${tag}>`
    }

    // Check for recognizable class names
    if (current.className && typeof current.className === 'string') {
      const classes = current.className.trim().split(/\s+/)
      const meaningful = classes.find(c =>
        /(header|footer|nav|sidebar|toolbar|modal|dialog|menu|search|card|panel|form|table|list)/i.test(c)
      )
      if (meaningful) return `inside .${meaningful}`
    }

    current = current.parentElement
    depth++
  }
  return ''
}

/** Build a plain-language description of the element */
function buildDescription(el: Element, role: string, accessibleName: string, textContent: string, region: string, parentContext: string): string {
  const ownText = getOwnText(el)
  const label = accessibleName || ownText || textContent.slice(0, 30)
  const tag = el.tagName.toLowerCase()

  // Friendly role names
  const roleLabels: Record<string, string> = {
    button: 'Button',
    link: 'Link',
    input: 'Input',
    image: 'Image',
    icon: 'Icon',
    heading: 'Heading',
    navigation: 'Navigation',
    header: 'Header',
    footer: 'Footer',
    table: 'Table',
    'column-header': 'Column header',
    cell: 'Table cell',
    row: 'Table row',
    'list-item': 'List item',
    label: 'Label',
    text: 'Text',
    container: 'Container',
  }

  const friendlyRole = roleLabels[role] || tag.toUpperCase()

  // Build the description
  const parts: string[] = []

  // Input types
  if (role === 'input') {
    const type = (el as HTMLInputElement).type || 'text'
    const typeLabel = type === 'text' ? 'Text input' :
      type === 'search' ? 'Search input' :
      type === 'email' ? 'Email input' :
      type === 'password' ? 'Password input' :
      type === 'checkbox' ? 'Checkbox' :
      type === 'radio' ? 'Radio button' :
      tag === 'select' ? 'Dropdown' :
      tag === 'textarea' ? 'Text area' :
      `${type} input`
    parts.push(typeLabel)
  } else if (role === 'heading') {
    const level = tag.replace('h', '')
    parts.push(`H${level} heading`)
  } else {
    parts.push(friendlyRole)
  }

  // Add label/text
  if (label) {
    const short = label.length > 30 ? label.slice(0, 27) + '...' : label
    parts.push(`'${short}'`)
  }

  // Add region context
  if (parentContext) {
    parts.push(parentContext)
  } else if (region !== 'center' && region !== 'middle') {
    parts.push(`in ${region} area`)
  }

  return parts.join(' ')
}

// ─── Dew Component Detection ─────────────────────────────────

/** Map data-testid values to component names for spec lookup */
const TESTID_TO_COMPONENT: Record<string, string> = {
  'button': 'Button',
  'icon-button': 'Button',
  'hyperlink-button': 'Button',
  'dropdown-button': 'Button',
  'split-button': 'Button',
  'split-button-main': 'Button',
  'split-button-trigger': 'Button',
  'checkbox': 'Checkbox',
  'toggle': 'Toggle',
  'radio': 'Radio',
  'badge': 'Badge',
  'banner': 'Banner',
  'tag': 'Tag',
  'chip': 'Chips',
  'chips': 'Chips',
  'tooltip': 'Tooltip',
  'modal': 'Modal',
  'card': 'Card',
  'accordion': 'Accordion',
  'breadcrumb': 'Breadcrumb',
  'toast': 'ToastMessage',
  'inline-message': 'InlineMessage',
  'top-navigation': 'TopNavigation',
  'loader': 'Loaders',
}

function detectDewComponent(el: Element): DewComponentInfo | undefined {
  // Check the element itself or walk up to find nearest [data-dew]
  let dewEl: Element | null = el.hasAttribute('data-dew') ? el : el.closest('[data-dew]')

  if (!dewEl) return undefined

  const testId = dewEl.getAttribute('data-testid') || ''
  const variant = dewEl.getAttribute('data-variant') || 'default'
  const size = dewEl.getAttribute('data-size') || 'default'

  // Determine component name
  const componentName = TESTID_TO_COMPONENT[testId] || ''

  // Determine state from attributes
  let state = 'normal'
  if (dewEl.getAttribute('aria-disabled') === 'true') {
    state = 'disabled'
  } else if (dewEl.getAttribute('aria-busy') === 'true') {
    state = 'loading'
  } else if (dewEl.getAttribute('data-active') === 'true' || dewEl.getAttribute('aria-pressed') === 'true') {
    state = 'active'
  }

  return {
    isDewComponent: true,
    componentType: testId,
    componentVariant: variant,
    componentSize: size,
    componentState: state,
    componentName: componentName || testId,
  }
}

function extractElement(el: Element): ExtractedElement {
  const rect = el.getBoundingClientRect()
  const textContent = el.textContent?.trim().slice(0, 100) || ''
  const role = getElementRole(el)
  const accessibleName = getAccessibleName(el)
  const region = getRegion(rect)
  const parentContext = getParentContext(el)
  const description = buildDescription(el, role, accessibleName, textContent, region, parentContext)
  const dew = detectDewComponent(el)

  return {
    selector: getCssSelector(el),
    tagName: el.tagName,
    textContent,
    description,
    role,
    accessibleName,
    region,
    parentContext,
    dew,
    rect: {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    },
    styles: extractStyles(el),
  }
}

/** Minimum element size (px) to be included in scan */
const MIN_DOM_SIZE = 8

/** Tags to always skip */
const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'META', 'LINK', 'HEAD', 'HTML', 'NOSCRIPT', 'TEMPLATE'])

function scanPage(rootSelector?: string): ExtractedElement[] {
  const root = rootSelector
    ? document.querySelector(rootSelector)
    : document.body

  if (!root) return []

  const elements: ExtractedElement[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT)

  let node: Node | null = walker.currentNode
  while (node) {
    const el = node as Element
    const tag = el.tagName

    if (!SKIP_TAGS.has(tag)) {
      // Skip elements inside <svg> (only extract the <svg> itself)
      if (tag !== 'SVG' && el.closest('svg')) {
        node = walker.nextNode()
        continue
      }

      const cs = getComputedStyle(el)
      if (cs.display !== 'none' && cs.visibility !== 'hidden') {
        // Skip elements smaller than MIN_DOM_SIZE
        const rect = el.getBoundingClientRect()
        if (rect.width >= MIN_DOM_SIZE || rect.height >= MIN_DOM_SIZE) {
          elements.push(extractElement(el))
        }
      }
    }
    node = walker.nextNode()
  }

  return elements
}

// ─── Element Picker ──────────────────────────────────────────

let pickerActive = false
let highlightEl: HTMLDivElement | null = null

function createHighlight(): HTMLDivElement {
  const div = document.createElement('div')
  div.id = 'dew-vqa-picker-highlight'
  div.style.cssText = `
    position: fixed;
    pointer-events: none;
    border: 2px solid #276cf0;
    background: rgba(39, 108, 240, 0.1);
    z-index: 999999;
    transition: all 0.1s ease;
    display: none;
  `
  document.body.appendChild(div)
  return div
}

function onPickerMove(e: MouseEvent) {
  if (!pickerActive || !highlightEl) return
  const target = e.target as Element
  if (target === highlightEl) return
  const rect = target.getBoundingClientRect()
  highlightEl.style.display = 'block'
  highlightEl.style.top = `${rect.top}px`
  highlightEl.style.left = `${rect.left}px`
  highlightEl.style.width = `${rect.width}px`
  highlightEl.style.height = `${rect.height}px`
}

let scopePickMode = false

function onPickerClick(e: MouseEvent) {
  if (!pickerActive) return
  e.preventDefault()
  e.stopPropagation()
  const target = e.target as Element
  if (target.id === 'dew-vqa-picker-highlight') return

  if (scopePickMode) {
    // In scope-pick mode, just send back the selector
    const selector = getCssSelector(target)
    chrome.runtime.sendMessage({ type: 'SCOPE_PICKED', selector })
    scopePickMode = false
    deactivatePicker()
  } else {
    const extracted = extractElement(target)
    chrome.runtime.sendMessage({ type: 'ELEMENT_PICKED', element: extracted })
    deactivatePicker()
  }
}

function activatePicker() {
  pickerActive = true
  if (!highlightEl) highlightEl = createHighlight()
  document.addEventListener('mousemove', onPickerMove, true)
  document.addEventListener('click', onPickerClick, true)
  document.body.style.cursor = 'crosshair'
}

function deactivatePicker() {
  pickerActive = false
  document.removeEventListener('mousemove', onPickerMove, true)
  document.removeEventListener('click', onPickerClick, true)
  document.body.style.cursor = ''
  if (highlightEl) {
    highlightEl.style.display = 'none'
  }
}

// ─── Violation Overlay ───────────────────────────────────────

let overlayElements: HTMLDivElement[] = []

const SEVERITY_COLORS: Record<string, string> = {
  blocker: '#cd2629',
  high: '#ed7d27',
  medium: '#f8a34b',
  low: '#4c91ff',
}

function showOverlay(violations: Violation[]) {
  clearOverlay()

  for (const v of violations) {
    const target = document.querySelector(v.element.selector)
    if (!target) continue

    const rect = target.getBoundingClientRect()
    const overlay = document.createElement('div')
    overlay.className = 'dew-vqa-overlay'
    overlay.style.cssText = `
      position: fixed;
      top: ${rect.top}px;
      left: ${rect.left}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px solid ${SEVERITY_COLORS[v.severity] || '#4c91ff'};
      background: ${SEVERITY_COLORS[v.severity] || '#4c91ff'}11;
      pointer-events: none;
      z-index: 999998;
    `

    // Badge
    const badge = document.createElement('div')
    badge.className = 'dew-vqa-badge'
    badge.textContent = v.id
    badge.style.cssText = `
      position: absolute;
      top: -10px;
      left: -2px;
      background: ${SEVERITY_COLORS[v.severity] || '#4c91ff'};
      color: white;
      font-size: 10px;
      font-family: Inter, system-ui, sans-serif;
      padding: 1px 4px;
      border-radius: 3px;
      pointer-events: auto;
      cursor: default;
      white-space: nowrap;
    `
    badge.title = `${v.category}: ${v.property}\n${v.actual} → ${v.expected}`
    overlay.appendChild(badge)

    document.body.appendChild(overlay)
    overlayElements.push(overlay)
  }
}

function clearOverlay() {
  for (const el of overlayElements) {
    el.remove()
  }
  overlayElements = []
}

// ─── Message Listener ──────────────────────────────────────── (highlight removed)


// eslint-disable-next-line @typescript-eslint/no-explicit-any
chrome.runtime.onMessage.addListener(
  (message: Message & Record<string, any>, _sender, sendResponse) => {
    switch (message.type) {
      case 'PING': {
        sendResponse({ ok: true })
        break
      }
      case 'SCAN_PAGE': {
        const elements = scanPage(message.selector)
        sendResponse({ type: 'SCAN_RESULT', elements })
        break
      }
      case 'PICK_ELEMENT': {
        if (message.active) {
          scopePickMode = false
          activatePicker()
        } else {
          deactivatePicker()
        }
        sendResponse({ ok: true })
        break
      }
      case 'PICK_SCOPE': {
        if (message.active) {
          scopePickMode = true
          activatePicker()
        } else {
          scopePickMode = false
          deactivatePicker()
        }
        sendResponse({ ok: true })
        break
      }
      case 'TOGGLE_OVERLAY': {
        if (message.visible) {
          showOverlay(message.violations)
        } else {
          clearOverlay()
        }
        sendResponse({ ok: true })
        break
      }
    }
    return true // keep message channel open for async
  }
)
