/**
 * claude-code-bridge main entry point
 *
 * Starts the bridge server and manages the session lifecycle.
 * The bridge provides:
 * - HTTP REST API for session management and settings
 * - WebSocket endpoint (/ws/:id) for VS Code frontend connections
 * - SDK WebSocket endpoint (/sdk/:id) for CLI subprocess connections
 */

import { createHttpServer } from './server/httpServer.js'
import { SessionManager } from './session/sessionManager.js'
import { logger } from './utils/logger.js'
import { existsSync } from 'node:fs'

export interface BridgeOptions {
  /** Host to bind to (default: '127.0.0.1') */
  host?: string
  /** Port to listen on (default: 0 = auto-assign) */
  port?: number
  /** Working directory for new sessions (default: process.cwd()) */
  workDir?: string
  /** Claude Code CLI binary path (auto-detected if not provided) */
  claudeCliPath?: string
}

export interface BridgeInstance {
  port: number
  host: string
  baseUrl: string
  sessionManager: SessionManager
  stop: () => Promise<void>
}

/**
 * Auto-detect the Claude Code CLI binary.
 * Searches common locations and PATH.
 */
function resolveClaudePath(cliPath?: string): string {
  if (cliPath) return cliPath

  const candidates = [
    '/home/heipi/.local/bin/claude',           // Official Claude Code
    '/home/heipi/.local/bin/claude-haha',      // cc-haha: fallback
    '/usr/local/bin/claude',
    '/usr/bin/claude',
    'claude',  // fallback to PATH
  ]

  for (const candidate of candidates) {
    if (candidate === 'claude' || existsSync(candidate)) {
      logger.info(`Resolved claude CLI: ${candidate}${candidate === 'claude' ? ' (from PATH)' : ''}`)
      return candidate
    }
  }

  logger.warn('Could not find claude CLI binary')
  return 'claude'
}

export async function createBridge(options: BridgeOptions = {}): Promise<BridgeInstance> {
  const host = options.host || '127.0.0.1'
  const port = options.port || 0
  const claudePath = resolveClaudePath(options.claudeCliPath)

  logger.info(`Starting claude-code-bridge on ${host}:${port}`)
  logger.info(`Using claude CLI: ${claudePath}`)

  const sessionManager = new SessionManager(claudePath)
  const { server, port: actualPort } = await createHttpServer(host, port, sessionManager)

  // Update SessionManager with actual port (needed for SDK URL construction)
  const finalBaseUrl = `http://${host}:${actualPort}`

  // Write the port to stdout so the VS Code extension can discover it
  process.stdout.write(JSON.stringify({ port: actualPort, host, baseUrl: finalBaseUrl }) + '\n')

  let isStopping = false

  const stop = async () => {
    if (isStopping) return
    isStopping = true

    logger.info('Stopping bridge...')
    await sessionManager.stopAll()

    await new Promise<void>((resolve) => {
      server.close(() => {
        logger.info('Bridge server stopped')
        resolve()
      })
    })
  }

  // Handle graceful shutdown
  process.on('SIGTERM', () => { stop().then(() => process.exit(0)) })
  process.on('SIGINT', () => { stop().then(() => process.exit(0)) })

  return {
    port: actualPort,
    host,
    baseUrl: finalBaseUrl,
    sessionManager,
    stop,
  }
}

// When run directly as a script (not imported as a module)
const isMainModule = process.argv[1] && (
  process.argv[1].endsWith('index.js') ||
  process.argv[1].endsWith('bridge.js')
)

if (isMainModule) {
  const port = process.env.BRIDGE_PORT ? parseInt(process.env.BRIDGE_PORT, 10) : 0
  const host = process.env.BRIDGE_HOST || '127.0.0.1'

  createBridge({ host, port }).catch((err) => {
    logger.error('Failed to start bridge', err)
    process.exit(1)
  })
}
