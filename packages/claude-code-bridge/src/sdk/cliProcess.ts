/**
 * CLI Process Manager — Agent SDK version
 *
 * Uses @anthropic-ai/claude-agent-sdk's query() function.
 * Multi-turn: each user message starts a new query() with { resume, continue }.
 * File checkpointing: captures UUIDs for rewindFiles() support.
 */

import { query, type Options, type CanUseTool } from '@anthropic-ai/claude-agent-sdk'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { logger } from '../utils/logger.js'
import * as sessionStore from '../session/sessionStore.js'
import type { StoredMessage } from '../session/sessionStore.js'

export interface CliProcessOptions {
  sessionId: string
  workDir: string
  permissionMode?: string
  model?: string
  extraEnv?: Record<string, string>
}

export type CliMessageHandler = (message: unknown) => void

export interface CheckpointEntry {
  messageUuid: string
  index: number
  userContent: string
  timestamp: number
}

export class CliProcess {
  private handlers = new Set<CliMessageHandler>()
  private _isRunning = false
  private _pid: number | null = null
  private permCallback: CanUseTool | null = null
  private pendingOptions: CliProcessOptions | null = null
  private isFirstTurn = true
  private sdkSessionId: string | null = null
  private _currentCheckpointUuid: string | null = null
  private _currentTurnHasFileOps = false
  private lastQuery: Query | null = null
  private _checkpoints: CheckpointEntry[] = []
  private msgIndex = 0

  get pid(): number | null { return this._pid }
  get isRunning(): boolean { return this._isRunning }
  get checkpoints(): CheckpointEntry[] { return this._checkpoints }
  get currentCheckpointUuid(): string | null { return this._currentCheckpointUuid }
  get currentTurnHasFileOps(): boolean { return this._currentTurnHasFileOps }

  constructor(_cliPath = '') {}

  start(options: CliProcessOptions): void {
    this.pendingOptions = options
    this._isRunning = true
    this._pid = process.pid
    this.isFirstTurn = true
    this._checkpoints = []
    this.msgIndex = 0
    // Restore SDK session ID from persisted store (for rewind support on reconnect)
    this.sdkSessionId = sessionStore.getSdkSessionId(options.sessionId)
    logger.info(`Agent SDK session configured for ${options.sessionId}${this.sdkSessionId ? ' (resumed)' : ''}`)
  }

  setPermissionCallback(callback: CanUseTool): void {
    this.permCallback = callback
  }

  sendMessage(message: unknown): void {
    const msg = message as Record<string, any>
    if (msg.type !== 'user' || !msg.message?.content) return

    const content = typeof msg.message.content === 'string'
      ? msg.message.content
      : String(msg.message.content)
    const sid = msg.session_id || ''
    const opts = this.pendingOptions
    if (!opts) { logger.warn('No pending options'); return }

    logger.debug(`SDK msg (turn ${this.isFirstTurn ? '1' : 'N'}): ${content.substring(0, 200)}`)

    // Build query options with file checkpointing enabled
    const qOpts: Options = {
      cwd: opts.workDir,
      model: opts.model,
      permissionMode: this.mapPermissionMode(opts.permissionMode),
      canUseTool: this.permCallback || undefined,
      enableFileCheckpointing: true,
      extraArgs: { 'replay-user-messages': null },
    }

    if (!this.isFirstTurn && this.sdkSessionId) {
      qOpts.continue = true
      qOpts.resume = this.sdkSessionId
    }

    this.isFirstTurn = false

    const sdkQuery = query({ prompt: content, options: qOpts })
    this.lastQuery = sdkQuery

    this.consumeQuery(sdkQuery).catch((err: any) => {
      if (err?.name !== 'AbortError') {
        logger.error(`SDK query error for ${sid}: ${err.message || err}`)
      }
    })
  }

  /**
   * Rewind files to a specific checkpoint (user message UUID).
   * Starts a new query with resume to get an active Query object,
   * then calls rewindFiles() on it.
   */
  async rewindFiles(checkpointMessageUuid: string): Promise<void> {
    if (!this.sdkSessionId || !this.pendingOptions) {
      throw new Error('No session to rewind files')
    }

    logger.info(`Rewinding files to checkpoint: ${checkpointMessageUuid}`)

    const opts = this.pendingOptions
    const rewindQuery = query({
      prompt: '',  // Empty prompt to open the connection
      options: {
        cwd: opts.workDir,
        model: opts.model,
        enableFileCheckpointing: true,
        extraArgs: { 'replay-user-messages': null },
        resume: this.sdkSessionId,
      },
    })

    // Consume first message then call rewindFiles
    for await (const msg of rewindQuery) {
      await rewindQuery.rewindFiles(checkpointMessageUuid)
      break
    }

    logger.info('Files restored to checkpoint')
  }

  onMessage(handler: CliMessageHandler): () => void {
    this.handlers.add(handler)
    return () => { this.handlers.delete(handler) }
  }

  sendControlResponse(_req: string, _behavior: 'allow' | 'deny'): void {}
  sendSetPermissionMode(_mode: string): void {}

  sendInterrupt(): void {}

  async stop(_ms = 5000): Promise<void> {
    this._isRunning = false
    this._pid = null
    this.pendingOptions = null
    this.sdkSessionId = null
    this.lastQuery = null
    this._checkpoints = []
  }

  kill(): void { this.stop() }

  private mapPermissionMode(mode?: string): Options['permissionMode'] {
    switch (mode) {
      case 'bypassPermissions': return 'bypassPermissions'
      case 'acceptEdits': return 'acceptEdits'
      case 'plan': return 'plan'
      default: return 'default'
    }
  }

  private async consumeQuery(sdkQuery: Query): Promise<void> {
    try {
      for await (const msg of sdkQuery) {
        const m = msg as Record<string, any>
        // Capture SDK session ID
        if (m.type === 'system' && m.subtype === 'init' && m.session_id) {
          if (this.sdkSessionId !== m.session_id) {
            logger.info(`SDK session ID: ${m.session_id}`)
            this.sdkSessionId = m.session_id
            // Persist SDK session ID for rewind support
            const bridgeSid = this.pendingOptions?.sessionId
            if (bridgeSid) {
              try { sessionStore.saveSdkSessionId(bridgeSid, m.session_id) } catch { /* ignore */ }
            }
          }
        }
        // Capture checkpoint UUIDs from user messages (only user prompts, not tool_results)
        if (m.type === 'user' && m.uuid && typeof m.message?.content === 'string') {
          this._currentCheckpointUuid = m.uuid
          this._currentTurnHasFileOps = false  // reset for new turn
          const entry: CheckpointEntry = {
            messageUuid: m.uuid,
            index: this.msgIndex++,
            userContent: m.message.content.substring(0, 200),
            timestamp: Date.now(),
          }
          this._checkpoints.push(entry)

          // Persist checkpoint to session store for recovery after restart
          const bridgeSid = this.pendingOptions?.sessionId
          if (bridgeSid) {
            try {
              sessionStore.appendCheckpoint(bridgeSid, entry)
            } catch { /* ignore */ }
          }

          logger.debug(`Checkpoint #${this._checkpoints.length}: ${m.uuid.substring(0, 8)}`)
        }

        // Track file-related tool operations
        if (m.type === 'assistant' && m.message?.content) {
          for (const block of m.message.content) {
            if (block.type === 'tool_use' && ['Write', 'Edit'].includes(block.name)) {
              this._currentTurnHasFileOps = true
            }
          }
        }
        for (const handler of this.handlers) {
          try { handler(msg as unknown) } catch (err) {
            logger.error('Handler error', err)
          }
        }
      }
    } catch (err: any) {
      if (err?.name !== 'AbortError') throw err
    }
  }
}
