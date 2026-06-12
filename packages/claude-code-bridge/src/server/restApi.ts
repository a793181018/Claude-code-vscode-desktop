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
import { listMcpServers, addMcpServer, removeMcpServer, toggleMcpServer } from './mcpConfig.js'
import { listSkills, getSkill, createSkill, deleteSkill, importSkills, toggleSkill } from './skillsConfig.js'
import { listAgents, getAgent, addAgent, deleteAgent } from './agentsConfig.js'
import { logger } from '../utils/logger.js'

interface UserSettings {
  model: string
  permissionMode: string
  locale: string
}

const DEFAULT_SETTINGS: UserSettings = {
  model: '', // empty = use SDK default from env (ANTHROPIC_MODEL)
  permissionMode: 'bypassPermissions',
  locale: 'en',
}

let userSettings: UserSettings = { ...DEFAULT_SETTINGS }

export function createApiRouter(sessionManager: SessionManager) {
  function resolveSlashCommandsCwd(req: Request): string {
    const sessionId = String(req.params.sessionId || '')
    if (sessionId) {
      const info = sessionManager.getSessionInfo(sessionId)
      if (info?.workDir) return info.workDir
    }
    return String(req.query.cwd || process.cwd())
  }

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
          title: req.body?.title?.trim() || undefined,
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

    getSlashCommands(req: Request, res: Response): void {
      // Built-in Claude Code commands
      const builtins: Array<{ name: string; description: string; source: string }> = [
        { name: 'help', description: 'Get help with Claude Code', source: 'builtin' },
        { name: 'clear', description: 'Clear the conversation', source: 'builtin' },
        { name: 'compact', description: 'Compact the conversation context', source: 'builtin' },
        { name: 'cost', description: 'Show token usage and cost', source: 'builtin' },
        { name: 'review', description: 'Review code changes', source: 'builtin' },
        { name: 'security-review', description: 'Security review of changes', source: 'builtin' },
        { name: 'context', description: 'Show context usage', source: 'builtin' },
        { name: 'doctor', description: 'Diagnose Claude Code issues', source: 'builtin' },
        { name: 'pr-comments', description: 'Review PR comments', source: 'builtin' },
        { name: 'release-notes', description: 'Generate release notes', source: 'builtin' },
        { name: 'init', description: 'Initialize project setup', source: 'builtin' },
        { name: 'login', description: 'Log in to Anthropic', source: 'builtin' },
        { name: 'logout', description: 'Log out', source: 'builtin' },
        { name: 'status', description: 'Show session status', source: 'builtin' },
        { name: 'add-dir', description: 'Add a directory to context', source: 'builtin' },
        { name: 'memory', description: 'Edit memory', source: 'builtin' },
      ]

      // Load user-defined skills as slash commands
      const skillCommands: Array<{ name: string; description: string; source: string }> = []
      try {
        const cwd = resolveSlashCommandsCwd(req)
        for (const scope of ['project', 'user'] as const) {
          const skills = listSkills(cwd, scope)
          for (const skill of skills) {
            if (skill.enabled) {
              skillCommands.push({
                name: skill.name,
                description: skill.description,
                source: `skill:${scope}`,
              })
            }
          }
        }
      } catch (err) {
        logger.warn(`Failed to load skills for slash commands: ${err}`)
      }

      res.json({
        commands: [...builtins, ...skillCommands],
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

    // ─── MCP Servers ─────────────────────────────────────────

    getMcpServers(req: Request, res: Response): void {
      try {
        const cwd = (req.query.cwd as string) || process.cwd()
        const servers = listMcpServers(cwd)
        res.json({ servers })
      } catch (err) {
        logger.error('Failed to list MCP servers', err)
        res.status(500).json({ error: 'Failed to list MCP servers' })
      }
    },

    addMcpServer(req: Request, res: Response): void {
      try {
        const cwd = req.body?.cwd || process.cwd()
        addMcpServer(cwd, {
          name: req.body.name,
          command: req.body.command || '',
          args: req.body.args || [],
          url: req.body.url || undefined,
          enabled: req.body.enabled !== false,
        })
        res.status(201).json({ ok: true })
      } catch (err) {
        logger.error('Failed to add MCP server', err)
        res.status(500).json({ error: 'Failed to add MCP server', message: err instanceof Error ? err.message : String(err) })
      }
    },

    toggleMcpServer(req: Request, res: Response): void {
      try {
        const cwd = (req.query.cwd as string) || process.cwd()
        const name = String(req.params.name)
        const enabled = toggleMcpServer(cwd, name)
        res.json({ ok: true, enabled })
      } catch (err) {
        logger.error('Failed to toggle MCP server', err)
        res.status(500).json({ error: 'Failed to toggle MCP server' })
      }
    },

    removeMcpServer(req: Request, res: Response): void {
      try {
        const cwd = req.query.cwd as string || process.cwd()
        const name = String(req.params.name)
        removeMcpServer(cwd, name)
        res.json({ ok: true })
      } catch (err) {
        logger.error('Failed to remove MCP server', err)
        res.status(500).json({ error: 'Failed to remove MCP server' })
      }
    },

    // ─── Agents ─────────────────────────────────────────────

    getAgents(req: Request, res: Response): void {
      try {
        const cwd = (req.query.cwd as string) || process.cwd()
        res.json({ agents: listAgents(cwd) })
      } catch (err) { logger.error('Failed to list agents', err); res.status(500).json({ error: 'Failed to list agents' }) }
    },

    getAgentDetail(req: Request, res: Response): void {
      try {
        const cwd = (req.query.cwd as string) || process.cwd()
        const agent = getAgent(cwd, String(req.params.name))
        if (!agent) { res.status(404).json({ error: 'Agent not found' }); return }
        res.json(agent)
      } catch (err) { logger.error('Failed to get agent', err); res.status(500).json({ error: 'Failed to get agent' }) }
    },

    createAgent(req: Request, res: Response): void {
      try {
        const cwd = req.body?.cwd || process.cwd()
        addAgent(cwd, req.body.name, { description: req.body.description, prompt: req.body.prompt, tools: req.body.tools, skills: req.body.skills, model: req.body.model, maxTurns: req.body.maxTurns })
        res.status(201).json({ ok: true })
      } catch (err) { logger.error('Failed to create agent', err); res.status(500).json({ error: 'Failed to create agent', message: err instanceof Error ? err.message : String(err) }) }
    },

    deleteAgent(req: Request, res: Response): void {
      try {
        const cwd = req.query.cwd as string || process.cwd()
        deleteAgent(cwd, String(req.params.name))
        res.json({ ok: true })
      } catch (err) { logger.error('Failed to delete agent', err); res.status(500).json({ error: 'Failed to delete agent' }) }
    },

    // ─── Skills ─────────────────────────────────────────────

    getSkills(req: Request, res: Response): void {
      try {
        const cwd = (req.query.cwd as string) || process.cwd()
        const scope = (req.query.scope as string) === 'user' ? 'user' : 'project'
        const skills = listSkills(cwd, scope)
        res.json({ skills })
      } catch (err) {
        logger.error('Failed to list skills', err)
        res.status(500).json({ error: 'Failed to list skills' })
      }
    },

    getSkillDetail(req: Request, res: Response): void {
      try {
        const cwd = (req.query.cwd as string) || process.cwd()
        const skill = getSkill(cwd, String(req.params.name))
        if (!skill) { res.status(404).json({ error: 'Skill not found' }); return }
        res.json(skill)
      } catch (err) {
        logger.error('Failed to get skill', err)
        res.status(500).json({ error: 'Failed to get skill' })
      }
    },

    createSkill(req: Request, res: Response): void {
      try {
        const cwd = req.body?.cwd || process.cwd()
        const scope = req.body?.scope === 'user' ? 'user' : 'project'
        createSkill(cwd, req.body.name, req.body.description || '', req.body.content || '', scope as 'project'|'user')
        res.status(201).json({ ok: true })
      } catch (err) {
        logger.error('Failed to create skill', err)
        res.status(500).json({ error: 'Failed to create skill', message: err instanceof Error ? err.message : String(err) })
      }
    },

    importSkills(req: Request, res: Response): void {
      try {
        const cwd = req.body?.cwd || process.cwd()
        const sourcePath = req.body?.sourcePath
        if (!sourcePath || typeof sourcePath !== 'string') {
          res.status(400).json({ error: 'sourcePath is required' })
          return
        }
        const scope = req.body?.scope === 'user' ? 'user' : 'project'
        const count = importSkills(cwd, sourcePath, scope as 'project'|'user')
        res.json({ ok: true, imported: count })
      } catch (err) {
        logger.error('Failed to import skills', err)
        res.status(500).json({ error: 'Failed to import skills', message: err instanceof Error ? err.message : String(err) })
      }
    },

    toggleSkill(req: Request, res: Response): void {
      try {
        const cwd = req.query.cwd as string || process.cwd()
        const scope = (req.query.scope as string) === 'user' ? 'user' : 'project'
        const enabled = toggleSkill(cwd, String(req.params.name), scope as 'project'|'user')
        res.json({ ok: true, enabled })
      } catch (err) {
        logger.error('Failed to toggle skill', err)
        res.status(500).json({ error: 'Failed to toggle skill' })
      }
    },

    deleteSkill(req: Request, res: Response): void {
      try {
        const cwd = req.query.cwd as string || process.cwd()
        const scope = (req.query.scope as string) === 'user' ? 'user' : 'project'
        deleteSkill(cwd, String(req.params.name), scope as 'project'|'user')
        res.json({ ok: true })
      } catch (err) {
        logger.error('Failed to delete skill', err)
        res.status(500).json({ error: 'Failed to delete skill' })
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
