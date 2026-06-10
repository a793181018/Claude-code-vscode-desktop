/**
 * PTY CLI Process Manager
 *
 * Runs Claude Code in interactive mode inside a pseudo-terminal (PTY).
 * Parses ANSI output to detect permission prompts and forwards them
 * as interactive permission_request messages.
 *
 * Key difference from cliProcess.ts: this runs WITHOUT --print,
 * allowing the full interactive Ink TUI with real-time permission prompts.
 */

// Dynamic import of node-pty (native module, may not be available in all environments)
let ptyModule: typeof import('node-pty') | null = null
async function getPty() {
  if (!ptyModule) {
    ptyModule = await import('node-pty')
  }
  return ptyModule
}

import { logger } from '../utils/logger.js'

export interface CliProcessOptions {
  sessionId: string
  workDir: string
  permissionMode?: string
  model?: string
  extraEnv?: Record<string, string>
}

export type CliMessageHandler = (message: unknown) => void
export type PermissionHandler = (prompt: PermissionPrompt) => void

export interface PermissionPrompt {
  requestId: string
  toolName: string
  message: string
  options: string[]
  // Index of "Yes, and allow all during session" option (shift+tab), if present
  allowAllIndex?: number
}

export class PtyCliProcess {
  private ptyProcess: any = null
  private handlers = new Set<CliMessageHandler>()
  private permHandlers = new Set<PermissionHandler>()
  private _pid: number | null = null
  private _isRunning = false
  private cliPath: string
  private outputBuffer = ''
  private pendingPrompt: PermissionPrompt | null = null
  private promptResolver: ((response: string) => void) | null = null

  constructor(cliPath = 'claude') {
    this.cliPath = cliPath
  }

  get pid(): number | null {
    return this._pid
  }

  get isRunning(): boolean {
    return this._isRunning && this.ptyProcess !== null
  }

  async start(options: CliProcessOptions): Promise<void> {
    if (this.isRunning) {
      logger.warn(`PTY CLI already running for session ${options.sessionId}`)
      return
    }

    const pty = await getPty()
    const args = this.buildCliArgs(options)
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      TERM: 'xterm-256color',
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TELEMETRY: '1',
      ...options.extraEnv,
    }

    logger.info(`Starting PTY Claude Code for session ${options.sessionId}`, {
      workDir: options.workDir,
      cliPath: this.cliPath,
      args,
    })

    const cmdArgs = [this.cliPath, ...args]
    const cmd = cmdArgs[0]

    this.ptyProcess = pty.spawn(cmd, cmdArgs.slice(1), {
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: options.workDir,
      env,
    })

    this._pid = this.ptyProcess.pid
    this._isRunning = true
    this.outputBuffer = ''

    // Parse PTY output
    this.ptyProcess.onData((data: string) => {
      this.outputBuffer += data
      this.processBuffer()
    })

    this.ptyProcess.onExit((result: { exitCode: number; signal?: number }) => {
      logger.info(`PTY CLI exited for session ${options.sessionId}: code=${result.exitCode}, signal=${result.signal}`)
      this._isRunning = false
      this._pid = null
    })
  }

  /**
   * Send user message by writing to PTY stdin.
   * In interactive mode, this is just text + newline.
   */
  sendMessage(content: string): void {
    if (!this.ptyProcess || !this.isRunning) {
      logger.warn('Cannot send message: PTY process not running')
      return
    }
    logger.debug(`PTY stdin: ${content.substring(0, 200)}`)
    this.ptyProcess.write(content + '\r')
  }

  /**
   * Register a handler for parsed CLI output messages.
   */
  onMessage(handler: CliMessageHandler): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  /**
   * Register a handler for permission prompts detected from PTY output.
   */
  onPermissionPrompt(handler: PermissionHandler): () => void {
    this.permHandlers.add(handler)
    return () => { this.permHandlers.delete(handler) }
  }

  /**
   * Respond to a permission prompt with a choice number (1, 2, 3...).
   */
  respondToPermission(choice: number, allowAll?: boolean): void {
    if (!this.ptyProcess || !this.isRunning) return

    if (allowAll) {
      // Shift+Tab equivalent: send choice number, then this special sequence
      this.ptyProcess.write(String(choice))
      // For "Yes, and allow all edits during this session" we need
      // to select option 2, which enables the acceptEdits permission mode
      logger.info(`PTY: sending permission choice ${choice} with allowAll`)
      this.ptyProcess.write(String(choice) + '\r')
    } else {
      this.ptyProcess.write(String(choice) + '\r')
    }
    this.pendingPrompt = null
  }

  /**
   * Change permission mode at runtime (PTY sends keyboard shortcut).
   */
  sendSetPermissionMode(_mode: string): void {
    // In PTY mode, permission mode changes can be done via Shift+Tab
    // which cycles through modes. For now, this is a no-op.
    logger.info(`PTY: permission mode change requested: ${_mode}`)
  }

  /**
   * Send interrupt to CLI (Ctrl+C).
   */
  sendInterrupt(): void {
    if (this.ptyProcess && this.isRunning) {
      this.ptyProcess.write('\x03') // Ctrl+C
    }
  }

  /**
   * Stop the PTY process.
   */
  async stop(timeoutMs = 5000): Promise<void> {
    if (!this.ptyProcess || !this.isRunning) {
      this._isRunning = false
      return
    }

    logger.info(`Stopping PTY CLI process PID=${this._pid}`)
    this.ptyProcess.write('\x03') // Ctrl+C to gracefully exit

    const killed = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        try { this.ptyProcess?.kill() } catch { /* ignore */ }
        resolve(false)
      }, timeoutMs)

      this.ptyProcess!.onExit(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })

    this._isRunning = false
    this._pid = null
    logger.info(`PTY CLI process stopped (graceful: ${killed})`)
  }

  kill(): void {
    try { this.ptyProcess?.kill() } catch { /* ignore */ }
    this._isRunning = false
    this._pid = null
  }

  // ============================================================================
  // Private methods
  // ============================================================================

  private buildCliArgs(options: CliProcessOptions): string[] {
    const args: string[] = [
      '--session-id', options.sessionId,
      // NO --print flag — interactive mode for real permission prompts
    ]

    if (options.model) {
      args.push('--model', options.model)
    }

    if (options.permissionMode === 'bypassPermissions') {
      args.push('--dangerously-skip-permissions')
    } else if (options.permissionMode && options.permissionMode !== 'default') {
      args.push('--permission-mode', options.permissionMode)
    }

    return args
  }

  private processBuffer(): void {
    // Strip ANSI and normalize whitespace
    const cleanText = this.outputBuffer
      .replace(/\x1B\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/\x1B\][0-9;]*[^\x07]*\x07/g, '')
      .replace(/\x1B[PX^_].*?\x1B\\/g, '')
      .replace(/\x1B\[\?[0-9;]*[a-zA-Z]/g, '')
      .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[─━═▬]/g, '') // strip box-drawing chars

    // Auto-respond to numbered prompts that are setup/trust dialogs
    const hasNumbers = /[>❯\s]*1\.\s/.test(cleanText) && /[>❯\s]*2\.\s/.test(cleanText)
    if (hasNumbers && /trust.*folder|trust.*directory|trust.*project|trust.*workspace/i.test(cleanText)) {
      logger.info('PTY: auto-responding to trust dialog')
      this.ptyProcess?.write('1\r')
      this.outputBuffer = ''
      return
    }

    if (hasNumbers && /sandbox|container|Docker|virtual.*env/i.test(cleanText)) {
      logger.info('PTY: auto-responding to setup prompt')
      this.ptyProcess?.write('1\r')
      this.outputBuffer = ''
      return
    }

    // Detect permission prompts for tool operations
    const prompt = this.detectPermissionPrompt(cleanText)
    if (prompt && !this.pendingPrompt) {
      logger.info(`PTY: permission prompt detected: ${prompt.message}`)
      this.pendingPrompt = prompt
      for (const handler of this.permHandlers) {
        try { handler(prompt) } catch (err) { logger.error('Permission handler error', err) }
      }
      return
    }

    if (this.pendingPrompt) return
    this.extractAndForwardContent(cleanText)
  }

  private detectPermissionPrompt(cleanText: string): PermissionPrompt | null {
    // Match "Do you want to ... ?" followed by Yes/No options
    const hasYesNoOptions = /\d+\.\s*Yes/i.test(cleanText) && /\d+\.\s*No/i.test(cleanText)
    if (!hasYesNoOptions) return null

    // Must be a tool-operation question (not trust/setup)
    const questionPatterns = [
      /Do you want to (create|edit|delete|write|modify|read|run|execute)/i,
      /Should I (create|edit|delete|write|modify|read|run|execute)/i,
      /Allow (create|edit|delete|write|modify|read|run|execute)/i,
      /Proceed with (create|edit|delete|write|modify)/i,
    ]

    let questionLine = ''
    for (const pattern of questionPatterns) {
      const match = cleanText.match(pattern)
      if (match) { questionLine = match[0]; break }
    }
    if (!questionLine) return null

    // Skip if it's a trust/setup dialog
    if (/trust|sandbox|container|Docker/i.test(cleanText)) return null

    const optionMatches = cleanText.match(/\d+\.\s*(Yes[^.,\n]*|No[^.,\n]*)/gi) || []
    const options = optionMatches.map(o => o.trim())

    if (options.length < 2) return null

    const allowAllIndex = options.findIndex(o => /allow all|session|shift.tab/i.test(o))

    return {
      requestId: `perm-pty-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      toolName: this.detectToolName(cleanText),
      message: questionLine,
      options,
      allowAllIndex: allowAllIndex >= 0 ? allowAllIndex + 1 : undefined,
    }
  }

  /**
   * Try to detect the tool name from the context.
   */
  private detectToolName(cleanText: string): string {
    // Look for tool-related keywords in the surrounding text
    if (/write|create|edit/i.test(cleanText)) return 'Write'
    if (/read|view|cat/i.test(cleanText)) return 'Read'
    if (/delete|remove/i.test(cleanText)) return 'Delete'
    if (/bash|command|execute|run/i.test(cleanText)) return 'Bash'
    if (/search|grep|find/i.test(cleanText)) return 'Grep'
    return 'Tool'
  }

  /**
   * Extract new content and forward as cleaned messages.
   * In interactive mode, the output is raw terminal text.
   * We synthesize stream-json-like messages for the frontend.
   */
  private extractAndForwardContent(cleanText: string): void {
    // In interactive mode, the output is a mix of assistant text and system messages.
    // We forward chunks of new text as synthetic content_delta messages.
    const MAX_CHUNK = 200

    // Get only the new part since last process
    if (!this._lastProcessedText) {
      this._lastProcessedText = ''
    }

    const newText = cleanText.substring(this._lastProcessedText.length)
    if (!newText.trim()) return

    this._lastProcessedText = cleanText

    // Forward in chunks to simulate streaming
    for (let i = 0; i < newText.length; i += MAX_CHUNK) {
      const chunk = newText.substring(i, i + MAX_CHUNK)
      const msg = {
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          delta: { type: 'text_delta', text: chunk },
        },
      }
      for (const handler of this.handlers) {
        try { handler(msg) } catch { /* ignore */ }
      }
    }
  }

  private _lastProcessedText = ''
}
