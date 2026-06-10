/**
 * Session Store — JSONL file-based persistence
 *
 * Stores session messages and metadata as JSONL files at
 * ~/.claude-cc-vscode/sessions/{sessionId}.jsonl
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../utils/logger.js'

const SESSIONS_DIR = path.join(
  process.env.HOME || process.env.USERPROFILE || '/tmp',
  '.claude-cc-vscode',
  'sessions',
)

export interface SessionMeta {
  sessionId: string
  workDir: string
  title?: string
  createdAt: number
  lastActiveAt: number
  messageCount: number
}

export interface StoredMessage {
  timestamp: number
  type: 'user' | 'assistant' | 'tool_use' | 'tool_result' | 'thinking' | 'error' | 'system'
  content?: unknown
  toolName?: string
  toolUseId?: string
  isError?: boolean
}

function ensureDir(dir: string) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function sessionDir(sessionId: string): string {
  return path.join(SESSIONS_DIR, sessionId)
}

export function messagesPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'messages.jsonl')
}

function metaPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'meta.json')
}

// ============================================================================
// Message persistence
// ============================================================================

export function appendMessage(sessionId: string, message: StoredMessage): void {
  try {
    ensureDir(sessionDir(sessionId))
    const line = JSON.stringify(message) + '\n'
    fs.appendFileSync(messagesPath(sessionId), line, 'utf-8')
  } catch (err) {
    logger.error(`Failed to append message for ${sessionId}: ${err}`)
  }
}

export function getMessages(sessionId: string): StoredMessage[] {
  const file = messagesPath(sessionId)
  if (!fs.existsSync(file)) return []

  try {
    const content = fs.readFileSync(file, 'utf-8')
    const lines = content.trim().split('\n').filter(Boolean)
    return lines.map((line) => {
      try {
        return JSON.parse(line) as StoredMessage
      } catch {
        return null
      }
    }).filter(Boolean) as StoredMessage[]
  } catch (err) {
    logger.error(`Failed to read messages for ${sessionId}: ${err}`)
    return []
  }
}

// ============================================================================
// Session metadata
// ============================================================================

export function saveSessionMeta(meta: SessionMeta): void {
  try {
    ensureDir(sessionDir(meta.sessionId))
    fs.writeFileSync(metaPath(meta.sessionId), JSON.stringify(meta, null, 2), 'utf-8')
  } catch (err) {
    logger.error(`Failed to save meta for ${meta.sessionId}: ${err}`)
  }
}

export function getSessionMeta(sessionId: string): SessionMeta | null {
  const file = metaPath(sessionId)
  if (!fs.existsSync(file)) return null

  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf-8'))
    return data as SessionMeta
  } catch (err) {
    logger.error(`Failed to read meta for ${sessionId}: ${err}`)
    return null
  }
}

export function updateSessionLastActive(sessionId: string): void {
  const meta = getSessionMeta(sessionId)
  if (meta) {
    meta.lastActiveAt = Date.now()
    saveSessionMeta(meta)
  }
}

export function updateSessionTitle(sessionId: string, title: string): void {
  const meta = getSessionMeta(sessionId)
  if (meta) {
    meta.title = title
    saveSessionMeta(meta)
  }
}

export function updateSessionMessageCount(sessionId: string, count: number): void {
  const meta = getSessionMeta(sessionId)
  if (meta) {
    meta.messageCount = count
    saveSessionMeta(meta)
  }
}

// ============================================================================
// Session listing
// ============================================================================

export function listAllSessions(): SessionMeta[] {
  ensureDir(SESSIONS_DIR)
  const sessions: SessionMeta[] = []

  try {
    const entries = fs.readdirSync(SESSIONS_DIR, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const meta = getSessionMeta(entry.name)
      if (meta) {
        sessions.push(meta)
      }
    }
  } catch (err) {
    logger.error(`Failed to list sessions: ${err}`)
  }

  // Sort by lastActiveAt descending
  sessions.sort((a, b) => b.lastActiveAt - a.lastActiveAt)
  return sessions
}

export function deleteSessionData(sessionId: string): void {
  const dir = sessionDir(sessionId)
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
      logger.info(`Deleted session data: ${sessionId}`)
    } catch (err) {
      logger.error(`Failed to delete session ${sessionId}: ${err}`)
    }
  }
}

// ============================================================================
// Checkpoint persistence
// ============================================================================

export interface CheckpointEntry {
  messageUuid: string
  index: number
  userContent: string
  timestamp: number
}

function checkpointsPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'checkpoints.json')
}

export function appendCheckpoint(sessionId: string, entry: CheckpointEntry): void {
  try {
    const existing = getCheckpoints(sessionId)
    existing.push(entry)
    ensureDir(sessionDir(sessionId))
    fs.writeFileSync(checkpointsPath(sessionId), JSON.stringify(existing))
  } catch (err) {
    logger.error(`Failed to save checkpoint for ${sessionId}: ${err}`)
  }
}

export function getCheckpoints(sessionId: string): CheckpointEntry[] {
  const file = checkpointsPath(sessionId)
  if (!fs.existsSync(file)) return []
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'))
  } catch {
    return []
  }
}

function sdkSessionIdPath(sessionId: string): string {
  return path.join(sessionDir(sessionId), 'sdk-session-id.txt')
}

export function saveSdkSessionId(sessionId: string, sdkSid: string): void {
  try {
    ensureDir(sessionDir(sessionId))
    fs.writeFileSync(sdkSessionIdPath(sessionId), sdkSid, 'utf-8')
  } catch (err) {
    logger.error(`Failed to save SDK session ID: ${err}`)
  }
}

export function getSdkSessionId(sessionId: string): string | null {
  const file = sdkSessionIdPath(sessionId)
  if (!fs.existsSync(file)) return null
  try {
    return fs.readFileSync(file, 'utf-8').trim()
  } catch {
    return null
  }
}

/** Overwrite messages.jsonl while preserving other files in the session dir */
export function overwriteMessages(sessionId: string, messages: StoredMessage[]): void {
  const file = messagesPath(sessionId)
  ensureDir(sessionDir(sessionId))
  const content = messages.map(m => JSON.stringify(m)).join('\n') + '\n'
  try {
    fs.writeFileSync(file, content, 'utf-8')
  } catch (err) {
    logger.error(`Failed to overwrite messages for ${sessionId}: ${err}`)
  }
}
