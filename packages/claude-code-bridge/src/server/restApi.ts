/**
 * REST API Handler
 *
 * Provides REST endpoints for the VS Code frontend:
 * - /api/settings/user (critical for app bootstrap)
 * - /api/sessions (CRUD with JSONL persistence)
 * - /api/sessions/:id/messages (message history from store)
 * - /api/health (health check)
 */

import * as path from 'node:path'
import type { Request, Response } from 'express'
import type { SessionManager } from '../session/sessionManager.js'
import * as sessionStore from '../session/sessionStore.js'
import { forkSession, rewindSession, listTurnCheckpoints } from '../session/sessionBranching.js'
import { logger } from '../utils/logger.js'

interface UserSettings {
  model: string
  permissionMode: string
  locale: string
}

const DEFAULT_SETTINGS: UserSettings = {
  model: 'claude-sonnet-4-20250514',
  permissionMode: 'bypassPermissions',
  locale: 'en',
}

let userSettings: UserSettings = { ...DEFAULT_SETTINGS }

export function createApiRouter(sessionManager: SessionManager) {
  return {
    // ─── Settings ────────────────────────────────────────────

    getUserSettings(_req: Request, res: Response): void {
      res.json(userSettings)
    },

    updateUserSettings(req: Request, res: Response): void {
      const updates = req.body || {}
      userSettings = { ...userSettings, ...updates }
      res.json(userSettings)
    },

    // ─── Sessions ────────────────────────────────────────────

    listSessions(_req: Request, res: Response): void {
      const sessions = sessionManager.listSessions()
      res.json({
        sessions: sessions.map((s) => ({
          sessionId: s.sessionId,
          workDir: s.workDir,
          title: s.title || `Session ${s.sessionId.substring(0, 8)}`,
          createdAt: s.createdAt,
        })),
        total: sessions.length,
      })
    },

    async createSession(req: Request, res: Response): Promise<void> {
      try {
        const workDir = path.resolve(req.body?.workDir || process.cwd())
        const info = await sessionManager.createSession(workDir, {
          permissionMode: userSettings.permissionMode,
          model: userSettings.model,
        })
        res.status(201).json(info)
      } catch (err) {
        logger.error('Failed to create session', err)
        res.status(500).json({
          error: 'Failed to create session',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },

    async deleteSession(req: Request, res: Response): Promise<void> {
      const sessionId = String(req.params.sessionId)
      await sessionManager.destroySession(sessionId)
      // Clean up stored data
      sessionStore.deleteSessionData(sessionId)
      res.json({ ok: true })
    },

    // ─── Messages ────────────────────────────────────────────

    getMessages(req: Request, res: Response): void {
      const sessionId = String(req.params.sessionId)
      const messages = sessionManager.getSessionMessages(sessionId)
      res.json({
        messages: messages.map((m) => ({
          id: `${m.timestamp}-${Math.random().toString(36).slice(2, 8)}`,
          type: mapStoredTypeToUIMessageType(m.type),
          content: m.content,
          toolName: m.toolName,
          toolUseId: m.toolUseId,
          isError: m.isError,
          timestamp: m.timestamp,
        })),
        taskNotifications: [],
      })
    },

    // ─── Slash Commands ──────────────────────────────────────

    getSlashCommands(_req: Request, res: Response): void {
      res.json({
        commands: [
          { name: 'help', description: 'Get help with Claude Code' },
          { name: 'clear', description: 'Clear the conversation' },
          { name: 'compact', description: 'Compact the conversation context' },
          { name: 'cost', description: 'Show token usage and cost' },
        ],
      })
    },

    // ─── Branch / Fork ──────────────────────────────────────

    branchSession(req: Request, res: Response): void {
      try {
        const sourceSessionId = String(req.params.sessionId)
        const targetMessageIndex = Number(req.body?.targetMessageIndex)
        const title = req.body?.title?.trim() || undefined

        if (isNaN(targetMessageIndex)) {
          res.status(400).json({ error: 'targetMessageIndex is required' })
          return
        }

        const result = forkSession(sourceSessionId, targetMessageIndex, title)
        res.status(201).json({
          sessionId: result.sessionId,
          title: result.title,
          sourceSessionId,
          targetMessageIndex,
        })
      } catch (err) {
        logger.error('Failed to branch session', err)
        res.status(500).json({
          error: 'Failed to branch session',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },

    // ─── Rewind ──────────────────────────────────────────────

    rewindSession(req: Request, res: Response): void {
      try {
        const sessionId = String(req.params.sessionId)
        const messages = sessionStore.getMessages(sessionId)
        let targetIndex = -1

        // Try content matching first (more reliable)
        const content = req.body?.messageContent?.trim()
        if (content) {
          targetIndex = messages.findIndex(
            (m) => m.type === 'user' && typeof m.content === 'string' && m.content.trim() === content
          )
        }

        // Fall back to direct index
        if (targetIndex < 0 && req.body?.fallbackIndex !== undefined) {
          targetIndex = Number(req.body.fallbackIndex)
        }

        if (targetIndex < 0 || targetIndex >= messages.length) {
          res.status(400).json({ error: 'Valid target not found', totalMessages: messages.length })
          return
        }

        const result = rewindSession(sessionId, targetIndex)
        res.json({ ok: true, messagesRemoved: result.messagesRemoved })
      } catch (err) {
        logger.error('Failed to rewind session', err)
        res.status(500).json({
          error: 'Failed to rewind session',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },

    // ─── Rewind Files ───────────────────────────────────────

    async rewindFiles(req: Request, res: Response): Promise<void> {
      try {
        const sessionId = String(req.params.sessionId)
        const checkpointUuid = req.body?.checkpointUuid
        if (typeof checkpointUuid !== 'string' || !checkpointUuid) {
          res.status(400).json({ error: 'checkpointUuid is required' })
          return
        }
        await sessionManager.rewindFiles(sessionId, checkpointUuid)
        res.json({ ok: true })
      } catch (err) {
        logger.error('Failed to rewind files', err)
        res.status(500).json({
          error: 'Failed to rewind files',
          message: err instanceof Error ? err.message : String(err),
        })
      }
    },

    // ─── Turn Checkpoints ────────────────────────────────────

    getTurnCheckpoints(req: Request, res: Response): void {
      try {
        const sessionId = String(req.params.sessionId)
        const fileCheckpoints = sessionManager.getCheckpoints(sessionId)
        const msgCheckpoints = listTurnCheckpoints(sessionId)

        // Merge file checkpoints with message checkpoints by index
        const results = msgCheckpoints.map((cp) => {
          const fileCp = fileCheckpoints.find((f: any) => f.index === cp.index)
          return { ...cp, checkpointUuid: fileCp?.messageUuid || null, rewindIndex: cp.jsonlIndex }
        })

        res.json({ checkpoints: results })
      } catch (err) {
        logger.error('Failed to get turn checkpoints', err)
        res.status(500).json({ error: 'Failed to get checkpoints' })
      }
    },

    // ─── Health ──────────────────────────────────────────────

    health(_req: Request, res: Response): void {
      res.json({
        ok: true,
        uptime: process.uptime(),
        sessions: sessionManager.listSessions().length,
      })
    },
  }
}

function mapStoredTypeToUIMessageType(type: string): string {
  switch (type) {
    case 'user': return 'user_text'
    case 'assistant': return 'assistant_text'
    case 'thinking': return 'thinking'
    case 'tool_use': return 'tool_use'
    case 'tool_result': return 'tool_result'
    case 'error': return 'error'
    case 'system': return 'system'
    default: return 'system'
  }
}
