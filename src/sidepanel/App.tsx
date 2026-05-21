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

/** Short label for which surface a discrepancy lives on (region + parent). */
function surfaceLabel(d: FigmaComparisonReport['discrepancies'][number]): string {
  const parts: string[] = []
  if (d.element.dew?.componentName) parts.push(d.element.dew.componentName)
  else if (d.element.role) parts.push(d.element.role)
  if (d.element.parentContext) parts.push(d.element.parentContext)
  else if (d.element.region) parts.push(d.element.region)
  return parts.filter(Boolean).join(' · ') || d.figmaNodeName || '—'
}

/** Compact "what changed" description for the element column. */
function elementLabel(d: FigmaComparisonReport['discrepancies'][number]): string {
  const desc = d.element.description || d.element.tagName || d.figmaNodeName
  return `${d.property} on ${desc}`
}

/** Map each discrepancy id → the AI finding title that grouped it, if any. */
function buildFindingIndex(report: FigmaComparisonReport): Map<string, string> {
  const index = new Map<string, string>()
  const findings = report.aiEnhancement?.groupedFindings ?? []
  for (const f of findings) {
    for (const id of f.discrepancyIds) {
      if (!index.has(id)) index.set(id, f.title)
    }
  }
  return index
}

const SEVERITY_BADGE: Record<Severity, string> = {
  blocker: '🔴 Blocker',
  high: '🟠 High',
  medium: '🟡 Medium',
  low: '🟢 Low',
}

function generateFigmaMarkdown(report: FigmaComparisonReport): string {
  const findingIndex = buildFindingIndex(report)
  const ai = report.aiEnhancement
  const totalIssues =
    report.summary.blocker + report.summary.high + report.summary.medium + report.summary.low

  const lines: string[] = [
    `# Figma vs. Live Build — VQA Report`,
    ``,
    `> Side-by-side audit of what Figma specifies against what's actually rendered in the browser.`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Captured | ${cell(report.timestamp)} |`,
    `| Figma frame | ${cell(report.figmaUrl)} |`,
    `| Live page | ${cell(report.pageUrl)} |`,
    `| Figma nodes inspected | ${report.totalFigmaNodes} |`,
    `| Page elements inspected | ${report.totalDomElements} |`,
    `| Nodes successfully paired | ${report.matchedPairs} |`,
    `| Discrepancies surfaced | ${totalIssues} |`,
    ``,
  ]

  // ─── Severity snapshot ─────────────────────────────────────
  lines.push(
    `## Severity snapshot`,
    ``,
    `| Severity | Count | What it means |`,
    `|----------|-------|---------------|`,
    `| 🔴 Blocker | ${report.summary.blocker} | Ship-stopping divergence from the design |`,
    `| 🟠 High | ${report.summary.high} | Clearly visible mismatch users will notice |`,
    `| 🟡 Medium | ${report.summary.medium} | Off-spec but unlikely to confuse users |`,
    `| 🟢 Low | ${report.summary.low} | Minor polish gap |`,
    ``,
  )

  // ─── AI headline ───────────────────────────────────────────
  if (ai?.summary) {
    lines.push(`## Headline takeaways`, ``, ai.summary.trim(), ``)
  }
  if (ai?.visualDiffNotes) {
    lines.push(`## Visual diff notes`, ``, ai.visualDiffNotes.trim(), ``)
  }

  // ─── Per-discrepancy table (the centerpiece) ───────────────
  if (report.discrepancies.length > 0) {
    lines.push(
      `## Discrepancy log`,
      ``,
      `Each row is a single mismatch between the Figma frame and the live page. Use the **Track** column to mark progress as the team works through fixes.`,
      ``,
      `| # | Severity | Surface | What's off | Spec'd in Figma | Showing in product | Theme | Recommended fix | Match confidence | Track |`,
      `|---|----------|---------|-----------|------------------|--------------------|-------|------------------|------------------|-------|`,
    )
    report.discrepancies.forEach((d, i) => {
      const row = [
        String(i + 1),
        SEVERITY_BADGE[d.severity],
        surfaceLabel(d),
        elementLabel(d),
        `${cell(d.figmaValue)} (node: ${cell(d.figmaNodeName)})`,
        cell(d.domValue),
        findingIndex.get(d.id) ?? '—',
        cell(d.suggestion),
        `${Math.round(d.matchConfidence * 100)}%`,
        '☐ Open',
      ]
      lines.push(`| ${row.map(cell).join(' | ')} |`)
    })
    lines.push(``)

    // ─── Per-row detail (expanded reference for each row) ────
    lines.push(
      `### Per-row detail`,
      ``,
      `Expanded context for every row above, including selectors and node ids you'll need to fix it.`,
      ``,
    )
    report.discrepancies.forEach((d, i) => {
      lines.push(
        `#### ${i + 1}. ${d.property} — ${SEVERITY_BADGE[d.severity]}`,
        ``,
        `- **Surface:** ${surfaceLabel(d)}`,
        `- **Element:** ${d.element.description}`,
        `- **Selector:** \`${d.element.selector}\``,
        `- **Figma node:** ${d.figmaNodeName} (\`${d.figmaNodeId}\`)`,
        `- **Spec'd value:** \`${d.figmaValue}\``,
        `- **Live value:** \`${d.domValue}\``,
        `- **Theme:** ${findingIndex.get(d.id) ?? 'Standalone finding'}`,
        `- **Match confidence:** ${Math.round(d.matchConfidence * 100)}%`,
        `- **Recommended fix:** ${d.suggestion}`,
        `- **Discrepancy id:** \`${d.id}\``,
        ``,
      )
    })
  } else {
    lines.push(`## Discrepancy log`, ``, `_No discrepancies surfaced — the live build matches the Figma frame for every paired node._`, ``)
  }

  // ─── AI grouped findings with CSS fixes ────────────────────
  if (ai && ai.groupedFindings.length > 0) {
    lines.push(`## Grouped fixes (with CSS)`, ``)
    ai.groupedFindings.forEach((f, i) => {
      lines.push(
        `### ${i + 1}. ${f.title}`,
        ``,
        f.description.trim(),
        ``,
      )
      if (f.discrepancyIds.length > 0) {
        lines.push(`**Covers rows:** ${f.discrepancyIds.map((id) => `\`${id}\``).join(', ')}`, ``)
      }
      if (f.cssFix?.trim()) {
        lines.push('```css', f.cssFix.trim(), '```', ``)
      }
    })
  }

  // ─── Unmatched on either side ──────────────────────────────
  if (report.unmatchedFigmaNodes.length > 0) {
    lines.push(
      `## In Figma but not on the page`,
      ``,
      `Nodes from the design that the matcher couldn't pair to anything in the live DOM. Often these are missing implementations — worth a quick sanity check.`,
      ``,
    )
    for (const name of report.unmatchedFigmaNodes) lines.push(`- ${name}`)
    lines.push(``)
  }

  if (report.unmatchedDomElements && report.unmatchedDomElements.length > 0) {
    lines.push(
      `## On the page but not in Figma`,
      ``,
      `Elements rendered in the browser that don't correspond to any node in the Figma frame. May be intentional (data-driven UI) or extra cruft.`,
      ``,
    )
    for (const sel of report.unmatchedDomElements) lines.push(`- \`${sel}\``)
    lines.push(``)
  }

  lines.push(`---`, ``, `_Generated by Dew VQA. Track column uses ☐ Open / ☑ Fixed / ⏳ In review — edit inline as you triage._`, ``)

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
