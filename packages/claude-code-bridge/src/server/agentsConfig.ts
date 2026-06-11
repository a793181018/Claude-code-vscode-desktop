/**
 * Agents Configuration
 *
 * Reads/writes agent definitions from .claude/agents.json.
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
}

export interface AgentsConfig {
  agents: Record<string, AgentDefinition>
}

/**
 * Load agents config from .claude/agents.json, searching upward from cwd.
 */
export function loadAgentsConfig(cwd: string): AgentsConfig {
  const result: AgentsConfig = { agents: {} }

  // Check user home .claude/agents.json first
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'
  const homeAgentsPath = path.join(home, '.claude', 'agents.json')
  if (fs.existsSync(homeAgentsPath)) {
    try {
      const content = JSON.parse(fs.readFileSync(homeAgentsPath, 'utf-8'))
      if (content.agents) Object.assign(result.agents, content.agents)
    } catch (err) { logger.warn(`Failed to parse ${homeAgentsPath}: ${err}`) }
  }

  // Then check project .claude/agents.json, searching upward from cwd
  for (const dir of getParentDirs(cwd)) {
    const filePath = path.join(dir, '.claude', 'agents.json')
    if (fs.existsSync(filePath)) {
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (content.agents) Object.assign(result.agents, content.agents)
      } catch (err) { logger.warn(`Failed to parse ${filePath}: ${err}`) }
    }
  }
  return result
}

export function listAgents(cwd: string): Array<{ name: string; description: string; tools: string[]; model: string }> {
  const config = loadAgentsConfig(cwd)
  return Object.entries(config.agents).map(([name, def]) => ({
    name,
    description: def.description || name,
    tools: def.tools || [],
    model: def.model || 'inherit',
  }))
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
  addAgent(cwd, name, def) // same logic
}

export function deleteAgent(cwd: string, name: string): void {
  const home = process.env.HOME || process.env.USERPROFILE || '/tmp'

  // Check home .claude/agents.json first
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

  // Then check project .claude/agents.json
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
