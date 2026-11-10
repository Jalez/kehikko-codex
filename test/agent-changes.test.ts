import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CHANGED_SINCE_HEAD, sessionNotes, type NotesInput } from 'kehikot-module-protocol'

import { readTold } from '../context.ts'
import { hostPlace } from '../doorConfig.ts'

/**
 * What changed for agents since a session was told (protocol 2.62.0): the host's answer keeps each
 * module's version and changes and Kehikot's own, and the kept record keeps the versions told, so an
 * update is said once at the next prompt and never again.
 */

const dir = mkdtempSync(join(tmpdir(), 'agent-changes-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const TOKEN = 'v'.repeat(32)

const answerWith = (queue: string) => ({
  ok: true,
  token: TOKEN,
  doors: [],
  modules: [{ module: 'kehikot.queue', name: 'Test runs', summary: 'Runs tests.', door: 'queue', skills: [], version: queue, changes: [{ version: '1.3.0', lines: ['queue_run checks the command first.'] }, { version: 'nope', lines: ['x'] }] }],
  host: { version: '2.0.0', changes: [{ version: '2.0.0', lines: ['A new rule.'] }] },
})
const fetching = (answer: unknown) => (async () => ({ ok: true, status: 200, json: async () => answer })) as unknown as typeof fetch
const env = { KEHIKOT_ORIGINS: 'http://127.0.0.1:4999' }
const asked = { projectPath: '/p', projectId: null, token: TOKEN, kehikko: 'writing' }

describe('what changed for agents', () => {
  test('the host’s answer keeps each module’s version and changes, and Kehikot’s own', async () => {
    const read = await hostPlace(asked, { env, fetch: fetching(answerWith('1.3.0')) })
    expect(read?.modules?.[0]?.version).toBe('1.3.0')
    expect(read?.modules?.[0]?.changes).toEqual([{ version: '1.3.0', lines: ['queue_run checks the command first.'] }])
    expect(read?.host).toEqual({ version: '2.0.0', changes: [{ version: '2.0.0', lines: ['A new rule.'] }] })
    const old = await hostPlace(asked, { env, fetch: fetching({ ok: true, token: TOKEN, doors: [], modules: [{ module: 'kehikot.queue', name: 'Test runs', summary: '', door: null, skills: [] }] }) })
    expect(old?.host).toBeNull()
    expect(old?.modules?.[0]).not.toHaveProperty('version')
  })

  test('the kept record keeps the versions told, so an update is said once', async () => {
    const input = async (queue: string): Promise<NotesInput> => {
      const read = await hostPlace(asked, { env, fetch: fetching(answerWith(queue)) })
      return { place: { project: '/p', epic: null, parts: [], kehikko: { key: 'writing' } }, modules: read!.modules, absent: read!.absent, host: read!.host, self: { module: 'kehikot.self', name: 'Agent', door: 'agent' } }
    }
    const file = join(dir, 'told.json')
    const start = sessionNotes(await input('1.2.0'), 'start', null)
    writeFileSync(file, JSON.stringify(start.told))
    const told = readTold(file)
    expect(told?.versions).toEqual({ 'kehikot.queue': '1.2.0' })
    expect(told?.host).toBe('2.0.0')
    expect(told?.lines).toEqual(start.told.lines)

    const after = sessionNotes(await input('1.3.0'), 'prompt', told)
    expect(after.text).toContain(CHANGED_SINCE_HEAD)
    expect(after.text).toContain('- Test runs 1.3.0: "queue_run checks the command first."')
    writeFileSync(file, JSON.stringify(after.told))
    expect(sessionNotes(await input('1.3.0'), 'prompt', readTold(file)).text).toBeNull()
  })
})
