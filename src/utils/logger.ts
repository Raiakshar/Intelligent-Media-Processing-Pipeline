/**
 * Minimal structured logger. In a real production system this would be
 * swapped for pino/winston shipping to a log aggregator, but the JSON
 * shape here is intentionally compatible with that future swap:
 * every line is a single JSON object with level/msg/ts/...meta.
 */
type Level = 'debug' | 'info' | 'warn' | 'error';

function log(level: Level, msg: string, meta: Record<string, unknown> = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export const logger = {
  debug: (msg: string, meta?: Record<string, unknown>) => log('debug', msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => log('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => log('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => log('error', msg, meta),
};
