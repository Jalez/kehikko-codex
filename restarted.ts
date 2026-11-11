import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { placedGuardsSchema, type PlacedGuard } from 'kehikot-module-protocol'

/**
 * A session that outlived a restart of Kehikot (or of this module) and the tools it lost.
 *
 * When Kehikot restarts, the host and every module go away for a while. A session that keeps
 * running through it has its MCP servers drop. A Codex session this module started is a child of
 * its process and ends with it (it is resumed, with fresh doors, when its place is next opened), so
 * this is the rarer case here: a session that kept running while Kehikot went away and came back.
 * Codex (0.166.0) re-initialises a streamable-HTTP server that answers a call with "session expired"
 * (404), but does not start again one that failed or closed, and has no command that reconnects
 * one (`/mcp` lists, `/mcp login` signs in): the tools can stay gone, and an agent that no longer
 * sees the work queue's tool tends to run the heavy command itself. So at the session's first prompt
 * after this module started again, it is told once (`restartNote` in workQueue.ts): the tools may be
 * gone, the shell path that does the same — the run line of the work queue the host names, when there
 * is one — and how the person brings them back where the CLI has a way (`RECONNECT` in context.ts: Codex has none).
 *
 * "Since its last prompt" is a marker beside what the session was told (`restartedSince`): this
 * process's start, written at every prompt. Another start's marker means this module restarted in
 * between, and so its door, and Kehikot's, were away.
 */

/** This process's start, as a session's marker names it. */
export const BOOT = `${process.pid}-${Date.now()}`

/**
 * Whether this module started again since the session's last prompt — true once per restart — and
 * the marker brought level. A session never marked before is not told: it was started by this
 * process, or by a release before the marker. Never throws.
 */
export function restartedSince(file: string, boot = BOOT): boolean {
  let before: string | null = null
  try {
    before = readFileSync(file, 'utf8').trim() || null
  } catch {
    /* Never marked. */
  }
  if (before === boot) return false
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, boot, { mode: 0o600 })
    renameSync(temporary, file)
  } catch {
    /* Not marked: told again at the next prompt, which is better than never. */
  }
  return before !== null
}

/**
 * Kehikot's stable address for module `id` (`http://127.0.0.1:<host port>/m/<id>`), read from a
 * session's doors: the host writes them there when its stable addresses are on, and that address
 * follows the module to whatever port it bound after a restart. Null when no door is written that
 * way (the addresses are off, or an older host): the hooks then ask the registration and the origin.
 */
export function stableAddress(doors: readonly { url: string }[], id: string): string | null {
  for (const door of doors) {
    try {
      const url = new URL(door.url)
      if (url.protocol === 'http:' && url.hostname === '127.0.0.1' && /^\/m\/[^/]+\//.test(url.pathname)) return `${url.origin}/m/${id}`
    } catch {
      /* Not an address. */
    }
  }
  return null
}

/**
 * The guards last handed for a session, kept on disk beside what it was told, so a module that
 * restarted while the host is still away does not take "no answer" for "no guards". Read back as
 * old (`at: 0`): the host is asked first, and these are used only when it does not answer. Never throws.
 */
export function writeKeptGuards(file: string, guards: readonly PlacedGuard[]): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(guards), { mode: 0o600 })
    renameSync(temporary, file)
  } catch {
    /* Kept in memory only. */
  }
}

export function readKeptGuards(file: string): { at: number; guards: PlacedGuard[] } | null {
  try {
    const guards = placedGuardsSchema.parse(JSON.parse(readFileSync(file, 'utf8'))) as PlacedGuard[]
    return { at: 0, guards }
  } catch {
    return null
  }
}
