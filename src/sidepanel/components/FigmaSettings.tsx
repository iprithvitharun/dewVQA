import React, { useState, useEffect, useCallback } from 'react'

interface Props {
  figmaUrl: string
  onFigmaUrlChange: (url: string) => void
  scopeSelector: string
  onScopeSelectorChange: (selector: string) => void
  onCompare: () => void
  comparing: boolean
  onPickScope: () => void
  scopePickerActive: boolean
}

export function FigmaSettings({
  figmaUrl,
  onFigmaUrlChange,
  scopeSelector,
  onScopeSelectorChange,
  onCompare,
  comparing,
  onPickScope,
  scopePickerActive,
}: Props) {
  const [tokenInput, setTokenInput] = useState('')
  const [tokenSaved, setTokenSaved] = useState(false)
  const [showTokenInput, setShowTokenInput] = useState(false)

  const [claudeKeyInput, setClaudeKeyInput] = useState('')
  const [claudeKeySaved, setClaudeKeySaved] = useState(false)
  const [showClaudeKeyInput, setShowClaudeKeyInput] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(['figmaToken', 'claudeApiKey'], (result) => {
      if (result.figmaToken) {
        setTokenSaved(true)
      } else {
        setShowTokenInput(true)
      }
      if (result.claudeApiKey) {
        setClaudeKeySaved(true)
      }
    })
  }, [])

  const handleSaveToken = useCallback(async () => {
    if (!tokenInput.trim()) return
    await chrome.storage.local.set({ figmaToken: tokenInput.trim() })
    setTokenSaved(true)
    setShowTokenInput(false)
    setTokenInput('')
  }, [tokenInput])

  const handleChangeToken = useCallback(() => {
    setShowTokenInput(true)
    setTokenSaved(false)
  }, [])

  const handleSaveClaudeKey = useCallback(async () => {
    if (!claudeKeyInput.trim()) return
    await chrome.storage.local.set({ claudeApiKey: claudeKeyInput.trim() })
    setClaudeKeySaved(true)
    setShowClaudeKeyInput(false)
    setClaudeKeyInput('')
  }, [claudeKeyInput])

  const isUrlValid = figmaUrl.includes('figma.com') && figmaUrl.includes('node-id')
  const canCompare = isUrlValid && tokenSaved && !comparing

  return (
    <div>
      {/* Figma Token */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#12334c' }}>
            Figma Token
          </span>
          {tokenSaved && !showTokenInput && (
            <>
              <span style={{
                fontSize: '10px', color: '#00795c', background: '#daf3ee',
                padding: '1px 6px', borderRadius: '99px', fontWeight: 500,
              }}>
                Saved
              </span>
              <button onClick={handleChangeToken} style={linkBtnStyle}>
                Change
              </button>
            </>
          )}
        </div>
        {showTokenInput && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="password"
              placeholder="figd_..."
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveToken()}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleSaveToken}
              disabled={!tokenInput.trim()}
              style={{
                ...btnBaseStyle,
                background: tokenInput.trim() ? '#276cf0' : '#c9d3db',
                color: '#fff',
              }}
            >
              Save
            </button>
          </div>
        )}
        {!tokenSaved && !showTokenInput && (
          <button onClick={() => setShowTokenInput(true)} style={{ ...btnBaseStyle, background: '#f6f7f8', color: '#12334c', border: '1px solid #c9d3db' }}>
            Set Token
          </button>
        )}
      </div>

      {/* Claude API Key (optional) */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '4px' }}>
          <span style={{ fontSize: '11px', fontWeight: 600, color: '#12334c' }}>
            Claude API Key
          </span>
          <span style={{ fontSize: '10px', color: '#6f8396' }}>(optional)</span>
          {claudeKeySaved && !showClaudeKeyInput && (
            <>
              <span style={{
                fontSize: '10px', color: '#00795c', background: '#daf3ee',
                padding: '1px 6px', borderRadius: '99px', fontWeight: 500,
              }}>
                Saved
              </span>
              <button onClick={() => { setShowClaudeKeyInput(true); setClaudeKeySaved(false) }} style={linkBtnStyle}>
                Change
              </button>
            </>
          )}
        </div>
        {!claudeKeySaved && !showClaudeKeyInput && (
          <button onClick={() => setShowClaudeKeyInput(true)} style={{ ...btnBaseStyle, background: '#f6f7f8', color: '#12334c', border: '1px solid #c9d3db', fontSize: '11px' }}>
            Add Claude Key for AI Enhancement
          </button>
        )}
        {showClaudeKeyInput && (
          <div style={{ display: 'flex', gap: '6px' }}>
            <input
              type="password"
              placeholder="sk-ant-..."
              value={claudeKeyInput}
              onChange={(e) => setClaudeKeyInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveClaudeKey()}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              onClick={handleSaveClaudeKey}
              disabled={!claudeKeyInput.trim()}
              style={{
                ...btnBaseStyle,
                background: claudeKeyInput.trim() ? '#276cf0' : '#c9d3db',
                color: '#fff',
              }}
            >
              Save
            </button>
          </div>
        )}
      </div>

      {/* Figma Frame URL */}
      <div style={{ marginBottom: '8px' }}>
        <input
          type="text"
          placeholder="Paste Figma frame URL..."
          value={figmaUrl}
          onChange={(e) => onFigmaUrlChange(e.target.value)}
          style={inputStyle}
        />
        {figmaUrl && !isUrlValid && (
          <div style={{ fontSize: '10px', color: '#cd2629', marginTop: '2px' }}>
            URL should include figma.com and a node-id parameter
          </div>
        )}
      </div>

      {/* Scope Selector */}
      <div style={{ marginBottom: '12px' }}>
        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="CSS selector to scope scan (optional)"
            value={scopeSelector}
            onChange={(e) => onScopeSelectorChange(e.target.value)}
            style={{ ...inputStyle, flex: 1 }}
          />
          <button
            onClick={onPickScope}
            style={{
              ...btnBaseStyle,
              background: scopePickerActive ? '#276cf0' : '#f6f7f8',
              color: scopePickerActive ? '#fff' : '#12334c',
              border: scopePickerActive ? 'none' : '1px solid #c9d3db',
              height: '30px',
              fontSize: '11px',
            }}
          >
            {scopePickerActive ? 'Picking...' : 'Pick'}
          </button>
        </div>
        {scopeSelector && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginTop: '4px' }}>
            <code style={{ fontSize: '10px', background: '#f6f7f8', padding: '2px 6px', borderRadius: '3px', fontFamily: 'SF Mono, Menlo, monospace', color: '#12334c', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {scopeSelector}
            </code>
            <button
              onClick={() => onScopeSelectorChange('')}
              style={{ ...linkBtnStyle, color: '#cd2629', fontSize: '10px' }}
            >
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Compare Button */}
      <button
        onClick={onCompare}
        disabled={!canCompare}
        style={{
          ...btnBaseStyle,
          background: canCompare ? '#276cf0' : '#c9d3db',
          color: '#fff',
          width: '100%',
          padding: '8px 12px',
          fontSize: '13px',
          fontWeight: 600,
        }}
      >
        {comparing ? 'Comparing...' : 'Compare with Figma'}
      </button>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '6px 8px',
  fontSize: '12px',
  border: '1px solid #c9d3db',
  borderRadius: '6px',
  outline: 'none',
  fontFamily: 'inherit',
  boxSizing: 'border-box',
}

const btnBaseStyle: React.CSSProperties = {
  padding: '4px 10px',
  fontSize: '12px',
  fontWeight: 500,
  fontFamily: 'inherit',
  border: 'none',
  borderRadius: '6px',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
}

const linkBtnStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#276cf0',
  fontSize: '10px',
  cursor: 'pointer',
  textDecoration: 'underline',
  fontFamily: 'inherit',
  padding: 0,
}
