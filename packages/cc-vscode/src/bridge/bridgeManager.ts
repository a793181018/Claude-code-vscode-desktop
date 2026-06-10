/**
 * Bridge Manager
 *
 * Spawns and manages the claude-code-bridge child process.
 * Detects the bridge URL from stdout and provides health checking.
 */

import { spawn, type ChildProcess, execSync } from 'node:child_process'
import WebSocket from 'ws'
import * as vscode from 'vscode'
import * as path from 'node:path'
import * as fs from 'node:fs'

/** Resolve the node binary path (VS Code may not have nvm's node in PATH) */
function resolveNodePath(): string {
  // Try common paths
  const candidates = [
    path.join(process.env.HOME || '/home/heipi', '.config/nvm/versions/node/v24.15.0/bin/node'),
    path.join(process.env.HOME || '/home/heipi', '.nvm/versions/node/v24.15.0/bin/node'),
    '/usr/local/bin/node',
    '/usr/bin/node',
  ]
  for (const c of candidates) {
    if (fs.existsSync(c)) return c
  }
  // Fallback: try finding via nvm
  try {
    const nvmDir = process.env.NVM_DIR || path.join(process.env.HOME || '/home/heipi', '.config/nvm')
    const versionsDir = path.join(nvmDir, 'versions', 'node')
    if (fs.existsSync(versionsDir)) {
      const versions = fs.readdirSync(versionsDir).sort().reverse()
      for (const v of versions) {
        const nodeBin = path.join(versionsDir, v, 'bin', 'node')
        if (fs.existsSync(nodeBin)) return nodeBin
      }
    }
  } catch { /* ignore */ }
  return 'node' // final fallback
}

export type BridgeState = 'stopped' | 'starting' | 'running' | 'error'
type StateChangeHandler = (state: BridgeState) => void

export class BridgeManager {
  private process: ChildProcess | null = null
  private port: number | null = null
  private host: string = '127.0.0.1'
  private channel: vscode.OutputChannel
  private healthCheckInterval: ReturnType<typeof setInterval> | null = null
  private state: BridgeState = 'stopped'
  private stateHandlers = new Set<StateChangeHandler>()
  private bridgeDistDir: string

  constructor(channel: vscode.OutputChannel, extensionUri: vscode.Uri) {
    this.channel = channel
    this.bridgeDistDir = path.join(extensionUri.fsPath, 'bridge-dist')
  }

  setState(state: BridgeState) {
    this.state = state
    for (const handler of this.stateHandlers) {
      try { handler(state) } catch { /* ignore */ }
    }
  }

  onStateChange(handler: StateChangeHandler): () => void {
    this.stateHandlers.add(handler)
    return () => { this.stateHandlers.delete(handler) }
  }

  get baseUrl(): string {
    return `http://${this.host}:${this.port}`
  }

  get wsUrl(): string {
    return `ws://${this.host}:${this.port}`
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed && this.port !== null
  }

  getBaseUrl(): string {
    return this.baseUrl
  }

  getWsUrl(): string {
    return this.wsUrl
  }

  getPort(): number | null {
    return this.port
  }

  /**
   * Start the bridge server as a child process.
   */
  async start(workspaceDir: string): Promise<void> {
    if (this.isRunning()) {
      this.channel.appendLine('Bridge is already running, stopping first...')
      await this.stop()
    }

    // Resolve the bridge entry point
    const bridgeJs = path.join(this.bridgeDistDir, 'index.js')
    if (!fs.existsSync(bridgeJs)) {
      throw new Error(`Bridge not found at ${bridgeJs}. Run 'npm run build:bridge' first.`)
    }

    this.channel.appendLine(`Starting bridge from: ${bridgeJs}`)
    this.channel.appendLine(`Workspace: ${workspaceDir}`)

    return new Promise((resolve, reject) => {
      const nodeBin = resolveNodePath()
      this.channel.appendLine(`Node binary: ${nodeBin}`)

      this.process = spawn(nodeBin, [bridgeJs], {
        cwd: workspaceDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env as Record<string, string>,
          BRIDGE_HOST: this.host,
          BRIDGE_PORT: '0',
        },
      })

      let resolved = false
      let buffer = ''

      this.process.stdout!.on('data', (data: Buffer) => {
        buffer += data.toString()

        // Parse line-by-line: look for the JSON startup message
        const lines = buffer.split('\n')
        buffer = lines.pop() || '' // keep incomplete last line

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed) continue

          // Try to parse as JSON (bridge startup message)
          if (trimmed.startsWith('{') && !resolved) {
            try {
              const parsed = JSON.parse(trimmed)
              if (parsed.port) {
                resolved = true
                this.port = parsed.port
                this.host = parsed.host || '127.0.0.1'
                this.channel.appendLine(`Bridge started on ${this.baseUrl}`)
                this.startHealthCheck()
                resolve()
              }
            } catch { /* not JSON, probably a log line */ }
          }

          // Log all non-JSON lines
          if (!trimmed.startsWith('{')) {
            this.channel.appendLine(`[bridge] ${trimmed}`)
          }
        }
      })

      this.process.stderr!.on('data', (data: Buffer) => {
        const text = data.toString().trim()
        if (text) {
          this.channel.appendLine(`[bridge] ${text}`)
        }
      })

      this.process.on('error', (err) => {
        this.channel.appendLine(`Bridge process error: ${err.message}`)
        if (!resolved) reject(err)
      })

      this.process.on('close', (code) => {
        this.channel.appendLine(`Bridge process exited (code=${code})`)
        this.process = null
        this.port = null
        this.stopHealthCheck()
      })

      // Timeout after 15 seconds
      setTimeout(() => {
        if (!this.port) {
          reject(new Error('Bridge failed to start within 15 seconds'))
        }
      }, 15_000)
    })
  }

  /**
   * Stop the bridge process gracefully.
   */
  async stop(): Promise<void> {
    this.stopHealthCheck()

    if (!this.process) return

    this.channel.appendLine('Stopping bridge...')

    this.process.kill('SIGTERM')

    await new Promise<void>((resolve) => {
      const forceKill = setTimeout(() => {
        if (this.process && !this.process.killed) {
          this.process.kill('SIGKILL')
        }
        resolve()
      }, 5_000)

      this.process!.on('close', () => {
        clearTimeout(forceKill)
        resolve()
      })
    })

    this.process = null
    this.port = null
  }

  /**
   * Create a WebSocket connection to a bridge session.
   */
  connectWebSocket(sessionId: string): WebSocket {
    if (!this.port) {
      throw new Error('Bridge not running')
    }
    const url = `${this.wsUrl}/ws/${encodeURIComponent(sessionId)}`
    const ws = new WebSocket(url)
    return ws
  }

  private startHealthCheck(): void {
    this.stopHealthCheck()
    this.healthCheckInterval = setInterval(async () => {
      try {
        const res = await fetch(`${this.baseUrl}/api/health`)
        if (!res.ok) {
          this.channel.appendLine(`Health check failed: ${res.status}`)
        }
      } catch {
        this.channel.appendLine('Health check: bridge unreachable')
      }
    }, 30_000)
  }

  private stopHealthCheck(): void {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval)
      this.healthCheckInterval = null
    }
  }
}
