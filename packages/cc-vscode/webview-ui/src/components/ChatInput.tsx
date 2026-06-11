import { useState, useRef, useEffect, useCallback } from 'react'
import type { ChatState } from '../types'
import { restRequest } from '../vscodeApi'

interface SlashCommand {
  name: string
  description: string
  source: string
}

interface Props {
  chatState: ChatState
  error: string | null
  onSend: (content: string) => void
  onStop: () => void
  onClear?: () => void
  sessionId?: string | null
}

export function ChatInput({ chatState, error, onSend, onStop, onClear, sessionId }: Props) {
  const [input, setInput] = useState('')
  const [showCommands, setShowCommands] = useState(false)
  const [commands, setCommands] = useState<SlashCommand[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map())
  const isRunning = chatState !== 'idle' && chatState !== 'permission_pending'

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  // Fetch available slash commands from the bridge
  useEffect(() => {
    let cancelled = false
    async function loadCommands() {
      try {
        const url = sessionId
          ? `/api/sessions/${sessionId}/slash-commands`
          : '/api/sessions/_/slash-commands'
        const data = await restRequest(url) as { commands: SlashCommand[] }
        if (!cancelled && data?.commands) {
          setCommands(data.commands)
        }
      } catch {
        if (!cancelled) {
          setCommands([
            { name: 'help', description: 'Get help with Claude Code', source: 'builtin' },
            { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
            { name: 'compact', description: 'Compact the conversation context', source: 'builtin' },
            { name: 'cost', description: 'Show token usage and cost', source: 'builtin' },
          ])
        }
      }
    }
    loadCommands()
    return () => { cancelled = true }
  }, [sessionId])

  // Scroll selected item into view
  useEffect(() => {
    const el = itemRefs.current.get(selectedIndex)
    el?.scrollIntoView({ block: 'nearest' })
  }, [selectedIndex])

  const filteredCommands = useCallback(function (): SlashCommand[] {
    const prefix = input.trim().replace(/^\/\s*/, '')
    if (!prefix) return commands
    return commands.filter((c) =>
      c.name.toLowerCase().startsWith(prefix.toLowerCase())
    )
  }, [commands, input])

  const activeCommands = filteredCommands()
  const selectedCmd = activeCommands.length > 0 ? activeCommands[selectedIndex] || activeCommands[0] : null

  function commitCommand(cmd: SlashCommand) {
    setInput('/' + cmd.name + ' ')
    setShowCommands(false)
    setSelectedIndex(0)
  }

  function handleSend() {
    const text = input.trim()
    if (!text || isRunning) return

    if (text === '/clear') {
      onClear?.()
      setInput('')
      return
    }

    setInput('')
    setShowCommands(false)
    setSelectedIndex(0)
    onSend(text)
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!showCommands) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelectedIndex((prev) =>
        prev >= activeCommands.length - 1 ? 0 : prev + 1
      )
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelectedIndex((prev) =>
        prev <= 0 ? activeCommands.length - 1 : prev - 1
      )
      return
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      if (selectedCmd) {
        commitCommand(selectedCmd)
      }
      return
    }
    if (e.key === 'Escape') {
      e.preventDefault()
      setShowCommands(false)
      setSelectedIndex(0)
    }
  }

  function handleChange(value: string) {
    setInput(value)
    setShowCommands(value.trim().startsWith('/'))
    setSelectedIndex(0)
  }

  function sourceLabel(source: string): string {
    if (source === 'builtin') return ''
    if (source === 'agent') return 'agent'
    if (source.startsWith('skill:')) return source.slice(6)
    return source
  }

  function setItemRef(index: number) {
    return (el: HTMLDivElement | null) => {
      if (el) itemRefs.current.set(index, el)
      else itemRefs.current.delete(index)
    }
  }

  return (
    <div className="chat-input-bar">
      {error && <div className="input-error">{error}</div>}
      {showCommands && (
        <div className="slash-suggestions">
          {activeCommands.map((c, i) => (
            <div
              key={c.name}
              ref={setItemRef(i)}
              className={`slash-item${i === selectedIndex ? ' selected' : ''}`}
              onClick={() => commitCommand(c)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <span className="slash-cmd">/{c.name}</span>
              <span className="slash-desc">{c.description}</span>
              {sourceLabel(c.source) && (
                <span className="slash-source">{sourceLabel(c.source)}</span>
              )}
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
