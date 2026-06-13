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
      // Built-in Claude Code commands (pass-through to CLI)
      // Categorized by type: core, session, code, config, bundled-skills
      const builtins: Array<{ name: string; description: string; source: string }> = [
        // ── Core / Navigation ──
        { name: 'help', description: 'Show help and available commands', source: 'builtin' },
        { name: 'clear', description: 'Start a new conversation (old one stays in /resume)', source: 'builtin' },
        { name: 'exit', description: 'Exit the current session', source: 'builtin' },
        { name: 'quit', description: 'Alias for /exit', source: 'builtin' },
        { name: 'status', description: 'Show version, model, account, and connectivity', source: 'builtin' },
        { name: 'doctor', description: 'Diagnose Claude Code installation', source: 'builtin' },
        { name: 'login', description: 'Sign in to your Anthropic account', source: 'builtin' },
        { name: 'logout', description: 'Sign out from your Anthropic account', source: 'builtin' },
        // ── Session Management ──
        { name: 'btw', description: 'Ask a quick side question without adding to conversation', source: 'builtin' },
        { name: 'compact', description: 'Summarize conversation to free up context', source: 'builtin' },
        { name: 'context', description: 'Visualize context window usage', source: 'builtin' },
        { name: 'export', description: 'Export the current conversation as plain text', source: 'builtin' },
        { name: 'rename', description: 'Rename the current session', source: 'builtin' },
        { name: 'resume', description: 'Resume a previous conversation', source: 'builtin' },
        { name: 'continue', description: 'Alias for /resume', source: 'builtin' },
        { name: 'branch', description: 'Create a branch of the current conversation', source: 'builtin' },
        { name: 'rewind', description: 'Rewind conversation and/or code to previous point', source: 'builtin' },
        { name: 'checkpoint', description: 'Alias for /rewind', source: 'builtin' },
        { name: 'add-dir', description: 'Add a working directory for file access', source: 'builtin' },
        { name: 'cd', description: 'Move session to a new working directory', source: 'builtin' },
        { name: 'copy', description: 'Copy last assistant response to clipboard', source: 'builtin' },
        { name: 'recap', description: 'Generate a one-line summary of the current session', source: 'builtin' },
        { name: 'goal', description: 'Set a goal — Claude keeps working across turns until met', source: 'builtin' },
        { name: 'fast', description: 'Toggle fast mode on or off', source: 'builtin' },
        // ── Code / Review ──
        { name: 'review', description: 'Review a pull request locally', source: 'builtin' },
        { name: 'security-review', description: 'Analyze pending changes for security issues', source: 'builtin' },
        { name: 'diff', description: 'Open interactive diff viewer showing changes', source: 'builtin' },
        { name: 'code-review', description: 'Review diff for correctness and cleanups', source: 'builtin' },
        { name: 'pr-comments', description: 'View pull request comments (removed in CLI v2.1.91)', source: 'builtin' },
        { name: 'release-notes', description: 'View changelog in interactive version picker', source: 'builtin' },
        // ── Model / Effort ──
        { name: 'model', description: 'Switch the AI model', source: 'builtin' },
        { name: 'effort', description: 'Set the model effort level (low/medium/high/xhigh/max)', source: 'builtin' },
        { name: 'plan', description: 'Enter plan mode for designing before coding', source: 'builtin' },
        // ── Usage ──
        { name: 'usage', description: 'Show session cost, plan limits, and activity stats', source: 'builtin' },
        { name: 'stats', description: 'Alias for /usage', source: 'builtin' },
        { name: 'cost', description: 'Alias for /usage', source: 'builtin' },
        // ── Config / Settings ──
        { name: 'config', description: 'Open the Settings interface', source: 'builtin' },
        { name: 'settings', description: 'Alias for /config', source: 'builtin' },
        { name: 'permissions', description: 'Manage tool permission rules', source: 'builtin' },
        { name: 'allowed-tools', description: 'Alias for /permissions', source: 'builtin' },
        { name: 'memory', description: 'Edit CLAUDE.md memory files', source: 'builtin' },
        { name: 'init', description: 'Initialize project with a CLAUDE.md guide', source: 'builtin' },
        { name: 'hooks', description: 'View hook configurations for tool events', source: 'builtin' },
        { name: 'ide', description: 'Manage IDE integrations and show status', source: 'builtin' },
        // ── Agents / MCP / Skills ──
        { name: 'agents', description: 'Manage subagent configurations', source: 'builtin' },
        { name: 'mcp', description: 'Manage MCP server connections (reconnect/enable/disable)', source: 'builtin' },
        { name: 'skills', description: 'List available skills', source: 'builtin' },
        { name: 'tasks', description: 'View and manage background tasks', source: 'builtin' },
        { name: 'bashes', description: 'Alias for /tasks', source: 'builtin' },
        { name: 'workflows', description: 'Open workflow progress view', source: 'builtin' },
        { name: 'plugin', description: 'Manage Claude Code plugins (list/install/enable/disable)', source: 'builtin' },
        { name: 'reload-plugins', description: 'Reload all active plugins without restarting', source: 'builtin' },
        { name: 'reload-skills', description: 'Re-scan skill directories to pick up changes', source: 'builtin' },
        // ── Feedback ──
        { name: 'feedback', description: 'Submit feedback or report a bug', source: 'builtin' },
        { name: 'bug', description: 'Alias for /feedback', source: 'builtin' },
        { name: 'share', description: 'Alias for /feedback', source: 'builtin' },
        // ── Bundled Skills ──
        { name: 'batch', description: 'Orchestrate large-scale changes across a codebase in parallel', source: 'builtin' },
        { name: 'claude-api', description: 'Load Claude API reference material for your language', source: 'builtin' },
        { name: 'debug', description: 'Enable debug logging for this session', source: 'builtin' },
        { name: 'deep-research', description: 'Fan out web searches and synthesize a cited report', source: 'builtin' },
        { name: 'fewer-permission-prompts', description: 'Scan transcripts and add allowlist to reduce prompts', source: 'builtin' },
        { name: 'loop', description: 'Run a prompt on a recurring interval', source: 'builtin' },
        { name: 'proactive', description: 'Alias for /loop', source: 'builtin' },
        { name: 'run', description: 'Launch and drive your project app to verify changes', source: 'builtin' },
        { name: 'run-skill-generator', description: 'Teach /run and /verify how to launch your app', source: 'builtin' },
        { name: 'verify', description: 'Confirm a code change works by running the app', source: 'builtin' },
        { name: 'simplify', description: 'Review changed code for cleanup and apply fixes', source: 'builtin' },
        { name: 'schedule', description: 'Create or manage routines on cloud infrastructure', source: 'builtin' },
        { name: 'routines', description: 'Alias for /schedule', source: 'builtin' },
        { name: 'insights', description: 'Generate a report analyzing your Claude Code sessions', source: 'builtin' },
        { name: 'team-onboarding', description: 'Generate a team onboarding guide from your usage history', source: 'builtin' },
        { name: 'powerup', description: 'Discover Claude Code features through interactive lessons', source: 'builtin' },
        // ── Integrations ──
        { name: 'install-github-app', description: 'Set up Claude GitHub Actions for a repository', source: 'builtin' },
        { name: 'install-slack-app', description: 'Install the Claude Slack app', source: 'builtin' },
        { name: 'web-setup', description: 'Connect GitHub account to Claude Code on the web', source: 'builtin' },
        { name: 'setup-bedrock', description: 'Configure Amazon Bedrock authentication', source: 'builtin' },
        { name: 'setup-vertex', description: 'Configure Google Vertex AI authentication', source: 'builtin' },
        // ── Misc ──
        { name: 'fork', description: 'Spawn a background subagent that inherits the conversation', source: 'builtin' },
        { name: 'voice', description: 'Toggle voice dictation (hold/tap/off)', source: 'builtin' },
        { name: 'sandbox', description: 'Toggle sandbox mode (supported platforms only)', source: 'builtin' },
        { name: 'heapdump', description: 'Write a JS heap snapshot for diagnosing memory issues', source: 'builtin' },
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
