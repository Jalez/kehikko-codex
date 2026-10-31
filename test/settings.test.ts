import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { settingsDeclarationSchema } from 'kehikot-module-protocol'

import { MANIFEST, TICKET, answer, hostCheck } from '../doors.ts'
import { readSettings, writeSettings } from '../record.ts'
import { DEFAULTS, SETTINGS, sessionFlags, settingIssue, settingsOf } from '../settings.ts'

/**
 * Codex's settings at its door for the host (protocol 2.15.0): "Resume conversations cut off by a
 * restart" declared and the person's; a read and a change round trip through the same
 * `.kehikot/codex/settings.json` in the same format the page's toggle writes; an agent refused; a
 * person's pass asked only of the origins the host started this module with.
 */

const made: string[] = []
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})
let project: string
const realFetch = globalThis.fetch
const realHas = hostCheck.has
beforeEach(() => {
  project = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-settings-')))
  made.push(project)
  hostCheck.has = async (folder) => folder === project
})
afterEach(() => {
  globalThis.fetch = realFetch
  hostCheck.has = realHas
})

const file = () => join(project, '.kehikot', 'codex', 'settings.json')
const PASS = 'q'.repeat(30)

async function get(at = project) {
  const reply = await answer('GET', '/api/kehikot/settings', new URLSearchParams({ project: at }), null, null)
  return reply!.body as { values: Record<string, unknown>; file?: string; problem?: string }
}
async function set(body: Record<string, unknown>, ticket: string | null = null) {
  const reply = await answer('POST', '/api/kehikot/settings', new URLSearchParams(), { project, ...body }, ticket)
  return reply!.body as { outcome: string; why: string; values?: Record<string, unknown> }
}
function host(person: boolean) {
  const asked: string[] = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    asked.push(String(input))
    return Response.json({ ok: true, person })
  }) as unknown as typeof fetch
  return asked
}

describe('the declaration', () => {
  test('is in the manifest, parses, is the person’s, and defaults to on as the file does', () => {
    expect(MANIFEST.declares.settings).toEqual(SETTINGS)
    expect(settingsDeclarationSchema.parse(SETTINGS)).toEqual(SETTINGS)
    expect(SETTINGS.map((one) => one.key)).toEqual(['resumeCutOff', 'model', 'effort', 'approvals', 'wakeOnMessages', 'actOnMessages'])
    expect(SETTINGS[0]).toMatchObject({ key: 'resumeCutOff', type: 'boolean', default: true, scope: 'project', personOnly: true })
    expect(SETTINGS.every((one) => one.personOnly)).toBe(true)
    expect(readSettings(project)).toEqual(DEFAULTS)
  })

  test('none of them is about the sandbox, and the approval choice cannot let anything out unasked', () => {
    expect(SETTINGS.map((one) => one.key).join(' ')).not.toMatch(/sandbox/i)
    expect(SETTINGS.find((one) => one.key === 'approvals')?.choices?.map((one) => one.value)).toEqual(['default', 'on-request', 'never'])
  })
})

describe('what a session started here is given', () => {
  test('nothing for what is left at its default: the person’s own Codex config decides', () => {
    expect(sessionFlags(DEFAULTS)).toEqual([])
  })

  test('the model, its effort and when to ask, as Codex’s own `-c` keys', () => {
    expect(sessionFlags({ ...DEFAULTS, model: 'gpt-5.5', effort: 'high', approvals: 'never' })).toEqual(['-c', 'model="gpt-5.5"', '-c', 'model_reasoning_effort="high"', '-c', 'approval_policy="never"'])
  })

  test('a model that is not one word is not a model, and a value a file holds that is not one is the default', () => {
    expect(settingIssue('model', 'gpt 5" --yolo')).toContain('one word')
    expect(settingIssue('effort', 'max')).not.toBeNull()
    expect(settingIssue('sandbox', 'danger-full-access')).toContain('no setting')
    expect(settingsOf({ model: 'x y', effort: 'loud', approvals: 'never', resumeCutOff: 'yes' })).toEqual({ ...DEFAULTS, approvals: 'never' })
  })
})

describe('read and change, round trip', () => {
  test('get reads the default with no file, then what the toggle wrote', async () => {
    expect(await get()).toEqual({ ok: true, values: DEFAULTS, file: '.kehikot/codex/settings.json' } as never)
    writeSettings(project, { ...DEFAULTS, resumeCutOff: false })
    expect((await get()).values).toEqual({ ...DEFAULTS, resumeCutOff: false })
  })

  test("the page's ticket is the person: saved, in the format the toggle writes", async () => {
    expect((await set({ key: 'resumeCutOff', value: false }, TICKET)).outcome).toBe('saved')
    expect(readFileSync(file(), 'utf8')).toBe(`${JSON.stringify({ ...DEFAULTS, resumeCutOff: false }, null, 2)}\n`)
    expect(readSettings(project).resumeCutOff).toBe(false)
    expect((await set({ key: 'model', value: 'gpt-5.5' }, TICKET)).outcome).toBe('saved')
    expect((await set({ key: 'model', value: 'two words' }, TICKET)).outcome).toBe('refused')
    /* And the page's own route still reads it. */
    const page = await answer('GET', '/api/settings', new URLSearchParams({ projectPath: project }), null, TICKET)
    expect((page!.body as { settings: unknown }).settings).toEqual({ ...DEFAULTS, resumeCutOff: false, model: 'gpt-5.5' })
  })

  test('a folder the host does not hold is neither read nor written', async () => {
    const other = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-settings-other-')))
    made.push(other)
    expect((await get(other)).problem).toContain('not a project open in Kehikot')
    const said = await answer('POST', '/api/kehikot/settings', new URLSearchParams(), { project: other, key: 'resumeCutOff', value: false }, TICKET)
    expect((said!.body as { outcome: string }).outcome).toBe('refused')
    expect(existsSync(join(other, '.kehikot'))).toBe(false)
  })
})

describe('who may change it', () => {
  test('an agent is refused, with or without saying "person", and nothing is written', async () => {
    const asked = host(true)
    for (const body of [{ key: 'resumeCutOff', value: false }, { key: 'resumeCutOff', value: false, by: 'person' }]) {
      const said = await set(body)
      expect(said.outcome).toBe('refused')
      expect(said.why).toContain('An agent cannot change it')
    }
    expect(asked).toEqual([])
    expect(existsSync(file())).toBe(false)
  })

  test("a person's pass is asked only of the host's own origins, never of an address the request names", async () => {
    const asked = host(true)
    const said = await set({ key: 'resumeCutOff', value: false, by: 'person', pass: PASS, host: 'http://evil.example' })
    expect(said.outcome).toBe('saved')
    expect(asked).toHaveLength(1)
    expect(asked[0]!.startsWith(`${process.env.KEHIKOT_ORIGINS}/host/settings-pass?`)).toBe(true)
    expect(asked[0]).toContain('module=kehikot.codex')
    expect(asked[0]).toContain('key=resumeCutOff')
  })

  test('a pass the host does not vouch for is refused', async () => {
    host(false)
    expect((await set({ key: 'resumeCutOff', value: false, by: 'person', pass: PASS })).outcome).toBe('refused')
    expect(readSettings(project).resumeCutOff).toBe(true)
  })
})
