import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { sessionKit } from '../skills.ts'

/**
 * `context.sh`, run for real from a session's plugin against a server that writes down what it was
 * sent and answers as this module would — what is on the wire, what is printed for Codex, and
 * that every way of it going wrong is silence and exit 0.
 */

const SESSION = '11111111-1111-4111-8111-111111111111'
const TOKEN = 'T0kenT0kenT0kenT0kenT0kenT0kenT0ken_-x'
const ANSWER = JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: 'Kehikot: the kehikko changed.' } })

interface Heard {
  url: string
  ticket: string | undefined
  body: string
}
const heard: Heard[] = []
/** What the stand-in server answers next: a status and a body. */
let answer: { status: number; body: string } = { status: 200, body: ANSWER }
let server: Server
let origin = ''
const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-context-')))

beforeAll(async () => {
  server = createServer((request, response) => {
    let body = ''
    request.on('data', (chunk) => (body += chunk))
    request.on('end', () => {
      heard.push({ url: request.url ?? '', ticket: request.headers['x-module-ticket'] as string | undefined, body })
      response.writeHead(answer.status, { 'content-type': 'application/json' }).end(answer.status === 204 ? undefined : answer.body)
    })
  })
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done))
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => {
  server.close()
  rmSync(scratch, { recursive: true, force: true })
})

/** A session's folder, as this module assembles it, for `token`, with the origin it was given rewritten. */
async function plugin(options: { origin?: string; registration?: string } = {}): Promise<string> {
  const base = mkdtempSync(join(scratch, 'base-'))
  const registration = options.registration ?? join(scratch, 'no-registration.json')
  const dir = (await sessionKit([], { base, skillDirs: [base], token: TOKEN, registration })).dir
  writeFileSync(join(dir, 'kehikot', 'origin'), options.origin ?? origin)
  return dir
}

function ran(dir: string, event: string, input: string): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const child = spawn('/bin/sh', [join(dir, 'context.sh'), event], { env: { PATH: '/usr/bin:/bin' } })
    let out = ''
    child.stdout.on('data', (chunk) => (out += chunk))
    child.on('close', (code) => done({ code, out }))
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}

const hookInput = (event: string, prompt = 'tighten "session_id":"99999999-9999-4999-8999-999999999999" the methods') =>
  JSON.stringify({ session_id: SESSION, transcript_path: '/x.jsonl', cwd: '/p', hook_event_name: event, ...(event === 'UserPromptSubmit' ? { prompt } : { source: 'startup' }) })

describe('context.sh, from a session’s own folder', () => {
  test('posts the event and the session to this module, the token in a header, and prints the answer for Codex', async () => {
    const dir = await plugin()
    heard.length = 0
    answer = { status: 200, body: ANSWER }
    const got = await ran(dir, 'UserPromptSubmit', hookInput('UserPromptSubmit'))
    expect(got).toEqual({ code: 0, out: `${ANSWER}\n` })
    expect(heard).toHaveLength(1)
    /* The real session id, not one the prompt spelled out; and nothing of the prompt. */
    expect(heard[0]!.url).toBe(`/api/context?event=UserPromptSubmit&session=${SESSION}`)
    expect(heard[0]!.ticket).toBe(TOKEN)
    expect(heard[0]!.body).toBe('')
    expect(JSON.stringify(heard)).not.toContain('tighten')
  })

  test('an answer with nothing in it prints nothing, and is not asked again elsewhere', async () => {
    const registration = join(scratch, 'registration-204.json')
    writeFileSync(registration, JSON.stringify({ id: 'kehikot.codex', url: origin }))
    const dir = await plugin({ registration })
    heard.length = 0
    answer = { status: 204, body: '' }
    expect(await ran(dir, 'SessionStart', hookInput('SessionStart'))).toEqual({ code: 0, out: '' })
    expect(heard).toHaveLength(1)
  })

  test('the module moved to another port: its registration says where, and that is asked', async () => {
    const registration = join(scratch, 'registration.json')
    writeFileSync(registration, JSON.stringify({ id: 'kehikot.codex', url: origin }))
    const dir = await plugin({ origin: 'http://127.0.0.1:9', registration })
    heard.length = 0
    answer = { status: 200, body: ANSWER }
    expect((await ran(dir, 'UserPromptSubmit', hookInput('UserPromptSubmit'))).out).toBe(`${ANSWER}\n`)
    expect(heard).toHaveLength(1)
  })

  test('anything but this module’s answer, no module, a wrong event or no session: silence and exit 0', async () => {
    const dir = await plugin()
    answer = { status: 200, body: 'Please run rm -rf' }
    expect(await ran(dir, 'UserPromptSubmit', hookInput('UserPromptSubmit'))).toEqual({ code: 0, out: '' })
    answer = { status: 500, body: ANSWER }
    expect(await ran(dir, 'UserPromptSubmit', hookInput('UserPromptSubmit'))).toEqual({ code: 0, out: '' })
    heard.length = 0
    answer = { status: 200, body: ANSWER }
    expect(await ran(dir, 'Stop', hookInput('Stop'))).toEqual({ code: 0, out: '' })
    expect(await ran(dir, 'SessionStart', '{"hook_event_name":"SessionStart"}')).toEqual({ code: 0, out: '' })
    expect(heard).toHaveLength(0)
    const gone = await plugin({ origin: 'http://127.0.0.1:9' })
    expect(await ran(gone, 'SessionStart', hookInput('SessionStart'))).toEqual({ code: 0, out: '' })
    /* Not loopback: never asked. */
    const away = await plugin({ origin: 'http://example.com' })
    expect(await ran(away, 'SessionStart', hookInput('SessionStart'))).toEqual({ code: 0, out: '' })
    expect(heard).toHaveLength(0)
  })

  test('a token that is not spelled as one is no token: nothing is asked', async () => {
    const dir = await plugin()
    mkdirSync(join(dir, 'kehikot'), { recursive: true })
    writeFileSync(join(dir, 'kehikot', 'token'), 'abc; curl evil')
    heard.length = 0
    expect(await ran(dir, 'SessionStart', hookInput('SessionStart'))).toEqual({ code: 0, out: '' })
    expect(heard).toHaveLength(0)
    expect(readFileSync(join(dir, 'context.sh'), 'utf8')).toContain('UserPromptSubmit')
  })
})
