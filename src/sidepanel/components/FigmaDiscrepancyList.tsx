import React, { useState } from 'react'
import type { FigmaDiscrepancy, ViolationCategory, Severity } from '../../shared/types'

interface Props {
  discrepancies: FigmaDiscrepancy[]
}

const SEVERITY_COLORS: Record<Severity, string> = {
  blocker: '#cd2629',
  high: '#ed7d27',
  medium: '#f8a34b',
  low: '#4c91ff',
}

const CATEGORY_LABELS: Record<ViolationCategory, string> = {
  color: 'Colors',
  spacing: 'Spacing',
  typography: 'Typography',
  'border-radius': 'Border Radius',
  contrast: 'Contrast',
  shadow: 'Shadows',
  content: 'Content',
}

const CONFIDENCE_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: 'High match', color: '#00795c', bg: '#daf3ee' },
  medium: { label: 'Medium match', color: '#ac5000', bg: '#feecd5' },
  low: { label: 'Low match', color: '#cd2629', bg: '#ffe9ee' },
}

function getConfidenceLevel(c: number): 'high' | 'medium' | 'low' {
  if (c >= 0.8) return 'high'
  if (c >= 0.5) return 'medium'
  return 'low'
}

export function FigmaDiscrepancyList({ discrepancies }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<ViolationCategory | 'all'>('all')
  const [filterSeverity, setFilterSeverity] = useState<Severity | 'all'>('all')

  const categories = [...new Set(discrepancies.map((d) => d.category))]

  const filtered = discrepancies.filter((d) => {
    if (filterCategory !== 'all' && d.category !== filterCategory) return false
    if (filterSeverity !== 'all' && d.severity !== filterSeverity) return false
    return true
  })

  return (
    <div>
      {/* Filters */}
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px' }}>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value as ViolationCategory | 'all')}
          style={selectStyle}
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>
          ))}
        </select>

        <select
          value={filterSeverity}
          onChange={(e) => setFilterSeverity(e.target.value as Severity | 'all')}
          style={selectStyle}
        >
          <option value="all">All severities</option>
          <option value="blocker">Blocker</option>
          <option value="high">High</option>
          <option value="medium">Medium</option>
          <option value="low">Low</option>
        </select>
      </div>

      {/* Discrepancy cards */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: '#6f8396', fontSize: '12px' }}>
          {discrepancies.length === 0
            ? 'No discrepancies found -- design matches implementation!'
            : 'No discrepancies match the current filters.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {filtered.map((d) => (
            <DiscrepancyCard
              key={d.id}
              discrepancy={d}
              expanded={expandedId === d.id}
              onToggle={() => setExpandedId(expandedId === d.id ? null : d.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function DiscrepancyCard({
  discrepancy: d,
  expanded,
  onToggle,
}: {
  discrepancy: FigmaDiscrepancy
  expanded: boolean
  onToggle: () => void
}) {
  const confLevel = getConfidenceLevel(d.matchConfidence)
  const confStyle = CONFIDENCE_LABELS[confLevel]
  const isColorProp = d.category === 'color'

  return (
    <div
      style={{
        border: '1px solid #eaeef2',
        borderRadius: '6px',
        borderLeft: `3px solid ${SEVERITY_COLORS[d.severity]}`,
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 10px',
          cursor: 'pointer',
          background: expanded ? '#f6f7f8' : '#fff',
        }}
      >
        <span style={{ fontSize: '10px', fontWeight: 700, color: SEVERITY_COLORS[d.severity], minWidth: '40px' }}>
          {d.id}
        </span>
        <span style={{ fontSize: '11px', fontWeight: 500, color: '#12334c', flex: 1, lineHeight: '1.4' }}>
          <strong>{d.element.description}</strong>
          <span style={{ color: '#6f8396', fontSize: '10px', marginLeft: '4px' }}>
            {d.property}
          </span>
        </span>
        <span style={{
          fontSize: '10px',
          background: SEVERITY_COLORS[d.severity],
          color: d.severity === 'medium' ? '#12334c' : '#fff',
          padding: '1px 6px',
          borderRadius: '99px',
          fontWeight: 600,
        }}>
          {d.severity}
        </span>
      </div>

      {/* Collapsed preview: Figma vs DOM values */}
      {!expanded && (
        <div style={{ padding: '4px 10px 8px', fontSize: '10px', display: 'flex', gap: '12px', color: '#6f8396' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            Figma:
            {isColorProp && <ColorSwatch hex={d.figmaValue} />}
            <code style={codeStyle}>{d.figmaValue}</code>
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            DOM:
            {isColorProp && <ColorSwatch hex={extractHex(d.domValue)} />}
            <code style={codeStyle}>{d.domValue}</code>
          </span>
        </div>
      )}

      {/* Expanded details */}
      {expanded && (
        <div style={{ padding: '8px 10px', fontSize: '11px', lineHeight: '1.6' }}>
          {/* Match confidence */}
          <div style={{ marginBottom: '6px' }}>
            <span style={{
              fontSize: '10px', fontWeight: 500, padding: '1px 6px',
              borderRadius: '99px', background: confStyle.bg, color: confStyle.color,
            }}>
              {confStyle.label} ({Math.round(d.matchConfidence * 100)}%)
            </span>
          </div>

          {/* Figma node */}
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: '#6f8396' }}>Figma node: </span>
            <span style={{ fontWeight: 500 }}>{d.figmaNodeName}</span>
          </div>

          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: '#6f8396' }}>Category: </span>
            <span>{CATEGORY_LABELS[d.category]}</span>
          </div>

          {/* Values comparison */}
          <div style={{
            display: 'flex', gap: '12px', marginBottom: '4px',
            padding: '6px 8px', background: '#f6f7f8', borderRadius: '4px',
          }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: '#6f8396', marginBottom: '2px' }}>Figma (expected)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {isColorProp && <ColorSwatch hex={d.figmaValue} size={16} />}
                <code style={codeStyle}>{d.figmaValue}</code>
              </div>
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: '10px', color: '#6f8396', marginBottom: '2px' }}>DOM (actual)</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                {isColorProp && <ColorSwatch hex={extractHex(d.domValue)} size={16} />}
                <code style={codeStyle}>{d.domValue}</code>
              </div>
            </div>
          </div>

          {/* Element info */}
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: '#6f8396' }}>Element: </span>
            <span style={{ fontWeight: 500 }}>{d.element.description}</span>
            {d.element.region && (
              <span style={{ color: '#6f8396', fontSize: '10px' }}> ({d.element.region})</span>
            )}
          </div>

          {/* Suggestion */}
          <div style={{
            marginTop: '6px', padding: '6px 8px',
            background: '#f6f7f8', borderRadius: '4px',
            color: '#335a7a', fontSize: '11px',
          }}>
            {d.suggestion}
          </div>
        </div>
      )}
    </div>
  )
}

function ColorSwatch({ hex, size = 12 }: { hex: string; size?: number }) {
  if (!hex || !hex.startsWith('#')) return null
  return (
    <span style={{
      display: 'inline-block', width: `${size}px`, height: `${size}px`,
      background: hex, borderRadius: '2px',
      border: '1px solid rgba(0,0,0,0.1)',
      flexShrink: 0,
    }} />
  )
}

/** Extract hex from strings like "rgb(1,2,3) (#aabbcc)" */
function extractHex(value: string): string {
  const match = value.match(/#[0-9a-f]{6}/i)
  return match ? match[0] : value
}

const selectStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: '11px',
  border: '1px solid #c9d3db',
  borderRadius: '6px',
  background: '#fff',
  color: '#12334c',
  fontFamily: 'inherit',
  outline: 'none',
  cursor: 'pointer',
}

const codeStyle: React.CSSProperties = {
  background: '#f6f7f8',
  padding: '1px 4px',
  borderRadius: '3px',
  fontSize: '10px',
  fontFamily: 'SF Mono, Menlo, monospace',
}
