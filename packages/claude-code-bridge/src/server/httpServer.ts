/**
 * HTTP Server
 *
 * Creates an Express HTTP server with WebSocket upgrade for client connections.
 * SDK communication now goes through stdin/stdout pipes (no more SDK WebSocket).
 */

import express from 'express'
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import type { Server } from 'node:http'
import { ClientWsHandler } from './wsHandler.js'
import { createApiRouter } from './restApi.js'
import type { SessionManager } from '../session/sessionManager.js'
import { logger } from '../utils/logger.js'

export interface HttpServerResult {
  server: Server
  port: number
  host: string
}

export async function createHttpServer(
  host: string,
  port: number,
  sessionManager: SessionManager,
): Promise<HttpServerResult> {
  const app = express()
  app.use(express.json())

  // CORS for VS Code Webview
  app.use((_req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*')
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    if (_req.method === 'OPTIONS') {
      res.sendStatus(200)
      return
    }
    next()
  })

  const api = createApiRouter(sessionManager)

  // REST API routes
  app.get('/api/settings/user', api.getUserSettings)
  app.put('/api/settings/user', api.updateUserSettings)
  app.get('/api/sessions', (req, res) => api.listSessions(req, res))
  app.post('/api/sessions', (req, res) => api.createSession(req, res))
  app.delete('/api/sessions/:sessionId', (req, res) => api.deleteSession(req, res))
  app.get('/api/sessions/:sessionId/messages', (req, res) => api.getMessages(req, res))
  app.get('/api/sessions/:sessionId/slash-commands', (req, res) =>
    api.getSlashCommands(req, res),
  )
  app.post('/api/sessions/:sessionId/branch', (req, res) => api.branchSession(req, res))
  app.post('/api/sessions/:sessionId/rewind', (req, res) => api.rewindSession(req, res))
  app.post('/api/sessions/:sessionId/rewind-files', (req, res) => api.rewindFiles(req, res))
  app.get('/api/sessions/:sessionId/turn-checkpoints', (req, res) => api.getTurnCheckpoints(req, res))
  app.get('/api/mcp', (req, res) => api.getMcpServers(req, res))
  app.post('/api/mcp', (req, res) => api.addMcpServer(req, res))
  app.post('/api/mcp/:name/toggle', (req, res) => api.toggleMcpServer(req, res))
  app.delete('/api/mcp/:name', (req, res) => api.removeMcpServer(req, res))
  app.get('/api/skills', (req, res) => api.getSkills(req, res))
  app.get('/api/skills/:name', (req, res) => api.getSkillDetail(req, res))
  app.post('/api/skills', (req, res) => api.createSkill(req, res))
  app.post('/api/skills/import', (req, res) => api.importSkills(req, res))
  app.post('/api/skills/:name/toggle', (req, res) => api.toggleSkill(req, res))
  app.delete('/api/skills/:name', (req, res) => api.deleteSkill(req, res))
  app.get('/api/agents', (req, res) => api.getAgents(req, res))
  app.get('/api/agents/:name', (req, res) => api.getAgentDetail(req, res))
  app.post('/api/agents', (req, res) => api.createAgent(req, res))
  app.delete('/api/agents/:name', (req, res) => api.deleteAgent(req, res))
  app.get('/api/health', api.health)

  // 404 handler
  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found' })
  })

  const server = createServer(app)

  // Client WebSocket handler (the only WS needed now)
  const clientWss = new WebSocketServer({ noServer: true })
  new ClientWsHandler(clientWss, sessionManager)

  // Single upgrade handler
  server.on('upgrade', (request, socket, head) => {
    const pathname = request.url || ''

    if (pathname.startsWith('/ws/')) {
      clientWss.handleUpgrade(request, socket, head, (ws) => {
        clientWss.emit('connection', ws, request)
      })
    } else {
      socket.destroy()
    }
  })

  // Start listening
  return new Promise((resolve, reject) => {
    server.listen(port, host, () => {
      const addr = server.address()
      if (addr && typeof addr !== 'string') {
        const actualPort = addr.port
        logger.info(`Bridge server listening at http://${host}:${actualPort}`)
        resolve({ server, port: actualPort, host })
      } else {
        reject(new Error('Failed to get server address'))
      }
    })

    server.on('error', reject)
  })
}
