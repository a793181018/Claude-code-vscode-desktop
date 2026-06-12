/**
 * VS Code Extension Main Entry Point
 */

import * as vscode from 'vscode'
import * as cp from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { BridgeManager } from './bridge/bridgeManager.js'
import { createChatWebview } from './webview/createWebview.js'

let bridgeManager: BridgeManager | null = null
let statusBarItem: vscode.StatusBarItem | null = null

export async function activate(context: vscode.ExtensionContext) {
  const channel = vscode.window.createOutputChannel('Claude Code', { log: true })
  channel.appendLine('Claude Code extension activating...')

  // ─── Status Bar ──────────────────────────────────────────────
  statusBarItem = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    100,
  )
  statusBarItem.command = 'cc-vscode.openChat'
  statusBarItem.text = '$(comment-discussion) Claude Code'
  statusBarItem.tooltip = 'Open Claude Code Chat'
  statusBarItem.show()
  context.subscriptions.push(statusBarItem)

  // ─── Bridge Manager ──────────────────────────────────────────
  bridgeManager = new BridgeManager(channel, context.extensionUri)

  bridgeManager.onStateChange((state) => {
    if (statusBarItem) {
      switch (state) {
        case 'starting':
          statusBarItem.text = '$(sync~spin) Claude Code Starting...'
          statusBarItem.tooltip = 'Bridge server is starting'
          break
        case 'running':
          statusBarItem.text = '$(comment-discussion) Claude Code'
          statusBarItem.tooltip = `Bridge running at ${bridgeManager?.getBaseUrl()}`
          break
        case 'error':
          statusBarItem.text = '$(error) Claude Code Error'
          statusBarItem.tooltip = 'Bridge server error — click to restart'
          statusBarItem.command = 'cc-vscode.restartBridge'
          break
        case 'stopped':
          statusBarItem.text = '$(circle-slash) Claude Code Stopped'
          statusBarItem.tooltip = 'Bridge server stopped — click to restart'
          statusBarItem.command = 'cc-vscode.restartBridge'
          break
      }
    }
  })

  // ─── Install Dependencies Command ─────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('cc-vscode.installDeps', async () => {
      const extDir = context.extensionUri.fsPath
      channel.appendLine('Installing dependencies...')
      channel.show()

      const result = await runNpmInstall(extDir, channel)
      if (result) {
        channel.appendLine('Dependencies installed successfully. Restarting bridge...')
        await startBridge(channel)
      } else {
        channel.appendLine('Failed to install dependencies.')
        vscode.window.showErrorMessage(
          'Failed to install dependencies. Please run "npm install" manually in the extension directory.'
        )
      }
    }),
  )

  // ─── Start Bridge ────────────────────────────────────────────
  await startBridge(channel)

  // ─── Commands ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('cc-vscode.openChat', () => {
      if (!bridgeManager?.isRunning()) {
        promptBridgeNotRunning(channel, context)
        return
      }
      createChatWebview(context, bridgeManager)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('cc-vscode.newSession', () => {
      if (!bridgeManager?.isRunning()) {
        promptBridgeNotRunning(channel, context)
        return
      }
      createChatWebview(context, bridgeManager, { newSession: true })
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('cc-vscode.stopBridge', async () => {
      await bridgeManager?.stop()
      bridgeManager?.setState('stopped')
      vscode.window.showInformationMessage('Claude Code bridge server stopped.')
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('cc-vscode.restartBridge', async () => {
      channel.appendLine('Restarting bridge...')
      await startBridge(channel)
    }),
  )

  channel.appendLine('Claude Code extension activated')
}

function getClaudeEnv(): Record<string, string> {
  const config = vscode.workspace.getConfiguration('claudeCode')
  const env: Record<string, string> = {}

  const mapping: Record<string, string> = {
    baseUrl: 'ANTHROPIC_BASE_URL',
    authToken: 'ANTHROPIC_AUTH_TOKEN',
    model: 'ANTHROPIC_MODEL',
    defaultOpusModel: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    defaultSonnetModel: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    defaultHaikuModel: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    subagentModel: 'CLAUDE_CODE_SUBAGENT_MODEL',
    effortLevel: 'CLAUDE_CODE_EFFORT_LEVEL',
  }

  for (const [setting, envVar] of Object.entries(mapping)) {
    const val = config.get<string>(setting)
    if (val) env[envVar] = val
  }

  // Merge additional env vars
  const extraEnv = config.get<Record<string, string>>('extraEnv') || {}
  Object.assign(env, extraEnv)

  // Also set ANTHROPIC_API_KEY from ANTHROPIC_AUTH_TOKEN if auth token is provided
  // (many Claude Code components check ANTHROPIC_API_KEY specifically)
  if (env.ANTHROPIC_AUTH_TOKEN) {
    // Set apiKeyDummy to avoid triggering login checks that require stored credentials
    env.ANTHROPIC_API_KEY = env.ANTHROPIC_AUTH_TOKEN
  }

  return env
}

async function startBridge(channel: vscode.OutputChannel): Promise<void> {
  if (!bridgeManager) return

  bridgeManager.setState('starting')
  try {
    await bridgeManager?.stop()
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    const claudeEnv = getClaudeEnv()
    channel.appendLine(`Starting bridge with workspace: ${workspaceDir}`)
    if (Object.keys(claudeEnv).length > 0) {
      channel.appendLine(`Claude Code env: ${Object.keys(claudeEnv).join(', ')}`)
    }
    await bridgeManager.start(workspaceDir, claudeEnv)
    bridgeManager.setState('running')
    channel.appendLine(`Bridge started at ${bridgeManager.getBaseUrl()}`)
    vscode.window.showInformationMessage('Claude Code bridge server started.')
  } catch (err: any) {
    channel.appendLine(`Failed to start bridge: ${err}`)

    // Check if it's a missing SDK dependency
    const errMsg = err?.message || String(err)
    if (errMsg.includes('Cannot find package') || errMsg.includes('Cannot find module')) {
      showInstallDepsPrompt(channel)
    } else {
      bridgeManager?.setState('error')
      vscode.window.showErrorMessage(
        'Claude Code: Failed to start bridge server. Check Output > Claude Code for details.',
      )
    }
  }
}

function showInstallDepsPrompt(channel: vscode.OutputChannel): void {
  bridgeManager?.setState('error')
  channel.appendLine(
    'SDK dependency not found. Run "Install Dependencies" or run "npm install" in the extension directory.',
  )
  vscode.window
    .showErrorMessage(
      'Claude Code: Dependencies not installed. Click "Install" to set up automatically.',
      'Install',
    )
    .then((choice) => {
      if (choice === 'Install') {
        vscode.commands.executeCommand('cc-vscode.installDeps')
      }
    })
}

function promptBridgeNotRunning(
  channel: vscode.OutputChannel,
  context: vscode.ExtensionContext,
): void {
  vscode.window
    .showErrorMessage(
      'Claude Code bridge server is not running.',
      'Retry',
      'Install Dependencies',
    )
    .then((choice) => {
      if (choice === 'Retry') {
        startBridge(channel)
      } else if (choice === 'Install Dependencies') {
        vscode.commands.executeCommand('cc-vscode.installDeps')
      }
    })
}

/** Find npm binary: prefer the one alongside Node.js, then PATH fallback */
function findNpm(): string {
  const isWin = process.platform === 'win32'
  const npmName = isWin ? 'npm.cmd' : 'npm'

  // Try alongside the Node.js binary (standalone install)
  if (isWin && process.env.ProgramFiles) {
    const candidate = path.join(process.env.ProgramFiles, 'nodejs', npmName)
    if (fs.existsSync(candidate)) return candidate
  }
  // Try nvm-windows
  const home = process.env.HOME || process.env.USERPROFILE || ''
  const nvmCandidate = path.join(home, 'AppData', 'Roaming', 'nvm-windows', npmName)
  if (fs.existsSync(nvmCandidate)) return nvmCandidate

  return npmName // fallback to PATH
}

function runNpmInstall(cwd: string, channel: vscode.OutputChannel): Promise<boolean> {
  return new Promise((resolve) => {
    const npmBin = findNpm()
    channel.appendLine(`Using npm: ${npmBin}`)

    const proc = cp.spawn(npmBin, ['install', '--omit=dev', '--no-package-lock'], {
      cwd,
      shell: true,
    })

    proc.stdout?.on('data', (d: Buffer) => channel.append(d.toString()))
    proc.stderr?.on('data', (d: Buffer) => channel.append(d.toString()))

    proc.on('close', (code) => {
      resolve(code === 0)
    })

    proc.on('error', (err) => {
      channel.appendLine(`npm install error: ${err.message}`)
      resolve(false)
    })

    // Timeout after 120 seconds
    setTimeout(() => {
      proc.kill()
      resolve(false)
    }, 120_000)
  })
}

export async function deactivate() {
  if (bridgeManager) {
    await bridgeManager.stop()
  }
}
