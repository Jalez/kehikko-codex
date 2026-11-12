import { afterAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { AGENT_TASKS, CONVERSATIONS_FINDER, HOST_CALLER, SERVICE_CALLER_HEADER, SERVICE_PASS_HEADER, agentTaskView, conversationsBringResult, conversationsFindResult, serviceDescriptor } from 'kehikot-module-protocol'

import { BRING_PATH, FIND_PATH, START_PATH, answerHost, bringConversation, findConversations, names, placeTo, startConversation, type HostNeeds } from '../hostServices.ts'
import { CLOSED, Runs, TICKET, headless, opening, type Pty, type Run, type Viewer } from '../live.ts'
import { MANIFEST } from '../manifest.ts'
import { placeKey } from '../place.ts'
import { PROGRAM, promptArg, type Program, type Recorded } from '../program.ts'
import { assign, homeOf, ignore, readPlaces } from '../record.ts'
import { removeRollout, rolloutPath, typed } from './transcripts.ts'

/**
 * The services the host asks of this module (protocol 2.88.0): `find` from fake Codex records in the
 * scratch `CODEX_HOME` (test/setup.ts), `bring` over the project's own record, `start` with a
 * stand-in pty, and every route refused to anything the host did not vouch for.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const E = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const REAL = '99999999-9999-4999-8999-999999999999'
const OPENED = '12121212-1212-4121-8121-121212121212'

const made: string[] = []
const project = () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-host-')))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
  for (const id of [A, B, C, D, E]) removeRollout(id)
})

/** A Codex record as 0.164.0 writes one: the meta row (with `git` when given), then what the person typed. */
function record(id: string, cwd: string, said: string[], when: number, git?: { branch: string }) {
  removeRollout(id)
  const file = rolloutPath(id, true)
  mkdirSync(join(file, '..'), { recursive: true })
  const meta = JSON.stringify({ timestamp: new Date(when).toISOString(), type: 'session_meta', payload: { id, cwd, source: 'cli', thread_source: 'user', base_instructions: 'You are Codex.', ...(git ? { git: { commit_hash: 'abc', branch: git.branch, repository_url: 'git@github.com:o/r.git' } } : {}) } })
  writeFileSync(file, `${[meta, ...said.map((text, i) => typed(when + i, text))].join('\n')}\n`)
  const { utimesSync } = require('node:fs') as typeof import('node:fs')
  utimesSync(file, new Date(when), new Date(when))
}

const PLACE = { epic: 'parser', parts: ['lexer'], kehikko: 'a1b2c3d4' }
const OTHER = { epic: 'docs', parts: [], kehikko: 'a1b2c3d4' }

function stubRuns(more: Partial<HostNeeds['runs']> = {}): HostNeeds['runs'] & { told: (projectPath: string, assigned?: { key: string; session: string }) => void; heard: unknown[] } {
  const heard: unknown[] = []
  return {
    heard,
    sessions: () => [],
    running: async () => ({ known: true, active: [] }),
    find: () => null,
    told: (projectPath, assigned) => void heard.push({ projectPath, assigned }),
    startTask: async () => ({ code: CLOSED.refused, why: 'not in this test' }),
    ...more,
  }
}

describe('find', () => {
  test('lists the project’s conversations, strongest match first: branch, then mentioned, then folder', async () => {
    const dir = project()
    const elsewhere = project()
    record(A, dir, ['fix the parser'], 1_000_000, { branch: 'feat/x' })
    record(B, dir, ['look at !4721 please', 'and then the tests'], 3_000_000)
    record(C, dir, ['tidy the readme'], 2_000_000)
    record(D, elsewhere, ['not this project'], 4_000_000, { branch: 'feat/x' })
    record(E, dir, ['a background job'], 5_000_000, { branch: 'feat/x' })
    expect(ignore(dir, E).ok).toBe(true)
    expect(assign(dir, { epic: 'parser', parts: ['lexer'], kehikko: { key: 'a1b2c3d4' } }, A).ok).toBe(true)

    const found = await findConversations({ project: dir, refs: ['!4721'], branch: 'feat/x', repo: 'o/r' }, { program: PROGRAM, runs: stubRuns({ sessions: () => [{ id: OPENED, settled: C, ended: false } as unknown as Run] }) })
    expect(conversationsFindResult.parse(found)).toEqual(found)
    expect(found.conversations.map((one) => [one.session, one.match, one.reason])).toEqual([
      [A, 'branch', 'worked on branch feat/x'],
      [B, 'mentioned', 'mentioned !4721'],
      [C, 'folder', 'worked in this repository'],
    ])
    const [a, b, c] = found.conversations
    expect(a).toMatchObject({ title: 'fix the parser', folder: dir, place: PLACE, running: false })
    expect(b).toMatchObject({ place: null, running: false })
    /* One this module runs now. */
    expect(c).toMatchObject({ running: true, lastActive: 2_000_000 })
  })

  test('a ref is named only as a whole word, and the change’s address counts as one', async () => {
    expect(names('see !4721.', '!4721')).toBe(true)
    expect(names('see !47210', '!4721')).toBe(false)
    expect(names('o/r#12 done', '#12')).toBe(true)
    expect(names('#123', '#12')).toBe(false)
    const dir = project()
    record(A, dir, ['review https://example.com/o/r/-/merge_requests/9 now'], 1_000_000)
    const found = await findConversations({ project: dir, refs: ['!9'], url: 'https://example.com/o/r/-/merge_requests/9' }, { program: PROGRAM, runs: stubRuns() })
    expect(found.conversations[0]).toMatchObject({ session: A, match: 'mentioned', reason: 'mentioned https://example.com/o/r/-/merge_requests/9' })
  })

  test('never says a transcript’s content beyond its title', async () => {
    const dir = project()
    record(A, dir, ['first line\nsecret second line', 'the last thing said'], 1_000_000)
    const found = await findConversations({ project: dir, refs: ['!1'] }, { program: PROGRAM, runs: stubRuns() })
    const text = JSON.stringify(found)
    expect(text).not.toContain('secret')
    expect(text).not.toContain('the last thing said')
  })
})

describe('bring', () => {
  const needs = (runs = stubRuns()) => ({ program: PROGRAM, runs })

  test('files an unplaced conversation under the place, as $kehikot-here does', async () => {
    const dir = project()
    record(A, dir, ['fix the parser'], 1_000_000)
    const runs = stubRuns()
    const said = await bringConversation({ project: dir, session: A, to: PLACE, from: null }, needs(runs))
    expect(conversationsBringResult.parse(said)).toEqual({ outcome: 'brought', place: PLACE, resumed: false, why: '' })
    const read = readPlaces(dir)
    const key = placeKey({ epic: 'parser', parts: ['lexer'], kehikko: { key: 'a1b2c3d4' } })
    expect(read.ok && homeOf(read.value, A)).toBe(key)
    /* It had none, so it is that place's own; and it has its token, as $kehikot-here gives one. */
    expect(read.ok && read.value.places[key]?.own).toBe(A)
    expect(read.ok && read.value.sessions[A]?.token).toBeTruthy()
    expect(runs.heard).toEqual([{ projectPath: dir, assigned: { key, session: A } }])
  })

  test('refuses one filed under another place, and never overwrites it', async () => {
    const dir = project()
    record(A, dir, ['fix the parser'], 1_000_000)
    assign(dir, { epic: 'docs', parts: [], kehikko: { key: 'a1b2c3d4' } }, A)
    const before = JSON.stringify(readPlaces(dir))
    const said = await bringConversation({ project: dir, session: A, to: PLACE, from: null }, needs())
    expect(said).toEqual({ outcome: 'elsewhere', place: OTHER, resumed: false, why: '' })
    expect(JSON.stringify(readPlaces(dir))).toBe(before)
  })

  test('takes a conversation back to no place (the undo), only from where it was brought', async () => {
    const dir = project()
    record(A, dir, ['fix the parser'], 1_000_000)
    await bringConversation({ project: dir, session: A, to: PLACE, from: null }, needs())
    /* Somebody's undo from a place it is not under: nothing changes. */
    expect((await bringConversation({ project: dir, session: A, to: null, from: OTHER }, needs())).outcome).toBe('elsewhere')
    const said = await bringConversation({ project: dir, session: A, to: null, from: PLACE }, needs())
    expect(said).toEqual({ outcome: 'brought', place: null, resumed: false, why: '' })
    const read = readPlaces(dir)
    expect(read.ok && homeOf(read.value, A)).toBeNull()
    expect(read.ok && Object.values(read.value.places).some((entry) => entry.sessions.includes(A))).toBe(false)
  })

  test('says resumed when this module holds the conversation’s terminal', async () => {
    const dir = project()
    record(A, dir, ['fix the parser'], 1_000_000)
    const said = await bringConversation({ project: dir, session: A, to: PLACE, from: null }, needs(stubRuns({ find: (id) => (id === A ? ({ id: A } as Run) : null) })))
    expect(said).toMatchObject({ outcome: 'brought', resumed: true })
  })

  test('a conversation Codex has no record of in this project is no such session', async () => {
    const dir = project()
    expect((await bringConversation({ project: dir, session: D, to: PLACE, from: null }, needs())).outcome).toBe('no-such-session')
    expect((await bringConversation({ project: dir, session: 'not-an-id', to: PLACE, from: null }, needs())).outcome).toBe('no-such-session')
  })

  test('a place filed under a kehikko’s row number is said without its kehikko, and never equals a from', () => {
    expect(placeTo('epic=x;parts=-;kehikko=3')).toEqual({ epic: 'x', parts: [], kehikko: null })
    expect(placeTo(null)).toBeNull()
  })
})

/* ------------------------------------------------------------------ * start, with a stand-in pty */

class FakePty implements Pty {
  pid = 0
  private heard: (chunk: string) => void = () => {}
  constructor(readonly file: string, readonly args: string[], readonly options: { cwd: string }) {}
  onData(heard: (chunk: string) => void) {
    this.heard = heard
  }
  onExit() {}
  write() {}
  resize() {}
  kill() {}
  says(text: string) {
    this.heard(text)
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

function world() {
  const ptys: FakePty[] = []
  const held = new Map<string, Recorded[]>()
  const program: Program = {
    ...PROGRAM,
    find: () => ({ file: '/fake/bin/codex', looked: [], usual: [] }),
    supports: async () => ({ ok: true, missing: null, tells: false, lists: true, names: false, configures: false, plugins: false }),
    active: async () => ({ known: true, active: [] }),
    newId: () => OPENED,
    /* Codex names the conversation once its first prompt is in: here, as soon as it was spawned with one. */
    settled: async (projectPath, id) => (id === OPENED && held.get(projectPath)?.length ? REAL : null),
    sessions: async (projectPath) => held.get(projectPath) ?? [],
    environment: () => ({ PATH: '/bin' }),
  }
  const runs = new Runs({
    program,
    grace: 60_000,
    quiet: 30 * 60_000,
    heldWait: 0,
    port: () => null,
    every: null,
    watchEvery: null,
    log: () => {},
    now: () => 1_000_000,
    screen: headless,
    spawn: (file, args, options) => {
      const pty = new FakePty(file, args, options)
      ptys.push(pty)
      const brief = args[0]
      if (brief) held.set(options.cwd, [{ id: REAL, label: brief.split('\n')[0]!, lastActive: 1_000_000 }])
      return pty
    },
  })
  return { runs, ptys }
}

describe('start', () => {
  test('starts a new Codex conversation in the project with the brief as its first prompt, filed under the place', async () => {
    const dir = project()
    const w = world()
    const started = await w.runs.startTask(dir, { epic: 'parser', parts: ['lexer'], kehikko: { key: 'a1b2c3d4' } }, 'Adopt !4721\nand finish it', { ms: 2000, every: 5 })
    expect('code' in started).toBe(false)
    expect((started as { session: string }).session).toBe(REAL)
    expect(w.ptys.length).toBe(1)
    expect(w.ptys[0]!.args).toEqual(['Adopt !4721\nand finish it'])
    expect(w.ptys[0]!.options.cwd).toBe(dir)
    const read = readPlaces(dir)
    expect(read.ok && homeOf(read.value, REAL)).toBe(placeKey({ epic: 'parser', parts: ['lexer'], kehikko: { key: 'a1b2c3d4' } }))

    /* Its view: attached to by id alone, never started again. */
    const viewer = new Watcher()
    const shown = w.runs.watchOne({ what: 'watch', session: REAL, cols: 100, rows: 30 }, viewer)
    expect('code' in shown).toBe(false)
    expect(w.ptys.length).toBe(1)
    expect(viewer.said[0]).toMatchObject({ opened: 'attached', session: REAL })
    expect(w.runs.watchOne({ what: 'watch', session: A, cols: 100, rows: 30 }, new Watcher())).toMatchObject({ code: CLOSED.refused })
  })

  test('the service answers the new conversation’s id, and a null place is the project itself', async () => {
    const dir = project()
    const w = world()
    let asked: unknown = null
    const said = await startConversation({ project: dir, brief: 'do the thing', place: null }, {
      runs: { ...stubRuns(), startTask: async (projectPath, place, brief) => ((asked = { projectPath, place, brief }), w.runs.startTask(projectPath, place, brief, { ms: 2000, every: 5 })) },
    })
    expect(said).toEqual({ outcome: 'started', session: REAL, why: '' })
    expect(asked).toEqual({ projectPath: dir, place: { epic: null, parts: [], kehikko: null }, brief: 'do the thing' })
  })

  test('a brief is one positional prompt, and never read as a flag', () => {
    expect(PROGRAM.fresh(OPENED, undefined, 'hello')).toEqual(['hello'])
    expect(PROGRAM.fresh(OPENED)).toEqual([])
    expect(promptArg('--dangerously-bypass-approvals-and-sandbox')).toBe('Task: --dangerously-bypass-approvals-and-sandbox')
  })

  test('the opening frame names a running conversation to watch by its id, and still needs the ticket', () => {
    expect(opening(JSON.stringify({ ticket: 'T', watch: A, cols: 90, rows: 20 }), 'T')).toEqual({ what: 'watch', session: A, cols: 90, rows: 20 })
    expect(typeof opening(JSON.stringify({ ticket: 'T', watch: '../x' }), 'T')).toBe('string')
    expect(typeof opening(JSON.stringify({ ticket: 'nope', watch: A }), 'T')).toBe('string')
    /* And no brief rides on any frame. */
    expect(Object.keys(opening(JSON.stringify({ ticket: TICKET, watch: A, brief: 'x', prompt: 'y' })) as object).sort()).toEqual(['cols', 'rows', 'session', 'what'])
  })
})

describe('only the host', () => {
  const PATHS = [FIND_PATH, BRING_PATH, START_PATH]
  const bodies: Record<string, unknown> = {
    [FIND_PATH]: { project: '/p', refs: ['!1'] },
    [BRING_PATH]: { project: '/p', session: A, to: null, from: null },
    [START_PATH]: { project: '/p', brief: 'x', place: null, title: 't' },
  }

  test('a request the host did not vouch for is refused on every route, and nothing is done', async () => {
    let started = 0
    const runs = stubRuns({ startTask: async () => ((started += 1), { session: A }) })
    for (const path of PATHS) {
      const refused = await answerHost('POST', path, { [SERVICE_CALLER_HEADER]: HOST_CALLER, [SERVICE_PASS_HEADER]: 'p'.repeat(43) }, bodies[path] as Record<string, unknown>, { program: PROGRAM, runs, vouch: async () => ({ ok: false, why: 'Kehikot did not vouch for that pass.' }) })
      expect(refused?.status).toBe(403)
      /* With the protocol's own check, and no pass at all: refused before anything is asked. */
      expect((await answerHost('POST', path, {}, bodies[path] as Record<string, unknown>, { program: PROGRAM, runs }))?.status).toBe(403)
    }
    expect(started).toBe(0)
  })

  test('a vouched request is answered, and other paths and methods are not these routes', async () => {
    const dir = project()
    record(A, dir, ['hello'], 1_000_000)
    const vouch = async () => ({ ok: true as const })
    const found = await answerHost('POST', FIND_PATH, {}, { project: dir, refs: ['!1'] }, { program: PROGRAM, runs: stubRuns(), vouch })
    expect(found?.status).toBe(200)
    expect((found?.body as { conversations: unknown[] }).conversations.length).toBe(1)
    expect((await answerHost('POST', FIND_PATH, {}, { project: dir }, { program: PROGRAM, runs: stubRuns(), vouch }))?.status).toBe(400)
    expect((await answerHost('GET', FIND_PATH, {}, null, { program: PROGRAM, runs: stubRuns(), vouch }))?.status).toBe(405)
    expect(await answerHost('POST', '/api/place', {}, null, { program: PROGRAM, runs: stubRuns(), vouch })).toBeNull()
  })

  test('the manifest provides both services, with a view that names the conversation', () => {
    const finder = serviceDescriptor(CONVERSATIONS_FINDER, MANIFEST.services?.[CONVERSATIONS_FINDER])
    const tasks = serviceDescriptor(AGENT_TASKS, MANIFEST.services?.[AGENT_TASKS])
    expect(finder).toEqual({ name: 'Codex', program: 'Codex', find: FIND_PATH, bring: BRING_PATH })
    expect(tasks).toMatchObject({ start: START_PATH })
    expect(agentTaskView(tasks!, A)).toBe(`/app?session=${A}`)
  })
})
