import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { MESSAGE_TOOL_NAMES, forgetMessageHosts } from 'kehikot-module-protocol/serve'

import { MANIFEST, answer } from '../doors.ts'
import { hostPlace } from '../doorConfig.ts'
import { ID } from '../manifest.ts'

/**
 * Messages between agent sessions (protocol 2.41.0): this module declares `agents:message`, puts the
 * protocol's `send_message` and `read_messages` on its door as a thin adapter over the host, and asks
 * the host for a session's unread ones with its notes. The host keeps them; this module keeps none.
 */

const TOKEN = 'm'.repeat(32)
const none = new URLSearchParams()
const withToken = new URLSearchParams({ 'kehikot-place': TOKEN })
let asked: { method: string; params: Record<string, unknown> }[] = []
let was: { fetch: typeof fetch; origins: string | undefined }

beforeAll(() => {
  /* A stand-in host: the door's questions come here, never to a running Kehikot. */
  was = { fetch: globalThis.fetch, origins: process.env.KEHIKOT_ORIGINS }
  process.env.KEHIKOT_ORIGINS = 'http://127.0.0.1:4999'
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { method: string; params: Record<string, unknown> }
    asked.push({ method: body.method, params: body.params })
    const data =
      body.method === 'messages.send'
        ? { outcome: 'sent', id: 3, why: '' }
        : { messages: [], unread: 0, you: { module: ID, session: 's', place: { epic: null, parts: [], kehikko: null } } }
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) }
  }) as unknown as typeof fetch
})
afterAll(() => {
  globalThis.fetch = was.fetch
  if (was.origins === undefined) Reflect.deleteProperty(process.env, 'KEHIKOT_ORIGINS')
  else process.env.KEHIKOT_ORIGINS = was.origins
})

const rpc = async (method: string, params: Record<string, unknown>, query: URLSearchParams) =>
  (await answer('POST', '/mcp', query, { jsonrpc: '2.0', id: 1, method, params }, null))?.body as {
    result?: { tools?: { name: string }[]; content?: { text: string }[]; isError?: boolean }
  }

describe('messages between agent sessions', () => {
  test('the manifest asks for agents:message', () => {
    expect(MANIFEST.declares?.uses).toContain('agents:message')
  })

  test('a session with no token is offered no message tools, and a call sends nothing', async () => {
    forgetMessageHosts()
    asked = []
    const names = ((await rpc('tools/list', {}, none)).result?.tools ?? []).map((tool) => tool.name)
    for (const name of MESSAGE_TOOL_NAMES) expect(names).not.toContain(name)
    const said = await rpc('tools/call', { name: 'send_message', arguments: { body: 'hi' } }, none)
    expect(said.result?.isError).toBe(true)
    expect(asked).toEqual([])
  })

  test('a session the host keeps messages for gets both tools, and they ask the host for it', async () => {
    forgetMessageHosts()
    asked = []
    const names = ((await rpc('tools/list', {}, withToken)).result?.tools ?? []).map((tool) => tool.name)
    for (const name of MESSAGE_TOOL_NAMES) expect(names).toContain(name)
    const sent = await rpc('tools/call', { name: 'send_message', arguments: { body: 'hello', to: { project: true } } }, withToken)
    expect(sent.result?.content?.[0]?.text).toBe('Sent (message #3).')
    expect(asked.at(-1)).toEqual({ method: 'messages.send', params: { token: TOKEN, body: 'hello', to: { project: true } } })
    const read = await rpc('tools/call', { name: 'read_messages', arguments: { unread: true } }, withToken)
    expect(read.result?.content?.[0]?.text).toContain('No messages.')
  })

  test('the notes ask for the unread ones, and an older host’s answer has none', async () => {
    let body: Record<string, unknown> = {}
    const message = {
      id: 1,
      at: '2026-10-31T12:00:00.000Z',
      from: { module: 'stand.alpha', name: 'Alpha', session: 'a', place: { epic: 'methods', parts: [], kehikko: null } },
      to: { project: true },
      thread: null,
      body: 'hello',
    }
    const host = (answer: Record<string, unknown>) =>
      (async (_url: string, init?: RequestInit) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>
        return { ok: true, status: 200, json: async () => ({ ok: true, token: TOKEN, doors: [], ...answer }) }
      }) as unknown as typeof fetch
    const env = { KEHIKOT_ORIGINS: 'http://127.0.0.1:4999' }
    const asked = { projectPath: '/p', projectId: null, token: TOKEN, kehikko: null }
    const now = await hostPlace(asked, { env, fetch: host({ messages: [message, { nonsense: true }], messagesMore: 2 }) })
    expect(body.messages).toBe(true)
    expect(now?.messages?.map((one) => one.body)).toEqual(['hello'])
    expect(now?.messagesMore).toBe(2)
    const older = await hostPlace(asked, { env, fetch: host({}) })
    expect(older?.messages).toBeNull()
    expect(older?.messagesMore).toBe(0)
  })
})
