/**
 * Chat Store — Zustand-based state management
 *
 * Simplified version of cc-haha's chatStore.ts.
 * Handles the full message processing pipeline:
 * streaming text/toolInput accumulation, permission state,
 * tool call tracking, and UI message construction.
 */

import { create } from 'zustand'
import {
  sendToBridge,
  connectSession,
  disconnectSession,
  onServerMessage,
  restRequest,
  onInit,
  getBridgeUrl,
  vscodeApi,
} from './vscodeApi'
import type { ServerMessage, UIMessage, ChatState, TokenUsage } from './types'

interface PendingPermission {
  requestId: string
  toolName: string
  toolUseId?: string
  input: unknown
  description?: string
}

interface ChatStore {
  // Connection
  connectionState: 'disconnected' | 'connecting' | 'connected'
  sessionId: string | null
  bridgeUrl: string

  // Messages
  messages: UIMessage[]
  chatState: ChatState
  streamingText: string
  streamingToolInput: string
  activeToolUseId: string | null
  activeToolName: string | null
  activeThinkingId: string | null
  currentCheckpointUuid: string | null
  currentTurnHasFileOps: boolean
  currentTurnIndex: number
  turnCheckpoints: Map<number, { uuid: string; hasFileOps: boolean }>

  // Permission
  pendingPermission: PendingPermission | null

  // Status
  tokenUsage: TokenUsage
  statusVerb: string
  error: string | null

  // Config
  activeModel: string
  activePermissionMode: string
  locale: 'en' | 'zh'

  // Session list
  sessions: Array<{ sessionId: string; title: string; workDir: string; createdAt: number }>

  // Actions
  init: () => void
  connectToSession: (sessionId: string) => void
  createSession: () => Promise<void>
  deleteSession: (sessionId: string) => Promise<void>
  sendMessage: (content: string) => void
  stopGeneration: () => void
  respondToPermission: (requestId: string, allowed: boolean) => void
  setRuntimeConfig: (modelId: string) => void
  setPermissionMode: (mode: string) => void
  loadSessions: () => Promise<void>
  loadSettings: () => Promise<void>
  clearSession: () => void
  forkSession: (messageIndex: number) => Promise<void>
  rewindSession: (messageIndex: number) => Promise<void>
  toggleLocale: () => void
  disconnect: () => void
}

let nextId = 0
function uid(): string {
  return `msg-${Date.now()}-${++nextId}`
}

// Stream flush timer
let flushTimer: ReturnType<typeof setTimeout> | null = null
let pendingText = ''

export const useChatStore = create<ChatStore>((set, get) => ({
  connectionState: 'disconnected',
  sessionId: null,
  bridgeUrl: '',

  messages: [],
  chatState: 'idle',
  streamingText: '',
  streamingToolInput: '',
  activeToolUseId: null,
  activeToolName: null,
  activeThinkingId: null,
  pendingPermission: null,
  tokenUsage: { input_tokens: 0, output_tokens: 0 },
  statusVerb: '',
  error: null,
  activeModel: 'claude-sonnet-4-20250514',
  activePermissionMode: 'bypassPermissions',
  locale: 'en',
  currentCheckpointUuid: null,
  currentTurnHasFileOps: false,
  currentTurnIndex: 0,
  turnCheckpoints: new Map(),
  sessions: [],

  init: () => {
    onInit(({ bridgeUrl }) => {
      set({ bridgeUrl, connectionState: 'connected' })
      get().loadSessions()
      get().loadSettings()
    })

    onServerMessage((msg: ServerMessage) => {
      handleServerMessage(msg, set, get)
    })
  },

  connectToSession: (sessionId: string) => {
    set({
      sessionId,
      messages: [],
      chatState: 'idle',
      connectionState: 'connecting',
      streamingText: '',
      error: null,
    })
    // Persist session ID for reconnection on reload
    vscodeApi.setState?.({ ...vscodeApi.getState?.(), lastSessionId: sessionId })
    connectSession(sessionId)
    // Load history
    restRequest(`/api/sessions/${sessionId}/messages`)
      .then((data: any) => {
        if (data.messages && Array.isArray(data.messages)) {
          const uiMessages = data.messages.map((m: any) => ({
            ...m,
            type: mapHistoryType(m.type),
          }))
          set({ messages: uiMessages })
        }
      })
      .catch(() => { /* history optional */ })
  },

  createSession: async (title?: string) => {
    try {
      const data: any = await restRequest('/api/sessions', 'POST', {
        workDir: '.',
        ...(title ? { title } : {}),
      })
      if (data.sessionId) {
        get().connectToSession(data.sessionId)
      }
    } catch (err) {
      set({ error: `Failed to create session: ${err}` })
    }
  },

  deleteSession: async (sessionId: string) => {
    try {
      await restRequest(`/api/sessions/${sessionId}`, 'DELETE')
      get().loadSessions()
      if (get().sessionId === sessionId) {
        set({ sessionId: null, messages: [] })
      }
    } catch (err) {
      set({ error: `Failed to delete session: ${err}` })
    }
  },

  sendMessage: (content: string) => {
    const state = get()
    if (!state.sessionId) return

    const turnIdx = state.currentTurnIndex
    set({ currentTurnIndex: turnIdx + 1, currentCheckpointUuid: null, currentTurnHasFileOps: false })

    const userMsg: UIMessage = {
      id: uid(),
      type: 'user_text',
      content,
      timestamp: Date.now(),
      checkpointUuid: undefined,
      hasFileOps: false,
    }

    set((s) => ({
      messages: [...s.messages, userMsg],
      chatState: 'thinking',
      streamingText: '',
      error: null,
    }))

    sendToBridge({
      type: 'user_message',
      content,
      sessionId: state.sessionId,
    })
  },

  stopGeneration: () => {
    const state = get()
    if (state.sessionId) {
      sendToBridge({
        type: 'stop_generation',
        sessionId: state.sessionId,
      })
    }
  },

  respondToPermission: (requestId: string, allowed: boolean) => {
    const state = get()
    if (state.sessionId) {
      sendToBridge({
        type: 'permission_response',
        requestId,
        allowed,
        sessionId: state.sessionId,
      })
      set({ pendingPermission: null, chatState: 'thinking' })
    }
  },

  loadSessions: async () => {
    try {
      const data: any = await restRequest('/api/sessions')
      if (data.sessions) {
        set({ sessions: data.sessions })
      }
    } catch {
      // Sessions optional
    }
  },

  loadSettings: async () => {
    try {
      const data: any = await restRequest('/api/settings/user')
      set({
        activeModel: data.model || get().activeModel,
        activePermissionMode: data.permissionMode || get().activePermissionMode,
      })
    } catch {
      // Use defaults
    }
  },

  setRuntimeConfig: (modelId: string) => {
    set({ activeModel: modelId })
    // Persist to server
    restRequest('/api/settings/user', 'PUT', { model: modelId }).catch(() => {})
    // Notify CLI
    const state = get()
    if (state.sessionId) {
      sendToBridge({
        type: 'set_runtime_config',
        providerId: null,
        modelId,
        sessionId: state.sessionId,
      })
    }
  },

  setPermissionMode: (mode: string) => {
    set({ activePermissionMode: mode })
    // Persist to server
    restRequest('/api/settings/user', 'PUT', { permissionMode: mode }).catch(() => {})
    // Notify CLI
    const state = get()
    if (state.sessionId) {
      sendToBridge({
        type: 'set_permission_mode',
        mode,
        sessionId: state.sessionId,
      })
    }
  },

  toggleLocale: () => {
    set((s) => ({ locale: s.locale === 'en' ? 'zh' : 'en' }))
  },

  clearSession: () => {
    const state = get()
    if (state.sessionId) {
      // Send /clear as a user message to the CLI
      sendToBridge({
        type: 'user_message',
        content: '/clear',
        sessionId: state.sessionId,
      })
    }
    set({
      messages: [],
      streamingText: '',
      tokenUsage: { input_tokens: 0, output_tokens: 0 },
      error: null,
    })
  },

  forkSession: async (messageIndex: number, title?: string) => {
    const state = get()
    if (!state.sessionId) return
    try {
      const data: any = await restRequest(
        `/api/sessions/${state.sessionId}/branch`,
        'POST',
        { targetMessageIndex: messageIndex, ...(title ? { title } : {}) }
      )
      if (data.sessionId) {
        get().connectToSession(data.sessionId)
      }
    } catch (err: any) {
      set({ error: `Fork failed: ${err.message || err}` })
    }
  },

  rewindSession: async (messageIndex: number) => {
    const state = get()
    if (!state.sessionId) return
    try {
      const msg = state.messages[messageIndex]
      const checkpointUuid = msg?.type === 'user_text' ? (msg as any).checkpointUuid : null
      const hasFileOps = msg?.type === 'user_text' ? !!(msg as any).hasFileOps : false
      const msgContent = msg?.type === 'user_text' ? (msg.content as string) : ''

      // 1. Rewind files only if this turn had Write/Edit operations
      if (hasFileOps && checkpointUuid) {
        try {
          await restRequest(`/api/sessions/${state.sessionId}/rewind-files`, 'POST', { checkpointUuid })
        } catch (e: any) { console.warn('Rewind files failed:', e.message) }
      }

      // 2. Rewind messages (always)
      await restRequest(
        `/api/sessions/${state.sessionId}/rewind`,
        'POST',
        { messageContent: msgContent, fallbackIndex: messageIndex }
      )

      // 3. Reconnect and reload
      disconnectSession(state.sessionId)
      set({ messages: [], streamingText: '', tokenUsage: { input_tokens: 0, output_tokens: 0 },
        connectionState: 'connecting', turnCheckpoints: new Map() })
      connectSession(state.sessionId)
      const data: any = await restRequest(`/api/sessions/${state.sessionId}/messages`)
      if (data.messages && Array.isArray(data.messages)) {
        set({ messages: data.messages.map((m: any) => ({ ...m, type: mapHistoryType(m.type) })) })
      }
    } catch (err: any) {
      set({ error: `Rewind failed: ${err.message || err}` })
    }
  },

  disconnect: () => {
    const state = get()
    if (state.sessionId) {
      disconnectSession(state.sessionId)
    }
    set({
      sessionId: null,
      connectionState: 'disconnected',
      messages: [],
      chatState: 'idle',
    })
  },
}))

// ============================================================================
// Server message handler
// ============================================================================

function handleServerMessage(
  msg: ServerMessage,
  set: (update: Partial<ChatStore> | ((state: ChatStore) => Partial<ChatStore>)) => void,
  get: () => ChatStore,
) {
  switch (msg.type) {
    case 'connected': {
      set({
        connectionState: 'connected',
        sessionId: msg.sessionId,
      })
      break
    }

    case 'content_start': {
      flushPendingText(set)
      // Capture checkpoint UUID (only first content_start in a turn should set it)
      if (msg.checkpointUuid && !get().currentCheckpointUuid) {
        set({ currentCheckpointUuid: msg.checkpointUuid, currentTurnHasFileOps: false })
      }
      if (msg.blockType === 'tool_use') {
        // Track file operations
        if (msg.toolName === 'Write' || msg.toolName === 'Edit') {
          set({ currentTurnHasFileOps: true })
        }
        const toolMsg: UIMessage = {
          id: uid(),
          type: 'tool_use',
          toolName: msg.toolName || 'Unknown',
          toolUseId: msg.toolUseId || '',
          input: {},
          timestamp: Date.now(),
          isPending: true,
        }
        set((s) => ({
          messages: [...s.messages, toolMsg],
          activeToolUseId: msg.toolUseId || null,
          activeToolName: msg.toolName || null,
          chatState: 'tool_executing',
          streamingToolInput: '',
        }))
      } else {
        set({ chatState: 'streaming' })
      }
      break
    }

    case 'content_delta': {
      if (msg.text) {
        pendingText += msg.text
        scheduleFlush(set)
      } else if (msg.toolInput) {
        set((s) => {
          const newToolInput = s.streamingToolInput + msg.toolInput
          const msgs = [...s.messages]
          const lastIdx = msgs.length - 1
          if (lastIdx >= 0 && msgs[lastIdx].type === 'tool_use') {
            msgs[lastIdx] = {
              ...msgs[lastIdx],
              partialInput: newToolInput,
            }
          }
          return { messages: msgs, streamingToolInput: newToolInput }
        })
      }
      break
    }

    case 'tool_use_complete': {
      set((s) => {
        const msgs = [...s.messages]
        // Find matching tool_use by toolUseId (not just last message)
        const idx = msgs.findIndex(
          (m) => m.type === 'tool_use' && m.toolUseId === msg.toolUseId
        )
        if (idx >= 0) {
          msgs[idx] = {
            ...msgs[idx],
            isPending: false,
            input: msg.input,
          } as UIMessage
        } else {
          msgs.push({
            id: uid(),
            type: 'tool_use',
            toolName: msg.toolName,
            toolUseId: msg.toolUseId,
            input: msg.input,
            timestamp: Date.now(),
          })
        }
        return {
          messages: msgs,
          activeToolUseId: null,
          activeToolName: null,
          streamingToolInput: '',
        }
      })
      break
    }

    case 'tool_result': {
      const resultMsg: UIMessage = {
        id: uid(),
        type: 'tool_result',
        toolUseId: msg.toolUseId,
        content: msg.content,
        isError: msg.isError,
        timestamp: Date.now(),
      }
      set((s) => ({
        messages: [...s.messages, resultMsg],
        chatState: 'thinking',
      }))
      break
    }

    case 'thinking': {
      set((s) => {
        const msgs = [...s.messages]
        const lastIdx = msgs.length - 1
        if (lastIdx >= 0 && msgs[lastIdx].type === 'thinking' && s.activeThinkingId) {
          msgs[lastIdx] = {
            ...msgs[lastIdx],
            content: (msgs[lastIdx] as any).content + msg.text,
          } as UIMessage
        } else {
          const thinkId = uid()
          msgs.push({
            id: thinkId,
            type: 'thinking',
            content: msg.text,
            timestamp: Date.now(),
          })
          return { messages: msgs, activeThinkingId: thinkId, chatState: 'thinking' }
        }
        return { messages: msgs }
      })
      break
    }

    case 'permission_request': {
      flushPendingText(set)
      set({
        pendingPermission: {
          requestId: msg.requestId,
          toolName: msg.toolName,
          toolUseId: msg.toolUseId,
          input: msg.input,
          description: msg.description,
        },
        chatState: 'permission_pending',
      })
      break
    }

    case 'message_complete': {
      flushPendingText(set)
      const state = get()
      // Store turn checkpoint info
      if (state.currentCheckpointUuid) {
        state.turnCheckpoints.set(state.currentTurnIndex - 1, {
          uuid: state.currentCheckpointUuid,
          hasFileOps: state.currentTurnHasFileOps,
        })
      }
      // Attach checkpoint info to current turn's user_text messages
      set((s) => {
        const msgs = [...s.messages]
        const cpUuid = s.currentCheckpointUuid
        const hasFOps = s.currentTurnHasFileOps
        if (cpUuid) {
          for (let i = msgs.length - 1; i >= 0; i--) {
            if (msgs[i].type === 'user_text' && !msgs[i].checkpointUuid) {
              msgs[i] = { ...msgs[i], checkpointUuid: cpUuid, hasFileOps: hasFOps }
              break
            }
          }
        }
        return {
          messages: msgs,
          chatState: 'idle',
          tokenUsage: msg.usage,
          activeThinkingId: null,
          statusVerb: '',
        }
      })
      break
    }

    case 'status': {
      set({
        chatState: msg.state,
        statusVerb: msg.verb || '',
      })
      break
    }

    case 'error': {
      flushPendingText(set)
      set((s) => ({
        messages: [
          ...s.messages,
          {
            id: uid(),
            type: 'error',
            message: msg.message,
            code: msg.code,
            timestamp: Date.now(),
          },
        ],
        chatState: 'idle',
        error: msg.message,
      }))
      break
    }

    case 'system_notification': {
      if (msg.message) {
        set((s) => ({
          messages: [
            ...s.messages,
            {
              id: uid(),
              type: 'system',
              content: `${msg.subtype}: ${msg.message}`,
              timestamp: Date.now(),
            },
          ],
        }))
      }
      break
    }

    case 'pong':
      break

    case 'api_retry':
      set({
        statusVerb: `Retrying... (${msg.attempt}/${msg.maxRetries})`,
      })
      break

    case 'permission_mode_changed':
    case 'session_title_updated':
      get().loadSessions()
      break

    default:
      break
  }
}

// ============================================================================
// Streaming text buffer
// ============================================================================

function flushPendingText(set: (update: Partial<ChatStore> | ((state: ChatStore) => Partial<ChatStore>)) => void) {
  if (flushTimer) {
    clearTimeout(flushTimer)
    flushTimer = null
  }
  if (!pendingText) return

  const text = pendingText
  pendingText = ''

  set((s) => ({
    messages: [
      ...s.messages,
      {
        id: uid(),
        type: 'assistant_text',
        content: text,
        timestamp: Date.now(),
      },
    ],
    streamingText: '',
  }))
}

function scheduleFlush(set: (update: Partial<ChatStore> | ((state: ChatStore) => Partial<ChatStore>)) => void) {
  if (flushTimer) clearTimeout(flushTimer)
  flushTimer = setTimeout(() => {
    flushTimedUpdate(set)
  }, 50)
}

function flushTimedUpdate(set: (update: Partial<ChatStore> | ((state: ChatStore) => Partial<ChatStore>)) => void) {
  if (!pendingText) return
  const text = pendingText
  pendingText = ''

  set((s) => {
    const textMsg: UIMessage = {
      id: uid(),
      type: 'assistant_text',
      content: text,
      timestamp: Date.now(),
    }
    return {
      messages: [...s.messages, textMsg],
      streamingText: '',
    }
  })
  flushTimer = null
}

function mapHistoryType(type: string): string {
  switch (type) {
    case 'user_text': return 'user_text'
    case 'assistant_text': return 'assistant_text'
    case 'thinking': return 'thinking'
    case 'tool_use': return 'tool_use'
    case 'tool_result': return 'tool_result'
    case 'error': return 'error'
    default: return 'system'
  }
}
