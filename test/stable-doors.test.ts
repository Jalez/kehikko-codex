import { describe, expect, test } from 'bun:test'

import { doorConfigProblems } from 'kehikot-module-protocol/serve'

import { OWN_DOOR, hostPlace, withOwnDoor } from '../doorConfig.ts'
import { ID } from '../manifest.ts'

/**
 * Protocol 2.95.0: every door a session is written names the stable address of the host that
 * STARTED this module, never a module's own port and never another host — a scratch host an agent
 * ran over a copy of a project once wrote its doors into a sibling module's sessions, and an agent
 * reconnects only to what it was given at launch.
 */

const HOST = 'http://127.0.0.1:4170'
const SCRATCH = 'http://127.0.0.1:47700'
const TOKEN = 'c'.repeat(43)
describe('the door URL comes from the start environment', () => {
  test('the starting host alone is asked, and its answer is written on its stable address — whatever another origin says', async () => {
    const asked: string[] = []
    const answer = (origin: string) =>
      Response.json({
        ok: true,
        token: TOKEN,
        doors: [
          { module: 'kehikko', name: 'kehikko', url: `${origin}/mcp?kehikot-place=${TOKEN}`, transport: 'http' },
          { module: 'kehikot.paper', name: 'paper', url: `http://127.0.0.1:7870/mcp?kehikot-place=${TOKEN}`, transport: 'http' },
        ],
      })
    const fetch = (async (url: string) => {
      asked.push(new URL(url).origin)
      return answer(new URL(url).origin === HOST ? HOST : SCRATCH)
    }) as unknown as typeof globalThis.fetch
    const got = await hostPlace(
      { projectPath: '/p', projectId: null, token: TOKEN, kehikko: null },
      { env: { KEHIKOT_HOST: HOST, KEHIKOT_ORIGINS: `${SCRATCH} http://127.0.0.1:4181` }, fetch },
    )
    expect(asked).toEqual([HOST])
    expect(got!.doors.map((door) => door.url)).toEqual([`${HOST}/mcp?kehikot-place=${TOKEN}`, `${HOST}/m/kehikot.paper/mcp?kehikot-place=${TOKEN}`])
  })

  test('a foreign-origin host is never asked: when the starting host does not answer, there are no doors', async () => {
    const asked: string[] = []
    const fetch = (async (url: string) => {
      asked.push(new URL(url).origin)
      throw new Error('refused')
    }) as unknown as typeof globalThis.fetch
    expect(await hostPlace({ projectPath: '/p', projectId: null, token: TOKEN, kehikko: null }, { env: { KEHIKOT_HOST: HOST, KEHIKOT_ORIGINS: SCRATCH }, fetch })).toBeNull()
    expect(asked).toEqual([HOST])
  })
})

describe('a raw-port entry is never written', () => {
  test('this module’s own door is on the starting host’s stable address', () => {
    const doors = withOwnDoor(null, HOST, TOKEN)!
    expect(doors).toEqual([{ module: ID, name: OWN_DOOR, url: `${HOST}/m/${ID}/mcp?kehikot-place=${TOKEN}`, transport: 'http' }])
    expect(doorConfigProblems({ mcpServers: { [doors[0]!.name]: { url: doors[0]!.url } } }, HOST)).toEqual([])
  })
})

