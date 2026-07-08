// Persistent file logging for the launcher. Until now install failures surfaced only as a
// transient toast and the game's stdout/stderr went to the in-app console and vanished — so a
// user reporting "Fabric won't download" left nothing on disk to diagnose. This writes a plain
// text log to <userData>/logs/launcher.log (i.e. %APPDATA%\Beacon\logs on Windows) that a user
// can attach to a bug report. It never throws: logging must not be able to crash the app.

import { app } from 'electron'
import { join } from 'node:path'
import { createWriteStream, mkdirSync, existsSync, statSync, renameSync, type WriteStream } from 'node:fs'

const MAX_BYTES = 5 * 1024 * 1024 // rotate at 5 MB — one previous file is kept as launcher.old.log

let stream: WriteStream | null = null
let dir = ''
let file = ''

function ensure(): WriteStream {
  if (stream) return stream
  dir = join(app.getPath('userData'), 'logs')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  file = join(dir, 'launcher.log')
  // Roll the file over once it gets large so it can't grow unbounded across sessions.
  try {
    if (existsSync(file) && statSync(file).size > MAX_BYTES) renameSync(file, join(dir, 'launcher.old.log'))
  } catch {
    /* rotation is best-effort */
  }
  stream = createWriteStream(file, { flags: 'a' })
  stream.on('error', () => {
    // Disk full / permissions revoked mid-session: drop the stream so we stop trying to write to
    // a dead handle, and never surface the error.
    stream = null
  })
  return stream
}

type Level = 'INFO' | 'WARN' | 'ERROR'

function write(level: Level, scope: string, msg: string): void {
  const line = `${new Date().toISOString()} [${level}] [${scope}] ${msg}\n`
  try {
    ensure().write(line)
  } catch {
    /* never let logging throw */
  }
  // Mirror to the terminal in dev.
  if (level === 'ERROR') console.error(line.trimEnd())
  else console.log(line.trimEnd())
}

export const log = {
  info: (scope: string, msg: string): void => write('INFO', scope, msg),
  warn: (scope: string, msg: string): void => write('WARN', scope, msg),
  error: (scope: string, msg: string): void => write('ERROR', scope, msg),
  /** Append raw text that already carries its own newlines (game stdout/stderr). */
  raw: (text: string): void => {
    try {
      ensure().write(text)
    } catch {
      /* never let logging throw */
    }
  }
}

/** Absolute path to the logs directory (created on demand). Used to open it from Settings. */
export function logsDir(): string {
  ensure()
  return dir
}
