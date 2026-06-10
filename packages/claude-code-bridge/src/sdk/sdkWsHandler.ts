/**
 * SDK WebSocket Handler
 *
 * Handles SDK WebSocket connections from the Claude Code CLI at /sdk/:sessionId.
 * The CLI connects here for control messages (permission responses, interrupts, etc.)
 * and sends system messages (init, status, etc.) back through this channel.
 */

import type { IncomingMessage } from 'node:http'
import { WebSocketServer, type WebSocket } from 'ws'
import type { SessionManager } from '../session/sessionManager.js'
import { translateCliMessage } from '../sdk/messageTranslator.js'
import { logger } from '../utils/logger.js'

export class SdkWsHandler {
  private sessionManager: SessionManager

  constructor(sessionManager: SessionManager) {
    this.sessionManager = sessionManager
  }

  /**
   * Handle a new SDK WebSocket connection from the CLI.
   * Called by the HTTP server when a connection comes in at /sdk/:sessionId.
   */
  handleConnection(ws: WebSocket, req: IncomingMessage): void {
    const sessionId = this.extractSessionId(req.url)
    if (!sessionId) {
      ws.close(4000, 'Missing session ID')
      return
    }

    logger.info(`SDK WS connected: sessionId=${sessionId}`)

    // Get the session
    const state = this.sessionManager['sessions']?.get(sessionId)
    if (!state) {
      logger.warn(`SDK WS connected but session ${sessionId} not found`)
      ws.close(4001, 'Session not found')
      return
    }

    // Forward control responses from the SDK WS to the CLI process
    ws.on('message', (data: Buffer) => {
      try {
        const msg = JSON.parse(data.toString())

        // Handle control responses from SDK (e.g., permission responses)
        if (msg.type === 'control_response') {
          state.cliProcess.sendMessage(msg)
        }

        // Translate SDK messages to ServerMessages and forward to clients
        const serverMessages = translateCliMessage(msg, state.streamState)
        if (serverMessages.length > 0) {
          for (const callback of state.outputCallbacks) {
            try {
              callback(serverMessages)
            } catch (err) {
              logger.error('Error in SDK output callback', err)
            }
          }
        }
      } catch (err) {
        logger.warn(`Failed to parse SDK message: ${err}`)
      }
    })

    ws.on('close', () => {
      logger.info(`SDK WS disconnected: sessionId=${sessionId}`)
    })

    ws.on('error', (err) => {
      logger.error(`SDK WS error for ${sessionId}: ${err.message}`)
    })
  }

  private extractSessionId(url: string | undefined): string | null {
    if (!url) return null
    const match = url.match(/\/sdk\/([^/?]+)/)
    return match ? decodeURIComponent(match[1]) : null
  }
}
