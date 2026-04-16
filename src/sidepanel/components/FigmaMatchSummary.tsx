import React, { useState } from 'react'
import type { FigmaComparisonReport, Severity } from '../../shared/types'

interface Props {
  report: FigmaComparisonReport
}

const SEVERITY_COLORS: Record<Severity, string> = {
  blocker: '#cd2629',
  high: '#ed7d27',
  medium: '#f8a34b',
  low: '#4c91ff',
}

export function FigmaMatchSummary({ report }: Props) {
  const [showUnmatched, setShowUnmatched] = useState(false)

  const totalDiscrepancies = report.discrepancies.length

  return (
    <div style={{ marginBottom: '16px' }}>
      {/* Match stats */}
      <div style={{
        display: 'flex', gap: '8px', flexWrap: 'wrap',
        marginBottom: '8px', fontSize: '12px', color: '#12334c',
      }}>
        <span>
          <strong>{report.matchedPairs}</strong> matched pairs
        </span>
        <span style={{ color: '#c9d3db' }}>|</span>
        <span style={{ color: '#6f8396' }}>
          {report.totalFigmaNodes} Figma nodes
        </span>
        <span style={{ color: '#c9d3db' }}>|</span>
        <span style={{ color: '#6f8396' }}>
          {report.totalDomElements} DOM elements
        </span>
      </div>

      {/* Discrepancy count */}
      <div style={{ fontSize: '13px', fontWeight: 600, marginBottom: '8px', color: '#12334c' }}>
        {totalDiscrepancies} {totalDiscrepancies === 1 ? 'discrepancy' : 'discrepancies'} found
      </div>

      {/* Severity badges */}
      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
        {(['blocker', 'high', 'medium', 'low'] as Severity[]).map((sev) => (
          <span
            key={sev}
            style={{
              fontSize: '11px',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: '99px',
              background: report.summary[sev] > 0 ? SEVERITY_COLORS[sev] : '#f6f7f8',
              color: report.summary[sev] > 0
                ? (sev === 'medium' ? '#12334c' : '#fff')
                : '#6f8396',
            }}
          >
            {report.summary[sev]} {sev.charAt(0).toUpperCase() + sev.slice(1)}
          </span>
        ))}
      </div>

      {/* Unmatched nodes */}
      {(report.unmatchedFigmaNodes.length > 0 || report.unmatchedDomElements.length > 0) && (
        <div>
          <button
            onClick={() => setShowUnmatched(!showUnmatched)}
            style={{
              background: 'none', border: 'none', color: '#6f8396',
              fontSize: '11px', cursor: 'pointer', fontFamily: 'inherit',
              padding: '2px 0', textDecoration: 'underline',
            }}
          >
            {showUnmatched ? 'Hide' : 'Show'} unmatched ({report.unmatchedFigmaNodes.length} Figma, {report.unmatchedDomElements.length} DOM)
          </button>

          {showUnmatched && (
            <div style={{
              marginTop: '6px', padding: '8px', background: '#f6f7f8',
              borderRadius: '6px', fontSize: '10px', lineHeight: '1.6',
            }}>
              {report.unmatchedFigmaNodes.length > 0 && (
                <div style={{ marginBottom: '6px' }}>
                  <div style={{ fontWeight: 600, color: '#12334c', marginBottom: '2px' }}>
                    Unmatched Figma nodes:
                  </div>
                  {report.unmatchedFigmaNodes.slice(0, 10).map((name, i) => (
                    <div key={i} style={{ color: '#6f8396' }}>- {name}</div>
                  ))}
                  {report.unmatchedFigmaNodes.length > 10 && (
                    <div style={{ color: '#6f8396', fontStyle: 'italic' }}>
                      ...and {report.unmatchedFigmaNodes.length - 10} more
                    </div>
                  )}
                </div>
              )}
              {report.unmatchedDomElements.length > 0 && (
                <div>
                  <div style={{ fontWeight: 600, color: '#12334c', marginBottom: '2px' }}>
                    Unmatched DOM elements:
                  </div>
                  {report.unmatchedDomElements.slice(0, 10).map((desc, i) => (
                    <div key={i} style={{ color: '#6f8396' }}>- {desc}</div>
                  ))}
                  {report.unmatchedDomElements.length > 10 && (
                    <div style={{ color: '#6f8396', fontStyle: 'italic' }}>
                      ...and {report.unmatchedDomElements.length - 10} more
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
