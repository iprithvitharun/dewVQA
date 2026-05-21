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

/** Make a value safe to drop into a single Markdown table cell. */
function cell(value: string | number | undefined | null): string {
  if (value === undefined || value === null || value === '') return '—'
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const SEVERITY_LABEL: Record<Severity, string> = {
  blocker: 'Blocker',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

interface IssueRow {
  issue: string
  solution: string
  rationale: string
}

/** Strip markdown emphasis so the table stays readable. */
function stripMd(text: string): string {
  return text.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/`([^`]+)`/g, '$1')
}

/** Turn a "- finding\n- finding" description into a single, comma-joined sentence. */
function flattenBullets(text: string): string {
  return text
    .split('\n')
    .map((l) => l.trim().replace(/^[-*]\s*/, ''))
    .filter(Boolean)
    .join('; ')
}

/** Build rows from the AI's grouped findings (the same data shown in the side panel). */
function rowsFromAiFindings(report: FigmaComparisonReport): IssueRow[] {
  const findings = report.aiEnhancement?.groupedFindings ?? []
  return findings.map((f) => {
    const body = stripMd(flattenBullets(f.description))
    const issue = `${f.title} — ${body}`
    const isCopy = /^copy:/i.test(f.title)
    const solution = isCopy
      ? `Update the copy to match the Figma spec.`
      : f.cssFix?.trim()
        ? stripMd(f.cssFix.trim().replace(/\n+/g, ' '))
        : `Apply the values from the Figma spec to this element.`
    const rationale = isCopy
      ? `Copy must match the design system spec; users see the live wording.`
      : `Visual property diverges from the Figma source of truth.`
    return { issue, solution, rationale }
  })
}

/** Build rows from the deterministic discrepancy engine. */
function rowsFromDiscrepancies(report: FigmaComparisonReport): IssueRow[] {
  const findingDescById = new Map<string, string>()
  for (const f of report.aiEnhancement?.groupedFindings ?? []) {
    for (const id of f.discrepancyIds) {
      if (!findingDescById.has(id)) findingDescById.set(id, f.description)
    }
  }
  return report.discrepancies.map((d) => {
    const where = d.element.description || d.element.tagName || d.figmaNodeName || 'element'
    const issue = `${d.property} on ${where} — Figma: ${d.figmaValue}; live: ${d.domValue}`
    const findingDesc = findingDescById.get(d.id)
    const rationale = findingDesc
      ? `${SEVERITY_LABEL[d.severity]} severity. ${stripMd(flattenBullets(findingDesc))}`
      : `${SEVERITY_LABEL[d.severity]} severity. Diverges from Figma node ${d.figmaNodeName}.`
    return { issue, solution: d.suggestion, rationale }
  })
}

/** De-duplicate rows by their (case-insensitive) issue text. */
function dedupeRows(rows: IssueRow[]): IssueRow[] {
  const seen = new Set<string>()
  const out: IssueRow[] = []
  for (const r of rows) {
    const key = r.issue.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(r)
  }
  return out
}

function generateFigmaMarkdown(report: FigmaComparisonReport): string {
  // AI findings come first (they're what the user sees in the side panel),
  // then any deterministic discrepancies the AI didn't already cover.
  const rows = dedupeRows([
    ...rowsFromAiFindings(report),
    ...rowsFromDiscrepancies(report),
  ])

  const lines: string[] = [
    `# Figma vs. Live Build`,
    ``,
    `- **Captured:** ${cell(report.timestamp)}`,
    `- **Figma frame:** ${cell(report.figmaUrl)}`,
    `- **Live page:** ${cell(report.pageUrl)}`,
    `- **Issues found:** ${rows.length}`,
    ``,
  ]

  if (report.aiEnhancement?.summary) {
    lines.push(`> ${stripMd(report.aiEnhancement.summary.trim().replace(/\n+/g, ' '))}`, ``)
  }

  if (rows.length === 0) {
    lines.push(`_No discrepancies — the live build matches the Figma frame._`, ``)
    return lines.join('\n')
  }

  lines.push(
    `| # | Issue | Proposed solution | Rationale |`,
    `|---|-------|-------------------|-----------|`,
  )
  rows.forEach((r, i) => {
    lines.push(`| ${cell(String(i + 1))} | ${cell(r.issue)} | ${cell(r.solution)} | ${cell(r.rationale)} |`)
  })
  lines.push(``)

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
