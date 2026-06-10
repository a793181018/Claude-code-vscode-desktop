/**
 * VS Code Webview API adapter
 *
 * Wraps the VS Code postMessage API to provide a WebSocket-like interface
 * that the chat store can use without knowing about VS Code internals.
 */

import type { ClientMessage, ServerMessage } from './types'

declare function acquireVsCodeApi(): {
  postMessage(message: unknown): void
  getState(): unknown
  setState(state: unknown): void
}

export const vscodeApi = acquireVsCodeApi()

type MessageHandler = (msg: ServerMessage) => void
type StatusHandler = (status: { bridgeUrl: string; newSession: boolean }) => void

let messageHandlers = new Set<MessageHandler>()
let statusHandler: StatusHandler | null = null
let bridgeUrl = 'http://127.0.0.1:0'
let connected = false
let lastInitMsg: { bridgeUrl: string; newSession: boolean } | null = null

// Listen for messages from extension host
window.addEventListener('message', (event) => {
  const msg = event.data

  if (msg.type === 'init') {
    bridgeUrl = msg.bridgeUrl
    connected = true
    lastInitMsg = msg
    statusHandler?.(msg)
    return
  }

  if (msg.type === '_ws_closed') {
    connected = false
    return
  }

  if (msg.type === '_rest_response' || msg.type?.startsWith('_')) {
    return // internal messages
  }

  // Forward server messages to all handlers
  for (const handler of messageHandlers) {
    try {
      handler(msg as ServerMessage)
    } catch { /* ignore */ }
  }
})

export function sendToBridge(msg: ClientMessage & { sessionId?: string }) {
  vscodeApi.postMessage(msg)
}

export function connectSession(sessionId: string) {
  vscodeApi.postMessage({
    type: '_connect_session',
    sessionId,
  })
}

export function disconnectSession(sessionId: string) {
  vscodeApi.postMessage({
    type: '_disconnect_session',
    sessionId,
  })
}

export async function restRequest(path: string, method = 'GET', body?: unknown): Promise<unknown> {
  const requestId = Math.random().toString(36).slice(2, 10)
  return new Promise((resolve, reject) => {
    const handler = (event: MessageEvent) => {
      if (event.data.type === '_rest_response' && event.data.requestId === requestId) {
        window.removeEventListener('message', handler)
        if (event.data.status >= 200 && event.data.status < 300) {
          resolve(event.data.data)
        } else {
          reject(new Error(event.data.data?.error || `HTTP ${event.data.status}`))
        }
      }
    }
    window.addEventListener('message', handler)

    vscodeApi.postMessage({
      type: '_rest_request',
      path,
      method,
      body,
      requestId,
    })

    // Timeout after 10 seconds
    setTimeout(() => {
      window.removeEventListener('message', handler)
      reject(new Error('Request timeout'))
    }, 10_000)
  })
}

export function onServerMessage(handler: MessageHandler): () => void {
  messageHandlers.add(handler)
  return () => { messageHandlers.delete(handler) }
}

export function onInit(handler: StatusHandler): () => void {
  statusHandler = handler
  // If init message already arrived, replay it immediately
  if (lastInitMsg) {
    handler(lastInitMsg)
  }
  return () => { statusHandler = null }
}

export function getBridgeUrl(): string {
  return bridgeUrl
}

export function isConnected(): boolean {
  return connected
}
