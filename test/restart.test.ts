import { afterAll, beforeEach, describe, expect, test } from 'bun:test'
import { randomUUID } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { answer } from '../doors.ts'
import { RESUME_LINE, Runs, TICKET, headless, type Pty, type Run, type Viewer } from '../live.ts'
import { PROGRAM, type Active, type Program, type Recorded } from '../program.ts'
import { born, markSession, readPlaces, readSettings, writeSettings, type NamedPlace } from '../record.ts'
import { DEFAULTS } from '../settings.ts'
import { resumeToggle } from '../src/view/conversations.ts'
import { completed, started, typed, writeRollout } from './transcripts.ts'

/**
 * What a restart cut off. A Codex session started here is a child of this module's process (its
 * hooks and doors are per-run settings, which keep it off Codex's shared background server), so a
 * restart of the module ends it; the next open of its place resumes it by id. A conversation the
 * module saw working when it went is said in the Inbox, and — unless the person turned it off —
 * told what happened when it is next opened.
 */

let A = randomUUID()
let C = randomUUID()
beforeEach(() => {
  A = randomUUID()
  C = randomUUID()
})
const HERE: NamedPlace = { epic: 'thesis', parts: ['methods'], kehikko: { key: '4072c9e5' }, kehikkoName: 'writing' }

const made: string[] = []
const project = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-restart-')))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

class FakePty implements Pty {
  pid = 0
  killed = false
  private exited: (exit: { exitCode: number }) => void = () => {}
  constructor(readonly file: string, readonly args: string[]) {}
  onData() {}
  onExit(heard: (exit: { exitCode: number }) => void) {
    this.exited = heard
  }
  write() {}
  resize() {}
  kill() {
    if (this.killed) return
    this.killed = true
    this.exited({ exitCode: 129 })
  }
}

class Watcher implements Viewer {
  said: Record<string, unknown>[] = []
  closed: { code: number; reason: string } | null = null
  output() {}
  say(message: Record<string, unknown>) {
    this.said.push(message)
  }
  close(code: number, reason: string) {
    this.closed = { code, reason }
  }
}

const settle = () => new Promise((done) => setTimeout(done, 25))

/** The program's machine: what is recorded and what runs survive every `Runs` (a module process) made over it. */
function machine() {
  const running = new Map<string, Active>()
  const held = new Map<string, Recorded[]>()
  return {
    running,
    records: (projectPath: string, id: string) => held.set(projectPath, [...(held.get(projectPath) ?? []).filter((one) => one.id !== id), { id, label: '', lastActive: Date.now(), next: [] }]),
    module() {
      const ptys: FakePty[] = []
      const logged: string[] = []
      const program: Program = {
        ...PROGRAM,
        find: () => ({ file: '/fake/bin/codex', looked: [], usual: [] }),
        supports: async () => ({ ok: true, missing: null, tells: false, lists: true, names: false, configures: false, plugins: false, backgrounds: false }),
        active: async () => ({ known: true, active: [...running.values()] }),
        settled: async (projectPath, id) => (held.get(projectPath)?.some((one) => one.id === id) ? id : null),
        sessions: async (projectPath) => held.get(projectPath) ?? [],
        environment: () => ({ PATH: '/bin' }),
      }
      const runs = new Runs({
        program,
        grace: 60_000,
        heldWait: 0,
        every: null,
        watchEvery: null,
        log: (line) => logged.push(line),
        screen: headless,
        spawn: (file, args) => {
          const pty = new FakePty(file, args)
          ptys.push(pty)
          return pty
        },
      })
      return { runs, ptys, logged }
    },
  }
}

const open = (projectPath: string, session: string | null) => ({ what: 'session' as const, projectPath, place: HERE, session, cols: 100, rows: 30 })
const isRun = (opened: unknown): opened is Run => typeof opened === 'object' && opened !== null && 'pty' in opened
const entryOf = (dir: string, id: string) => {
  const read = readPlaces(dir)
  if (!read.ok) throw new Error(read.error)
  return read.value.sessions[id]
}
/** Seen working by a module that then went away, and the Codex process with it. */
const wasWorking = (dir: string, id: string) =>
  markSession(dir, id, (one) => {
    one.working = new Date().toISOString()
    return true
  })

describe('a conversation a restart cut off mid-turn', () => {
  test('is said in the Inbox, and told what happened — once — when its place is next opened', async () => {
    const m = machine()
    const dir = project()
    m.records(dir, A)
    born(dir, HERE, A, null, { label: 'tighten the methods' })
    wasWorking(dir, A)

    const second = m.module()
    second.runs.know(dir)
    await second.runs.recovered(dir)
    expect(entryOf(dir, A)?.working).toBeUndefined()
    expect(entryOf(dir, A)?.resumeLine).toBe(true)
    const row = second.runs.activity(dir).find((one) => one.id === `cut-off:${A}`)
    expect(row).toMatchObject({ state: 'attention', label: 'tighten the methods: its turn was cut off when Kehikot restarted', place: { epic: 'thesis', parts: ['methods'], kehikko: '4072c9e5' } })
    /* Nothing is started by itself: Codex has no background to wake it in. */
    expect(second.ptys).toHaveLength(0)

    /* The person opens it: resumed with this module's one sentence, and the line goes. */
    const run = await second.runs.open(open(dir, A), new Watcher())
    expect(isRun(run)).toBe(true)
    expect(second.ptys[0]!.args).toEqual(['resume', A, RESUME_LINE])
    expect(entryOf(dir, A)?.resumeLine).toBeUndefined()
    expect(second.runs.activity(dir).some((one) => one.id === `cut-off:${A}`)).toBe(false)

    /* Once: opened again, it is resumed as any other. */
    second.ptys[0]!.kill()
    await settle()
    await second.runs.open(open(dir, A), new Watcher())
    expect(second.ptys[1]!.args).toEqual(['resume', A])
  })

  test('not told when the person turned the setting off: the Inbox line says it, and opening it is a plain resume', async () => {
    const m = machine()
    const dir = project()
    m.records(dir, A)
    born(dir, HERE, A, null)
    wasWorking(dir, A)
    writeSettings(dir, { ...DEFAULTS, resumeCutOff: false })
    const second = m.module()
    second.runs.know(dir)
    await second.runs.recovered(dir)
    expect(entryOf(dir, A)?.working).toBeUndefined()
    expect(entryOf(dir, A)?.resumeLine).toBeUndefined()
    expect(second.runs.activity(dir).some((one) => one.id === `cut-off:${A}`)).toBe(true)
    await second.runs.open(open(dir, A), new Watcher())
    expect(second.ptys[0]!.args).toEqual(['resume', A])
    expect(second.runs.activity(dir).some((one) => one.id === `cut-off:${A}`)).toBe(false)
  })

  test('never one the person ended, nor one still open in a process', async () => {
    const m = machine()
    const dir = project()
    m.records(dir, A)
    m.records(dir, C)
    born(dir, HERE, A, null)
    born(dir, HERE, C, null)
    const first = m.module()
    await first.runs.open(open(dir, A), new Watcher())
    wasWorking(dir, A)
    first.runs.end(A)
    await settle()
    wasWorking(dir, C)
    m.running.set(C, { session: C, kind: 'interactive', called: 'a Codex process', handle: null, pid: 77, cwd: dir, startedAt: null, name: '' })
    const second = m.module()
    second.runs.know(dir)
    await second.runs.recovered(dir)
    expect(entryOf(dir, A)?.resumeLine).toBeUndefined()
    expect(entryOf(dir, C)?.resumeLine).toBeUndefined()
    expect(second.runs.activity(dir).filter((one) => one.id.startsWith('cut-off:'))).toEqual([])
  })

  test('one recorded before the mark is judged by its transcript: a turn under way was cut off, an ended one was not', async () => {
    const m = machine()
    const dir = project()
    m.records(dir, A)
    m.records(dir, C)
    born(dir, HERE, A, null)
    born(dir, HERE, C, null)
    const now = Date.now()
    writeRollout(A, dir, [started(now - 60_000), typed(now - 60_000)])
    writeRollout(C, dir, [started(now - 60_000), typed(now - 60_000), completed(now - 50_000)])
    const one = m.module()
    one.runs.know(dir)
    await one.runs.recovered(dir)
    expect(entryOf(dir, A)?.resumeLine).toBe(true)
    expect(entryOf(dir, C)?.resumeLine).toBeUndefined()
  })
})

describe('the setting "Resume conversations cut off by a restart"', () => {
  test('on unless a person turned it off, and drawn as a toggle no agent can press', () => {
    const dir = project()
    expect(readSettings(dir)).toEqual(DEFAULTS)
    writeSettings(dir, { ...DEFAULTS, resumeCutOff: false })
    expect(readSettings(dir).resumeCutOff).toBe(false)
    expect(resumeToggle(false)).toEqual([{ kind: 'toggle', id: 'resume-cut-off', label: 'Resume conversations cut off by a restart', icon: 'refresh', checked: false }])
    expect(resumeToggle(true)[0]).not.toHaveProperty('agents')
    expect(resumeToggle(null)).toEqual([])
  })

  test('its door is the page’s: without the ticket nothing is read or changed', async () => {
    const dir = project()
    const query = new URLSearchParams({ projectPath: dir })
    expect((await answer('GET', '/api/settings', query, null, null))?.status).toBe(403)
    expect((await answer('POST', '/api/settings', new URLSearchParams(), { projectPath: dir, resumeCutOff: false }, null))?.status).toBe(403)
    expect(readSettings(dir).resumeCutOff).toBe(true)
    const changed = await answer('POST', '/api/settings', new URLSearchParams(), { projectPath: dir, resumeCutOff: false }, TICKET)
    expect(changed?.body).toMatchObject({ ok: true, settings: { resumeCutOff: false } })
    expect((await answer('GET', '/api/settings', query, null, TICKET))?.body).toMatchObject({ ok: true, settings: { resumeCutOff: false } })
    expect((await answer('POST', '/api/settings', new URLSearchParams(), { projectPath: dir, resumeCutOff: 'no' }, TICKET))?.status).toBe(400)
  })
})
