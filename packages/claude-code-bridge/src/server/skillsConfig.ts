/**
 * Skills Configuration
 *
 * Reads/writes skills as .claude/skills/{name}/SKILL.md files.
 * Skills are markdown files with YAML-like frontmatter.
 */

import * as fs from 'node:fs'
import * as path from 'node:path'
import { logger } from '../utils/logger.js'

export interface SkillInfo {
  name: string
  description: string
  modelInvocation: boolean
  enabled: boolean
  path: string
}

export interface SkillDetail extends SkillInfo {
  content: string
}

/**
 * Resolve skills directory from cwd or user home.
 */
function skillsDir(cwd: string, scope: 'project' | 'user' = 'project'): string {
  if (scope === 'user') {
    return path.join(process.env.HOME || process.env.USERPROFILE || '/tmp', '.claude', 'skills')
  }
  return path.join(cwd, '.claude', 'skills')
}

/**
 * Parse frontmatter from SKILL.md content.
 * Format:
 * ---
 * description: xxx
 * model-invocation: true/false
 * ---
 * markdown body...
 */
function parseFrontmatter(content: string): { description: string; modelInvocation: boolean; body: string } {
  const lines = content.split('\n')
  let description = ''
  let modelInvocation = true
  let body = content
  let inFrontmatter = false

  if (lines[0]?.trim() === '---') {
    inFrontmatter = true
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].trim() === '---') {
        body = lines.slice(i + 1).join('\n')
        break
      }
      const kv = lines[i].split(':')
      if (kv.length >= 2) {
        const key = kv[0].trim()
        const val = kv.slice(1).join(':').trim()
        if (key === 'description') description = val
        if (key === 'model-invocation') modelInvocation = val !== 'false'
      }
    }
  }

  return { description, modelInvocation, body }
}

/**
 * Build SKILL.md content from parts.
 */
function buildContent(description: string, modelInvocation: boolean, body: string): string {
  return `---
description: ${description}
model-invocation: ${modelInvocation}
---
${body}
`
}

/**
 * List all skills in .claude/skills/.
 */
type Scope = 'project' | 'user'

export function listSkills(cwd: string, scope: Scope = 'project'): SkillInfo[] {
  const dir = skillsDir(cwd, scope)
  if (!fs.existsSync(dir)) return []

  const skills: SkillInfo[] = []
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillPath = path.join(dir, entry.name, 'SKILL.md')
      const disabledPath = path.join(dir, entry.name, 'SKILL.md.disabled')
      const isDisabled = !fs.existsSync(skillPath) && fs.existsSync(disabledPath)
      const activePath = isDisabled ? disabledPath : skillPath
      if (!fs.existsSync(activePath)) continue
      let description = entry.name; let modelInvocation = true
      if (fs.existsSync(activePath)) {
        const content = fs.readFileSync(activePath, 'utf-8')
        const parsed = parseFrontmatter(content)
        description = parsed.description || entry.name
        modelInvocation = parsed.modelInvocation
      }
      skills.push({
        name: entry.name,
        description,
        modelInvocation,
        enabled: !isDisabled,
        path: activePath,
      })
    }
  } catch (err) {
    logger.error(`Failed to list skills at ${dir}: ${err}`)
  }
  return skills
}

/**
 * Get a single skill detail.
 */
export function getSkill(cwd: string, name: string, scope: Scope = 'project'): SkillDetail | null {
  const dir = skillsDir(cwd, scope)
  const skillPath = path.join(dir, name, 'SKILL.md')
  if (!fs.existsSync(skillPath)) return null

  try {
    const content = fs.readFileSync(skillPath, 'utf-8')
    const { description, modelInvocation, body } = parseFrontmatter(content)
    return { name, description, modelInvocation, enabled: true, content: body, path: skillPath }
  } catch (err) {
    logger.error(`Failed to read skill ${name}: ${err}`)
    return null
  }
}

/**
 * Create a new skill.
 */
export function createSkill(cwd: string, name: string, description: string, body: string, scope: Scope = 'project'): void {
  const dir = path.join(skillsDir(cwd, scope), name)
  const skillPath = path.join(dir, 'SKILL.md')

  if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
    throw new Error('Skill name must contain only letters, numbers, hyphens, and underscores')
  }

  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(skillPath, buildContent(description, true, body), 'utf-8')
  logger.info(`Skill created: ${name}`)
}

/**
 * Update an existing skill.
 */
export function updateSkill(cwd: string, name: string, description: string, body: string, modelInvocation = true, scope: Scope = 'project'): void {
  const skillPath = path.join(skillsDir(cwd, scope), name, 'SKILL.md')
  if (!fs.existsSync(skillPath)) {
    throw new Error(`Skill ${name} not found`)
  }
  fs.writeFileSync(skillPath, buildContent(description, modelInvocation, body), 'utf-8')
  logger.info(`Skill updated: ${name}`)
}

/**
 * Import skills from a source path.
 * Copies all SKILL.md directories to .claude/skills/.
 */
export function importSkills(cwd: string, sourcePath: string, scope: Scope = 'project'): number {
  const src = sourcePath
  if (!fs.existsSync(src)) {
    throw new Error(`Source path not found: ${src}`)
  }

  const destDir = skillsDir(cwd, scope)
  fs.mkdirSync(destDir, { recursive: true })
  let imported = 0

  // Walk source directory for SKILL.md files
  function walk(dir: string, basePath: string) {
    if (!fs.existsSync(dir)) return
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const subDir = path.join(dir, entry.name)
      const skillFile = path.join(subDir, 'SKILL.md')
      if (fs.existsSync(skillFile)) {
        const targetDir = path.join(destDir, entry.name)
        // Copy skill directory
        copyDirSync(subDir, targetDir)
        imported++
        logger.info(`Imported skill: ${entry.name}`)
      } else {
        // Recurse into subdirectories (e.g., skills/tilelang/writing-kernels/)
        walk(subDir, path.join(basePath, entry.name))
      }
    }
  }

  walk(src, '')
  return imported
}

function copyDirSync(src: string, dest: string) {
  fs.mkdirSync(dest, { recursive: true })
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

/**
 * Delete a skill.
 */
export function toggleSkill(cwd: string, name: string, scope: Scope = 'project'): boolean {
  const dir = path.join(skillsDir(cwd, scope), name)
  const skillPath = path.join(dir, 'SKILL.md')
  const disabledPath = path.join(dir, 'SKILL.md.disabled')

  if (fs.existsSync(skillPath)) {
    fs.renameSync(skillPath, disabledPath)
    return false // now disabled
  } else if (fs.existsSync(disabledPath)) {
    fs.renameSync(disabledPath, skillPath)
    return true // now enabled
  }
  throw new Error(`Skill ${name} not found`)
}

export function deleteSkill(cwd: string, name: string, scope: Scope = 'project'): void {
  const dir = path.join(skillsDir(cwd, scope), name)
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
    logger.info(`Skill deleted: ${name}`)
  }
}
