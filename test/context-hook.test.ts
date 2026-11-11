import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { WorkQueue } from 'kehikot-module-protocol'

import { unguardedHook } from '../context.ts'
import { sessionKit } from '../skills.ts'
import { unguardedSaid } from '../workQueue.ts'

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
async function plugin(options: { origin?: string; registration?: string; unguarded?: string } = {}): Promise<string> {
  const base = mkdtempSync(join(scratch, 'base-'))
  const registration = options.registration ?? join(scratch, 'no-registration.json')
  const dir = (await sessionKit([], { base, agentsDir: join(base, 'agents'), personal: [], token: TOKEN, registration, unguarded: options.unguarded })).dir
  writeFileSync(join(dir, 'kehikot', 'origin'), options.origin ?? origin)
  return dir
}

function ran(dir: string, event: string, input: string, script = 'context.sh', env: Record<string, string> = {}): Promise<{ code: number | null; out: string }> {
  return new Promise((done) => {
    const child = spawn('/bin/sh', [join(dir, script), event], { env: { PATH: '/usr/bin:/bin', ...env } })
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

describe('context.sh at a subagent’s start (protocol 2.61.0)', () => {
  test('SubagentStart is asked like the others, with the parent conversation’s id, and the answer printed', async () => {
    const dir = await plugin()
    heard.length = 0
    const body = JSON.stringify({ hookSpecificOutput: { hookEventName: 'SubagentStart', additionalContext: 'Kehikot: you are a subagent.' } })
    answer = { status: 200, body }
    const input = JSON.stringify({ session_id: SESSION, hook_event_name: 'SubagentStart', agent_id: 'agent-1', agent_type: 'worker', turn_id: 't1' })
    expect(await ran(dir, 'SubagentStart', input)).toEqual({ code: 0, out: `${body}\n` })
    expect(heard[0]!.url).toBe(`/api/context?event=SubagentStart&session=${SESSION}`)
  })
})

describe('guard.sh, from a session’s own folder (protocol 2.61.0)', () => {
  const REWRITE = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'allow', updatedInput: { command: "q run -- sh -c 'tsc'" }, additionalContext: 'Rewritten.' } })
  const DENY = JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: 'No.' } })
  const bashInput = (command: string) => JSON.stringify({ session_id: SESSION, turn_id: 't1', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'call-1', tool_input: { command } })

  test('is copied into the folder beside context.sh', async () => {
    const dir = await plugin()
    expect(readFileSync(join(dir, 'guard.sh'), 'utf8')).toBe(readFileSync(join(import.meta.dir, '..', 'guard.sh'), 'utf8'))
  })

  test('posts the hook input to this module, the token in a header, and prints its answer', async () => {
    const dir = await plugin()
    for (const body of [REWRITE, DENY]) {
      heard.length = 0
      answer = { status: 200, body }
      expect(await ran(dir, 'PreToolUse', bashInput(`tsc "it's" && echo $HOME`), 'guard.sh')).toEqual({ code: 0, out: `${body}\n` })
      expect(heard).toHaveLength(1)
      expect(heard[0]!.url).toBe(`/api/guard?session=${SESSION}&direct=0`)
      expect(heard[0]!.ticket).toBe(TOKEN)
      expect(JSON.parse(heard[0]!.body).tool_input.command).toBe(`tsc "it's" && echo $HOME`)
    }
  })

  test('KEHIKOT_DIRECT in the session’s environment is said', async () => {
    const dir = await plugin()
    heard.length = 0
    answer = { status: 204, body: '' }
    expect(await ran(dir, 'PreToolUse', bashInput('tsc'), 'guard.sh', { KEHIKOT_DIRECT: '1' })).toEqual({ code: 0, out: '' })
    expect(heard[0]!.url).toBe(`/api/guard?session=${SESSION}&direct=1`)
  })

  test('the module moved to another port: its registration says where', async () => {
    const registration = join(scratch, 'registration-guard.json')
    writeFileSync(registration, JSON.stringify({ id: 'kehikot.codex', url: origin }))
    const dir = await plugin({ origin: 'http://127.0.0.1:9', registration })
    answer = { status: 200, body: DENY }
    expect((await ran(dir, 'PreToolUse', bashInput('tsc'), 'guard.sh')).out).toBe(`${DENY}\n`)
  })

  test('nothing to say, another answer, no module or another event: silence and exit 0, the command runs as written', async () => {
    const dir = await plugin()
    answer = { status: 204, body: '' }
    expect(await ran(dir, 'PreToolUse', bashInput('tsc'), 'guard.sh')).toEqual({ code: 0, out: '' })
    answer = { status: 200, body: ANSWER }
    expect(await ran(dir, 'PreToolUse', bashInput('tsc'), 'guard.sh')).toEqual({ code: 0, out: '' })
    answer = { status: 500, body: DENY }
    expect(await ran(dir, 'PreToolUse', bashInput('tsc'), 'guard.sh')).toEqual({ code: 0, out: '' })
    heard.length = 0
    answer = { status: 200, body: DENY }
    expect(await ran(dir, 'PostToolUse', bashInput('tsc'), 'guard.sh')).toEqual({ code: 0, out: '' })
    expect(await ran(dir, 'PreToolUse', '{"tool_name":"Bash"}', 'guard.sh')).toEqual({ code: 0, out: '' })
    expect(heard).toHaveLength(0)
  })

  /* Kehikot restarting while the session runs: the host and this module away, then back on new ports. */
  describe('across a restart of Kehikot', () => {
    /** A stand-in for this module (or the host in front of it) that can be away, say 503, or answer, and can move. */
    async function standIn(first: { status: number; body: string } | 'away') {
      let now = first
      const asked: string[] = []
      const one = createServer((request, response) => {
        request.resume()
        request.on('end', () => {
          asked.push(request.url ?? '')
          const said = now === 'away' ? { status: 503, body: 'not up' } : now
          response.writeHead(said.status, { 'content-type': 'application/json' }).end(said.status === 204 ? undefined : said.body)
        })
      })
      await new Promise<void>((done) => one.listen(0, '127.0.0.1', done))
      const url = `http://127.0.0.1:${(one.address() as AddressInfo).port}`
      return { url, asked, set: (next: typeof now) => (now = next), close: () => new Promise<void>((done) => one.close(() => done())) }
    }
    /** A port nothing answers on. */
    async function deadUrl(): Promise<string> {
      const one = createServer()
      await new Promise<void>((done) => one.listen(0, '127.0.0.1', done))
      const port = (one.address() as AddressInfo).port
      await new Promise<void>((done) => one.close(() => done()))
      return `http://127.0.0.1:${port}`
    }

    test('nobody answers, no work queue named: after the wait the command runs as written, and the agent is told only that it ran unguarded', async () => {
      const gone = await plugin({ origin: await deadUrl() })
      const got = await ran(gone, 'PreToolUse', bashInput('tsc'), 'guard.sh', { KEHIKOT_GUARD_WAIT: '0' })
      expect(got.code).toBe(0)
      const note = JSON.parse(got.out).hookSpecificOutput
      expect(note.hookEventName).toBe('PreToolUse')
      /* Decides nothing (Codex fails open on an `allow` without `updatedInput`): only context for the model. */
      expect(note).not.toHaveProperty('updatedInput')
      expect(note).not.toHaveProperty('permissionDecision')
      expect(note.additionalContext).toContain('ran without the guards')
      expect(note.additionalContext).not.toMatch(/queue/i)
    })

    test('nobody answers, a work queue named: the agent is told how to hand it heavy work, in its descriptor’s words', async () => {
      const queue: WorkQueue = { name: 'Lane Keeper', run: { test: "'/opt/lane' take -- {command}" }, marks: [] }
      const gone = await plugin({ origin: await deadUrl(), unguarded: unguardedHook(queue) })
      const got = await ran(gone, 'PreToolUse', bashInput('tsc'), 'guard.sh', { KEHIKOT_GUARD_WAIT: '0' })
      expect(got.code).toBe(0)
      expect(JSON.parse(got.out).hookSpecificOutput.additionalContext).toBe(unguardedSaid(queue))
      expect(got.out).toContain("through Lane Keeper yourself: `'/opt/lane' take -- <command>`")
    })

    test('the module comes back on another port within the wait: its registration is followed and the guard applies', async () => {
      const registration = join(scratch, 'registration-moving.json')
      const old = await deadUrl()
      writeFileSync(registration, JSON.stringify({ id: 'kehikot.codex', url: old }))
      const dir = await plugin({ origin: old, registration })
      const running = ran(dir, 'PreToolUse', bashInput('bun test'), 'guard.sh', { KEHIKOT_GUARD_WAIT: '10' })
      await Bun.sleep(1500)
      const back = await standIn({ status: 200, body: REWRITE })
      writeFileSync(registration, JSON.stringify({ id: 'kehikot.codex', url: back.url }))
      const got = await running
      await back.close()
      expect(got).toEqual({ code: 0, out: `${REWRITE}\n` })
      expect(back.asked).toHaveLength(1)
    }, 15_000)

    test('the stable address is asked first; the host saying the module is not up yet is waited out, and the guard applies', async () => {
      const host = await standIn('away')
      const dir = await plugin({ origin: await deadUrl() })
      writeFileSync(join(dir, 'kehikot', 'stable'), host.url)
      const running = ran(dir, 'PreToolUse', bashInput('bun test'), 'guard.sh', { KEHIKOT_GUARD_WAIT: '10' })
      await Bun.sleep(1500)
      host.set({ status: 200, body: REWRITE })
      const got = await running
      await host.close()
      expect(got).toEqual({ code: 0, out: `${REWRITE}\n` })
      expect(host.asked.length).toBeGreaterThan(1)
      expect(host.asked.every((one) => one === `/api/guard?session=${SESSION}&direct=0`)).toBe(true)
    }, 15_000)

    test('the module saying it cannot know the guards yet (503) is asked again, not taken for "no guards"', async () => {
      const module = await standIn({ status: 503, body: '{"ok":false}' })
      const dir = await plugin({ origin: module.url })
      const running = ran(dir, 'PreToolUse', bashInput('bun test'), 'guard.sh', { KEHIKOT_GUARD_WAIT: '10' })
      await Bun.sleep(1200)
      module.set({ status: 200, body: REWRITE })
      expect(await running).toEqual({ code: 0, out: `${REWRITE}\n` })
      await module.close()
    }, 15_000)

    test('while Kehikot stays away, the next commands do not wait again; once it answers, they wait again next time', async () => {
      const dir = await plugin({ origin: await deadUrl() })
      await ran(dir, 'PreToolUse', bashInput('tsc'), 'guard.sh', { KEHIKOT_GUARD_WAIT: '1' })
      const started = Date.now()
      const again = await ran(dir, 'PreToolUse', bashInput('tsc'), 'guard.sh', { KEHIKOT_GUARD_WAIT: '10' })
      expect(Date.now() - started).toBeLessThan(5000)
      expect(again.out).toContain('ran without the guards')
      const module = await standIn({ status: 204, body: '' })
      writeFileSync(join(dir, 'kehikot', 'origin'), module.url)
      expect(await ran(dir, 'PreToolUse', bashInput('tsc'), 'guard.sh')).toEqual({ code: 0, out: '' })
      await module.close()
      expect(existsSync(join(dir, 'kehikot', 'away'))).toBe(false)
    }, 15_000)

    test('context.sh asks the stable address first', async () => {
      const host = await standIn({ status: 200, body: ANSWER })
      const dir = await plugin({ origin: await deadUrl() })
      writeFileSync(join(dir, 'kehikot', 'stable'), host.url)
      expect((await ran(dir, 'UserPromptSubmit', hookInput('UserPromptSubmit'))).out).toBe(`${ANSWER}\n`)
      await host.close()
      expect(host.asked).toEqual([`/api/context?event=UserPromptSubmit&session=${SESSION}`])
    })
  })
})
