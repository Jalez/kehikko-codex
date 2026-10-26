import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { sessionsRoot } from '../program.ts'

/**
 * Codex records, written where Codex 0.164.0 writes them — `$CODEX_HOME/sessions/YYYY/MM/DD/
 * rollout-<time>-<id>.jsonl`, the scratch one of test/setup.ts — in the shapes it writes (see
 * program.ts and cutoff.ts), with everything but the shape taken out.
 */
export const T0 = Date.parse('2026-10-21T17:30:00.000Z')
const iso = (at: number) => new Date(at).toISOString()

const DAY = '2026/10/21'
let written = 0

/** Where a session's record is now, or a new name for one (each write is a new file: the module keeps what a file's first row says). */
export function rolloutPath(id: string, fresh = false): string {
  const dir = join(sessionsRoot(), ...DAY.split('/'))
  if (!fresh) {
    const found = existsSync(dir) ? readdirSync(dir).find((one) => one.endsWith(`-${id}.jsonl`)) : undefined
    if (found) return join(dir, found)
  }
  written += 1
  return join(dir, `rollout-2026-10-21T17-30-${String(written).padStart(4, '0')}-${id}.jsonl`)
}

/** A session's record: its meta row (`cwd`), then `rows`. `when` sets its time. */
export function writeRollout(id: string, cwd: string, rows: string[] = [], when?: string | number): string {
  removeRollout(id)
  const file = rolloutPath(id, true)
  mkdirSync(join(file, '..'), { recursive: true })
  const meta = JSON.stringify({ timestamp: iso(T0), type: 'session_meta', payload: { id, cwd, source: 'cli', thread_source: 'user', base_instructions: 'You are Codex.' } })
  writeFileSync(file, `${[meta, ...rows].join('\n')}\n`)
  if (when !== undefined) utimesSync(file, new Date(when), new Date(when))
  return file
}

export function removeRollout(id: string): void {
  const dir = join(sessionsRoot(), ...DAY.split('/'))
  if (!existsSync(dir)) return
  for (const one of readdirSync(dir)) if (one.endsWith(`-${id}.jsonl`)) rmSync(join(dir, one), { force: true })
}

/** A prompt the person typed, as Codex notes it. */
export const typed = (at: number, text = 'carry on') => JSON.stringify({ timestamp: iso(at), type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text }] } } })
export const started = (at: number) => JSON.stringify({ timestamp: iso(at), type: 'event_msg', payload: { type: 'task_started', turn_attribution: { turn_trigger: 'user' } } })
export const completed = (at: number) => JSON.stringify({ timestamp: iso(at), type: 'event_msg', payload: { type: 'task_complete' } })
export const counted = (at: number, total: number) => JSON.stringify({ timestamp: iso(at), type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: total - 20, cached_input_tokens: 0, output_tokens: 20, total_tokens: total }, model_context_window: 258_400 } } })
