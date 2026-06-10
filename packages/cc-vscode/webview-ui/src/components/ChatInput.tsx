import { useState, useRef, useEffect } from 'react'
import type { ChatState } from '../types'

interface Props {
  chatState: ChatState
  error: string | null
  onSend: (content: string) => void
  onStop: () => void
  onClear?: () => void
}

const SLASH_CMDS = [
  { cmd: '/help', desc: 'Show help' },
  { cmd: '/clear', desc: 'Clear conversation' },
  { cmd: '/compact', desc: 'Compact context' },
  { cmd: '/cost', desc: 'Show token cost' },
]

export function ChatInput({ chatState, error, onSend, onStop, onClear }: Props) {
  const [input, setInput] = useState('')
  const [showCommands, setShowCommands] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const isRunning = chatState !== 'idle' && chatState !== 'permission_pending'

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  function handleSend() {
    const text = input.trim()
    if (!text || isRunning) return

    // Handle slash commands locally where possible
    if (text === '/clear') {
      onClear?.()
      setInput('')
      return
    }

    setInput('')
    setShowCommands(false)
    onSend(text)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (showCommands) {
        // Auto-complete first matching command
        const match = SLASH_CMDS.find((c) => c.cmd.startsWith(input.trim()))
        if (match) {
          setInput(match.cmd)
          setShowCommands(false)
        }
        return
      }
      handleSend()
    }
    if (e.key === 'Escape') {
      setShowCommands(false)
    }
  }

  function handleChange(value: string) {
    setInput(value)
    // Show command suggestions when typing /
    setShowCommands(value.trim().startsWith('/') && !value.includes(' '))
  }

  return (
    <div className="chat-input-bar">
      {error && <div className="input-error">{error}</div>}
      {showCommands && (
        <div className="slash-suggestions">
          {SLASH_CMDS.filter((c) => c.cmd.startsWith(input.trim())).map((c) => (
            <div
              key={c.cmd}
              className="slash-item"
              onClick={() => { setInput(c.cmd); setShowCommands(false) }}
            >
              <span className="slash-cmd">{c.cmd}</span>
              <span className="slash-desc">{c.desc}</span>
            </div>
          ))}
        </div>
      )}
      <div className="input-row">
        <textarea
          ref={inputRef}
          className="chat-input"
          value={input}
          onChange={(e) => handleChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={
            isRunning
              ? 'Claude is thinking...'
              : 'Ask anything, or / for commands (Enter to send)'
          }
          disabled={isRunning}
          rows={2}
        />
        <div className="input-actions">
          {isRunning ? (
            <button className="btn-stop" onClick={onStop}>
              Stop
            </button>
          ) : (
            <button
              className="btn-send"
              onClick={handleSend}
              disabled={!input.trim()}
            >
              Send
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
