import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WELL_KNOWN, toolEffect } from 'kehikot-module-protocol'

import { MANIFEST, TICKET, answer, listing, lookedIn, ordered, stream, type Listing } from '../doors.ts'
import { Runs, TELL_ENV, headless, theRuns, type Notice, type Pty, type Run, type Stated } from '../live.ts'
import { ID } from '../manifest.ts'
import { placeKey } from '../place.ts'
import { PROGRAM, type Active } from '../program.ts'
import { removeRollout, typed, writeRollout } from './transcripts.ts'
import { attach, detach as detachFrom, readPlaces } from '../record.ts'

const project = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-doors-')))
const bin = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-bin-')))
afterAll(() => {
  rmSync(project, { recursive: true, force: true })
  rmSync(bin, { recursive: true, force: true })
})

const none = new URLSearchParams()
const METHODS = { epic: 'thesis', parts: ['methods'], kehikko: { id: 3 }, kehikkoName: 'writing' }
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'

/** What Codex would have written for a session, where this module reads it from. */
function recorded(id: string, said: string) {
  writeRollout(id, project, [typed(Date.now(), said)])
}

async function rpc(method: string, params: Record<string, unknown> = {}) {
  const reply = await answer('POST', '/mcp', none, { jsonrpc: '2.0', id: 1, method, params }, null)
  return reply?.body as { result?: { tools?: { name: string; annotations?: Record<string, unknown> }[]; content?: { text: string }[]; isError?: boolean } }
}

describe('the doors', () => {
  test('the health check says which module this is', async () => {
    const reply = await answer('GET', '/healthz', none, null, null)
    expect(reply?.status).toBe(200)
    expect((reply?.body as { id: string }).id).toBe(ID)
  })

  test('the manifest is served at the well-known path by the config, and is this module’s', () => {
    expect(WELL_KNOWN.startsWith('/')).toBe(true)
    expect(MANIFEST.id).toBe(ID)
  })

  test('a path that is not ours is left to Vite', async () => {
    expect(await answer('GET', '/src/main.tsx', none, null, null)).toBeNull()
  })

  test('every door under /api needs this page’s ticket — the read as well, since it says what somebody worked on', async () => {
    const query = new URLSearchParams({ projectPath: project, key: placeKey(METHODS) })
    expect((await answer('GET', '/api/place', query, null, null))?.status).toBe(403)
    /* Marked, so the page's `ask()` knows it is older than this server and reloads. */
    expect(((await answer('GET', '/api/place', query, null, 'old'))?.body as { refused?: string }).refused).toBe('ticket')
    expect((await answer('POST', '/api/end', none, { session: A }, null))?.status).toBe(403)
    expect((await answer('POST', '/api/detach', none, { session: A }, 'x'))?.status).toBe(403)
    expect((await answer('GET', '/api/place', query, null, TICKET))?.status).toBe(200)
    expect((await answer('GET', '/api/nothing', none, null, TICKET))?.status).toBe(404)
  })

  test('there is no door that starts a session, types into one or installs anything', async () => {
    for (const path of ['/api/start', '/api/open', '/api/sessions', '/api/install', '/api/type', '/api/prompt']) {
      expect((await answer('POST', path, none, { projectPath: project }, TICKET))?.status).toBe(404)
    }
  })
})

describe('what a place holds', () => {
  const runs = new Runs({ spawn: () => { throw new Error('nothing is started by reading') }, screen: headless })

  test('its own sessions, the project’s others, and whether the program is there', async () => {
    recorded(A, 'tighten the methods section')
    recorded(B, 'draft the results')
    recorded(C, 'never attached anywhere')
    attach(project, METHODS, A)
    attach(project, { ...METHODS, parts: [] }, B)

    const said = (await listing(project, placeKey(METHODS), runs)) as Listing
    expect(said.ok).toBe(true)
    expect(said.sessions.map((one) => [one.id, one.label, one.running])).toEqual([[A, 'tighten the methods section', false]])
    /* Belongs to another place, and to none: both can be attached here. */
    expect(said.others.map((one) => one.id).sort()).toEqual([B, C])
    expect(typeof said.sessions[0]?.lastActive).toBe('number')
    expect(said.program.found).toBeNull()
    expect(said.program.looked.length).toBeGreaterThan(2)
    /* For the one sentence: PATH as one word, then where an install usually lands, the home folder as ~. */
    expect(said.program.where).toBe('PATH, ~/.local/bin, /opt/homebrew/bin, /usr/local/bin')
    expect(lookedIn(['/Users/someone/.local/bin', '/opt/homebrew/bin'], '/Users/someone')).toBe('PATH, ~/.local/bin, /opt/homebrew/bin')
    expect(said.program.install.line).toContain('@openai/codex')
    expect(said.running).toEqual([])
  })

  test('a session filed under the project folder’s old name (a renamed project) is listed, not missing', async () => {
    const renamed = 'c0000002-0000-4000-8000-00000000c001'
    writeRollout(renamed, `${project}-before-the-rename`, [typed(Date.now(), 'asked before the rename')])
    attach(project, METHODS, renamed, { label: 'kept in the record', lastActive: Date.parse('2026-10-01T00:00:00Z') })
    const said = (await listing(project, placeKey(METHODS), runs)) as Listing
    const row = said.sessions.find((one) => one.id === renamed)
    expect(row?.label).toBe('asked before the rename')
    expect(row && 'missing' in row).toBe(false)
  })

  test('a session Codex has no record of on this computer is listed from what was kept beside it, and marked as not here', async () => {
    /* The record came with the project; the session ran on another computer, or its transcript was cleaned away. */
    const gone = '44444444-4444-4444-8444-444444444444'
    attach(project, METHODS, gone, { label: 'kept in the record', lastActive: Date.parse('2026-10-01T00:00:00Z') })
    const said = (await listing(project, placeKey(METHODS), runs)) as Listing
    expect(said.sessions.find((one) => one.id === gone)).toEqual({ id: gone, label: 'kept in the record', lastActive: Date.parse('2026-10-01T00:00:00Z'), running: false, missing: true })
    /* The ones that are here are not marked at all. */
    expect(said.sessions.find((one) => one.id === A)).not.toHaveProperty('missing')
    /* Not offered for attaching either: that list is what Codex holds here. */
    expect(said.others.some((one) => one.id === gone)).toBe(false)
    /* And nothing was taken out of the record on that account. */
    const kept = readPlaces(project)
    expect(kept.ok && kept.value.places[placeKey(METHODS)]?.sessions).toContain(gone)
    expect(kept.ok && kept.value.sessions[gone]?.label).toBe('kept in the record')

    const called = await rpc('tools/call', { name: 'sessions', arguments: { projectPath: project } })
    const places = JSON.parse(called.result?.content?.[0]?.text ?? '[]') as { place: string; sessions: { id: string; missing?: boolean }[] }[]
    const methods = places.find((one) => one.place === placeKey(METHODS))
    expect(methods?.sessions.find((one) => one.id === gone)?.missing).toBe(true)
    expect(methods?.sessions.find((one) => one.id === A)?.missing).toBeUndefined()
  })

  test('says when the program is found', async () => {
    copyFileSync(join(import.meta.dir, 'stand-in', 'codex'), join(bin, 'codex'))
    copyFileSync(join(import.meta.dir, 'stand-in', 'codex.ts'), join(bin, 'codex.ts'))
    chmodSync(join(bin, 'codex'), 0o755)
    const path = process.env.PATH
    process.env.PATH = `${bin}:${path}`
    try {
      const said = (await listing(project, placeKey(METHODS), runs)) as Listing
      expect(said.program.found).toBe(join(bin, 'codex'))
      expect(said.program.lacks).toBeNull()
    } finally {
      process.env.PATH = path
    }
  })

  test('refuses a place that is not one and a project that is not there', async () => {
    expect((await listing(project, 'constructor', runs)).ok).toBe(false)
    expect((await listing('/no/such/folder', placeKey(METHODS), runs)).ok).toBe(false)
  })

  test('taking a session off a place is a door; it goes back among the others', async () => {
    const reply = await answer('POST', '/api/detach', none, { projectPath: project, key: placeKey(METHODS), session: A }, TICKET)
    expect(reply?.status).toBe(200)
    const said = (await listing(project, placeKey(METHODS), runs)) as Listing
    expect(said.sessions.some((one) => one.id === A)).toBe(false)
    expect(said.others.some((one) => one.id === A)).toBe(true)
    expect((await answer('POST', '/api/detach', none, { projectPath: project, key: placeKey(METHODS), session: 'nope' }, TICKET))?.status).toBe(400)
  })

  test('bringing an older file across to a kehikko’s key is a door of its own, ticketed, and the read never does it', async () => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-rekey-')))
    try {
      attach(dir, { epic: 'thesis', parts: [], kehikko: { id: 3 }, kehikkoName: 'writing' }, A)
      const old = 'epic=thesis;parts=-;kehikko=3'
      const keyed = 'epic=thesis;parts=-;kehikko=key:4072c9e5'
      const file = join(dir, '.kehikot', 'codex', 'places.json')
      const before = readFileSync(file, 'utf8')

      /* Reading the keyed place finds nothing, and moves nothing. */
      expect(((await listing(dir, keyed, runs)) as Listing).sessions).toEqual([])
      expect(readFileSync(file, 'utf8')).toBe(before)

      const body = { projectPath: dir, kehikko: { key: '4072c9e5', name: 'writing', id: 28 } }
      expect((await answer('POST', '/api/rekey', none, body, null))?.status).toBe(403)
      expect((await answer('POST', '/api/rekey', none, { projectPath: dir, kehikko: { key: 'Not A Key', name: 'writing' } }, TICKET))?.status).toBe(400)
      expect((await answer('POST', '/api/rekey', none, { projectPath: dir }, TICKET))?.status).toBe(400)
      expect(readFileSync(file, 'utf8')).toBe(before)

      expect((await answer('POST', '/api/rekey', none, body, TICKET))?.body).toEqual({ ok: true, moved: 1 })
      const read = readPlaces(dir)
      expect(read.ok && Object.keys(read.value.places)).toEqual([keyed])
      expect(read.ok && read.value.places[keyed]).toEqual({ epic: 'thesis', parts: [], kehikko: { key: '4072c9e5', id: 28, name: 'writing' }, sessions: [A], current: A })
      expect(read.ok && Object.hasOwn(read.value.places, old)).toBe(false)
      /* Asked again, there is nothing left to do. */
      expect((await answer('POST', '/api/rekey', none, body, TICKET))?.body).toEqual({ ok: true, moved: 0 })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  test('ending something that is not running says so and ends nothing', async () => {
    const reply = await answer('POST', '/api/end', none, { session: A }, TICKET)
    expect(reply?.body).toEqual({ ok: true, ended: false })
    expect((await answer('POST', '/api/end', none, { session: '--all' }, TICKET))?.status).toBe(400)
  })
})

describe('the MCP door', () => {
  test('offers two tools: one that only reads, and tell_finished, which tags and destroys nothing', async () => {
    expect((await answer('GET', '/mcp', none, null, null))?.status).toBe(405)
    const tools = (await rpc('tools/list')).result?.tools ?? []
    expect(tools.map((one) => one.name)).toEqual(['sessions', 'tell_finished'])
    expect(tools[0]?.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false })
    expect(tools[1]?.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false })
    const schema = (tools[1] as unknown as { inputSchema: { properties: { event: { enum: string[] } }; required: string[] } }).inputSchema
    expect(schema.properties.event.enum).toEqual(['research-complete'])
    expect(schema.required).toEqual(['event', 'label'])
  })

  test('tell_finished refuses, in words, a conversation it is not running, a missing label and an undeclared event', async () => {
    const call = (args: Record<string, unknown>, query = none) =>
      answer('POST', '/mcp', query, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'tell_finished', arguments: args } }, null) as Promise<{ body: { result?: { isError?: boolean; content?: { text: string }[] } } }>
    const nobody = await call({ event: 'research-complete', label: 'Protocol audit' }, new URLSearchParams({ 'kehikot-place': 'A'.repeat(43) }))
    expect(nobody.body.result?.isError).toBe(true)
    expect(nobody.body.result?.content?.[0]?.text).toContain('Nothing was told')
    expect((await call({ event: 'research-complete', label: '  ' })).body.result?.content?.[0]?.text).toContain('label')
    expect((await call({ event: 'build-green', label: 'x' })).body.result?.content?.[0]?.text).toContain('research-complete')
  })

  test('it takes the project as \`project\`, advertises no other name, and still reads \`projectPath\`', async () => {
    const tools = ((await rpc('tools/list')).result?.tools ?? []) as unknown as { annotations?: { readOnlyHint?: boolean }; inputSchema: { properties: Record<string, unknown>; required: string[] } }[]
    expect(toolEffect(tools[0]!)).toBe('reads')
    expect(Object.keys(tools[0]!.inputSchema.properties)).toEqual(['project', 'epic', 'place'])
    expect(tools[0]!.inputSchema.required).toEqual(['project'])
    const now = await rpc('tools/call', { name: 'sessions', arguments: { project, epic: 'thesis' } })
    const before = await rpc('tools/call', { name: 'sessions', arguments: { projectPath: project, epic: 'thesis' } })
    expect([now.result?.isError, before.result?.isError]).toEqual([undefined, undefined])
    expect(before.result?.content?.[0]?.text).toBe(now.result?.content?.[0]?.text)
    expect(now.result?.content?.[0]?.text).toContain(B)
  })

  test('lists the places of a project and their sessions', async () => {
    const called = await rpc('tools/call', { name: 'sessions', arguments: { projectPath: project } })
    expect(called.result?.isError).toBeUndefined()
    const places = JSON.parse(called.result?.content?.[0]?.text ?? '[]') as { place: string; sessions: { id: string; firstPrompt: string }[] }[]
    const whole = places.find((one) => one.place === 'epic=thesis;parts=-;kehikko=3')
    expect(whole?.sessions).toMatchObject([{ id: B, firstPrompt: 'draft the results', running: false }])

    const other = await rpc('tools/call', { name: 'sessions', arguments: { projectPath: project, epic: 'another' } })
    expect(other.result?.content?.[0]?.text).toContain('No session is recorded')
  })

  test('refuses in words an agent can read: no project, and a tool that is not here', async () => {
    expect((await rpc('tools/call', { name: 'sessions', arguments: {} })).result?.isError).toBe(true)
    for (const name of ['start', 'open', 'type', 'install', 'end']) {
      expect((await rpc('tools/call', { name, arguments: { projectPath: project } })).result?.isError).toBe(true)
    }
  })
})

/* ------------------------------------------------------------------ *
 * What a session is doing: the door its program reports to, and where it is read
 * ------------------------------------------------------------------ */

describe('a session’s own report, and where its state is read', () => {
  /* This process's one set of runs, as the doors find it, with a pty that is not one. */
  const env: NodeJS.ProcessEnv[] = []
  const pty = (): Pty => ({ pid: 0, write() {}, resize() {}, kill() {}, onData() {}, onExit() {} })
  const held = globalThis as Record<symbol, unknown>
  const HELD = Symbol.for('kehikot.codex.runs')
  const was = held[HELD]
  const D = '55555555-5555-4555-8555-555555555555'
  const live = new Runs({
    program: { ...PROGRAM, find: () => ({ file: '/fake/claude', looked: [], usual: [] }), supports: async () => ({ ok: true, missing: null, tells: true, lists: false }), newId: () => D },
    every: null,
    port: () => 9590,
    screen: headless,
    spawn: (_file, _args, options) => {
      env.push(options.env)
      return pty()
    },
  })
  held[HELD] = live
  afterAll(() => {
    held[HELD] = was
  })
  const state = (session: string, event: string, ticket: string | null, method = 'POST') => answer(method, '/api/state', new URLSearchParams({ session, event }), null, ticket)
  const viewer = { output() {}, say() {}, close() {} }
  let run: Run
  let secret = ''

  test('the doors find this process’s runs', async () => {
    expect(theRuns()).toBe(live)
    run = (await live.open({ what: 'session', projectPath: project, place: METHODS, session: null, cols: 80, rows: 24 }, viewer)) as Run
    secret = String(env[0]![TELL_ENV.secret])
    expect(run.id).toBe(D)
  })

  test('is taken with that session’s secret and answered with nothing', async () => {
    const reply = await state(D, 'UserPromptSubmit', secret)
    expect(reply).toEqual({ status: 204, body: null })
    expect(run.state).toBe('working')
  })

  test('is refused in one sentence for every other reason, and the sentence does not say which', async () => {
    const refusals = [
      await state(D, 'Stop', null),
      await state(D, 'Stop', ''),
      await state(D, 'Stop', 'wrong'),
      /* The page's own ticket opens every other door here, and not this one. */
      await state(D, 'Stop', TICKET),
      await state(A, 'Stop', secret),
      await state('', 'Stop', secret),
      await state('__proto__', 'Stop', secret),
    ]
    expect(new Set(refusals.map((one) => JSON.stringify(one))).size).toBe(1)
    expect(refusals[0]?.status).toBe(403)
    expect(run.state).toBe('working')
    expect((await state(D, 'Stop', secret, 'GET'))?.status).toBe(405)
    expect(run.state).toBe('working')
  })

  test('the secret opens no other door', async () => {
    const query = new URLSearchParams({ projectPath: project, key: placeKey(METHODS) })
    expect((await answer('GET', '/api/place', query, null, secret))?.status).toBe(403)
    expect((await answer('POST', '/api/end', none, { session: D }, secret))?.status).toBe(403)
  })

  test('nothing a report carries is kept: a body is not read and a strange event changes nothing', async () => {
    const reply = await answer('POST', '/api/state', new URLSearchParams({ session: D, event: 'Stop<script>' }), { message: 'Finished: something a person never wrote' }, secret)
    expect(reply?.status).toBe(204)
    expect(run.state).toBe('working')
    expect(JSON.stringify(live.sessions().map((one) => [one.label, one.state]))).not.toContain('never wrote')
  })

  test('the list a page reads says what each running session is doing, and since when', async () => {
    await state(D, 'PermissionRequest', secret)
    const said = (await listing(project, placeKey(METHODS), live)) as Listing
    expect(said.sessions.find((one) => one.id === D)).toMatchObject({ running: true, state: 'needs-you', since: run.stateSince })
    expect(said.running.find((one) => one.id === D)).toMatchObject({ state: 'needs-you', since: run.stateSince })
    /* One that is not running says nothing about a state. */
    expect(said.others.every((one) => !('state' in one))).toBe(true)
  })

  test('the MCP tool says it too, for a session that is recorded', async () => {
    recorded(D, 'the one that is running')
    await live.settle(run)
    await state(D, 'Stop', secret)
    const called = await rpc('tools/call', { name: 'sessions', arguments: { projectPath: project } })
    const places = JSON.parse(called.result?.content?.[0]?.text ?? '[]') as { place: string; sessions: { id: string; running: boolean; state?: string; since?: string }[] }[]
    const row = places.flatMap((one) => one.sessions).find((one) => one.id === D)
    expect(row).toMatchObject({ running: true, state: 'finished', since: new Date(run.stateSince).toISOString() })
    expect(places.flatMap((one) => one.sessions).filter((one) => one.id !== D).every((one) => !('state' in one))).toBe(true)
    const tools = (await rpc('tools/list')).result?.tools as { description?: string }[]
    expect(tools[0]?.description).toContain('needs-you')
  })

  test('the feed is ticketed like the read beside it, and says each change and each notice', async () => {
    const events: [unknown, string | undefined][] = []
    const emit = (event: unknown, name?: string) => void (name === 'activity' ? activity.push(event) : events.push([event, name]))
    const activity: unknown[] = []
    expect(stream('GET', '/api/place', none, emit, TICKET)).toBeNull()
    expect(stream('GET', '/api/feed', none, emit, null)).toMatchObject({ reply: { status: 403 } })
    expect(stream('GET', '/api/feed', new URLSearchParams({ ticket: secret }), emit, null)).toMatchObject({ reply: { status: 403 } })
    expect(stream('POST', '/api/feed', new URLSearchParams({ ticket: TICKET }), emit, null)).toMatchObject({ reply: { status: 405 } })
    expect(events).toEqual([])

    const opened = stream('GET', '/api/feed', new URLSearchParams({ ticket: TICKET, notices: '1' }), emit, null) as { close: () => void }
    /* What is running now, at once. */
    expect(events).toEqual([[{ session: D, state: 'finished', since: run.stateSince } satisfies Stated, undefined]])
    live.look(run, viewer, false)
    await state(D, 'UserPromptSubmit', secret)
    await state(D, 'PermissionRequest', secret)
    expect(events.map(([event, name]) => [name, (event as Stated).state])).toEqual([[undefined, 'finished'], [undefined, 'working'], [undefined, 'needs-you'], ['notice', 'needs-you']])
    const notice = events.at(-1)![0] as Notice
    expect(notice).toMatchObject({ session: D, label: 'the one that is running', epic: 'thesis', parts: ['methods'], kehikko: 'writing' })
    /* The whole list, on arrival and on each change, as its own event. */
    expect(activity.length).toBe(3)
    expect(activity.at(-1)).toMatchObject({ items: [{ id: D, state: 'attention', label: 'the one that is running', place: { epic: 'thesis', parts: ['methods'] } }] })
    opened.close()
    await state(D, 'PostToolUse', secret)
    expect(events.length).toBe(4)
    expect(activity.length).toBe(3)
  })
})

/* ------------------------------------------------------------------ *
 * Running elsewhere, as a row says it (#5), and a place with no session (#6)
 * ------------------------------------------------------------------ */

describe('what the list says about sessions running elsewhere, and a place with none', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-offer-')))
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  const WRITING = { key: '4072c9e5' }
  const place = (parts: string[], epic = 'thesis', kehikko: { key: string } = WRITING, kehikkoName = 'writing') => ({ epic, parts, kehikko, kehikkoName })
  const E = '55555555-5555-4555-8555-555555555555'
  const at = (id: string, said: string, when: string) => {
    writeRollout(id, dir, [typed(Date.parse(when), said)], when)
  }
  /** A program that can be asked, saying what a test puts in `elsewhere`. */
  const elsewhere: Active[] = []
  const lists = { yes: true }
  const program = {
    ...PROGRAM,
    find: () => ({ file: '/fake/claude', looked: [], usual: [] }),
    supports: async () => ({ ok: true, missing: null, tells: false, lists: lists.yes }),
    active: async () => ({ known: true as const, active: [...elsewhere] }),
  }
  const runs = new Runs({ program, every: null, spawn: () => { throw new Error('nothing is started by reading') }, screen: headless })
  const held = globalThis as Record<symbol, unknown>
  const HELD = Symbol.for('kehikot.codex.runs')
  const text = async (args: Record<string, unknown>) => {
    const was = held[HELD]
    held[HELD] = runs
    try {
      return (await rpc('tools/call', { name: 'sessions', arguments: { projectPath: dir, ...args } })).result
    } finally {
      held[HELD] = was
    }
  }

  test('the project’s others come most likely first: the ones another place of this epic holds, then the rest by when each was last active', async () => {
    at(A, 'the whole epic’s conversation', '2026-10-01T10:00:00Z')
    at(B, 'belongs to another epic', '2026-10-05T10:00:00Z')
    at(C, 'started in a plain terminal', '2026-10-04T10:00:00Z')
    at(E, 'the same epic on another kehikko', '2026-10-02T10:00:00Z')
    attach(dir, place([]), A)
    attach(dir, place(['intro'], 'another'), B)
    attach(dir, place(['results'], 'thesis', { key: 'aaaa1111' }, 'reading'), E)

    const said = (await listing(dir, placeKey(place(['methods'])), runs, program)) as Listing
    expect(said.sessions).toEqual([])
    /* Same epic first — E is more recent than A — then the rest, most recent first. */
    expect(said.others.map((one) => one.id)).toEqual([E, A, B, C])
    expect(said.others.map((one) => one.near)).toEqual([['results · reading'], ['whole epic · writing'], undefined, undefined])
    expect(said.others.map((one) => one.label)).toEqual(['the same epic on another kehikko', 'the whole epic’s conversation', 'belongs to another epic', 'started in a plain terminal'])
    expect(ordered(await PROGRAM.sessions(dir), [A], placeKey(place([])), (readPlaces(dir) as { value: Parameters<typeof ordered>[3] }).value).map((each) => each.one.id)).toEqual([E, B, C])
    /* A place with no epic has no "same epic". */
    expect(((await listing(dir, 'epic=-;parts=-;kehikko=-', runs, program)) as Listing).others.map((one) => one.near)).toEqual([undefined, undefined, undefined, undefined])
  })

  test('a row says when Codex is running it somewhere this module did not start it — in the background, or open in another process', async () => {
    elsewhere.push(
      { session: A, kind: 'background', called: 'background', handle: '11111111', pid: 4242, cwd: dir, startedAt: 1_000, name: 'stand-in' },
      { session: C, kind: 'interactive', called: 'interactive', handle: null, pid: 5151, cwd: dir, startedAt: 2_000, name: 'project-ea' },
    )
    try {
      const said = (await listing(dir, placeKey(place(['methods'])), runs, program)) as Listing
      expect(said.program.asked).toBe('yes')
      const row = (id: string) => said.others.find((one) => one.id === id)
      expect(row(A)).toMatchObject({ running: false, elsewhere: { kind: 'background', pid: 4242, since: 1_000 } })
      expect(row(C)).toMatchObject({ running: false, elsewhere: { kind: 'interactive', pid: 5151, since: 2_000 } })
      expect(row(B)).not.toHaveProperty('elsewhere')

      const told = await text({ place: { epic: 'thesis', parts: [], kehikko: '4072c9e5' } })
      expect(told?.content?.[0]?.text).toContain('has one session, and opening the module here opens it at once — which is running in the background: it is attached to, and no second process is started')
      expect(told?.content?.[0]?.text).toContain('"runningElsewhere"')
    } finally {
      elsewhere.length = 0
    }
  })

  test('a copy too old to be asked says so in the listing, and no row is called running elsewhere', async () => {
    lists.yes = false
    elsewhere.push({ session: A, kind: 'interactive', called: 'interactive', handle: null, pid: 5151, cwd: dir, startedAt: 2_000, name: 'x' })
    try {
      const said = (await listing(dir, placeKey(place(['methods'])), runs, program)) as Listing
      expect(said.program.asked).toBe('too-old')
      expect(said.others.some((one) => 'elsewhere' in one)).toBe(false)
      expect((await text({ place: { epic: 'thesis', parts: [], kehikko: '4072c9e5' } }))?.content?.[0]?.text).toContain('too old to say')
    } finally {
      lists.yes = true
      elsewhere.length = 0
    }
  })

  test('an agent asking about a place with no session is told a new one starts, and nothing is offered from the project', async () => {
    const told = await text({ place: { epic: 'thesis', parts: ['methods'], kehikko: '4072c9e5' } })
    expect(told?.isError).toBeUndefined()
    const said = told?.content?.[0]?.text ?? ''
    expect(said).toContain('This place (epic=thesis;parts=methods;kehikko=key:4072c9e5) has no conversation connected.')
    expect(said).toContain('starts a new Codex conversation')
    expect(said).toContain('$kehikot-here')
    expect(said).toContain('Nothing is offered from the project’s other sessions.')
    expect(said).not.toContain('\n')
  })

  test('and about a place in a project with no other session: a new one starts at once', async () => {
    const empty = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-empty-')))
    try {
      const was = held[HELD]
      held[HELD] = runs
      try {
        const told = (await rpc('tools/call', { name: 'sessions', arguments: { projectPath: empty, place: { epic: 'thesis', parts: [], kehikko: '4072c9e5' } } })).result
        expect(told?.content?.[0]?.text).toStartWith('This place (epic=thesis;parts=-;kehikko=key:4072c9e5) has no conversation connected. Opening the module here starts a new Codex conversation')
      } finally {
        held[HELD] = was
      }
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })

  test('a place that has its session is said to open it directly, and one with several to open one of them without asking', async () => {
    expect((await text({ place: { epic: 'thesis', parts: [], kehikko: '4072c9e5' } }))?.content?.[0]?.text).toContain('has one session, and opening the module here opens it at once — which is resumed.')
    attach(dir, place([]), C)
    try {
      expect((await text({ place: { epic: 'thesis', parts: [], kehikko: '4072c9e5' } }))?.content?.[0]?.text).toContain('has 2 sessions. Opening the module here opens one at once — the one last open there, else its own, else the most recently active')
    } finally {
      detachFrom(dir, placeKey(place([])), C)
    }
  })

  test('a project where nothing is attached anywhere says which sessions exist for its folder', async () => {
    const loose = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-loose-')))
    try {
      writeRollout('a0000001-0000-4000-8000-00000000a001', loose, [typed(Date.now(), 'from a plain terminal')])
      const said = (await rpc('tools/call', { name: 'sessions', arguments: { projectPath: loose } })).result?.content?.[0]?.text ?? ''
      expect(said).toContain('No session is recorded for that project yet. Codex has 1 session for the folder that belongs to no place')
      expect(said).toContain('from a plain terminal')
    } finally {
      rmSync(loose, { recursive: true, force: true })
      removeRollout('a0000001-0000-4000-8000-00000000a001')
    }
  })

  test('a place that is not one is refused in words', async () => {
    for (const not of ['thesis', { epic: 'Not A Slug' }, { epic: 'thesis', parts: 'methods' }, { epic: 'thesis', kehikko: 'Not A Key' }, { epic: 'thesis', kehikko: {} }]) {
      expect((await text({ place: not }))?.isError).toBe(true)
    }
    /* A host with no keys names the kehikko by its row number. */
    expect((await text({ place: { epic: 'thesis', parts: [], kehikko: 3 } }))?.content?.[0]?.text).toContain('epic=thesis;parts=-;kehikko=3')
  })
})
