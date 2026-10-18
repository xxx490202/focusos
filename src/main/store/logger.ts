// ============================================================
//  logger.ts — 统一日志，禁止散落 console.log
// ============================================================
type Level = 'debug' | 'info' | 'warn' | 'error'

const isDev = process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV === '1'

function emit(level: Level, scope: string, args: unknown[]): void {
  const prefix = `[FocusOS:${scope}]`
  const stamp = new Date().toISOString().slice(11, 23)
  const line = `${stamp} ${level.toUpperCase().padEnd(5)} ${prefix}`
  const target = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  target(line, ...args)
}

function create(scope: string) {
  return {
    debug: (...args: unknown[]) => {
      if (isDev) emit('debug', scope, args)
    },
    info: (...args: unknown[]) => emit('info', scope, args),
    warn: (...args: unknown[]) => emit('warn', scope, args),
    error: (...args: unknown[]) => emit('error', scope, args)
  }
}

export const logger = create('app')

export function scopedLogger(scope: string) {
  return create(scope)
}
