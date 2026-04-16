import React from 'react'
import type { Severity } from '../../shared/types'

interface Props {
  summary: Record<Severity, number>
  total: number
}

const SEVERITY_CONFIG: { key: Severity; label: string; bg: string; color: string }[] = [
  { key: 'blocker', label: 'Blocker', bg: '#cd2629', color: '#fff' },
  { key: 'high', label: 'High', bg: '#ed7d27', color: '#fff' },
  { key: 'medium', label: 'Medium', bg: '#f8a34b', color: '#12334c' },
  { key: 'low', label: 'Low', bg: '#4c91ff', color: '#fff' },
]

export function SummaryBar({ summary, total }: Props) {
  const totalViolations = Object.values(summary).reduce((a, b) => a + b, 0)

  return (
    <div style={{ marginBottom: '16px' }}>
      <div
        style={{
          fontSize: '12px',
          color: '#485a68',
          marginBottom: '8px',
        }}
      >
        {totalViolations} violation{totalViolations !== 1 ? 's' : ''} found across{' '}
        {total} elements
      </div>

      <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
        {SEVERITY_CONFIG.map(({ key, label, bg, color }) => (
          <div
            key={key}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
              padding: '3px 8px',
              borderRadius: '99px',
              fontSize: '11px',
              fontWeight: 600,
              background: summary[key] > 0 ? bg : '#f6f7f8',
              color: summary[key] > 0 ? color : '#6f8396',
            }}
          >
            <span>{summary[key]}</span>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
