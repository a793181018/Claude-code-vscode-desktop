import { useState, useEffect, useRef } from 'react'
import { t } from '../i18n'

interface Props {
  mode: 'new' | 'fork'
  locale: 'en' | 'zh'
  onConfirm: (name: string) => void
  onCancel: () => void
}

export function NamePrompt({ mode, locale, onConfirm, onCancel }: Props) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSubmit() {
    onConfirm(name.trim())
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter') {
      handleSubmit()
    }
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div className="mcp-overlay" onClick={onCancel}>
      <div className="mcp-overlay-content name-prompt-content" onClick={(e) => e.stopPropagation()}>
        <h3>{t(mode === 'new' ? 'name.newSession' : 'name.forkSession', locale)}</h3>
        <label style={{ fontSize: 11, opacity: 0.7, display: 'block', marginBottom: 4 }}>
          {t('name.label', locale)}
        </label>
        <input
          ref={inputRef}
          className="mcp-input"
          placeholder={t('name.placeholder', locale)}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={handleKeyDown}
          style={{ marginBottom: 12 }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button className="btn-small" onClick={onCancel}>
            {t('name.cancel', locale)}
          </button>
          <button className="btn-small btn-primary" onClick={handleSubmit}>
            {t('name.create', locale)}
          </button>
        </div>
      </div>
    </div>
  )
}
