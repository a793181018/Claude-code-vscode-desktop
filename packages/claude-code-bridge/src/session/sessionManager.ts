/**
 * Session Manager
 *
 * Manages session lifecycle, CLI process, message routing, and persistence.
 * Uses @anthropic-ai/claude-agent-sdk's query() with canUseTool callback
 * for interactive permission handling.
 */

import { randomUUID } from 'node:crypto'
import { CliProcess, type CliProcessOptions } from '../sdk/cliProcess.js'
import { createStreamState, translateCliMessage, type SessionStreamState } from '../sdk/messageTranslator.js'
import type { ServerMessage } from '../types/messages.js'
import { logger } from '../utils/logger.js'
import * as sessionStore from './sessionStore.js'
import { getSkill } from '../server/skillsConfig.js'

export interface SessionInfo {
  sessionId: string
  workDir: string
  createdAt: number
  title?: string
}

export interface SessionState {
  info: SessionInfo
  streamState: SessionStreamState
  cliProcess: CliProcess
  pendingPermissionRequests: Map<string, unknown>
  outputCallbacks: Set<(messages: ServerMessage[]) => void>
  cleanupTimer: ReturnType<typeof setTimeout> | null
  isStopping: boolean
}

export class SessionManager {
  private sessions = new Map<string, SessionState>()
  private cliPath: string

  constructor(cliPath = 'claude') {
    this.cliPath = cliPath
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId)
  }

  getSessionInfo(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId)?.info
  }

  listSessions(): SessionInfo[] {
    const stored = sessionStore.listAllSessions()
    const inMemory = new Map(
      [...this.sessions.values()].map((s) => [s.info.sessionId, s.info]),
    )
    for (const meta of stored) {
      if (!inMemory.has(meta.sessionId)) {
        inMemory.set(meta.sessionId, {
          sessionId: meta.sessionId,
          workDir: meta.workDir,
          createdAt: meta.createdAt,
          title: meta.title,
        })
      }
    }
    return [...inMemory.values()].sort((a, b) => b.createdAt - a.createdAt)
  }

  getSessionMessages(sessionId: string): sessionStore.StoredMessage[] {
    return sessionStore.getMessages(sessionId)
  }

  async createSession(workDir: string, options?: {
    sessionId?: string
    permissionMode?: string
    model?: string
    title?: string
  }): Promise<SessionInfo> {
    const sessionId = options?.sessionId || randomUUID()
    const streamState = createStreamState()

    const cliProcess = new CliProcess(this.cliPath)
    const cliOptions: CliProcessOptions = {
      sessionId,
      workDir,
      permissionMode: options?.permissionMode,
      model: options?.model,
    }

    // Set up interactive permission callback via Agent SDK
    cliProcess.setPermissionCallback(
      (toolName, input, permOptions) => {
        return new Promise((resolve) => {
          // Check if this tool needs user permission
          const needsPermission = shouldAskPermission(toolName, input)

          if (!needsPermission) {
            // Safe operations — auto-allow
            resolve({ behavior: 'allow', updatedInput: input })
            return
          }

          const requestId = `perm-${Date.now()}-${Math.random().toString(36).slice(2,6)}`
          logger.info(`canUseTool: ${toolName} -> ${requestId}`)

          // Store the resolver for when user responds
          state.pendingPermissionRequests.set(requestId, {
            toolName,
            input,
            resolve,
            permOptions,
          })

          // Generate description based on tool and input
          const desc = buildPermissionDescription(toolName, input)

          // Send permission_request to frontend
          for (const callback of state.outputCallbacks) {
            try {
              callback([{
                type: 'permission_request',
                requestId,
                toolName,
                input: input as unknown,
                description: desc,
              }])
            } catch (err) { logger.error('Output callback error', err) }
          }
        })
      }
    )

    cliProcess.start(cliOptions)

    const title = options?.title || undefined
    const info: SessionInfo = { sessionId, workDir, createdAt: Date.now(), title }
    const state: SessionState = {
      info,
      streamState,
      cliProcess,
      pendingPermissionRequests: new Map(),
      outputCallbacks: new Set(),
      cleanupTimer: null,
      isStopping: false,
    }

    cliProcess.onMessage((cliMsg) => {
      const msg = cliMsg as Record<string, any>
      const messages = translateCliMessage(msg, state.streamState)

      if (msg.type === 'control_request' && msg.request?.subtype === 'can_use_tool') {
        state.pendingPermissionRequests.set(msg.request_id, msg)
      }

      persistCliMessage(sessionId, msg)

      // Persist checkpoints from user messages with UUID
      if (msg.type === 'user' && msg.uuid) {
        // Count user messages in the session store to determine index
        const userMsgs = sessionStore.getMessages(sessionId).filter(m => m.type === 'user')
        const cpIndex = userMsgs.length - 1  // 0-based: count of user msgs BEFORE current one
        sessionStore.appendCheckpoint(sessionId, {
          messageUuid: msg.uuid,
          index: cpIndex,
          userContent: '',
          timestamp: Date.now(),
        })
      }

      if (messages.length > 0) {
        // Attach checkpoint UUID to relevant messages
        const cpUuid = state.cliProcess.currentCheckpointUuid
        for (const msg of messages) {
          if (cpUuid && (msg.type === 'content_start' || msg.type === 'message_complete')) {
            ;(msg as any).checkpointUuid = cpUuid
          }
        }
        for (const callback of state.outputCallbacks) {
          try { callback(messages) } catch (err) { logger.error('Output callback error', err) }
        }
      }
    })

    this.sessions.set(sessionId, state)

    sessionStore.saveSessionMeta({
      sessionId, workDir, title,
      createdAt: info.createdAt, lastActiveAt: Date.now(), messageCount: 0,
    })

    logger.info(`Session created: ${sessionId} (workDir: ${workDir})`)
    return info
  }

  sendMessage(sessionId: string, content: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) throw new Error(`Session ${sessionId} not found`)

    // Resolve skill slash commands: /skill-name args → load SKILL.md + args
    const resolvedContent = resolveSkillCommand(content, state.info.workDir)

    sessionStore.appendMessage(sessionId, { timestamp: Date.now(), type: 'user', content: resolvedContent })
    sessionStore.updateSessionLastActive(sessionId)

    state.cliProcess.sendMessage({
      type: 'user',
      message: { role: 'user', content: resolvedContent },
      parent_tool_use_id: null,
      session_id: sessionId,
    })
  }

  respondToPermission(sessionId: string, requestId: string, allowed: boolean): void {
    const state = this.sessions.get(sessionId)
    if (!state) return

    const pending = state.pendingPermissionRequests.get(requestId)
    state.pendingPermissionRequests.delete(requestId)

    // Resolve the canUseTool Promise for Agent SDK callback
    if (pending && typeof pending === 'object' && typeof (pending as any).resolve === 'function') {
      // SDK requires updatedInput field (even empty) for 'allow' behavior
      const toolInput = (pending as any).input || {}
      const result: any = allowed
        ? { behavior: 'allow', updatedInput: toolInput }
        : { behavior: 'deny', message: 'User denied' }
      ;(pending as any).resolve(result)
      return
    }

    state.cliProcess.sendControlResponse(requestId, allowed ? 'allow' : 'deny')
  }

  sendInterrupt(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    state.cliProcess.sendInterrupt()
  }

  async rewindFiles(sessionId: string, checkpointMessageUuid: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (state) {
      await state.cliProcess.rewindFiles(checkpointMessageUuid)
      return
    }
    // Session not in memory — create a temp CliProcess with persisted SDK session ID
    const sdkSid = sessionStore.getSdkSessionId(sessionId)
    const meta = sessionStore.getSessionMeta(sessionId)
    if (!sdkSid || !meta) throw new Error(`No persisted session data for ${sessionId}`)
    const tempProcess = new CliProcess(this.cliPath)
    tempProcess.start({ sessionId, workDir: meta.workDir })
    await tempProcess.rewindFiles(checkpointMessageUuid)
    await tempProcess.stop()
  }

  getCheckpoints(sessionId: string): any[] {
    // Try in-memory first (active session)
    const state = this.sessions.get(sessionId)
    if (state) {
      const cp = state.cliProcess.checkpoints
      if (cp.length > 0) return cp
    }
    // Fallback: read from persisted store
    return sessionStore.getCheckpoints(sessionId)
  }

  onOutput(sessionId: string, callback: (messages: ServerMessage[]) => void): () => void {
    const state = this.sessions.get(sessionId)
    if (!state) { logger.warn(`Session ${sessionId} not found`); return () => {} }
    state.outputCallbacks.add(callback)
    return () => { state.outputCallbacks.delete(callback) }
  }

  clearOutputCallbacks(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (state) state.outputCallbacks.clear()
  }

  startCleanupTimer(sessionId: string, delayMs = 30000): void {
    const state = this.sessions.get(sessionId)
    if (!state) return
    this.cancelCleanupTimer(sessionId)
    state.cleanupTimer = setTimeout(() => { this.destroySession(sessionId) }, delayMs)
  }

  cancelCleanupTimer(sessionId: string): void {
    const state = this.sessions.get(sessionId)
    if (state?.cleanupTimer) { clearTimeout(state.cleanupTimer); state.cleanupTimer = null }
  }

  async destroySession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)
    if (!state) return
    logger.info(`Destroying session ${sessionId}`)
    state.isStopping = true
    this.cancelCleanupTimer(sessionId)
    state.outputCallbacks.clear()
    await state.cliProcess.stop()
    this.sessions.delete(sessionId)
    sessionStore.updateSessionLastActive(sessionId)
    logger.info(`Session ${sessionId} destroyed`)
  }

  async stopAll(): Promise<void> {
    logger.info(`Stopping all ${this.sessions.size} sessions...`)
    const promises = [...this.sessions.keys()].map((id) => this.destroySession(id))
    await Promise.all(promises)
    logger.info('All sessions stopped')
  }

  getPendingPermissions(sessionId: string): unknown[] {
    const state = this.sessions.get(sessionId)
    if (!state) return []
    return [...state.pendingPermissionRequests.values()]
  }
}

// ============================================================================
// Permission helpers
// ============================================================================

function shouldAskPermission(toolName: string, _input: Record<string, unknown>): boolean {
  // Always ask for potentially destructive tools
  const destructiveTools = ['Write', 'Edit', 'Bash', 'Delete', 'NotebookEdit']
  return destructiveTools.includes(toolName)
}

function buildPermissionDescription(toolName: string, input: Record<string, unknown>): string {
  const filePath = input.file_path as string | undefined
  const command = input.command as string | undefined
  if (filePath) return `Allow ${toolName} to ${filePath}`
  if (command) return `Allow ${toolName}: ${command.substring(0, 80)}`
  return `Allow ${toolName} to run`
}

// ============================================================================
// Helper: persist CLI messages to JSONL
// ============================================================================

function persistCliMessage(sessionId: string, cliMsg: Record<string, any>): void {
  const ts = Date.now()
  switch (cliMsg.type) {
    case 'stream_event': break // transient
    case 'assistant': {
      if (!cliMsg.message?.content || !Array.isArray(cliMsg.message.content)) break
      for (const block of cliMsg.message.content) {
        if (block.type === 'text' && block.text) {
          sessionStore.appendMessage(sessionId, { timestamp: ts, type: 'assistant', content: block.text })
        } else if (block.type === 'tool_use') {
          sessionStore.appendMessage(sessionId, { timestamp: ts, type: 'tool_use', toolName: block.name, toolUseId: block.id, content: block.input })
        } else if (block.type === 'thinking' && block.thinking) {
          sessionStore.appendMessage(sessionId, { timestamp: ts, type: 'thinking', content: block.thinking })
        }
      }
      break
    }
    case 'user': {
      if (cliMsg.message?.content && Array.isArray(cliMsg.message.content)) {
        for (const block of cliMsg.message.content) {
          if (block.type === 'tool_result') {
            sessionStore.appendMessage(sessionId, {
              timestamp: ts, type: 'tool_result', toolUseId: block.tool_use_id,
              content: typeof block.content === 'string' ? block.content.substring(0, 5000) : block.content,
              isError: !!block.is_error,
            })
          }
        }
      }
      break
    }
    case 'result': {
      if (cliMsg.is_error) {
        sessionStore.appendMessage(sessionId, {
          timestamp: ts, type: 'error',
          content: cliMsg.result || (cliMsg.errors && cliMsg.errors[0]) || 'Unknown error',
        })
      }
      sessionStore.updateSessionLastActive(sessionId)
      break
    }
  }
  sessionStore.updateSessionLastActive(sessionId)
}

// ============================================================================
// Skill slash command resolution
// ============================================================================

/**
 * Resolve /skill-name into the skill's content + user message.
 * Searches both project and user scopes for the SKILL.md.
 */
function resolveSkillCommand(content: string, workDir: string): string {
  // Only process lines starting with /
  if (!content.startsWith('/')) return content

  // Extract skill name (first line, or until first space/tab)
  const sepMatch = content.match(/[ \t\r\n]/)
  const cmd = sepMatch ? content.substring(0, sepMatch.index!) : content
  const args = sepMatch ? content.substring(sepMatch.index! + 1).trim() : ''

  // Skip built-in commands
  const builtins = new Set([
    'help', 'clear', 'exit', 'quit', 'status', 'doctor', 'login', 'logout',
    'btw', 'compact', 'context', 'export', 'rename', 'resume', 'continue', 'branch',
    'rewind', 'checkpoint', 'add-dir', 'cd', 'copy', 'recap', 'goal', 'fast',
    'review', 'security-review', 'diff', 'code-review', 'pr-comments', 'release-notes',
    'model', 'effort', 'plan',
    'usage', 'stats', 'cost',
    'config', 'settings', 'permissions', 'allowed-tools', 'memory', 'init',
    'hooks', 'ide',
    'agents', 'mcp', 'skills', 'tasks', 'bashes', 'workflows',
    'plugin', 'reload-plugins', 'reload-skills',
    'feedback', 'bug', 'share',
    'batch', 'claude-api', 'debug', 'deep-research', 'fewer-permission-prompts',
    'loop', 'proactive', 'run', 'run-skill-generator', 'verify', 'simplify',
    'schedule', 'routines', 'insights', 'team-onboarding', 'powerup',
    'install-github-app', 'install-slack-app', 'web-setup',
    'setup-bedrock', 'setup-vertex',
    'fork', 'voice', 'sandbox', 'heapdump',
  ])
  // Remove leading /
  const skillName = cmd.startsWith('/') ? cmd.substring(1) : cmd
  if (builtins.has(skillName)) return content

  // Search for skill in project then user scope
  let skill = getSkill(workDir, skillName, 'project')
  if (!skill) {
    skill = getSkill(workDir, skillName, 'user')
  }

  if (!skill || !skill.enabled) {
    // Skill not found — pass through (let SDK handle)
    return content
  }

  // Inject skill content before user's message
  const prompt = args
    ? `${skill.content}\n\n---\n\nUser request: ${args}`
    : skill.content

  logger.info(`Resolved skill /${skillName} (${skill.description})`)
  return prompt
}
