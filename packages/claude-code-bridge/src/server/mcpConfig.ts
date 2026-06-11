/**
 * MCP Server Configuration
 *
 * Reads/writes MCP server config from .mcp.json in the project root.
 * Used by the bridge REST API for management and passed to Agent SDK query().
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../utils/logger.js'

export interface McpServerEntry {
  name: string
  command: string
  args: string[]
  url?: string
  env?: Record<string, string>
  enabled?: boolean
}

export interface McpConfig {
  mcpServers: Record<string, {
    command?: string
    args?: string[]
    env?: Record<string, string>
    disabled?: boolean
    url?: string
    headers?: Record<string, string>
  }>
}

/**
 * Load MCP config from .mcp.json in the given directory.
 * Searches upward from cwd to find .mcp.json files.
 */
export function loadMcpConfig(cwd: string): McpConfig {
  const result: McpConfig = { mcpServers: {} }
  const dirs = getParentDirs(cwd)

  for (const dir of dirs) {
    const filePath = path.join(dir, '.mcp.json')
    if (fs.existsSync(filePath)) {
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (content.mcpServers) {
          Object.assign(result.mcpServers, content.mcpServers)
        }
      } catch (err) {
        logger.warn(`Failed to parse ${filePath}: ${err}`)
      }
    }
  }

  return result
}

/**
 * Save MCP config to .mcp.json.
 * Merges with existing config at the target directory.
 */
export function saveMcpConfig(cwd: string, config: McpConfig): void {
  const filePath = path.join(cwd, '.mcp.json')
  const existing: McpConfig = { mcpServers: {} }

  if (fs.existsSync(filePath)) {
    try {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      if (content.mcpServers) existing.mcpServers = content.mcpServers
    } catch { /* overwrite on parse error */ }
  }

  existing.mcpServers = { ...existing.mcpServers, ...config.mcpServers }
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8')
  logger.info(`MCP config saved to ${filePath}`)
}

/**
 * List MCP servers as a flat array.
 */
export function listMcpServers(cwd: string): Array<{ name: string; command: string; args: string[]; url?: string; disabled?: boolean }> {
  const config = loadMcpConfig(cwd)
  return Object.entries(config.mcpServers).map(([name, cfg]) => ({
    name,
    command: cfg.command || '',
    args: cfg.args || [],
    url: cfg.url,
    disabled: cfg.disabled || false,
  }))
}

/**
 * Add or update an MCP server.
 */
export function addMcpServer(cwd: string, server: McpServerEntry): void {
  const config = loadMcpConfig(cwd)
  const entry: any = { args: server.args || [], disabled: server.enabled === false }
  if (server.url) {
    entry.url = server.url
    entry.type = 'sse'
  } else {
    entry.command = server.command
    entry.env = server.env
  }
  config.mcpServers[server.name] = entry
  saveMcpConfig(cwd, config)
}

/**
 * Remove an MCP server.
 */
export function removeMcpServer(cwd: string, name: string): void {
  // Walk parent dirs and remove from the first .mcp.json that contains the server
  const dirs = getParentDirs(cwd)
  for (const dir of dirs) {
    const filePath = path.join(dir, '.mcp.json')
    if (fs.existsSync(filePath)) {
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (content.mcpServers?.[name]) {
          delete content.mcpServers[name]
          fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8')
          logger.info(`Removed MCP server ${name} from ${filePath}`)
          return
        }
      } catch (err) {
        logger.warn(`Failed to parse ${filePath}: ${err}`)
      }
    }
  }
}

export function toggleMcpServer(cwd: string, name: string): boolean {
  const dirs = getParentDirs(cwd)
  for (const dir of dirs) {
    const filePath = path.join(dir, '.mcp.json')
    if (fs.existsSync(filePath)) {
      try {
        const content = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
        if (content.mcpServers?.[name]) {
          const current = content.mcpServers[name].disabled || false
          content.mcpServers[name].disabled = !current
          fs.writeFileSync(filePath, JSON.stringify(content, null, 2), 'utf-8')
          return !current // return new state
        }
      } catch (err) { logger.warn(`Failed to toggle MCP ${name}: ${err}`) }
    }
  }
  throw new Error(`MCP server ${name} not found`)
}

function getParentDirs(dir: string): string[] {
  const dirs: string[] = []
  let current = path.resolve(dir)
  while (current !== path.dirname(current)) {
    dirs.push(current)
    current = path.dirname(current)
  }
  return dirs
}
