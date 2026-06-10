import { useEffect, useRef } from 'react'
import { useChatStore } from '../useChatStore'
import { vscodeApi } from '../vscodeApi'
import { MessageList } from './MessageList'
import { ChatInput } from './ChatInput'
import { PermissionDialog } from './PermissionDialog'
import { Sidebar } from './Sidebar'
import { SettingsBar } from './SettingsBar'
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
            />
          </>
        )}

        {pendingPermission && (
          <PermissionDialog
            permission={pendingPermission}
            onRespond={respondToPermission}
          />
        )}
      </div>
    </div>
  )
}
