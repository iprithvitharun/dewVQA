import React, { useState } from 'react'
import type { Violation, ViolationCategory, Severity } from '../../shared/types'

interface Props {
  violations: Violation[]
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

export function ViolationList({ violations }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [filterCategory, setFilterCategory] = useState<ViolationCategory | 'all'>('all')
  const [filterSeverity, setFilterSeverity] = useState<Severity | 'all'>('all')

  const categories = [...new Set(violations.map((v) => v.category))]

  const filtered = violations.filter((v) => {
    if (filterCategory !== 'all' && v.category !== filterCategory) return false
    if (filterSeverity !== 'all' && v.severity !== filterSeverity) return false
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
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
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

      {/* Violation cards */}
      {filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '20px', color: '#6f8396', fontSize: '12px' }}>
          {violations.length === 0
            ? 'No violations found — looking good!'
            : 'No violations match the current filters.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
          {filtered.map((v) => (
            <ViolationCard
              key={v.id}
              violation={v}
              expanded={expandedId === v.id}
              onToggle={() =>
                setExpandedId(expandedId === v.id ? null : v.id)
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

/** Shorten a CSS selector for display: show tag + first class or id */
function shortSelector(selector: string): string {
  // Take the last segment of the selector chain
  const parts = selector.split(' > ')
  const last = parts[parts.length - 1] || selector
  // Truncate if too long
  return last.length > 40 ? last.slice(0, 37) + '...' : last
}

function ViolationCard({
  violation: v,
  expanded,
  onToggle,
}: {
  violation: Violation
  expanded: boolean
  onToggle: () => void
}) {
  // Use the plain-language description if available
  const description = v.element.description || (
    v.element.textContent
      ? `"${v.element.textContent.slice(0, 25)}${v.element.textContent.length > 25 ? '...' : ''}"`
      : `<${v.element.tagName.toLowerCase()}>`
  )

  const dew = v.element.dew
  const dewLabel = dew?.isDewComponent
    ? `${dew.componentName}${dew.componentVariant && dew.componentVariant !== 'default' ? ` · ${dew.componentVariant}` : ''}`
    : null

  return (
    <div
      style={{
        border: '1px solid #eaeef2',
        borderRadius: '6px',
        borderLeft: `3px solid ${SEVERITY_COLORS[v.severity]}`,
        overflow: 'hidden',
      }}
    >
      {/* Header — plain-language element description + property + value */}
      <div
        onClick={onToggle}
        style={{
          padding: '8px 10px',
          cursor: 'pointer',
          background: expanded ? '#f6f7f8' : '#fff',
        }}
      >
        {/* Component badge row */}
        <div style={{ marginBottom: '4px' }}>
          {dewLabel ? (
            <span
              style={{
                display: 'inline-block',
                fontSize: '9px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#276cf0',
                background: '#def0ff',
                padding: '1px 6px',
                borderRadius: '3px',
              }}
            >
              {dewLabel}
            </span>
          ) : (
            <span
              style={{
                display: 'inline-block',
                fontSize: '9px',
                fontWeight: 700,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                color: '#6f8396',
                background: '#f6f7f8',
                padding: '1px 6px',
                borderRadius: '3px',
              }}
            >
              Not a Dew component
            </span>
          )}
        </div>
        {/* Top row: ID, plain-language description, severity */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '3px' }}>
          <span
            style={{
              fontSize: '10px',
              fontWeight: 700,
              color: SEVERITY_COLORS[v.severity],
              flexShrink: 0,
            }}
          >
            {v.id}
          </span>
          <span
            style={{
              fontSize: '11px',
              fontWeight: 600,
              color: '#12334c',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={description}
          >
            {description}
          </span>
          <span
            style={{
              fontSize: '10px',
              background: SEVERITY_COLORS[v.severity],
              color: v.severity === 'medium' ? '#12334c' : '#fff',
              padding: '1px 6px',
              borderRadius: '99px',
              fontWeight: 600,
              flexShrink: 0,
            }}
          >
            {v.severity}
          </span>
        </div>
        {/* Middle row: property + actual value */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span style={{ fontSize: '10px', color: '#6f8396', flexShrink: 0 }}>
            {v.property}
          </span>
          <code
            style={{
              fontSize: '10px',
              fontFamily: 'SF Mono, Menlo, monospace',
              color: '#a62426',
              background: '#ffe9ee',
              padding: '0px 4px',
              borderRadius: '3px',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={v.actual}
          >
            {v.actual.length > 35 ? v.actual.slice(0, 32) + '...' : v.actual}
          </code>
        </div>
      </div>

      {/* Expanded details */}
      {expanded && (
        <div
          style={{
            padding: '8px 10px',
            fontSize: '11px',
            lineHeight: '1.6',
            borderTop: '1px solid #eaeef2',
          }}
        >
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: '#6f8396' }}>Element: </span>
            <span style={{ fontWeight: 500 }}>{description}</span>
            {v.element.region && (
              <span style={{ color: '#8e9dac', marginLeft: '4px' }}>({v.element.region})</span>
            )}
          </div>
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: '#6f8396' }}>Category: </span>
            <span>{CATEGORY_LABELS[v.category]}</span>
          </div>
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: '#6f8396' }}>Actual: </span>
            <code style={codeStyle}>{v.actual}</code>
          </div>
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: '#6f8396' }}>Expected: </span>
            <code style={{ ...codeStyle, color: '#006445', background: '#daf3ee' }}>
              {v.expected}
            </code>
          </div>
          <div style={{ marginBottom: '4px' }}>
            <span style={{ color: '#6f8396' }}>Selector: </span>
            <code style={codeStyle}>{v.element.selector}</code>
          </div>
          <div
            style={{
              marginTop: '6px',
              padding: '6px 8px',
              background: '#f6f7f8',
              borderRadius: '4px',
              color: '#335a7a',
              fontSize: '11px',
            }}
          >
            {v.suggestion}
          </div>
        </div>
      )}
    </div>
  )
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
