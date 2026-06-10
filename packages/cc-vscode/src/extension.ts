/**
 * VS Code Extension Main Entry Point
 */

import * as vscode from 'vscode'
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

  // Status bar update on bridge state change
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

  // ─── Start Bridge ────────────────────────────────────────────
  try {
    const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
    channel.appendLine(`Starting bridge with workspace: ${workspaceDir}`)
    bridgeManager.setState('starting')
    await bridgeManager.start(workspaceDir)
    bridgeManager.setState('running')
    channel.appendLine(`Bridge started at ${bridgeManager.getBaseUrl()}`)
  } catch (err) {
    channel.appendLine(`Failed to start bridge: ${err}`)
    bridgeManager.setState('error')
    vscode.window.showErrorMessage(
      `Claude Code: Failed to start bridge server. Check Output > Claude Code for details.`,
    )
  }

  // ─── Commands ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand('cc-vscode.openChat', () => {
      if (!bridgeManager?.isRunning()) {
        vscode.window.showErrorMessage('Claude Code bridge server is not running.')
        return
      }
      createChatWebview(context, bridgeManager)
    }),
  )

  context.subscriptions.push(
    vscode.commands.registerCommand('cc-vscode.newSession', () => {
      if (!bridgeManager?.isRunning()) {
        vscode.window.showErrorMessage('Claude Code bridge server is not running.')
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
      bridgeManager?.setState('starting')
      try {
        await bridgeManager?.stop()
        const workspaceDir = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || process.cwd()
        await bridgeManager?.start(workspaceDir)
        bridgeManager?.setState('running')
        channel.appendLine('Bridge restarted')
        vscode.window.showInformationMessage('Claude Code bridge server restarted.')
      } catch (err) {
        channel.appendLine(`Failed to restart bridge: ${err}`)
        bridgeManager?.setState('error')
        vscode.window.showErrorMessage(
          `Claude Code: Failed to restart bridge. Check Output > Claude Code for details.`
        )
      }
    }),
  )

  channel.appendLine('Claude Code extension activated')
}

export async function deactivate() {
  if (bridgeManager) {
    await bridgeManager.stop()
  }
}
