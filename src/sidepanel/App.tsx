import React, { useState, useEffect, useCallback } from 'react'
import type { VqaReport, FigmaComparisonReport, Severity } from '../shared/types'
import { SummaryBar } from './components/SummaryBar'
import { ViolationList } from './components/ViolationList'
import { FigmaSettings } from './components/FigmaSettings'
import { AIReportSummary } from './components/AIReportSummary'

type Mode = 'token-scan' | 'figma-compare'

export function App() {
  const [mode, setMode] = useState<Mode>('token-scan')
  const [report, setReport] = useState<VqaReport | null>(null)
  const [scanning, setScanning] = useState(false)
  const [overlayVisible, setOverlayVisible] = useState(false)
  const [pickerActive, setPickerActive] = useState(false)
  const [scopeSelector, setScopeSelector] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Figma compare state
  const [figmaUrl, setFigmaUrl] = useState('')
  const [figmaReport, setFigmaReport] = useState<FigmaComparisonReport | null>(null)
  const [figmaComparing, setFigmaComparing] = useState(false)
  const [figmaError, setFigmaError] = useState<string | null>(null)
  const [scopePickerActive, setScopePickerActive] = useState(false)

  const [hasClaudeKey, setHasClaudeKey] = useState(false)

  // Check if Claude API key exists
  useEffect(() => {
    chrome.storage.local.get('claudeApiKey', (result) => {
      setHasClaudeKey(!!result.claudeApiKey)
    })
    // Re-check when storage changes (user saves key)
    const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
      if (changes.claudeApiKey) {
        setHasClaudeKey(!!changes.claudeApiKey.newValue)
      }
    }
    chrome.storage.onChanged.addListener(listener)
    return () => chrome.storage.onChanged.removeListener(listener)
  }, [])

  // Listen for reports pushed from background + scope picks
  useEffect(() => {
    const listener = (message: { type: string; report?: VqaReport; selector?: string }) => {
      if (message.type === 'REPORT_READY' && message.report) {
        setReport(message.report)
        setScanning(false)
      }
      if (message.type === 'SCOPE_PICKED' && message.selector) {
        setScopeSelector(message.selector)
        setScopePickerActive(false)
      }
    }
    chrome.runtime.onMessage.addListener(listener)
    return () => chrome.runtime.onMessage.removeListener(listener)
  }, [])

  const handleScan = useCallback(() => {
    setScanning(true)
    setError(null)
    setReport(null)

    chrome.runtime.sendMessage(
      {
        type: 'SCAN_PAGE',
        selector: scopeSelector || undefined,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          setError(chrome.runtime.lastError.message || 'Scan failed')
          setScanning(false)
          return
        }
        if (response?.error) {
          setError(response.error)
          setScanning(false)
          return
        }
        if (response?.type === 'REPORT_READY') {
          setReport(response.report)
          setScanning(false)
        }
      }
    )
  }, [scopeSelector])

  const toggleOverlay = useCallback(() => {
    const newVisible = !overlayVisible
    setOverlayVisible(newVisible)
    chrome.runtime.sendMessage({
      type: 'TOGGLE_OVERLAY',
      violations: report?.violations || [],
      visible: newVisible,
    })
  }, [overlayVisible, report])

  const togglePicker = useCallback(() => {
    const newActive = !pickerActive
    setPickerActive(newActive)
    chrome.runtime.sendMessage({
      type: 'PICK_ELEMENT',
      active: newActive,
    })
  }, [pickerActive])

  const toggleScopePicker = useCallback(() => {
    const newActive = !scopePickerActive
    setScopePickerActive(newActive)
    chrome.runtime.sendMessage({
      type: 'PICK_SCOPE',
      active: newActive,
    })
  }, [scopePickerActive])

  const handleFigmaCompare = useCallback(() => {
    setFigmaComparing(true)
    setFigmaError(null)
    setFigmaReport(null)

    chrome.runtime.sendMessage(
      {
        type: 'FIGMA_COMPARE',
        figmaUrl,
        selector: scopeSelector || undefined,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          setFigmaError(chrome.runtime.lastError.message || 'Compare failed')
          setFigmaComparing(false)
          return
        }
        if (response?.type === 'FIGMA_COMPARE_ERROR') {
          setFigmaError(response.error)
          setFigmaComparing(false)
          return
        }
        if (response?.type === 'FIGMA_COMPARE_RESULT') {
          setFigmaReport(response.report)
          setFigmaComparing(false)
        }
      }
    )
  }, [figmaUrl, scopeSelector])

  const exportReport = useCallback(() => {
    if (mode === 'figma-compare' && figmaReport) {
      const md = generateFigmaMarkdown(figmaReport)
      downloadMd(md, 'figma-compare')
      return
    }
    if (!report) return
    const md = generateMarkdown(report)
    downloadMd(md, 'vqa-report')
  }, [mode, report, figmaReport])

  const activeError = mode === 'figma-compare' ? figmaError : error
  const hasResults = mode === 'token-scan' ? !!report : !!figmaReport

  return (
    <div style={{ padding: '16px', maxWidth: '100%' }}>
      {/* Header */}
      <div style={{ marginBottom: '12px' }}>
        <h1 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '4px' }}>
          Dew VQA
        </h1>
        <p style={{ fontSize: '12px', color: '#485a68' }}>
          Visual QA against Dew Design System
        </p>
      </div>

      {/* Mode toggle */}
      <div style={{ display: 'flex', marginBottom: '16px', borderRadius: '8px', overflow: 'hidden', border: '1px solid #c9d3db' }}>
        <button
          onClick={() => setMode('token-scan')}
          style={tabStyle(mode === 'token-scan')}
        >
          Token Scan
        </button>
        <button
          onClick={() => setMode('figma-compare')}
          style={tabStyle(mode === 'figma-compare')}
        >
          Figma Compare
        </button>
      </div>

      {/* ─── Token Scan Mode ─── */}
      {mode === 'token-scan' && (
        <>
          {/* Scope selector */}
          <div style={{ marginBottom: '12px' }}>
            <input
              type="text"
              placeholder="CSS selector to scope scan (optional)"
              value={scopeSelector}
              onChange={(e) => setScopeSelector(e.target.value)}
              style={{
                width: '100%',
                padding: '6px 8px',
                fontSize: '12px',
                border: '1px solid #c9d3db',
                borderRadius: '6px',
                outline: 'none',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: '6px', marginBottom: '16px', flexWrap: 'wrap' }}>
            <button onClick={handleScan} disabled={scanning} style={btnStyle('#276cf0', '#fff')}>
              {scanning ? 'Scanning...' : 'Scan Page'}
            </button>
            <button
              onClick={togglePicker}
              style={btnStyle(pickerActive ? '#276cf0' : '#f6f7f8', pickerActive ? '#fff' : '#12334c')}
            >
              {pickerActive ? 'Picking...' : 'Pick Element'}
            </button>
            {report && (
              <>
                <button
                  onClick={toggleOverlay}
                  style={btnStyle(overlayVisible ? '#276cf0' : '#f6f7f8', overlayVisible ? '#fff' : '#12334c')}
                >
                  {overlayVisible ? 'Hide Overlay' : 'Show Overlay'}
                </button>
                <button onClick={exportReport} style={btnStyle('#f6f7f8', '#12334c')}>
                  Export MD
                </button>
              </>
            )}
          </div>
        </>
      )}

      {/* ─── Figma Compare Mode ─── */}
      {mode === 'figma-compare' && (
        <div style={{ marginBottom: '16px' }}>
          <FigmaSettings
            figmaUrl={figmaUrl}
            onFigmaUrlChange={setFigmaUrl}
            scopeSelector={scopeSelector}
            onScopeSelectorChange={setScopeSelector}
            onCompare={handleFigmaCompare}
            comparing={figmaComparing}
            onPickScope={toggleScopePicker}
            scopePickerActive={scopePickerActive}
          />
          {figmaReport && (
            <div style={{ marginTop: '12px', display: 'flex', gap: '6px' }}>
              <button onClick={exportReport} style={btnStyle('#f6f7f8', '#12334c')}>
                Export MD
              </button>
            </div>
          )}
        </div>
      )}

      {/* Error */}
      {activeError && (
        <div
          style={{
            padding: '8px 12px',
            background: '#ffe9ee',
            border: '1px solid #ffc2cb',
            borderRadius: '6px',
            fontSize: '12px',
            color: '#a62426',
            marginBottom: '12px',
          }}
        >
          {activeError}
        </div>
      )}

      {/* Token Scan Results */}
      {mode === 'token-scan' && report && (
        <>
          <SummaryBar summary={report.summary} total={report.totalElements} />
          <ViolationList violations={report.violations} />
        </>
      )}

      {/* Figma Compare Results */}
      {mode === 'figma-compare' && figmaReport && (
        <>
          {figmaReport.aiEnhancement && (
            <AIReportSummary report={figmaReport.aiEnhancement} />
          )}
        </>
      )}

      {/* Empty state */}
      {!hasResults && !scanning && !figmaComparing && !activeError && (
        <div
          style={{
            textAlign: 'center',
            padding: '40px 16px',
            color: '#6f8396',
            fontSize: '12px',
          }}
        >
          {mode === 'token-scan' ? (
            <>
              <p style={{ marginBottom: '8px' }}>No scan results yet.</p>
              <p>Click "Scan Page" to check design token compliance.</p>
            </>
          ) : (
            <>
              <p style={{ marginBottom: '8px' }}>No comparison results yet.</p>
              <p>Paste a Figma frame URL and click "Compare with Figma".</p>
            </>
          )}
        </div>
      )}
    </div>
  )
}

function tabStyle(active: boolean): React.CSSProperties {
  return {
    flex: 1,
    padding: '8px 12px',
    fontSize: '12px',
    fontWeight: 600,
    fontFamily: 'inherit',
    border: 'none',
    cursor: 'pointer',
    background: active ? '#276cf0' : '#fff',
    color: active ? '#fff' : '#485a68',
    transition: 'all 0.15s ease',
  }
}

function btnStyle(bg: string, color: string): React.CSSProperties {
  return {
    padding: '6px 12px',
    fontSize: '12px',
    fontWeight: 500,
    fontFamily: 'inherit',
    background: bg,
    color,
    border: bg === '#f6f7f8' ? '1px solid #c9d3db' : 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  }
}

function downloadMd(md: string, prefix: string): void {
  const blob = new Blob([md], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${prefix}-${new Date().toISOString().slice(0, 10)}.md`
  a.click()
  URL.revokeObjectURL(url)
}

function generateFigmaMarkdown(report: FigmaComparisonReport): string {
  const lines: string[] = [
    `# Figma Comparison Report`,
    ``,
    `- **Figma URL**: ${report.figmaUrl}`,
    `- **Page URL**: ${report.pageUrl}`,
    `- **Date**: ${report.timestamp}`,
    `- **Figma nodes**: ${report.totalFigmaNodes}`,
    `- **DOM elements**: ${report.totalDomElements}`,
    `- **Matched pairs**: ${report.matchedPairs}`,
    ``,
    `## Summary`,
    ``,
    `| Severity | Count |`,
    `|----------|-------|`,
    `| Blocker  | ${report.summary.blocker} |`,
    `| High     | ${report.summary.high} |`,
    `| Medium   | ${report.summary.medium} |`,
    `| Low      | ${report.summary.low} |`,
    ``,
  ]

  if (report.discrepancies.length > 0) {
    lines.push(`## Discrepancies`, ``)
    for (const d of report.discrepancies) {
      lines.push(`### ${d.id} (${d.severity.toUpperCase()})`)
      lines.push(``)
      lines.push(`- **Property**: ${d.property}`)
      lines.push(`- **Figma**: ${d.figmaValue} (node: ${d.figmaNodeName})`)
      lines.push(`- **DOM**: ${d.domValue}`)
      lines.push(`- **Element**: ${d.element.description}`)
      lines.push(`- **Match confidence**: ${Math.round(d.matchConfidence * 100)}%`)
      lines.push(`- **Fix hint**: ${d.suggestion}`)
      lines.push(``)
    }
  }

  if (report.unmatchedFigmaNodes.length > 0) {
    lines.push(`## Unmatched Figma Nodes`, ``)
    for (const name of report.unmatchedFigmaNodes) {
      lines.push(`- ${name}`)
    }
    lines.push(``)
  }

  return lines.join('\n')
}

function generateMarkdown(report: VqaReport): string {
  const lines: string[] = [
    `# VQA Report`,
    ``,
    `- **URL**: ${report.url}`,
    `- **Date**: ${report.timestamp}`,
    `- **Elements scanned**: ${report.totalElements}`,
    ``,
    `## Summary`,
    ``,
    `| Severity | Count |`,
    `|----------|-------|`,
    `| Blocker  | ${report.summary.blocker} |`,
    `| High     | ${report.summary.high} |`,
    `| Medium   | ${report.summary.medium} |`,
    `| Low      | ${report.summary.low} |`,
    ``,
    `## Findings`,
    ``,
  ]

  for (const v of report.violations) {
    lines.push(`### ${v.id} (${v.severity.toUpperCase()})`)
    lines.push(``)
    lines.push(`- **Category**: ${v.category}`)
    lines.push(`- **Property**: ${v.property}`)
    lines.push(`- **Actual**: ${v.actual}`)
    lines.push(`- **Expected**: ${v.expected}`)
    lines.push(`- **Element**: \`${v.element.selector}\` (${v.element.tagName})`)
    lines.push(`- **Fix hint**: ${v.suggestion}`)
    lines.push(``)
  }

  return lines.join('\n')
}
