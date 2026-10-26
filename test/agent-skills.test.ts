import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { MARKER, agentsSkillsDir, disabledArgs, keep, othersInstalled, readLocal, sweep, versionOf, filesOf, type Holder, type Wanted } from '../agentSkills.ts'
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
