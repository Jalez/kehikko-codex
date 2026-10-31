import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WELL_KNOWN, skillPath } from 'kehikot-module-protocol'

import { MARKER, agentsSkillsDir, disabledArgs, keep, othersInstalled, readLocal, resyncEverywhere, sweep, versionOf, filesOf, type Holder, type Wanted } from '../agentSkills.ts'
import { HOME } from './setup.ts'

/** Installing Kehikot's skills where Codex reads them: who owns a folder, and when it goes. */

const scratch: string[] = []
const dir = () => {
  const one = mkdtempSync(join(tmpdir(), 'kehikko-codex-agents-'))
  scratch.push(one)
  return one
}
afterAll(() => {
  for (const one of scratch) rmSync(one, { recursive: true, force: true })
})

const skill = (name: string, body = 'Do it.', more: Partial<Wanted> = {}): Wanted => ({
  name,
  module: 'kehikot.journeys',
  text: `---\nname: ${name}\ndescription: "${name}"\n---\n${body}\n`,
  yaml: null,
  bound: false,
  everywhere: false,
  ...more,
})
/** A conversation that holds what it was given while its folder is there. */
const holder = (): Holder => ({ dir: dir(), pid: process.pid })
const names = (root: string) => (existsSync(root) ? readdirSync(root).filter((one) => !one.startsWith('.')).sort() : [])
const marker = (root: string, name: string) => JSON.parse(readFileSync(join(root, name, MARKER), 'utf8'))

describe('where', () => {
  test('is ~/.agents/skills under the home folder: in the tests, a scratch one', () => {
    expect(agentsSkillsDir()).toBe(join(HOME, '.agents', 'skills'))
  })
})

describe('install, update and removal, by the marker', () => {
  test('a skill is installed whole, with a marker naming this module, the offering module and every file’s hash', () => {
    const root = join(dir(), 'skills')
    const one = holder()
    const kept = keep([skill('journey'), skill('kehikot-here', 'Assign.', { module: 'kehikot.codex', yaml: 'policy:\n  allow_implicit_invocation: false\n' })], { root, holder: one, everywhere: null })
    expect(kept.callable).toEqual(['journey', 'kehikot-here'])
    expect(names(root)).toEqual(['journey', 'kehikot-here'])
    expect(readFileSync(join(root, 'kehikot-here', 'agents', 'openai.yaml'), 'utf8')).toContain('allow_implicit_invocation: false')
    const said = marker(root, 'journey')
    expect(said).toMatchObject({ by: 'kehikot.codex', module: 'kehikot.journeys', name: 'journey', everywhere: false, bound: false, holders: [one] })
    expect(said.version).toBe(versionOf(filesOf(skill('journey'))))
    expect(Object.keys(marker(root, 'kehikot-here').files).sort()).toEqual(['SKILL.md', join('agents', 'openai.yaml')])
    expect(readLocal(root, 'journey').kind).toBe('ours')
    /* Nothing half-written is left beside it. */
    expect(readdirSync(root).filter((entry) => entry.startsWith('.'))).toEqual([])
  })

  test('versioned by content: a new text replaces an untouched install; the same text writes nothing', () => {
    const root = join(dir(), 'skills')
    const one = holder()
    keep([skill('journey')], { root, holder: one, everywhere: null })
    const first = marker(root, 'journey')
    const again = keep([skill('journey')], { root, holder: one, everywhere: null })
    expect(again.said.filter((line) => line.startsWith('installed') || line.startsWith('updated'))).toEqual([])
    expect(marker(root, 'journey').at).toBe(first.at)
    const changed = keep([skill('journey', 'Do it better.')], { root, holder: one, everywhere: null })
    expect(changed.said.some((line) => line.startsWith('updated journey'))).toBe(true)
    expect(readFileSync(join(root, 'journey', 'SKILL.md'), 'utf8')).toContain('Do it better.')
    expect(marker(root, 'journey').version).not.toBe(first.version)
  })

  test('removed when no conversation holds it and the host does not keep it everywhere', () => {
    const root = join(dir(), 'skills')
    const a = holder()
    const b = holder()
    keep([skill('journey'), skill('browse')], { root, holder: a, everywhere: null })
    keep([skill('journey')], { root, holder: b, everywhere: null })
    expect(marker(root, 'journey').holders).toEqual([a, b])
    /* A lets go: journey is still B's, browse was only A's. */
    sweep(root, { drop: a })
    expect(names(root)).toEqual(['journey'])
    /* B's conversation ended without saying so: its folder is gone. */
    rmSync(b.dir, { recursive: true, force: true })
    sweep(root)
    expect(names(root)).toEqual([])
  })

  test('a holder whose process is gone holds nothing', () => {
    const root = join(dir(), 'skills')
    const one = holder()
    keep([skill('journey')], { root, holder: one, everywhere: null })
    expect(names(root)).toEqual(['journey'])
    /* The module that started it stopped without ending it (its pid is gone). */
    const said = marker(root, 'journey')
    writeFileSync(join(root, 'journey', MARKER), JSON.stringify({ ...said, holders: [{ ...one, pid: 2 ** 22 + 12345 }] }))
    expect(readLocal(root, 'journey').kind).toBe('ours')
    sweep(root)
    expect(names(root)).toEqual([])
  })

  test('a session that no longer wants a skill lets it go at its next keep', () => {
    const root = join(dir(), 'skills')
    const one = holder()
    keep([skill('journey'), skill('browse')], { root, holder: one, everywhere: null })
    keep([skill('journey')], { root, holder: one, everywhere: null })
    expect(names(root)).toEqual(['journey'])
  })

  test('kept for every conversation: stays with no holder, until the host’s list leaves it out; an unknown list changes nothing', () => {
    const root = join(dir(), 'skills')
    const one = holder()
    keep([skill('kehikot-module', 'Build.', { module: 'kehikko', everywhere: true })], { root, holder: one, everywhere: new Set(['kehikot-module']) })
    sweep(root, { drop: one })
    expect(names(root)).toEqual(['kehikot-module'])
    expect(marker(root, 'kehikot-module').everywhere).toBe(true)
    keep([], { root, holder: holder(), everywhere: null })
    expect(names(root)).toEqual(['kehikot-module'])
    keep([], { root, holder: holder(), everywhere: new Set() })
    expect(names(root)).toEqual([])
  })

  test('a folder half-written by a process that stopped is tidied away', () => {
    const root = join(dir(), 'skills')
    mkdirSync(join(root, '.journey.kehikot-0123456789ab'), { recursive: true })
    mkdirSync(join(root, '.journey.kehikot-old-0123456789ab'), { recursive: true })
    sweep(root)
    expect(readdirSync(root)).toEqual([])
  })
})

describe('never a skill of the person’s', () => {
  test('a folder with no marker is never written over or removed', () => {
    const root = join(dir(), 'skills')
    mkdirSync(join(root, 'journey'), { recursive: true })
    writeFileSync(join(root, 'journey', 'SKILL.md'), 'mine')
    const kept = keep([skill('journey')], { root, holder: holder(), everywhere: null })
    expect(kept.taken).toEqual(['journey'])
    expect(kept.callable).toEqual([])
    expect(readFileSync(join(root, 'journey', 'SKILL.md'), 'utf8')).toBe('mine')
    sweep(root, { everywhere: new Set() })
    expect(readFileSync(join(root, 'journey', 'SKILL.md'), 'utf8')).toBe('mine')
  })

  test('a marker that is not this module’s — the host’s, another program’s — is not ours', () => {
    const root = join(dir(), 'skills')
    mkdirSync(join(root, 'journey'), { recursive: true })
    writeFileSync(join(root, 'journey', 'SKILL.md'), 'theirs')
    writeFileSync(join(root, 'journey', MARKER), JSON.stringify({ module: 'kehikot.journeys', name: 'journey', version: '1', sha256: 'x' }))
    expect(readLocal(root, 'journey').kind).toBe('taken')
    expect(keep([skill('journey')], { root, holder: holder(), everywhere: null }).taken).toEqual(['journey'])
  })

  test('a name taken in another folder Codex reads is not installed here either', () => {
    const root = join(dir(), 'skills')
    const codexSkills = dir()
    mkdirSync(join(codexSkills, 'journey'))
    expect(keep([skill('journey')], { root, personal: [codexSkills], holder: holder(), everywhere: null }).taken).toEqual(['journey'])
    expect(names(root)).toEqual([])
  })

  test('Kehikot’s copy the person changed, or added a file to, is theirs now: not updated, not removed', () => {
    const root = join(dir(), 'skills')
    const one = holder()
    keep([skill('journey'), skill('browse')], { root, holder: one, everywhere: null })
    writeFileSync(join(root, 'journey', 'SKILL.md'), 'changed by me')
    writeFileSync(join(root, 'browse', 'notes.txt'), 'mine')
    expect(readLocal(root, 'journey').kind).toBe('edited')
    expect(readLocal(root, 'browse').kind).toBe('edited')
    const kept = keep([skill('journey', 'Newer.'), skill('browse', 'Newer.')], { root, holder: one, everywhere: null })
    expect(kept.edited).toEqual(['journey', 'browse'])
    expect(readFileSync(join(root, 'journey', 'SKILL.md'), 'utf8')).toBe('changed by me')
    sweep(root, { drop: one, everywhere: new Set() })
    expect(names(root)).toEqual(['browse', 'journey'])
    /* And never switched off: it is the person's now. */
    expect(othersInstalled(new Set(), root)).toEqual([])
  })
})

describe('switched off for one process', () => {
  test('every install of ours not offered, as Codex’s skills.config by path', () => {
    const root = join(dir(), 'skills')
    keep([skill('journey'), skill('review-factory', 'Review.', { bound: true })], { root, holder: holder(), everywhere: null })
    mkdirSync(join(root, 'mine'))
    expect(othersInstalled(new Set(['journey']), root)).toEqual([join(root, 'review-factory', 'SKILL.md')])
    expect(disabledArgs([])).toEqual([])
    expect(disabledArgs(['/a b/"x"/SKILL.md'])).toEqual(['-c', 'skills.config=[{path="/a b/\\"x\\"/SKILL.md",enabled=false}]'])
  })
})

describe('re-synced against the modules as they are now', () => {
  const ORIGIN = 'http://127.0.0.1:7840'
  const manifestOf = (skills: unknown) => JSON.stringify({ kind: 'kehikot.module', protocol: 2, id: 'kehikot.journeys', name: 'Journeys', declares: { skills } })
  const fetchOf = (routes: Record<string, string>): typeof fetch =>
    (async (input) => {
      const body = routes[String(input)]
      return new Response(body ?? 'not found', { status: body === undefined ? 404 : 200 })
    }) as typeof fetch
  const refused = (async (..._args: unknown[]) => {
    throw new Error('connection refused')
  }) as unknown as typeof fetch
  const registryWith = (id: string): string => {
    const where = dir()
    writeFileSync(join(where, `${id}.json`), JSON.stringify({ url: ORIGIN, dir: `/modules/${id}` }))
    return where
  }
  /** An everywhere install no conversation holds any more. */
  const everywhereInstall = (root: string, name: string, module = 'kehikot.journeys') => {
    const one = holder()
    keep([skill(name, 'Do it.', { module, everywhere: true })], { root, holder: one, everywhere: new Set([name]) })
    sweep(root, { drop: one })
    expect(marker(root, name).everywhere).toBe(true)
    expect(marker(root, name).holders).toEqual([])
  }
  const offered = (text: string) => ({
    [`${ORIGIN}${WELL_KNOWN}`]: manifestOf([{ name: 'journey', summary: 'Steps.', version: 'b' }]),
    [`${ORIGIN}${skillPath('journey')}`]: text,
  })

  test('a changed skill text replaces the untouched install whole', async () => {
    const root = join(dir(), 'skills')
    everywhereInstall(root, 'journey')
    const text = '---\nname: journey\ndescription: "Do it better."\n---\nDo it better.\n'
    const said = await resyncEverywhere({ root, registry: registryWith('kehikot.journeys'), fetchFn: fetchOf(offered(text)) })
    expect(said.some((line) => line.startsWith('updated journey') && line.includes('kehikot.journeys'))).toBe(true)
    expect(readFileSync(join(root, 'journey', 'SKILL.md'), 'utf8')).toBe(text)
    expect(marker(root, 'journey').version).toBe(versionOf(filesOf({ text, yaml: null })))
    expect(readLocal(root, 'journey').kind).toBe('ours')
    /* The same text again writes nothing. */
    const again = await resyncEverywhere({ root, registry: registryWith('kehikot.journeys'), fetchFn: fetchOf(offered(text)) })
    expect(again.filter((line) => line.startsWith('updated') || line.startsWith('removed'))).toEqual([])
  })

  test('removed when the module is not registered on this computer', async () => {
    const root = join(dir(), 'skills')
    everywhereInstall(root, 'journey')
    const said = await resyncEverywhere({ root, registry: dir(), fetchFn: refused })
    expect(names(root)).toEqual([])
    expect(said.some((line) => line.startsWith('removed journey') && line.includes('not registered'))).toBe(true)
  })

  test('removed when the module answers but no longer offers the skill', async () => {
    const root = join(dir(), 'skills')
    everywhereInstall(root, 'journey')
    const routes = { [`${ORIGIN}${WELL_KNOWN}`]: manifestOf([]) }
    const said = await resyncEverywhere({ root, registry: registryWith('kehikot.journeys'), fetchFn: fetchOf(routes) })
    expect(names(root)).toEqual([])
    expect(said.some((line) => line.startsWith('removed journey') && line.includes('no longer offers'))).toBe(true)
  })

  test('left exactly as it is when the module does not answer', async () => {
    const root = join(dir(), 'skills')
    everywhereInstall(root, 'journey')
    const before = marker(root, 'journey')
    const said = await resyncEverywhere({ root, registry: registryWith('kehikot.journeys'), fetchFn: refused })
    expect(names(root)).toEqual(['journey'])
    expect(marker(root, 'journey').at).toBe(before.at)
    expect(said.filter((line) => line.startsWith('removed') || line.startsWith('updated'))).toEqual([])
  })

  test('never touched while a conversation still holds it', async () => {
    const root = join(dir(), 'skills')
    const one = holder()
    keep([skill('journey', 'Do it.', { module: 'kehikot.journeys', everywhere: true })], { root, holder: one, everywhere: new Set(['journey']) })
    let asked = 0
    const counting = (async (..._args: unknown[]) => {
      asked++
      throw new Error('connection refused')
    }) as unknown as typeof fetch
    await resyncEverywhere({ root, registry: registryWith('kehikot.journeys'), fetchFn: counting })
    expect(asked).toBe(0)
    expect(names(root)).toEqual(['journey'])
    expect(marker(root, 'journey').holders).toEqual([one])
  })

  test('a folder the person changed is left alone', async () => {
    const root = join(dir(), 'skills')
    everywhereInstall(root, 'journey')
    writeFileSync(join(root, 'journey', 'SKILL.md'), 'mine now\n')
    const text = '---\nname: journey\ndescription: "Do it better."\n---\nDo it better.\n'
    const said = await resyncEverywhere({ root, registry: registryWith('kehikot.journeys'), fetchFn: fetchOf(offered(text)) })
    expect(readFileSync(join(root, 'journey', 'SKILL.md'), 'utf8')).toBe('mine now\n')
    expect(names(root)).toEqual(['journey'])
    expect(said.filter((line) => line.startsWith('removed') || line.startsWith('updated'))).toEqual([])
  })
})
