import React, { useState } from 'react'
import type { AIEnhancedReport } from '../../shared/types'

interface Props {
  report: AIEnhancedReport
}

/** Render text with **bold** markers and line breaks as bullet list items */
function FormattedText({ text }: { text: string }) {
  const lines = text.split('\n').filter((l) => l.trim())

  return (
    <div>
      {lines.map((line, i) => {
        const trimmed = line.trim()
        const isBullet = trimmed.startsWith('- ') || trimmed.startsWith('* ')
        const content = isBullet ? trimmed.slice(2) : trimmed

        // Parse **bold** markers
        const parts = content.split(/(\*\*[^*]+\*\*)/)
        const rendered = parts.map((part, j) => {
          if (part.startsWith('**') && part.endsWith('**')) {
            return (
              <strong key={j} style={{ color: '#12334c', fontWeight: 600 }}>
                {part.slice(2, -2)}
              </strong>
            )
          }
          return <span key={j}>{part}</span>
        })

        if (isBullet) {
          return (
            <div key={i} style={{ display: 'flex', gap: '6px', marginBottom: '4px' }}>
              <span style={{ color: '#6b3fa0', fontWeight: 700, flexShrink: 0 }}>-</span>
              <span>{rendered}</span>
            </div>
          )
        }

        return <div key={i} style={{ marginBottom: '4px' }}>{rendered}</div>
      })}
    </div>
  )
}

export function AIReportSummary({ report }: Props) {
  return (
    <div style={{ marginBottom: '16px' }}>
      {/* AI badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '8px' }}>
        <span style={{
          fontSize: '10px', fontWeight: 700, textTransform: 'uppercase' as const,
          letterSpacing: '0.05em', padding: '2px 8px', borderRadius: '99px',
          background: 'linear-gradient(135deg, #276cf0, #6b3fa0)',
          color: '#fff',
        }}>
          AI Enhanced
        </span>
      </div>

      {/* Summary */}
      <div style={{
        padding: '12px', borderRadius: '8px',
        background: '#f8f6ff', border: '1px solid #e8e0f7',
        fontSize: '12px', lineHeight: '1.6', color: '#12334c',
        marginBottom: '12px',
      }}>
        <FormattedText text={report.summary} />
      </div>

      {/* Visual diff notes */}
      {report.visualDiffNotes && (
        <div style={{
          padding: '10px 12px', borderRadius: '8px',
          background: '#f0f7ff', border: '1px solid #c1e2ff',
          fontSize: '12px', lineHeight: '1.5', color: '#12334c',
          marginBottom: '12px',
        }}>
          <div style={{ fontWeight: 600, fontSize: '11px', marginBottom: '4px', color: '#003fd2' }}>
            Visual Diff
          </div>
          {report.visualDiffNotes}
        </div>
      )}

      {/* Grouped findings */}
      {report.groupedFindings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {report.groupedFindings.map((finding, i) => (
            <FindingCard key={i} finding={finding} />
          ))}
        </div>
      )}
    </div>
  )
}

function FindingCard({ finding }: { finding: AIEnhancedReport['groupedFindings'][0] }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)

  const handleCopyCSS = () => {
    navigator.clipboard.writeText(finding.cssFix)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div style={{
      border: '1px solid #e8e0f7',
      borderRadius: '8px',
      borderLeft: '3px solid #6b3fa0',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          padding: '10px 12px',
          cursor: 'pointer',
          background: expanded ? '#f8f6ff' : '#fff',
        }}
      >
        <div style={{ fontSize: '12px', fontWeight: 600, color: '#12334c', marginBottom: '6px' }}>
          {finding.title}
        </div>
        <div style={{ fontSize: '11px', color: '#485a68', lineHeight: '1.7' }}>
          <FormattedText text={finding.description} />
        </div>
        {finding.discrepancyIds.length > 0 && (
          <div style={{ marginTop: '4px', fontSize: '10px', color: '#6f8396' }}>
            Related: {finding.discrepancyIds.join(', ')}
          </div>
        )}
      </div>

      {expanded && finding.cssFix && (
        <div style={{ padding: '0 12px 10px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '4px' }}>
            <span style={{ fontSize: '10px', fontWeight: 600, color: '#6b3fa0' }}>CSS Fix</span>
            <button
              onClick={(e) => { e.stopPropagation(); handleCopyCSS() }}
              style={{
                background: 'none', border: '1px solid #c9d3db', borderRadius: '4px',
                padding: '2px 8px', fontSize: '10px', cursor: 'pointer',
                color: copied ? '#00795c' : '#485a68', fontFamily: 'inherit',
              }}
            >
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>
          <pre style={{
            background: '#1e1e2e', color: '#cdd6f4',
            padding: '10px', borderRadius: '6px',
            fontSize: '11px', lineHeight: '1.5',
            overflow: 'auto', margin: 0,
            fontFamily: 'SF Mono, Menlo, monospace',
          }}>
            {finding.cssFix}
          </pre>
        </div>
      )}
    </div>
  )
}
