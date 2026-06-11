import type { UIMessage } from '../types'
import { sendToBridge } from '../vscodeApi'

interface Props {
  messages: UIMessage[]
  streamingText: string
  onFork?: (msgIndex: number) => void
  onRewind?: (msgIndex: number) => void
  chatState?: string
}

export function MessageList({ messages, streamingText, onFork, onRewind, chatState }: Props) {
  const isIdle = !chatState || chatState === 'idle'

  return (
    <div className="message-list">
      {messages.map((msg, idx) => (
        <div key={msg.id} className="message-row">
          <MessageItem msg={msg} messages={messages} />
          {isIdle && onFork && isBranchable(msg) && (
            <button
              className="msg-action-btn fork-btn"
              title="Fork a new conversation from here"
              onClick={() => onFork(idx)}
            >
              ⇲
            </button>
          )}
          {isIdle && onRewind && msg.type === 'user_text' && (msg as any).checkpointUuid && (
            <button
              className="msg-action-btn rewind-btn"
              title={(msg as any).hasFileOps ? 'Undo file changes + rewind conversation' : 'Rewind conversation from here'}
              onClick={() => onRewind(idx)}
            >
              ↩
            </button>
          )}
          {isIdle && onFork && isBranchable(msg) && (
            <button
              className="msg-action-btn fork-btn"
              title="Fork a new conversation from here"
              onClick={() => onFork(idx)}
            >
              ⇲
            </button>
          )}
        </div>
      ))}
      {streamingText && (
        <div className="message assistant streaming">
          {streamingText}
          <span className="cursor">|</span>
        </div>
      )}
    </div>
  )
}

/** A message is branchable if it's a user or assistant message with content */
function isBranchable(msg: UIMessage): boolean {
  return msg.type === 'user_text' || msg.type === 'assistant_text'
}

function MessageItem({ msg, messages }: { msg: UIMessage; messages: UIMessage[] }) {
  switch (msg.type) {
    case 'user_text':
      return <div className="message user"><strong>You:</strong> {msg.content}</div>

    case 'assistant_text':
      return <div className="message assistant">{msg.content}</div>

    case 'thinking':
      return (
        <details className="message thinking" open>
          <summary>Thinking...</summary>
          <div>{msg.content}</div>
        </details>
      )

    case 'tool_use': {
      const fp = extractFilePath(msg.input)
      return (
        <div className="message tool">
          <span className="tool-icon">{msg.isPending ? '⏳' : '🔧'}</span>
          <strong>{msg.toolName}</strong>
          {fp && <button className="diff-open-btn" onClick={() => openFileInEditor(fp)}>Open</button>}
          {msg.partialInput && <pre className="tool-preview">{formatInput(msg.partialInput)}</pre>}
          {!msg.isPending && msg.input && (
            <pre className="tool-input">{formatInput(JSON.stringify(msg.input, null, 2))}</pre>
          )}
        </div>
      )
    }

    case 'tool_result': {
      const toolUse = messages.find(
        (m) => m.type === 'tool_use' && m.toolUseId === msg.toolUseId
      )
      const fp = toolUse ? extractFilePath(toolUse.input) : null
      return (
        <div className={`message tool-result ${msg.isError ? 'error' : ''}`}>
          {msg.isError ? 'Error:' : 'Result:'}
          {fp && <button className="diff-open-btn" onClick={() => openFileInEditor(fp)}>Open</button>}
          <pre>{formatContent(msg.content)}</pre>
        </div>
      )
    }

    case 'permission_request':
      return (
        <div className="message permission">
          Requesting permission to run <strong>{msg.toolName}</strong>
          {msg.description && <div className="desc">{msg.description}</div>}
        </div>
      )

    case 'error':
      return <div className="message error">{msg.message}</div>

    case 'system':
      return <div className="message system">{msg.content}</div>

    default:
      return null
  }
}

export function extractFilePath(input: unknown): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  if (typeof obj.file_path === 'string' && obj.file_path) return obj.file_path
  if (typeof obj.path === 'string' && obj.path) return obj.path
  if (typeof obj.filePath === 'string' && obj.filePath) return obj.filePath
  return null
}

function openFileInEditor(filePath: string) {
  sendToBridge({ type: '_open_file', filePath, sessionId: '' } as any)
}

function formatInput(text: string): string {
  return text.length > 500 ? text.substring(0, 500) + '...' : text
}

function formatContent(content: unknown): string {
  if (typeof content === 'string') {
    return content.length > 1000 ? content.substring(0, 1000) + '...' : content
  }
  return JSON.stringify(content, null, 2).substring(0, 500)
}
