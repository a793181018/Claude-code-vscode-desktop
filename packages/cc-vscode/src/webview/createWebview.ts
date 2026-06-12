/**
 * Webview Panel Factory
 *
 * Creates and manages the VS Code Webview panel that hosts the
 * adapted React frontend from cc-haha.
 */

import * as vscode from 'vscode'
import type { BridgeManager } from '../bridge/bridgeManager.js'

let panel: vscode.WebviewPanel | undefined = undefined

interface CreateOptions {
  newSession?: boolean
}

export function createChatWebview(
  context: vscode.ExtensionContext,
  bridgeManager: BridgeManager,
  options: CreateOptions = {},
): vscode.WebviewPanel {
  // Reuse existing panel if available
  if (panel) {
    panel.reveal(vscode.ViewColumn.Two)
    return panel
  }

  panel = vscode.window.createWebviewPanel(
    'cc-vscode.chat',
    'Claude Code',
    vscode.ViewColumn.Two,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'webview-ui', 'dist'),
      ],
    },
  )

  // Get webview HTML content
  panel.webview.html = getWebviewContent(panel.webview, context.extensionUri)

  // Handle messages from the webview
  panel.webview.onDidReceiveMessage(
    (message) => {
      handleWebviewMessage(message, panel!.webview, bridgeManager)
    },
    undefined,
    context.subscriptions,
  )

  // Handle panel dispose
  panel.onDidDispose(
    () => {
      panel = undefined
    },
    null,
    context.subscriptions,
  )

  // Send initial config to webview
  const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || ''
  panel.webview.postMessage({
    type: 'init',
    bridgeUrl: bridgeManager.getBaseUrl(),
    newSession: options.newSession || false,
    workspaceDir,
  })

  return panel
}

function getWebviewContent(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist', 'main.js'),
  )
  const styleUri = webview.asWebviewUri(
    vscode.Uri.joinPath(extensionUri, 'webview-ui', 'dist', 'style.css'),
  )

  const nonce = getNonce()

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none';
                 style-src ${webview.cspSource} 'unsafe-inline';
                 script-src ${webview.cspSource} 'nonce-${nonce}';
                 font-src ${webview.cspSource};
                 img-src ${webview.cspSource} data: https:;
                 connect-src ${webview.cspSource}">
  <link rel="stylesheet" href="${styleUri}">
  <title>Claude Code</title>
  <style>
    html, body, #root {
      margin: 0;
      padding: 0;
      height: 100vh;
      width: 100vw;
      overflow: hidden;
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: var(--vscode-editor-font-size);
    }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
}

function getNonce(): string {
  let text = ''
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  for (let i = 0; i < 64; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length))
  }
  return text
}

// ============================================================================
// Message Relay: Webview <-> Bridge
// ============================================================================

interface WebviewMessage {
  type: string
  sessionId?: string
  [key: string]: unknown
}

const wsConnections = new Map<string, import('ws').WebSocket>()

function handleWebviewMessage(
  message: WebviewMessage,
  webview: vscode.Webview,
  bridgeManager: BridgeManager,
): void {
  switch (message.type) {
    case '_connect_session': {
      const sessionId = message.sessionId as string
      if (!sessionId) return

      // Close existing connection for this session if any
      const existing = wsConnections.get(sessionId)
      if (existing && existing.readyState === existing.OPEN) {
        existing.close()
      }

      // Connect to bridge WebSocket
      try {
        const ws = bridgeManager.connectWebSocket(sessionId)
        wsConnections.set(sessionId, ws)

        // Forward bridge messages to webview
        ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data.toString())
            webview.postMessage(msg)
          } catch {
            // Ignore parse errors
          }
        }

        ws.onclose = () => {
          wsConnections.delete(sessionId)
          webview.postMessage({ type: '_ws_closed', sessionId })
        }

        ws.onerror = (err) => {
          console.error(`WS error for ${sessionId}:`, err.message)
        }
      } catch (err) {
        webview.postMessage({
          type: 'error',
          message: `Failed to connect: ${err instanceof Error ? err.message : String(err)}`,
          code: 'WS_CONNECT_ERROR',
        })
      }
      break
    }

    case '_disconnect_session': {
      const sessionId = message.sessionId as string
      const ws = wsConnections.get(sessionId)
      if (ws) {
        ws.close()
        wsConnections.delete(sessionId)
      }
      break
    }

    case '_rest_request': {
      // Proxy REST requests from webview to bridge
      const { path, method, body, requestId } = message
      const url = `${bridgeManager.getBaseUrl()}${path}`

      const headers: Record<string, string> = { 'Content-Type': 'application/json' }

      fetch(url, {
        method: (method as string) || 'GET',
        headers,
        body: body ? JSON.stringify(body) : undefined,
      })
        .then(async (res) => {
          const data = await res.json()
          webview.postMessage({
            type: '_rest_response',
            requestId,
            status: res.status,
            data,
          })
        })
        .catch((err) => {
          webview.postMessage({
            type: '_rest_response',
            requestId,
            status: 0,
            data: { error: err.message },
          })
        })
      break
    }

    case '_open_file': {
      const filePath = message.filePath as string
      if (filePath) {
        vscode.workspace.openTextDocument(filePath).then(
          (doc) => vscode.window.showTextDocument(doc)
        )
      }
      break
    }

    default: {
      // Forward all other messages as ClientMessages to bridge via WS
      const sessionId = message.sessionId as string
      const ws = wsConnections.get(sessionId)
      if (ws && ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(message))
      } else {
        console.warn(`No WS connection for session ${sessionId}, dropping message:`, message.type)
      }
    }
  }
}
