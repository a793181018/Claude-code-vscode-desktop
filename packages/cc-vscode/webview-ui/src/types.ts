/** Shared types for the webview UI */

export type ChatState = 'idle' | 'thinking' | 'compacting' | 'tool_executing' | 'streaming' | 'permission_pending'

export type TokenUsage = {
  input_tokens: number
  output_tokens: number
  cache_read_tokens?: number
  cache_creation_tokens?: number
}

// ─── Client → Bridge messages ─────────────────────────────────

export type ClientMessage =
  | { type: 'prewarm_session' }
  | { type: 'user_message'; content: string; attachments?: AttachmentRef[] }
  | {
      type: 'permission_response'
      requestId: string
      allowed: boolean
      rule?: string
      updatedInput?: Record<string, unknown>
    }
  | { type: 'set_permission_mode'; mode: string }
  | { type: 'set_runtime_config'; providerId: string | null; modelId: string; effortLevel?: string }
  | { type: 'stop_generation' }
  | { type: 'ping' }

export type AttachmentRef = {
  type: 'file' | 'image'
  name?: string
  path?: string
  data?: string
  mimeType?: string
}

// ─── Bridge → Client messages ─────────────────────────────────

export type ServerMessage =
  | { type: 'connected'; sessionId: string }
  | { type: 'content_start'; blockType: 'text' | 'tool_use'; toolName?: string; toolUseId?: string; parentToolUseId?: string; checkpointUuid?: string }
  | { type: 'content_delta'; text?: string; toolInput?: string }
  | { type: 'tool_use_complete'; toolName: string; toolUseId: string; input: unknown; parentToolUseId?: string }
  | { type: 'tool_result'; toolUseId: string; content: unknown; isError: boolean; parentToolUseId?: string }
  | { type: 'permission_request'; requestId: string; toolName: string; toolUseId?: string; input: unknown; description?: string }
  | { type: 'message_complete'; usage: TokenUsage; checkpointUuid?: string }
  | { type: 'thinking'; text: string }
  | { type: 'status'; state: ChatState; verb?: string; elapsed?: number; tokens?: number }
  | { type: 'permission_mode_changed'; mode: string }
  | { type: 'api_retry'; attempt: number; maxRetries: number; retryDelayMs: number; errorStatus: number | null; errorType?: string; errorMessage?: string }
  | { type: 'error'; message: string; code: string; retryable?: boolean; businessErrorCode?: string }
  | { type: 'system_notification'; subtype: string; message?: string; data?: unknown }
  | { type: 'pong' }
  | { type: 'session_title_updated'; sessionId: string; title: string }

// ─── UI Message model ─────────────────────────────────────────

export type UIMessage =
  | { id: string; type: 'user_text'; content: string; timestamp: number; checkpointUuid?: string; hasFileOps?: boolean }
  | { id: string; type: 'assistant_text'; content: string; timestamp: number }
  | { id: string; type: 'thinking'; content: string; timestamp: number }
  | { id: string; type: 'tool_use'; toolName: string; toolUseId: string; input: unknown; timestamp: number; isPending?: boolean; partialInput?: string }
  | { id: string; type: 'tool_result'; toolUseId: string; content: unknown; isError: boolean; timestamp: number }
  | { id: string; type: 'permission_request'; requestId: string; toolName: string; toolUseId?: string; input: unknown; description?: string; timestamp: number }
  | { id: string; type: 'error'; message: string; code: string; timestamp: number }
  | { id: string; type: 'system'; content: string; timestamp: number }
