import { useEffect, useRef, useState } from 'react'
import { useChatStore } from '../useChatStore'
import { vscodeApi } from '../vscodeApi'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { PermissionDialog } from './PermissionDialog'
import { Sidebar } from './Sidebar'
import { SettingsBar } from './SettingsBar'
import { McpSettings } from './McpSettings'
import { SkillsSettings } from './SkillsSettings'
import { AgentsSettings } from './AgentsSettings'
import type { ChatState } from '../types'

export function App() {
  const {
    init,
    connectToSession,
    createSession,
    deleteSession,
    sendMessage,
    stopGeneration,
    respondToPermission,
    connectionState,
    sessionId,
    messages,
    chatState,
    streamingText,
    pendingPermission,
    error,
    sessions,
    statusVerb,
    bridgeUrl,
  } = useChatStore()

  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState<'mcp' | 'agents' | 'skills'>('mcp')
  const initialized = useRef(false)

  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true
      init()
      // onInit now replays immediately if the init message already arrived
      // Check after a microtask if bridge URL is set and reconnect
      setTimeout(() => {
        const s = useChatStore.getState()
        if (s.connectionState === 'connected') {
          const saved = vscodeApi.getState() as { lastSessionId?: string } | undefined
          if (saved?.lastSessionId) {
            s.connectToSession(saved.lastSessionId!)
          }
        }
      }, 50)
    }
  }, [init])

  return (
    <div className="app-container">
      <Sidebar
        sessions={sessions}
        activeSessionId={sessionId}
        onSelect={connectToSession}
        onNew={createSession}
        onDelete={deleteSession}
      />
      <div className="main-area">
        <div className="status-bar">
          <span className="status-left">
            {connectionState === 'disconnected' && 'Disconnected'}
            {connectionState === 'connecting' && 'Connecting...'}
            {connectionState === 'connected' && (
              <>
                {sessionId ? `Session: ${sessionId.substring(0, 8)}` : 'No session'}
                {statusVerb && ` — ${statusVerb}`}
              </>
            )}
          </span>
          <span className="status-right">
            <button className="settings-gear-btn" onClick={() => setShowSettings(true)} title="Settings">⚙</button>
            {bridgeUrl ? `Bridge: ${bridgeUrl}` : 'No bridge'}
          </span>
        </div>
        <SettingsBar />

        {!sessionId ? (
          <div className="empty-state">
            <h2>Claude Code</h2>
            <p>Select a session or create a new one to start.</p>
            <button className="btn-primary" onClick={createSession}>
              New Session
            </button>
          </div>
        ) : (
          <>
            <MessageList
              messages={messages}
              streamingText={streamingText}
              chatState={chatState}
              onFork={(idx) => useChatStore.getState().forkSession(idx)}
              onRewind={(idx) => useChatStore.getState().rewindSession(idx)}
            />
            <ChatInput
              chatState={chatState}
              error={error}
              onSend={sendMessage}
              onStop={stopGeneration}
              onClear={() => useChatStore.getState().clearSession()}
              sessionId={sessionId}
            />
          </>
        )}

        {pendingPermission && (
          <PermissionDialog
            permission={pendingPermission}
            onRespond={respondToPermission}
          />
        )}

        {showSettings && (
          <div className="mcp-overlay" onClick={() => setShowSettings(false)}>
            <div className="mcp-overlay-content" onClick={(e) => e.stopPropagation()}>
              <div className="mcp-overlay-header">
                <div className="mcp-overlay-tabs">
                  <button className={`mcp-tab ${settingsTab === 'mcp' ? 'active' : ''}`} onClick={() => setSettingsTab('mcp')}>MCP</button>
                  <button className={`mcp-tab ${settingsTab === 'agents' ? 'active' : ''}`} onClick={() => setSettingsTab('agents')}>Agents</button>
                  <button className={`mcp-tab ${settingsTab === 'skills' ? 'active' : ''}`} onClick={() => setSettingsTab('skills')}>Skills</button>
                </div>
                <button className="btn-small" onClick={() => setShowSettings(false)}>Close</button>
              </div>
              {settingsTab === 'mcp' ? <McpSettings /> : settingsTab === 'agents' ? <AgentsSettings /> : <SkillsSettings />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
