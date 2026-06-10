/**
 * Client WebSocket Handler
 *
 * Handles WebSocket connections from the VS Code frontend at /ws/:sessionId.
 * Translates between the frontend's ClientMessage/ServerMessage protocol
 * and the CLI's SDK message protocol.
 */

import type { IncomingMessage } from 'node:http'
import { WebSocketServer, WebSocket } from 'ws'
import type { ServerMessage, ClientMessage } from '../types/messages.js'
import type { SessionManager } from '../session/sessionManager.js'
import { logger } from '../utils/logger.js'

interface ClientState {
  ws: WebSocket
  sessionId: string
  pingInterval: ReturnType<typeof setInterval> | null
  cleanupTimer: ReturnType<typeof setTimeout> | null
}

export class ClientWsHandler {
  private wss: WebSocketServer
  private sessionManager: SessionManager
  private clients = new Map<WebSocket, ClientState>()

  constructor(wss: WebSocketServer, sessionManager: SessionManager) {
    this.wss = wss
    this.sessionManager = sessionManager
    this.setupHandlers()
  }

  private setupHandlers(): void {
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      const sessionId = this.extractSessionId(req.url)
      if (!sessionId) {
        ws.close(4000, 'Missing session ID')
        return
      }

      // Check if this is an SDK connection (handled by sdkWsHandler)
      if (req.url?.includes('/sdk/')) {
        return // SDK connections are handled by the SDK WS handler
      }

      logger.info(`Client WS connected: sessionId=${sessionId}`)

      // Cancel cleanup timer if reconnecting
      this.sessionManager.cancelCleanupTimer(sessionId)

      const clientState: ClientState = {
        ws,
        sessionId,
        pingInterval: null,
        cleanupTimer: null,
      }
      this.clients.set(ws, clientState)

      // Send connected message
      this.sendMessage(ws, { type: 'connected', sessionId })

      // Auto-create session in bridge if reconnecting to a stored session
      if (!this.sessionManager.hasSession(sessionId)) {
        import('../session/sessionStore.js').then(({ getSessionMeta }) => {
          const meta = getSessionMeta(sessionId)
          const workDir = meta?.workDir || process.cwd()
          return this.sessionManager.createSession(workDir, { sessionId })
        }).catch((err: any) => {
          logger.error(`Failed to auto-create session ${sessionId}: ${err.message}`)
        })
      }

      // Register for CLI output
      const unregister = this.sessionManager.onOutput(sessionId, (messages) => {
        for (const msg of messages) {
          this.sendMessage(ws, msg)
        }
      })

      // Start ping/pong keepalive
      clientState.pingInterval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.ping()
        }
      }, 30_000)

      // Handle client messages
      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString()) as ClientMessage
          this.handleClientMessage(sessionId, msg, ws)
        } catch (err) {
          logger.warn(`Failed to parse client message: ${err}`)
        }
      })

      // Handle pong
      ws.on('pong', () => {
        // Keepalive response received, nothing to do
      })

      // Handle disconnect
      ws.on('close', () => {
        logger.info(`Client WS disconnected: sessionId=${sessionId}`)
        if (clientState.pingInterval) {
          clearInterval(clientState.pingInterval)
        }
        unregister()

        // Start cleanup timer — kill CLI after idle timeout
        this.sessionManager.startCleanupTimer(sessionId, 30_000)

        this.clients.delete(ws)
      })

      ws.on('error', (err) => {
        logger.error(`Client WS error for ${sessionId}: ${err.message}`)
      })
    })
  }

  private handleClientMessage(
    sessionId: string,
    msg: ClientMessage,
    ws: WebSocket,
  ): void {
    switch (msg.type) {
      case 'user_message':
        try {
          this.sessionManager.sendMessage(sessionId, msg.content)
        } catch (err) {
          this.sendMessage(ws, {
            type: 'error',
            message: `Failed to send message: ${err instanceof Error ? err.message : String(err)}`,
            code: 'SEND_ERROR',
          })
        }
        break

      case 'permission_response':
        this.sessionManager.respondToPermission(
          sessionId,
          msg.requestId,
          msg.allowed,
        )
        break

      case 'stop_generation':
        this.sessionManager.sendInterrupt(sessionId)
        break

      case 'ping':
        this.sendMessage(ws, { type: 'pong' })
        break

      case 'prewarm_session':
        // Prewarming not needed for VS Code integration, silently ignore
        break

      case 'set_permission_mode':
        {
          const state = this.sessionManager['sessions']?.get(sessionId)
          if (state) {
            state.cliProcess.sendSetPermissionMode(msg.mode)
          }
        }
        break

      case 'set_runtime_config':
        // Model switching — update settings, apply to next session
        logger.info(`Model change requested: ${msg.modelId}`)
        this.sendMessage(ws, {
          type: 'system_notification',
          subtype: 'info',
          message: `Model switched to ${msg.modelId}. Create a new session for it to take effect.`,
        })
        break

      default:
        logger.warn(`Unknown client message type: ${(msg as any).type}`)
    }
  }

  private sendMessage(ws: WebSocket, msg: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg))
    }
  }

  private extractSessionId(url: string | undefined): string | null {
    if (!url) return null
    // Match /ws/:sessionId from the URL path
    const match = url.match(/\/ws\/([^/?]+)/)
    return match ? decodeURIComponent(match[1]) : null
  }
}
