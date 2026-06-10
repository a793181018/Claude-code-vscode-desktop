/**
 * Session Branching & Rewind Utilities
 *
 * Fork: copies messages from source session up to a target message
 *       into a new session with a fresh sessionId.
 * Rewind: trims messages from target message onward in-place.
 */

import { randomUUID } from 'node:crypto'
import * as sessionStore from './sessionStore.js'
import type { StoredMessage } from './sessionStore.js'

/**
 * Create a new session by forking from a source session at a target message.
 * All messages up to (and including) the target are copied to the new session.
 */
export function forkSession(
  sourceSessionId: string,
  targetMessageIndex: number,
  title?: string,
): { sessionId: string; title: string } {
  const allMessages = sessionStore.getMessages(sourceSessionId)
  if (allMessages.length === 0) {
    throw new Error('Source session has no messages')
  }
  if (targetMessageIndex < 0 || targetMessageIndex >= allMessages.length) {
    throw new Error('Invalid target message index')
  }

  const newSessionId = randomUUID()
  const forkedTitle = title || `Session ${newSessionId.substring(0, 8)}`

  // Copy messages up to and including the target
  const copiedMessages = allMessages.slice(0, targetMessageIndex + 1)

  // Write to new session
  for (const msg of copiedMessages) {
    sessionStore.appendMessage(newSessionId, { ...msg })
  }

  // Save metadata for new session
  const sourceMeta = sessionStore.getSessionMeta(sourceSessionId)
  sessionStore.saveSessionMeta({
    sessionId: newSessionId,
    workDir: sourceMeta?.workDir || '.',
    title: forkedTitle,
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
    messageCount: copiedMessages.length,
  })

  return { sessionId: newSessionId, title: forkedTitle }
}

/**
 * Rewind a session by removing all messages from targetIndex onward.
 */
export function rewindSession(
  sessionId: string,
  targetMessageIndex: number,
): { messagesRemoved: number } {
  const allMessages = sessionStore.getMessages(sessionId)
  if (allMessages.length === 0) {
    throw new Error('Session has no messages')
  }
  if (targetMessageIndex < 0 || targetMessageIndex >= allMessages.length) {
    throw new Error('Invalid target message index')
  }

  const removedCount = allMessages.length - targetMessageIndex

  // Rewrite the messages file keeping only messages before targetIndex
  const keptMessages = allMessages.slice(0, targetMessageIndex)

  // Clear and rewrite
  const meta = sessionStore.getSessionMeta(sessionId)
  const workDir = meta?.workDir || '.'

  // Overwrite messages file (preserves checkpoints.json and sdk-session-id.txt)
  sessionStore.overwriteMessages(sessionId, keptMessages)

  // Re-save meta
  sessionStore.saveSessionMeta({
    sessionId,
    workDir,
    title: meta?.title,
    createdAt: meta?.createdAt || Date.now(),
    lastActiveAt: Date.now(),
    messageCount: keptMessages.length,
  })

  return { messagesRemoved: removedCount }
}

/**
 * List turn checkpoints in a session.
 * Returns indices into the messages array where the session can be branched/rewound.
 * A checkpoint = a user message that has at least one assistant/tool response.
 */
export interface TurnCheckpoint {
  index: number        // 0-based turn number (for file checkpoint matching)
  jsonlIndex: number   // line number in JSONL file (for rewind operations)
  messageId: string
  type: string
  content: string
}

export function listTurnCheckpoints(sessionId: string): TurnCheckpoint[] {
  const allMessages = sessionStore.getMessages(sessionId)
  const checkpoints: TurnCheckpoint[] = []
  let turnNum = 0

  for (let i = 0; i < allMessages.length; i++) {
    const msg = allMessages[i]
    if (msg.type !== 'user') continue

    // Check if this user message has at least one response after it
    let hasResponse = false
    for (let j = i + 1; j < allMessages.length; j++) {
      if (allMessages[j].type === 'user') break
      if (['assistant', 'tool_use', 'tool_result', 'thinking', 'error'].includes(allMessages[j].type)) {
        hasResponse = true
        break
      }
    }

    if (hasResponse) {
      checkpoints.push({
        index: turnNum,
        jsonlIndex: i,
        messageId: `msg-${msg.timestamp}`,
        type: msg.type,
        content: typeof msg.content === 'string' ? msg.content.substring(0, 200) : '',
      })
      turnNum++
    }
  }

  return checkpoints
}
