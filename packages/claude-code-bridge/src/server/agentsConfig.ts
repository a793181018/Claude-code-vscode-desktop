/**
 * Agents Configuration
 *
 * Reads/writes agent definitions from .claude/agents.json.
 * Includes built-in agents that ship with the extension (can be disabled/removed).
 * Agents are subagents that Claude can invoke via the Agent tool.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../utils/logger.js'

export interface AgentDefinition {
  description: string
  prompt: string
  tools?: string[]
  skills?: string[]
  model?: string
  maxTurns?: number
  background?: boolean
  permissionMode?: string
  effort?: string
  /** User set this to true to disable the agent */
  disabled?: boolean
  /** 'builtin' | 'user' | 'project' — where this agent was defined */
  source?: string
}

export interface AgentsConfig {
  agents: Record<string, AgentDefinition>
}

// ============================================================================
// Built-in agents — shipped with the extension, can be disabled by user
// ============================================================================

const BUILTIN_AGENTS: Record<string, AgentDefinition> = {
  'general-purpose': {
    description: 'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks.',
    prompt: 'You are a file search and codebase exploration specialist. You have access to all tools. When searching:\n- Use Glob for pattern-based file search\n- Use Grep for content search with regex\n- Use Read when you know the exact file path\n- Report findings concisely with file paths and line numbers\n- Never create documentation files unless explicitly requested\n- If a search returns too many results, refine your pattern\n- Prefer multiple targeted searches over one broad search',
    source: 'builtin',
  },
  Explore: {
    description: "Fast agent specialized for exploring codebases. Use when you need to quickly find files by patterns or search code for keywords. Specify thoroughness level: 'quick' for basic searches, 'medium' for moderate exploration, or 'very thorough' for comprehensive analysis.",
    prompt: "You are a code exploration specialist. STRICT RULES: You CANNOT create, modify, or delete any files. You are READ-ONLY.\n\nYour process:\n1. Use Glob to find files by pattern\n2. Use Grep to search file contents with regex\n3. Use Read to examine specific files\n4. Report findings clearly with paths and line numbers\n\nBased on the requested thoroughness level:\n- 'quick': one search strategy, 2-3 files read\n- 'medium': two complementary strategies, reading key files\n- 'very thorough': multiple strategies across naming conventions, comprehensive analysis",
    tools: ['Glob', 'Grep', 'Read'],
    model: 'haiku',
    source: 'builtin',
  },
  Plan: {
    description: 'Software architect agent for designing implementation plans. Use when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
    prompt: 'You are a software architect and planning specialist. STRICT RULES: You CANNOT create, modify, or delete any files. You are READ-ONLY.\n\nYour process:\n1. Understand the requirements fully\n2. Explore the codebase using Glob, Grep, and Read to understand existing patterns\n3. Design a solution using established patterns from the codebase\n4. Consider architectural trade-offs (performance, maintainability, complexity)\n5. Produce a step-by-step implementation strategy\n\nYour output must include:\n- Critical files that need to be modified\n- Step-by-step implementation order\n- Architectural trade-offs considered\n- Potential risks and mitigations',
    tools: ['Glob', 'Grep', 'Read'],
    model: 'inherit',
    source: 'builtin',
  },
  verification: {
    description: 'Verify that implementation work is correct before reporting completion. Invoke after non-trivial tasks (3+ file edits, backend/API changes, infrastructure changes).',
    prompt: 'CRITICAL: This is a VERIFICATION-ONLY task. You CANNOT edit, write, or create files.\n\nYou are an adversarial verifier. Your job is to try to break the implementation:\n\n1. BUILD VERIFICATION: Run the build system\n2. TEST VERIFICATION: Run the test suite, look for regressions\n3. LINT VERIFICATION: Run linters and formatters\n4. REGRESSION CHECK: Verify existing functionality still works\n5. EDGE CASES: Test boundary values, concurrency, idempotency\n\nYou MUST end with: VERDICT: PASS or VERDICT: FAIL or VERDICT: PARTIAL\n\nDO NOT be satisfied with partial success. If anything is broken, report VERDICT: FAIL with evidence.',
    tools: ['Bash', 'Read', 'Glob', 'Grep'],
    model: 'inherit',
    background: true,
    source: 'builtin',
  },
  'statusline-setup': {
    description: "Configure the user's Claude Code status line setting.",
    prompt: "You configure Claude Code status lines. The status line shows git branch, file count, and other context.\n\nAvailable variables: {branch}, {files}, {behind}, {ahead}, {model}, {cost}\n\nTo set: Edit ~/.claude/settings.json, add 'statusLine' field with a format string.\nExample: { branch: 'main' } [{files} files] | Claude",
    tools: ['Read', 'Edit'],
    source: 'builtin',
  },
  'claude-code-guide': {
    description: 'Answer questions about Claude Code features, hooks, slash commands, MCP servers, settings, IDE integrations, keyboard shortcuts, the Claude Agent SDK, or Claude API usage.',
    prompt: "You answer questions about Claude Code (the CLI tool), the Claude Agent SDK, and the Claude API.\n\nReference documentation:\n- Claude Code docs: https://code.claude.com/docs/en/claude_code_docs_map.md\n- Claude API docs: https://platform.claude.com/llms.txt\n\nUse WebFetch to read documentation pages when needed. Provide specific answers with examples.",
    tools: ['Glob', 'Grep', 'Read', 'WebFetch', 'WebSearch'],
    model: 'haiku',
    source: 'builtin',
  },
}

// ============================================================================
// Load / List / CRUD
// ============================================================================

/**
 * Load agents config — merges built-ins (lowest priority), user home, and project.
 * Agents with `disabled: true` are excluded from the result.
 */
export function loadAgentsConfig(cwd: string): AgentsConfig {
  const result: AgentsConfig = { agents: {} }

  // 1. Built-in agents (lowest priority)
  for (const [name, def] of Object.entries(BUILTIN_AGENTS)) {
    result.agents[name] = { ...def }
  }

  // 2. User home .claude/agents.json (overrides built-ins)
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
  const homeAgentsPath = path.join(home, '.claude', 'agents.json')
  if (fs.existsSync(homeAgentsPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(homeAgentsPath, 'utf-8'))
      if (content.agents) {
        for (const [name, def] of Object.entries<any>(content.agents)) {
          if (def.disabled) {
            delete result.agents[name]
          } else {
            result.agents[name] = { ...result.agents[name], ...def, source: 'user' }
          }
        }
      }
    } catch (err) { logger.warn(`Failed to parse ${homeAgentsPath}: ${err}`) }
  }

  // 3. Project .claude/agents.json (highest priority)
  for (const dir of getParentDirs(cwd)) {
    const filePath = path.join(dir, '.claude', 'agents.json')
    if (fs.existsSync(filePath)) {
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (content.agents) {
          for (const [name, def] of Object.entries<any>(content.agents)) {
            if (def.disabled) {
              delete result.agents[name]
            } else {
              result.agents[name] = { ...result.agents[name], ...def, source: 'project' }
            }
          }
        }
      } catch (err) { logger.warn(`Failed to parse ${filePath}: ${err}`) }
    }
  }

  // Remove source field from final output (internal only)
  for (const name of Object.keys(result.agents)) {
    delete result.agents[name].source
  }

  return result
}

export function listAgents(cwd: string): Array<{ name: string; description: string; tools: string[]; model: string; source: string }> {
  // We need source info for the UI, so load raw
  const result: Array<{ name: string; description: string; tools: string[]; model: string; source: string }> = []

  // Built-ins
  for (const [name, def] of Object.entries(BUILTIN_AGENTS)) {
    result.push({ name, description: def.description, tools: def.tools || [], model: def.model || 'inherit', source: 'builtin' })
  }

  // Apply user overrides/disables
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
  const homeAgentsPath = path.join(home, '.claude', 'agents.json')
  const userDisabled = new Set<string>()
  const userOverrides: Record<string, any> = {}
  if (fs.existsSync(homeAgentsPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(homeAgentsPath, 'utf-8'))
      if (content.agents) {
        for (const [name, def] of Object.entries<any>(content.agents)) {
          if (def.disabled) {
            userDisabled.add(name)
          } else {
            userOverrides[name] = def
          }
        }
      }
    } catch { /* ignore */ }
  }

  // Apply project overrides/disables
  const projectDisabled = new Set<string>()
  const projectOverrides: Record<string, any> = {}
  for (const dir of getParentDirs(cwd)) {
    const filePath = path.join(dir, '.claude', 'agents.json')
    if (fs.existsSync(filePath)) {
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (content.agents) {
          for (const [name, def] of Object.entries<any>(content.agents)) {
            if (def.disabled) {
              projectDisabled.add(name)
            } else {
              projectOverrides[name] = def
            }
          }
        }
      } catch { /* ignore */ }
    }
  }

  // Apply overrides and disables
  const finalResult: typeof result = []
  for (const entry of result) {
    if (userDisabled.has(entry.name) || projectDisabled.has(entry.name)) continue
    if (projectOverrides[entry.name]) {
      const d = projectOverrides[entry.name]
      entry.description = d.description || entry.description
      entry.tools = d.tools || entry.tools
      entry.model = d.model || entry.model
      entry.source = 'project'
    } else if (userOverrides[entry.name]) {
      const d = userOverrides[entry.name]
      entry.description = d.description || entry.description
      entry.tools = d.tools || entry.tools
      entry.model = d.model || entry.model
      entry.source = 'user'
    }
    finalResult.push(entry)
  }

  // Add non-builtin user agents
  for (const [name, def] of Object.entries(userOverrides)) {
    if (!finalResult.find(e => e.name === name)) {
      finalResult.push({ name, description: def.description, tools: def.tools || [], model: def.model || 'inherit', source: 'user' })
    }
  }

  // Add non-builtin project agents
  for (const [name, def] of Object.entries(projectOverrides)) {
    if (!finalResult.find(e => e.name === name)) {
      finalResult.push({ name, description: def.description, tools: def.tools || [], model: def.model || 'inherit', source: 'project' })
    }
  }

  return finalResult
}

export function getAgent(cwd: string, name: string): AgentDefinition | null {
  const config = loadAgentsConfig(cwd)
  return config.agents[name] || null
}

export function addAgent(cwd: string, name: string, def: AgentDefinition): void {
  if (!/^[a-zA-Z0-9_-]+$/.test(name)) throw new Error('Agent name must be alphanumeric')
  const filePath = path.join(cwd, '.claude', 'agents.json')
  ensureDir(path.dirname(filePath))
  const config = fs.existsSync(filePath) ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) : { agents: {} }
  config.agents[name] = { description: def.description, prompt: def.prompt, ...def.tools?.length ? { tools: def.tools } : {}, ...def.skills?.length ? { skills: def.skills } : {}, ...def.model ? { model: def.model } : {}, ...def.maxTurns ? { maxTurns: def.maxTurns } : {} }
  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
}

export function updateAgent(cwd: string, name: string, def: AgentDefinition): void {
  addAgent(cwd, name, def)
}

/**
 * Disable an agent by writing `disabled: true` to the user config.
 * Works for both built-in and user-defined agents.
 */
export function disableAgent(cwd: string, name: string): void {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
  const agentsPath = path.join(home, '.claude', 'agents.json')
  ensureDir(path.dirname(agentsPath))
  const config = fs.existsSync(agentsPath) ? JSON.parse(fs.readFileSync(agentsPath, 'utf-8')) : { agents: {} }
  config.agents[name] = { ...(config.agents[name] || {}), disabled: true }
  fs.writeFileSync(agentsPath, JSON.stringify(config, null, 2), 'utf-8')
}

export function deleteAgent(cwd: string, name: string): void {
  // First check if it's a built-in — if so, just disable it
  if (BUILTIN_AGENTS[name]) {
    disableAgent(cwd, name)
    return
  }

  // Otherwise delete from file
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
  const homeAgentsPath = path.join(home, '.claude', 'agents.json')
  if (fs.existsSync(homeAgentsPath)) {
    try {
      const config = JSON.parse(fs.readFileSync(homeAgentsPath, 'utf-8'))
      if (config.agents?.[name]) {
        delete config.agents[name]
        fs.writeFileSync(homeAgentsPath, JSON.stringify(config, null, 2), 'utf-8')
        return
      }
    } catch (err) { logger.warn(`Failed to update ${homeAgentsPath}: ${err}`) }
  }

  for (const dir of getParentDirs(cwd)) {
    const filePath = path.join(dir, '.claude', 'agents.json')
    if (fs.existsSync(filePath)) {
      try {
        const config = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (config.agents?.[name]) {
          delete config.agents[name]
          fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8')
          return
        }
      } catch (err) { logger.warn(`Failed to update ${filePath}: ${err}`) }
    }
  }
}

function ensureDir(dir: string) { if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true }) }

function getParentDirs(dir: string): string[] {
  const dirs: string[] = []
  let current = path.resolve(dir)
  while (current !== path.dirname(current)) { dirs.push(current); current = path.dirname(current) }
  return dirs
}
