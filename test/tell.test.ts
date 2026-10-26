import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TELL_ENV, tellLine } from '../live.ts'
import { PROGRAM, TELLS } from '../program.ts'

/**
 * `tell.sh`, run for real against a server that writes down what it was
 * sent — and the stand-in program firing it, the way the real one fires its
 * hooks.
 *
 * This is the one place the report is tested as a process and a request
 * rather than as a function call: what is on the wire, what is not, and that
 * every way of it going wrong is silence and exit 0.
 */

const TELL = join(import.meta.dir, '..', 'tell.sh')
const STAND_IN = join(import.meta.dir, 'stand-in', 'codex')
const THREAD = '01a175cc-82f0-77b1-a11b-77a47b470116'
const SESSION = '11111111-1111-4111-8111-111111111111'
const SECRET = 'ab'.repeat(24)

interface Heard {
  method: string
  url: string
  ticket: string | undefined
  body: string
  headers: Record<string, unknown>
}
const heard: Heard[] = []
let server: Server
let port = 0
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-tell-')))

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      heard.push({ method: request.method ?? '', url: request.url ?? '', ticket: request.headers['x-module-ticket'] as string | undefined, body, headers: request.headers })
      response.writeHead(204).end()
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  port = (server.address() as AddressInfo).port
})
afterAll(() => {
  server.close()
  rmSync(scratch, { recursive: true, force: true })
})

/** Run a command to its end: what it printed, how it exited, how long it took. */
function ran(file: string, args: string[], env: NodeJS.ProcessEnv, input = '', cwd = scratch): Promise<{ code: number | null; out: string; ms: number }> {
  return new Promise((done) => {
    const began = Date.now()
    const child = spawn(file, args, { env, cwd })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.stderr.on('data', (chunk) => (out += chunk))
    child.on('close', (code) => done({ code, out, ms: Date.now() - began }))
    /* A script that has decided to send nothing may exit before its input is written: that is not a failure. */
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

const env = (more: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv => ({ PATH: '/usr/bin:/bin', [TELL_ENV.port]: String(port), [TELL_ENV.secret]: SECRET, [TELL_ENV.session]: SESSION, ...more })
const HANDED = JSON.stringify({ session_id: THREAD, prompt: 'the person’s words, which are nobody else’s', tool_input: { command: 'rm -rf /' } })

describe('the report a session’s program makes', () => {
  test('is one POST to this computer: the event’s name, the run, the conversation Codex says, and the secret in a header', async () => {
    heard.length = 0
    const done = await ran('/bin/sh', [TELL, 'Stop'], env(), HANDED)
    expect(done).toMatchObject({ code: 0, out: '' })
    expect(heard.length).toBe(1)
    expect(heard[0]).toMatchObject({ method: 'POST', url: `/api/state?event=Stop&session=${SESSION}&thread=${THREAD}`, ticket: SECRET, body: '' })
    expect(heard[0]!.headers.host).toBe(`127.0.0.1:${port}`)
  })

  test('carries nothing the program handed it: the prompt and the tool’s input stay where they were', async () => {
    heard.length = 0
    await ran('/bin/sh', [TELL, 'PermissionRequest'], env(), HANDED)
    const sent = JSON.stringify(heard[0])
    expect(sent).not.toContain('nobody else')
    expect(sent).not.toContain('rm -rf')
  })

  test('a conversation id it cannot be sure of is not sent: a prompt cannot fake the key', async () => {
    heard.length = 0
    await ran('/bin/sh', [TELL, 'Stop'], env(), JSON.stringify({ prompt: '\"session_id\": \"' + THREAD + '\"' }))
    await ran('/bin/sh', [TELL, 'Stop'], env(), JSON.stringify({ session_id: 'not-an-id' }))
    await ran('/bin/sh', [TELL, 'Stop'], env(), '')
    expect(heard.map((one) => one.url)).toEqual([`/api/state?event=Stop&session=${SESSION}`, `/api/state?event=Stop&session=${SESSION}`, `/api/state?event=Stop&session=${SESSION}`])
  })

  test('with nobody listening it is silence and exit 0, at once', async () => {
    const closed = createServer()
    await new Promise<void>((done) => closed.listen(0, '127.0.0.1', done))
    const dead = (closed.address() as AddressInfo).port
    await new Promise((done) => closed.close(done))
    const done = await ran('/bin/sh', [TELL, 'Stop'], env({ [TELL_ENV.port]: String(dead) }), HANDED)
    expect(done).toMatchObject({ code: 0, out: '' })
    expect(done.ms).toBeLessThan(2500)
  })

  test('a server that never answers costs two seconds and no more', async () => {
    const mute = createServer(() => {})
    await new Promise<void>((done) => mute.listen(0, '127.0.0.1', done))
    try {
      const done = await ran('/bin/sh', [TELL, 'Stop'], env({ [TELL_ENV.port]: String((mute.address() as AddressInfo).port) }))
      expect(done).toMatchObject({ code: 0, out: '' })
      expect(done.ms).toBeLessThan(3500)
    } finally {
      mute.closeAllConnections()
      mute.close()
    }
  })

  test('anything not spelled exactly as this module spells it sends nothing', async () => {
    heard.length = 0
    const cases: [string[], NodeJS.ProcessEnv][] = [
      [[TELL], env()],
      [[TELL, 'Stop&session=x'], env()],
      [[TELL, 'Stop;id'], env()],
      [[TELL, '$(id)'], env()],
      [[TELL, 'Stop'], env({ [TELL_ENV.port]: '' })],
      [[TELL, 'Stop'], env({ [TELL_ENV.port]: '80@evil.example' })],
      [[TELL, 'Stop'], env({ [TELL_ENV.port]: '123456' })],
      [[TELL, 'Stop'], env({ [TELL_ENV.secret]: '' })],
      [[TELL, 'Stop'], env({ [TELL_ENV.secret]: 'not"hex' })],
      [[TELL, 'Stop'], env({ [TELL_ENV.secret]: 'ab\nurl = "http://evil.example"' })],
      [[TELL, 'Stop'], env({ [TELL_ENV.session]: '' })],
      [[TELL, 'Stop'], env({ [TELL_ENV.session]: 'x&event=Stop' })],
      [[TELL, 'Stop'], { PATH: '/usr/bin:/bin' }],
    ]
    for (const [args, vars] of cases) expect(await ran('/bin/sh', args, vars, HANDED)).toMatchObject({ code: 0, out: '' })
    expect(heard).toEqual([])
  })

  test('it goes to this computer whatever the environment says about a proxy or an address', async () => {
    heard.length = 0
    const done = await ran(
      '/bin/sh',
      [TELL, 'Stop'],
      env({ http_proxy: 'http://127.0.0.1:1', HTTP_PROXY: 'http://127.0.0.1:1', all_proxy: 'http://127.0.0.1:1', KEHIKOT_TELL_URL: 'http://evil.example/', HOME: scratch }),
    )
    expect(done.code).toBe(0)
    expect(heard.length).toBe(1)
  })

  test('a curl a project put on PATH is not the one that is run', async () => {
    heard.length = 0
    const bin = join(scratch, 'planted')
    mkdirSync(bin, { recursive: true })
    writeFileSync(join(bin, 'curl'), `#!/bin/sh\necho planted > ${JSON.stringify(join(scratch, 'planted-ran'))}\n`, { mode: 0o755 })
    await ran('/bin/sh', [TELL, 'Stop'], env({ PATH: `${bin}:/usr/bin:/bin` }))
    expect(heard.length).toBe(1)
    expect(await Bun.file(join(scratch, 'planted-ran')).exists()).toBe(false)
  })
})

describe('the stand-in program reports as the real one does', () => {
  /** Start it on a new session with the hooks this module gives the real one, type the lines, and say what arrived. */
  async function session(lines: string[], more: NodeJS.ProcessEnv = {}, withHooks = true) {
    heard.length = 0
    const home = mkdtempSync(join(scratch, 'home-'))
    const bin = join(home, 'bin')
    mkdirSync(bin)
    copyFileSync(STAND_IN, join(bin, 'codex'))
    copyFileSync(`${STAND_IN}.ts`, join(bin, 'codex.ts'))
    chmodSync(join(bin, 'codex'), 0o755)
    const hooks = TELLS.map((one) => ({ event: one.event, ...(one.matcher ? { matcher: one.matcher } : {}), commands: [{ command: tellLine(one.says, TELL), timeout: 5 }] }))
    const args = [...PROGRAM.fresh(SESSION), ...(withHooks ? PROGRAM.hookArgs(hooks) : [])]
    const done = await ran(join(bin, 'codex'), args, env({ HOME: home, CODEX_HOME: join(home, 'codex'), KEHIKOT_TEST_BUN: process.execPath, ...more }), `${lines.join('\n')}\n/exit\n`, home)
    const events = heard.map((one) => new URL(one.url, 'http://x').searchParams.get('event'))
    return { done, events, states: events.map((event) => PROGRAM.signal(event ?? '')).filter(Boolean), threads: heard.map((one) => new URL(one.url, 'http://x').searchParams.get('thread')) }
  }

  test('a prompt and its answer: the conversation’s id from its first hook, working, then finished', async () => {
    const { events, states, done, threads } = await session(['hello'])
    expect(done.code).toBe(0)
    expect(done.out).not.toContain('Hooks need review')
    expect(events).toEqual(['SessionStart', 'UserPromptSubmit', 'Stop'])
    expect(states).toEqual(['working', 'finished'])
    expect(heard.every((one) => one.ticket === SECRET && one.url.includes(`session=${SESSION}`))).toBe(true)
    expect(new Set(threads).size).toBe(1)
    expect(PROGRAM.isId(threads[0]!)).toBe(true)
  })

  test('a permission in the middle: working, needs you, working again once it is answered, finished', async () => {
    const { states } = await session(['/ask', 'yes'])
    expect(states).toEqual(['working', 'needs-you', 'working', 'finished'])
  })

  test('Codex’s own question tool needs its person too, by the matcher on its name', async () => {
    const { events, states } = await session(['/question', 'blue'])
    expect(events).toContain('AskUser')
    expect(states).toEqual(['working', 'needs-you', 'working', 'finished'])
  })

  test('an interrupted turn is a turn that is over', async () => {
    expect((await session(['/work', '/interrupt'])).states).toEqual(['working', 'finished'])
  })

  test('/clear is a new conversation in the same process, said by its next hook', async () => {
    const { threads } = await session(['one', '/clear', 'two'])
    expect(new Set(threads).size).toBe(2)
  })

  test('given no hooks it reports nothing, and a hook whose trust does not match is not run', async () => {
    expect((await session(['hello'], {}, false)).events).toEqual([])
  })

  test('with its server gone it carries on exactly as it would have', async () => {
    const { done, events } = await session(['hello', '/ask', 'yes'], { [TELL_ENV.port]: '1' })
    expect(done.code).toBe(0)
    expect(done.out).toContain('you said: hello')
    expect(done.out).toContain('answered: yes')
    expect(events).toEqual([])
  })
})
