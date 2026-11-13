import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MESSAGE_TOOL_NAMES, forgetMessageHosts } from 'kehikot-module-protocol/serve'

import { SELF, context, type ContextNeeds } from '../context.ts'
import { answer } from '../doors.ts'
import { OWN_DOOR, withOwnDoor, type HostPlace, type SessionDoor } from '../doorConfig.ts'
import { ID } from '../manifest.ts'

/**
 * Jalez/kehikko-claude#80: a session's notes and its door of this module agree about messaging. The
 * door lists the message tools for its token even while the host cannot answer yet (an agent lists a
 * door's tools once, when it connects); a session is always handed this module's own tokened door;
 * and the notes promise the tools only to a session whose door carries the token.
 */

const TOKEN = 'a'.repeat(40)
const OTHER = 'b'.repeat(40)
const SESSION = '11111111-1111-4111-8111-111111111111'
const HOST = 'http://127.0.0.1:4170'

let asked: { method: string; params: Record<string, unknown> }[] = []
let host: 'up' | 'down' = 'up'
let was: { fetch: typeof fetch; origins: string | undefined }

beforeAll(() => {
  was = { fetch: globalThis.fetch, origins: process.env.KEHIKOT_ORIGINS }
  process.env.KEHIKOT_ORIGINS = 'http://127.0.0.1:4998'
  globalThis.fetch = (async (_url: string, init?: RequestInit) => {
    if (host === 'down') throw new Error('ECONNREFUSED')
    const body = JSON.parse(String(init?.body ?? '{}')) as { method: string; params: Record<string, unknown> }
    asked.push({ method: body.method, params: body.params })
    if (body.params?.token !== TOKEN) return { ok: true, status: 200, json: async () => ({ ok: false, reason: 'failed', refused: 'project', error: 'That token is not one this host holds.' }) }
    const data = body.method === 'messages.send' ? { outcome: 'sent', id: 9, why: '' } : { messages: [], unread: 0, you: { module: ID, session: SESSION, place: { epic: null, parts: [], kehikko: null } } }
    return { ok: true, status: 200, json: async () => ({ ok: true, data }) }
  }) as unknown as typeof fetch
})
afterAll(() => {
  globalThis.fetch = was.fetch
  if (was.origins === undefined) Reflect.deleteProperty(process.env, 'KEHIKOT_ORIGINS')
  else process.env.KEHIKOT_ORIGINS = was.origins
})
beforeEach(() => {
  forgetMessageHosts()
  asked = []
  host = 'up'
})

const listed = async (query: URLSearchParams): Promise<string[]> => {
  const reply = (await answer('POST', '/mcp', query, { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }, null))?.body as { result?: { tools?: { name: string }[] } }
  return (reply.result?.tools ?? []).map((tool) => tool.name)
}
const called = async (query: URLSearchParams, name: string, args: Record<string, unknown>) =>
  ((await answer('POST', '/mcp', query, { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, null))?.body as { result?: { content?: { text: string }[]; isError?: boolean } }).result
const tokened = (token = TOKEN) => new URLSearchParams({ 'kehikot-place': token })
const hasMessaging = (names: string[]) => MESSAGE_TOOL_NAMES.every((name) => names.includes(name))

describe('the door', () => {
  test('lists the message tools for its token even while no host answers: the agent asks only once', async () => {
    host = 'down'
    expect(hasMessaging(await listed(tokened()))).toBe(true)
    expect((await called(tokened(), 'read_messages', {}))?.isError).toBe(true)
  })

  test('the person’s own entry, with no token, lists them too: a tool a caller cannot use yet answers why (protocol 2.96.0)', async () => {
    expect(hasMessaging(await listed(new URLSearchParams()))).toBe(true)
  })
})

describe('the doors a session is handed', () => {
  const hostDoor = (url: string, name = 'kehikko'): SessionDoor => ({ module: 'kehikko', name, url, transport: 'http' })

  test('this module’s own door is added, with the token, when the host handed none or left it out', () => {
    for (const given of [null, [], [hostDoor(`http://127.0.0.1:4170/mcp?kehikot-place=${TOKEN}`)]]) {
      const own = withOwnDoor(given, HOST, TOKEN)!.find((door) => door.module === ID)
      expect(own).toEqual({ module: ID, name: OWN_DOOR, url: `${HOST}/m/${ID}/mcp?kehikot-place=${TOKEN}`, transport: 'http' })
    }
    expect(OWN_DOOR).toBe(SELF.door)
  })

  test('the host’s door for this module is kept; another under its name gives way; nothing without a starting host or a real token', () => {
    const stable: SessionDoor = { module: ID, name: OWN_DOOR, url: `http://127.0.0.1:4170/m/${ID}/mcp?kehikot-place=${TOKEN}`, transport: 'http' }
    expect(withOwnDoor([stable], HOST, TOKEN)).toEqual([stable])
    expect(withOwnDoor([hostDoor('http://127.0.0.1:7000/mcp', OWN_DOOR)], HOST, TOKEN)!.filter((door) => door.name === OWN_DOOR).map((door) => door.module)).toEqual([ID])
    expect(withOwnDoor(null, null, TOKEN)).toBeNull()
    expect(withOwnDoor(null, HOST, 'not a token&kehikot-place=x')).toBeNull()
  })
})

describe('the notes say what the door has', () => {
  const project = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-agree-')))
  const place: HostPlace = { doors: [], modules: [], absent: [], everywhere: null, messages: [], messagesMore: 0 }
  const needs = (doors: string[] | null): ContextNeeds => ({
    program: { isId: (id: string) => id === SESSION, settled: async () => false } as unknown as ContextNeeds['program'],
    startedOf: () => ({ projectPath: project, projectId: null, place: { epic: 'methods', parts: [], kehikko: null } }),
    host: async () => place,
    doorsOf: () => doors,
    toldFile: () => join(project, `told-${Math.random()}.json`),
    told: () => {},
    log: () => {},
  })
  const notes = async (doors: string[] | null) => JSON.stringify(await context({ event: 'SessionStart', session: SESSION, token: TOKEN }, needs(doors)))

  test('a session handed this module’s tokened door is told the tools and its address, and the door lists them', async () => {
    const doors = withOwnDoor(null, HOST, TOKEN)!
    const text = await notes(doors.map((door) => door.name))
    expect(text).toContain(`can message each other: send_message and read_messages on the ${SELF.name} module’s MCP server (${SELF.door})`)
    expect(text).toContain('Others reach this conversation')
    expect(hasMessaging(await listed(new URL(doors[0]!.url).searchParams))).toBe(true)
  })

  test('a session without one is not promised them and is told how to get them, and the door lists them anyway and answers why', async () => {
    for (const doors of [null, ['kehikko']]) {
      const text = await notes(doors)
      expect(text).not.toContain('can message each other: send_message')
      expect(text).not.toContain('Others reach this conversation')
      expect(text).toContain('but not from this conversation')
      expect(text).toContain(`open it again from the ${SELF.name} container`)
    }
    expect(hasMessaging(await listed(new URLSearchParams()))).toBe(true)
  })
})

describe('one conversation cannot act as another', () => {
  test('a call sends the host only the token on its own door’s URL, whatever its arguments say', async () => {
    const said = await called(tokened(), 'send_message', { body: 'hi', token: OTHER, session: 'someone-else', from: { session: 'x' } })
    expect(said?.content?.[0]?.text).toBe('Sent (message #9).')
    expect(asked.at(-1)).toEqual({ method: 'messages.send', params: { token: TOKEN, body: 'hi' } })
  })

  test('a door without a token cannot borrow one from its arguments, and a token the host does not hold is refused', async () => {
    expect((await called(new URLSearchParams(), 'send_message', { body: 'hi', token: TOKEN, 'kehikot-place': TOKEN }))?.isError).toBe(true)
    expect(asked).toEqual([])
    const said = await called(tokened(OTHER), 'read_messages', {})
    expect(said?.isError).toBe(true)
    expect(said?.content?.[0]?.text).toContain('not one this host holds')
  })
})
