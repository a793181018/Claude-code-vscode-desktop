#!/usr/bin/env node

/**
 * claude-code-bridge startup script
 *
 * Usage: claude-code-bridge [--port PORT] [--host HOST]
 *
 * The bridge starts and writes its port to stdout as JSON.
 * The VS Code extension reads this to discover the bridge URL.
 */

import { createBridge } from '../dist/index.js'

async function main() {
  const args = process.argv.slice(2)
  let port = 0
  let host = '127.0.0.1'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--port' && i + 1 < args.length) {
      port = parseInt(args[++i], 10)
    } else if (args[i] === '--host' && i + 1 < args.length) {
      host = args[++i]
    }
  }

  await createBridge({ host, port })
}

main().catch((err) => {
  console.error('Failed to start bridge:', err)
  process.exit(1)
})
