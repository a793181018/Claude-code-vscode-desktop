/**
 * Webview UI - Main Entry Point
 *
 * Adapted from cc-haha's desktop/src/main.tsx.
 * This is a minimal React app for the VS Code Webview that communicates
 * with the bridge server via VS Code's postMessage API.
 */

// The actual React frontend from cc-haha will replace this once we port it.
// For now, this is a minimal demo that validates the communication pipeline.

const vscodeApi = acquireVsCodeApi()

let bridgeUrl = 'http://127.0.0.1:0'
let currentSessionId: string | null = null

// Listen for messages from the extension host
window.addEventListener('message', (event) => {
  const message = event.data

  switch (message.type) {
    case 'init':
      // Received initial configuration from extension
      bridgeUrl = message.bridgeUrl
      document.getElementById('status')!.textContent = `Connected to ${bridgeUrl}`
      if (message.newSession) {
        createAndConnectSession()
      }
      break

    case 'connected':
      currentSessionId = message.sessionId
      document.getElementById('status')!.textContent = 'Connected'
      document.getElementById('send-btn')!.removeAttribute('disabled')
      break

    case 'content_start':
      appendMessage(`[start ${message.blockType}]`, 'system')
      if (message.blockType === 'tool_use') {
        appendMessage(`Tool: ${message.toolName}`, 'tool')
      }
      break

    case 'content_delta':
      if (message.text) {
        appendText(message.text)
      } else if (message.toolInput) {
        appendMessage(`  ${message.toolInput}`, 'tool')
      }
      break

    case 'tool_use_complete':
      appendMessage(`Tool complete: ${message.toolName}`, 'tool')
      break

    case 'tool_result':
      appendMessage(
        `Result${message.isError ? ' (error)' : ''}: ${JSON.stringify(message.content).substring(0, 200)}`,
        'tool',
      )
      break

    case 'thinking':
      appendMessage(`Thinking: ${message.text.substring(0, 100)}...`, 'thinking')
      break

    case 'message_complete':
      appendMessage(`[Done — tokens: ${message.usage?.input_tokens}/${message.usage?.output_tokens}]`, 'system')
      break

    case 'permission_request':
      handlePermission(message)
      break

    case 'error':
      appendMessage(`Error [${message.code}]: ${message.message}`, 'error')
      break

    case 'pong':
      // Keepalive response
      break

    case 'system_notification':
      appendMessage(`[sys:${message.subtype}] ${message.message || ''}`, 'system')
      break

    case 'status':
      appendMessage(`[status: ${message.state}] ${message.verb || ''}`, 'system')
      break

    default:
      // Log unknown messages for debugging
      if (message.type?.startsWith('_')) break // internal messages
      console.log('Unknown message:', message)
  }
})

// Send a message to the extension host
function sendToExtension(message: Record<string, unknown>) {
  // If it's a client message, attach session ID
  if (currentSessionId && !('sessionId' in message)) {
    message = { ...message, sessionId: currentSessionId }
  }
  vscodeApi.postMessage(message)
}

// Connect to a session via the extension host
function connectToSession(sessionId: string) {
  sendToExtension({
    type: '_connect_session',
    sessionId,
  })
}

// Create a new session and connect
async function createAndConnectSession() {
  const requestId = Math.random().toString(36).slice(2)
  sendToExtension({
    type: '_rest_request',
    path: '/api/sessions',
    method: 'POST',
    body: {},
    requestId,
  })
}

function sendMessage() {
  const input = document.getElementById('input') as HTMLInputElement
  const text = input.value.trim()
  if (!text) return

  input.value = ''
  appendMessage(`You: ${text}`, 'user')

  sendToExtension({
    type: 'user_message',
    content: text,
  })
}

function handlePermission(msg: { requestId: string; toolName: string; description?: string }) {
  appendMessage(`Permission needed: ${msg.toolName} — ${msg.description || 'No description'}`, 'system')
  // Auto-allow in the demo
  sendToExtension({
    type: 'permission_response',
    requestId: msg.requestId,
    allowed: true,
  })
}

// UI helper
let currentTextEl: HTMLElement | null = null

function appendText(text: string) {
  if (!currentTextEl) {
    currentTextEl = document.createElement('div')
    currentTextEl.className = 'message assistant'
    document.getElementById('messages')!.appendChild(currentTextEl)
  }
  currentTextEl.textContent += text
}

function appendMessage(text: string, className: string) {
  currentTextEl = null // end current text stream
  const el = document.createElement('div')
  el.className = `message ${className}`
  el.textContent = text
  document.getElementById('messages')!.appendChild(el)
}

// Set up UI
function initUI() {
  document.getElementById('send-btn')!.addEventListener('click', sendMessage)
  document.getElementById('input')!.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  })

  document.getElementById('new-session-btn')!.addEventListener('click', () => {
    document.getElementById('messages')!.innerHTML = ''
    createAndConnectSession()
  })
}

// Handle REST responses from extension host
window.addEventListener('message', (event) => {
  if (event.data.type === '_rest_response') {
    const { requestId, data } = event.data
    if (data?.sessionId) {
      connectToSession(data.sessionId)
    }
  }
})

// Initialize
document.addEventListener('DOMContentLoaded', initUI)
