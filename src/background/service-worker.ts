import type {
  TokenDatabase,
  ComponentSpecDatabase,
  ExtractedElement,
  FigmaComparisonReport,
  VqaReport,
  Message,
} from '../shared/types'
import { runComparison, setComponentSpecs } from './comparison-engine'
import { parseFigmaUrl, getFigmaToken, fetchFigmaNodes, flattenFigmaTree } from './figma-api'
import { getClaudeApiKey } from './claude-api'
import { runAIComparison, fetchFigmaScreenshot } from './ai-enhance'
import tokenDb from '../data/token-database.json'
import componentSpecsDb from '../data/component-specs.json'

const db = tokenDb as unknown as TokenDatabase
setComponentSpecs(componentSpecsDb as unknown as ComponentSpecDatabase)
let latestReport: VqaReport | null = null
let latestFigmaReport: FigmaComparisonReport | null = null

// Open side panel when extension icon is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    chrome.sidePanel.open({ tabId: tab.id })
  }
})

/**
 * Ensure the content script is injected into the given tab.
 * If it's already there, the second injection is harmless (idempotent listener).
 * If the tab was open before the extension was installed, this injects it on-demand.
 */
async function ensureContentScript(tabId: number): Promise<void> {
  try {
    // Try pinging the content script first
    await chrome.tabs.sendMessage(tabId, { type: 'PING' })
  } catch {
    // Content script not present — inject it programmatically
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
    })
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ['content.css'],
    })
  }
}

// Handle messages from side panel and content scripts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
chrome.runtime.onMessage.addListener((message: Message & Record<string, any>, sender, sendResponse) => {
  switch (message.type) {
    case 'SCAN_PAGE': {
      // Forward scan request to content script, get extracted elements, run comparison
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tabId = tabs[0]?.id
        if (!tabId) {
          sendResponse({ error: 'No active tab' })
          return
        }

        try {
          await ensureContentScript(tabId)

          chrome.tabs.sendMessage(
            tabId,
            { type: 'SCAN_PAGE', selector: message.selector },
            (response: { type: string; elements: ExtractedElement[] }) => {
              if (chrome.runtime.lastError) {
                sendResponse({
                  error: chrome.runtime.lastError.message,
                })
                return
              }

              const report = runComparison(
                response.elements,
                db,
                tabs[0]?.url || 'unknown'
              )
              latestReport = report

              sendResponse({ type: 'REPORT_READY', report })
            }
          )
        } catch (err) {
          sendResponse({
            error: `Failed to inject content script: ${err}`,
          })
        }
      })
      return true // async
    }

    case 'ELEMENT_PICKED': {
      // Run comparison on single picked element
      const report = runComparison([message.element], db, 'element-pick')
      latestReport = report
      // Broadcast to side panel
      chrome.runtime.sendMessage({ type: 'REPORT_READY', report })
      break
    }

    case 'GET_REPORT': {
      sendResponse({ report: latestReport })
      break
    }

    case 'TOGGLE_OVERLAY': {
      // Forward overlay toggle to content script
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tabId = tabs[0]?.id
        if (!tabId) return
        await ensureContentScript(tabId)
        chrome.tabs.sendMessage(tabId, message)
      })
      break
    }

    case 'PICK_ELEMENT':
    case 'PICK_SCOPE': {
      // Forward picker toggle to content script (ensure injected first)
      chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
        const tabId = tabs[0]?.id
        if (!tabId) return
        try {
          await ensureContentScript(tabId)
          chrome.tabs.sendMessage(tabId, message)
        } catch { /* tab might have closed */ }
      })
      break
    }


    case 'FIGMA_COMPARE': {
      handleFigmaCompare(message.figmaUrl, message.selector, sendResponse)
      return true // async
    }

  }

  return false
})

async function handleFigmaCompare(
  figmaUrl: string,
  _selector: string | undefined,
  sendResponse: (response: unknown) => void
): Promise<void> {
  try {
    // 1. Parse Figma URL
    const ref = parseFigmaUrl(figmaUrl)
    if (!ref) {
      sendResponse({ type: 'FIGMA_COMPARE_ERROR', error: 'Invalid Figma URL. Expected format: https://figma.com/design/:fileKey/:name?node-id=...' })
      return
    }

    // 2. Check tokens
    const figmaToken = await getFigmaToken()
    if (!figmaToken) {
      sendResponse({ type: 'FIGMA_COMPARE_ERROR', error: 'No Figma token set. Please enter your Personal Access Token in settings.' })
      return
    }

    const claudeKey = await getClaudeApiKey()
    if (!claudeKey) {
      sendResponse({ type: 'FIGMA_COMPARE_ERROR', error: 'No Claude API key set. The AI comparison requires a Claude API key.' })
      return
    }

    // 3. Capture page screenshot
    let pageScreenshot: string
    try {
      pageScreenshot = await chrome.tabs.captureVisibleTab({ format: 'png' })
    } catch (err) {
      sendResponse({ type: 'FIGMA_COMPARE_ERROR', error: 'Could not capture page screenshot. Make sure the page is visible.' })
      return
    }

    // 4. Fetch Figma screenshot
    const figmaScreenshot = await fetchFigmaScreenshot(ref.fileKey, ref.nodeId, figmaToken)
    if (!figmaScreenshot) {
      sendResponse({ type: 'FIGMA_COMPARE_ERROR', error: 'Could not fetch Figma frame screenshot. Check the URL and your Figma token.' })
      return
    }

    // 5. Extract Figma node properties
    const rootNode = await fetchFigmaNodes(ref, figmaToken)
    const figmaNodes = flattenFigmaTree(rootNode)

    // 6. Scan DOM for property data
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true })
    const tabId = tabs[0]?.id
    const pageUrl = tabs[0]?.url || 'unknown'

    let domElements: ExtractedElement[] = []
    if (tabId) {
      try {
        await ensureContentScript(tabId)
        const domResponse = await new Promise<{ type: string; elements: ExtractedElement[] }>((resolve, reject) => {
          chrome.tabs.sendMessage(
            tabId,
            { type: 'SCAN_PAGE', selector: _selector },
            (response) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message))
              else resolve(response)
            }
          )
        })
        domElements = domResponse.elements
      } catch {
        // DOM scan failed — proceed with screenshots only
      }
    }

    // 7. Send screenshots + property data to Claude
    const aiReport = await runAIComparison(
      claudeKey,
      pageScreenshot,
      figmaScreenshot,
      figmaNodes,
      domElements,
      pageUrl,
      figmaUrl
    )

    // 8. Build report
    const report: FigmaComparisonReport = {
      figmaUrl,
      pageUrl,
      timestamp: new Date().toISOString(),
      totalFigmaNodes: figmaNodes.length,
      totalDomElements: 0,
      matchedPairs: 0,
      unmatchedFigmaNodes: [],
      unmatchedDomElements: [],
      discrepancies: [],
      summary: { blocker: 0, high: 0, medium: 0, low: 0 },
      aiEnhancement: aiReport,
    }

    latestFigmaReport = report
    sendResponse({ type: 'FIGMA_COMPARE_RESULT', report })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    sendResponse({ type: 'FIGMA_COMPARE_ERROR', error: message })
  }
}

function computeRootRect(elements: ExtractedElement[]): { x: number; y: number; width: number; height: number } {
  if (elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  for (const el of elements) {
    if (el.rect.width === 0 && el.rect.height === 0) continue
    minX = Math.min(minX, el.rect.x)
    minY = Math.min(minY, el.rect.y)
    maxX = Math.max(maxX, el.rect.x + el.rect.width)
    maxY = Math.max(maxY, el.rect.y + el.rect.height)
  }

  return {
    x: minX === Infinity ? 0 : minX,
    y: minY === Infinity ? 0 : minY,
    width: maxX === -Infinity ? 0 : maxX - minX,
    height: maxY === -Infinity ? 0 : maxY - minY,
  }
}
