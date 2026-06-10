type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LOG_PREFIX = '[bridge]'

function log(level: LogLevel, message: string, ...args: unknown[]) {
  const timestamp = new Date().toISOString()
  const prefix = `${timestamp} ${LOG_PREFIX}[${level.toUpperCase()}]`
  switch (level) {
    case 'error':
      console.error(prefix, message, ...args)
      break
    case 'warn':
      console.warn(prefix, message, ...args)
      break
    case 'debug':
      console.debug(prefix, message, ...args)
      break
    default:
      console.log(prefix, message, ...args)
  }
}

export const logger = {
  debug: (msg: string, ...args: unknown[]) => log('debug', msg, ...args),
  info: (msg: string, ...args: unknown[]) => log('info', msg, ...args),
  warn: (msg: string, ...args: unknown[]) => log('warn', msg, ...args),
  error: (msg: string, ...args: unknown[]) => log('error', msg, ...args),
}
