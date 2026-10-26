import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { moduleFile } from 'kehikot-module-protocol'

import { ID } from '../manifest.ts'
import { placeKey } from '../place.ts'
import { IGNORE, attach, detach, follow, note, readPlaces, rekey, sessionsAt, type Places } from '../record.ts'

const made: string[] = []
const project = () => {
  const dir = mkdtempSync(join(tmpdir(), 'kehikko-codex-record-'))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

const METHODS = { epic: 'thesis', parts: ['methods'], kehikko: { id: 3 }, kehikkoName: 'writing' }
const BOTH = { epic: 'thesis', parts: ['results', 'methods'], kehikko: { id: 3 }, kehikkoName: 'writing' }
const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'

const places = (dir: string) => {
  const read = readPlaces(dir)
  if (!read.ok) throw new Error(read.error)
  return read.value
}

describe('the record of which session belongs where', () => {
  test('is kept inside the project, under this module’s own folder, and nowhere else', () => {
    const dir = project()
    expect(places(dir)).toEqual({ version: 1, places: {}, sessions: {} })
    attach(dir, METHODS, A)
    const file = moduleFile(dir, ID, 'places')!
    expect(file.endsWith('/.kehikot/codex/places.json')).toBe(true)
    expect(existsSync(file)).toBe(true)
  })

  test('a place keeps its sessions in the order they were added, and each place its own', () => {
    const dir = project()
    attach(dir, METHODS, A)
    attach(dir, METHODS, B)
    attach(dir, BOTH, B)
    const read = places(dir)
    expect(sessionsAt(read, placeKey(METHODS))).toEqual([A, B])
    expect(sessionsAt(read, placeKey(BOTH))).toEqual([B])
    expect(sessionsAt(read, placeKey({ epic: 'thesis', parts: [], kehikko: { id: 3 } }))).toEqual([])
  })

  test('the file can be read by a person: the key, and beside it the names', () => {
    const dir = project()
    attach(dir, BOTH, A, { label: 'tighten the methods section', lastActive: Date.parse('2026-10-12T15:40:02.000Z') }, Date.parse('2026-10-12T14:00:00.000Z'))
    const written = JSON.parse(readFileSync(moduleFile(dir, ID, 'places')!, 'utf8'))
    expect(written).toEqual({
      version: 1,
      places: {
        'epic=thesis;parts=methods+results;kehikko=3': {
          epic: 'thesis',
          parts: ['methods', 'results'],
          kehikko: { id: 3, name: 'writing' },
          sessions: [A],
          current: A,
        },
      },
      sessions: {
        [A]: { added: '2026-10-12T14:00:00.000Z', label: 'tighten the methods section', lastActive: '2026-10-12T15:40:02.000Z' },
      },
    })
  })

  test('attaching twice lists a session once; a renamed kehikko is the same place under its new name', () => {
    const dir = project()
    attach(dir, METHODS, A)
    attach(dir, { ...METHODS, kehikkoName: 'drafting' }, A)
    const read = places(dir)
    expect(Object.keys(read.places)).toEqual([placeKey(METHODS)])
    expect(read.places[placeKey(METHODS)]?.sessions).toEqual([A])
    expect(read.places[placeKey(METHODS)]?.kehikko).toEqual({ id: 3, name: 'drafting' })
  })

  test('taking a session off a place keeps the session, and leaves it on its other places', () => {
    const dir = project()
    attach(dir, METHODS, A, { label: 'first' })
    attach(dir, BOTH, A)
    detach(dir, placeKey(METHODS), A)
    const read = places(dir)
    expect(sessionsAt(read, placeKey(METHODS))).toEqual([])
    expect(sessionsAt(read, placeKey(BOTH))).toEqual([A])
    expect(read.sessions[A]?.label).toBe('first')
    expect(detach(dir, 'not a key', A).ok).toBe(false)
  })

  test('what is known about a session is brought up to date, and an unknown one is not invented', () => {
    const dir = project()
    attach(dir, METHODS, A)
    note(dir, A, { label: 'what it was first asked', lastActive: Date.parse('2026-10-12T16:00:00.000Z') })
    note(dir, B, { label: 'nobody listed this one' })
    const read = places(dir)
    expect(read.sessions[A]?.label).toBe('what it was first asked')
    expect(read.sessions[A]?.lastActive).toBe('2026-10-12T16:00:00.000Z')
    expect(read.sessions[B]).toBeUndefined()
  })

  /*
   * The lost update. Every change is read-modify-write, and the only thing
   * that keeps two of them from interleaving is that nothing is awaited
   * between the read and the write. Forty writers released together, each to
   * its own place and all to one: every one of them must be in the file.
   */
  test('many writes at once lose none of them', async () => {
    const dir = project()
    const ids = Array.from({ length: 40 }, (_, n) => `${String(n).padStart(8, '0')}-0000-4000-8000-000000000000`)
    await Promise.all(
      ids.map(async (id, n) => {
        await Promise.resolve()
        attach(dir, { epic: 'thesis', parts: [`part-${n}`], kehikko: { id: 1 } }, id)
        await Promise.resolve()
        attach(dir, METHODS, id)
        note(dir, id, { label: `session ${n}` })
      }),
    )
    const read = places(dir)
    expect(sessionsAt(read, placeKey(METHODS)).sort()).toEqual([...ids].sort())
    expect(Object.keys(read.places).length).toBe(41)
    expect(Object.keys(read.sessions).length).toBe(40)
    expect(read.sessions[ids[7]!]?.label).toBe('session 7')
  })

  test('with no project nothing is read from a guess and nothing is written', () => {
    expect(readPlaces(null).ok).toBe(false)
    expect(attach('', METHODS, A).ok).toBe(false)
    expect(attach('relative/path', METHODS, A).ok).toBe(false)
    expect(attach(join(tmpdir(), 'kehikko-codex-no-such-folder'), METHODS, A).ok).toBe(false)
  })

  test('a file that is not JSON is refused rather than written over', () => {
    const dir = project()
    attach(dir, METHODS, A)
    const file = moduleFile(dir, ID, 'places')!
    writeFileSync(file, '{ not json')
    expect(readPlaces(dir).ok).toBe(false)
    expect(attach(dir, METHODS, B).ok).toBe(false)
    expect(readFileSync(file, 'utf8')).toBe('{ not json')
  })

  test('what a hand or another release put in the file is left out rather than trusted', () => {
    const dir = project()
    attach(dir, METHODS, A)
    const file = moduleFile(dir, ID, 'places')!
    const written = JSON.parse(readFileSync(file, 'utf8'))
    written.places.constructor = { sessions: ['x'] }
    written.places['epic=thesis;parts=b+a;kehikko=1'] = { sessions: ['x'] }
    written.places[placeKey(METHODS)].sessions.push(7, A)
    writeFileSync(file, JSON.stringify(written))
    const read = places(dir)
    expect(Object.keys(read.places)).toEqual([placeKey(METHODS)])
    expect(read.places[placeKey(METHODS)]?.sessions).toEqual([A])
  })

  test('a .kehikot that is a link out of the project is refused rather than followed', () => {
    const dir = project()
    const elsewhere = project()
    symlinkSync(elsewhere, join(dir, '.kehikot'))
    const written = attach(dir, METHODS, A)
    expect(written.ok).toBe(false)
    expect(existsSync(join(elsewhere, 'claude'))).toBe(false)
    mkdirSync(join(elsewhere, 'claude'), { recursive: true })
    expect(readPlaces(dir).ok).toBe(false)
  })
})

/**
 * A kehikko by its key, and the files written before there was one.
 *
 * `rekey` is the one place a NAME is compared, and it writes into people's
 * projects: each rule it follows is pinned here on its own.
 */
describe('a kehikko by its key', () => {
  const KEYED = { epic: 'thesis', parts: ['methods'], kehikko: { key: '4072c9e5' }, kehikkoName: 'writing', kehikkoId: 3 }
  const C = '33333333-3333-4333-8333-333333333333'
  const D = '44444444-4444-4444-8444-444444444444'
  const file = (dir: string) => moduleFile(dir, ID, 'places')!
  const raw = (dir: string) => readFileSync(file(dir), 'utf8')
  /** A file as a release before keys wrote it. */
  const old = (dir: string, entries: Record<string, { name: string; sessions: string[] }>, more: Record<string, unknown> = {}) => {
    mkdirSync(join(dir, '.kehikot', 'codex'), { recursive: true })
    const written = {
      version: 1,
      places: {
        ...Object.fromEntries(
          Object.entries(entries).map(([key, { name, sessions }]) => {
            const found = /^epic=([^;]+);parts=([^;]+);kehikko=(\d+)$/.exec(key)!
            return [key, { epic: found[1], parts: found[2] === '-' ? [] : found[2]!.split('+'), kehikko: { id: Number(found[3]), name }, sessions }]
          }),
        ),
        ...more,
      },
      sessions: Object.fromEntries([A, B, C, D].map((id) => [id, { added: '2026-10-01T00:00:00.000Z', label: `the session ${id.slice(0, 1)}`, lastActive: null }])),
    }
    writeFileSync(file(dir), `${JSON.stringify(written, null, 2)}\n`)
  }
  const OPEN = { key: '4072c9e5', name: 'writing', id: 28 }

  test('is what the place is filed under, with the row number beside it as a note that is never looked up', () => {
    const dir = project()
    attach(dir, KEYED, A)
    expect(JSON.parse(raw(dir)).places).toEqual({
      'epic=thesis;parts=methods;kehikko=key:4072c9e5': { epic: 'thesis', parts: ['methods'], kehikko: { key: '4072c9e5', id: 3, name: 'writing' }, sessions: [A], current: A },
    })
    /* Renumbered and renamed: the same entry, brought up to date. */
    attach(dir, { ...KEYED, kehikkoId: 28, kehikkoName: 'drafting' }, B)
    const read = places(dir)
    expect(Object.keys(read.places)).toEqual([placeKey(KEYED)])
    expect(read.places[placeKey(KEYED)]).toEqual({ epic: 'thesis', parts: ['methods'], kehikko: { key: '4072c9e5', id: 28, name: 'drafting' }, sessions: [A, B], current: B })
    /* With no number said, the last one seen is kept; with none ever seen there is none. */
    attach(dir, { epic: 'thesis', parts: ['methods'], kehikko: { key: '4072c9e5' } }, B)
    expect(places(dir).places[placeKey(KEYED)]?.kehikko).toEqual({ key: '4072c9e5', id: 28, name: 'drafting' })
    attach(dir, { epic: 'thesis', parts: [], kehikko: { key: '4072c9e5' }, kehikkoName: 'drafting' }, B)
    expect(places(dir).places['epic=thesis;parts=-;kehikko=key:4072c9e5']?.kehikko).toEqual({ key: '4072c9e5', name: 'drafting' })
  })

  test('a key that is all digits and the row number of the same digits are two places in one file', () => {
    const dir = project()
    attach(dir, { epic: 'thesis', parts: [], kehikko: { key: '12345678' }, kehikkoName: 'writing' }, A)
    attach(dir, { epic: 'thesis', parts: [], kehikko: { id: 12345678 }, kehikkoName: 'another' }, B)
    const read = places(dir)
    expect(Object.keys(read.places).sort()).toEqual(['epic=thesis;parts=-;kehikko=12345678', 'epic=thesis;parts=-;kehikko=key:12345678'])
    expect(read.places['epic=thesis;parts=-;kehikko=key:12345678']).toMatchObject({ kehikko: { key: '12345678', name: 'writing' }, sessions: [A] })
    expect(read.places['epic=thesis;parts=-;kehikko=12345678']).toMatchObject({ kehikko: { id: 12345678, name: 'another' }, sessions: [B] })
  })

  test('which kehikko an entry is about is read off its key, not off what is written beside it', () => {
    const dir = project()
    attach(dir, KEYED, A)
    const written = JSON.parse(raw(dir))
    written.places[placeKey(KEYED)].kehikko = { key: 'somebody-else', id: 'nine', name: 'writing' }
    written.places['epic=thesis;parts=-;kehikko=7'] = { kehikko: { key: '4072c9e5', id: 99, name: 'old' }, sessions: [B] }
    writeFileSync(file(dir), JSON.stringify(written))
    const read = places(dir)
    expect(read.places[placeKey(KEYED)]?.kehikko).toEqual({ key: '4072c9e5', name: 'writing' })
    expect(read.places['epic=thesis;parts=-;kehikko=7']?.kehikko).toEqual({ id: 7, name: 'old' })
  })

  test('a host that sends no key still files by the row number, exactly as before', () => {
    const dir = project()
    attach(dir, METHODS, A)
    expect(JSON.parse(raw(dir)).places).toEqual({ 'epic=thesis;parts=methods;kehikko=3': { epic: 'thesis', parts: ['methods'], kehikko: { id: 3, name: 'writing' }, sessions: [A], current: A } })
  })

  test('migration: an entry filed under a row number whose kehikko NAME is the open one’s is re-keyed, epic and parts unchanged', () => {
    const dir = project()
    old(dir, {
      'epic=thesis;parts=-;kehikko=3': { name: 'writing', sessions: [A] },
      'epic=thesis;parts=methods+results;kehikko=3': { name: 'writing', sessions: [B, C] },
    })
    expect(rekey(dir, OPEN)).toEqual({ ok: true, value: { moved: 2 } })
    expect(JSON.parse(raw(dir)).places).toEqual({
      'epic=thesis;parts=-;kehikko=key:4072c9e5': { epic: 'thesis', parts: [], kehikko: { key: '4072c9e5', id: 28, name: 'writing' }, sessions: [A] },
      'epic=thesis;parts=methods+results;kehikko=key:4072c9e5': { epic: 'thesis', parts: ['methods', 'results'], kehikko: { key: '4072c9e5', id: 28, name: 'writing' }, sessions: [B, C] },
    })
    /* What is known about each session is carried untouched. */
    expect(places(dir).sessions[A]?.label).toBe('the session 1')
  })

  test('migration: never by id — the same number under another name is another kehikko, and stays', () => {
    const dir = project()
    old(dir, {
      'epic=thesis;parts=-;kehikko=28': { name: 'review', sessions: [A] },
      'epic=thesis;parts=-;kehikko=3': { name: 'writing', sessions: [B] },
    })
    /* The open kehikko is row 28 today. The entry filed under 28 belonged to whatever was 28 then. */
    expect(rekey(dir, OPEN)).toEqual({ ok: true, value: { moved: 1 } })
    const read = places(dir)
    expect(read.places['epic=thesis;parts=-;kehikko=28']).toEqual({ epic: 'thesis', parts: [], kehikko: { id: 28, name: 'review' }, sessions: [A] })
    expect(read.places['epic=thesis;parts=-;kehikko=key:4072c9e5']?.sessions).toEqual([B])
  })

  test('migration: one kehikko a renumbering had split across several numbers comes back together, as a set', () => {
    const dir = project()
    /* It was 2, then 9, then 28, and sessions were filed under each. */
    old(dir, {
      'epic=thesis;parts=-;kehikko=2': { name: 'writing', sessions: [A, B] },
      'epic=thesis;parts=-;kehikko=9': { name: 'writing', sessions: [B, C] },
      'epic=thesis;parts=methods;kehikko=9': { name: 'writing', sessions: [D] },
    })
    expect(rekey(dir, OPEN)).toEqual({ ok: true, value: { moved: 3 } })
    const read = places(dir)
    expect(Object.keys(read.places)).toEqual(['epic=thesis;parts=-;kehikko=key:4072c9e5', 'epic=thesis;parts=methods;kehikko=key:4072c9e5'])
    expect(read.places['epic=thesis;parts=-;kehikko=key:4072c9e5']?.sessions).toEqual([A, B, C])
    expect(read.places['epic=thesis;parts=methods;kehikko=key:4072c9e5']?.sessions).toEqual([D])
  })

  test('migration: where the key already has an entry, the session lists are merged as a set — the key’s own first', () => {
    for (const keyedFirst of [true, false]) {
      const dir = project()
      /* The key's entry carries another name (the kehikko was called something else when it was written), so the name is unclaimed. */
      const target = { 'epic=thesis;parts=-;kehikko=key:4072c9e5': { epic: 'thesis', parts: [], kehikko: { key: '4072c9e5', id: 5, name: 'drafting' }, sessions: [C, A] } }
      old(dir, { 'epic=thesis;parts=-;kehikko=3': { name: 'writing', sessions: [A, B] } }, target)
      if (keyedFirst) {
        const written = JSON.parse(raw(dir)) as Places
        written.places = Object.fromEntries(Object.entries(written.places).reverse())
        writeFileSync(file(dir), JSON.stringify(written))
      }
      expect(rekey(dir, OPEN)).toEqual({ ok: true, value: { moved: 1 } })
      const read = places(dir)
      expect(Object.keys(read.places)).toEqual(['epic=thesis;parts=-;kehikko=key:4072c9e5'])
      expect(read.places['epic=thesis;parts=-;kehikko=key:4072c9e5']?.sessions).toEqual([C, A, B])
      /* What was written beside the key's own entry is kept. */
      expect(read.places['epic=thesis;parts=-;kehikko=key:4072c9e5']?.kehikko).toEqual({ key: '4072c9e5', id: 5, name: 'drafting' })
    }
  })

  test('migration: once a keyed entry claims the name, entries under row numbers are left alone', () => {
    const dir = project()
    const claimed = { 'epic=thesis;parts=methods;kehikko=key:4072c9e5': { epic: 'thesis', parts: ['methods'], kehikko: { key: '4072c9e5', id: 28, name: 'writing' }, sessions: [C] } }
    old(dir, { 'epic=thesis;parts=-;kehikko=3': { name: 'writing', sessions: [A] } }, claimed)
    const before = raw(dir)
    expect(rekey(dir, OPEN)).toEqual({ ok: true, value: { moved: 0 } })
    expect(raw(dir)).toBe(before)
    /* Claimed by ANOTHER kehikko of the same name is the same: whose the old entries were cannot be told. */
    expect(rekey(dir, { key: 'another-one', name: 'writing', id: 4 })).toEqual({ ok: true, value: { moved: 0 } })
    expect(raw(dir)).toBe(before)
  })

  test('migration: it runs once — the second time the name is claimed, and what an older host files afterwards is not swept up', () => {
    const dir = project()
    old(dir, { 'epic=thesis;parts=-;kehikko=3': { name: 'writing', sessions: [A] } })
    expect(rekey(dir, OPEN)).toEqual({ ok: true, value: { moved: 1 } })
    attach(dir, { epic: 'thesis', parts: ['methods'], kehikko: { id: 3 }, kehikkoName: 'writing' }, B)
    const before = raw(dir)
    expect(rekey(dir, OPEN)).toEqual({ ok: true, value: { moved: 0 } })
    expect(raw(dir)).toBe(before)
    expect(sessionsAt(places(dir), 'epic=thesis;parts=methods;kehikko=3')).toEqual([B])
  })

  test('migration: entries that match nothing stay exactly as they are, byte for byte, and can still be read', () => {
    const dir = project()
    old(dir, {
      'epic=thesis;parts=-;kehikko=3': { name: 'review', sessions: [A] },
      'epic=thesis;parts=methods;kehikko=9': { name: '', sessions: [B] },
    }, { 'epic=-;parts=-;kehikko=-': { epic: null, parts: [], kehikko: null, sessions: [C] } })
    const before = raw(dir)
    expect(rekey(dir, OPEN)).toEqual({ ok: true, value: { moved: 0 } })
    expect(raw(dir)).toBe(before)
    /* A kehikko with no name matches nothing either, not even an entry with none. */
    expect(rekey(dir, { key: '4072c9e5', name: '' })).toEqual({ ok: true, value: { moved: 0 } })
    expect(raw(dir)).toBe(before)
    expect(sessionsAt(places(dir), 'epic=thesis;parts=-;kehikko=3')).toEqual([A])
    expect(sessionsAt(places(dir), 'epic=thesis;parts=methods;kehikko=9')).toEqual([B])
  })

  test('migration: the unmatched are carried through a migration that does move something, untouched', () => {
    const dir = project()
    old(dir, {
      'epic=thesis;parts=-;kehikko=3': { name: 'writing', sessions: [A] },
      'epic=thesis;parts=-;kehikko=4': { name: 'review', sessions: [B] },
    }, { 'epic=-;parts=-;kehikko=-': { epic: null, parts: [], kehikko: null, sessions: [C] } })
    expect(rekey(dir, OPEN)).toEqual({ ok: true, value: { moved: 1 } })
    const read = places(dir)
    expect(Object.keys(read.places)).toEqual(['epic=thesis;parts=-;kehikko=key:4072c9e5', 'epic=thesis;parts=-;kehikko=4', 'epic=-;parts=-;kehikko=-'])
    expect(read.places['epic=thesis;parts=-;kehikko=4']).toEqual({ epic: 'thesis', parts: [], kehikko: { id: 4, name: 'review' }, sessions: [B] })
    expect(read.places['epic=-;parts=-;kehikko=-']).toEqual({ epic: null, parts: [], kehikko: null, sessions: [C] })
  })

  test('migration: reading never does it — only the explicit step writes', () => {
    const dir = project()
    old(dir, { 'epic=thesis;parts=-;kehikko=3': { name: 'writing', sessions: [A] } })
    const before = raw(dir)
    const read = places(dir)
    expect(Object.keys(read.places)).toEqual(['epic=thesis;parts=-;kehikko=3'])
    expect(sessionsAt(read, 'epic=thesis;parts=-;kehikko=key:4072c9e5')).toEqual([])
    expect(raw(dir)).toBe(before)
  })

  test('migration: with nothing recorded nothing is made — no folder, no file', () => {
    const dir = project()
    expect(rekey(dir, OPEN)).toEqual({ ok: true, value: { moved: 0 } })
    expect(existsSync(join(dir, '.kehikot'))).toBe(false)
    expect(rekey(null, OPEN).ok).toBe(false)
    expect(rekey(dir, { key: 'Not A Key', name: 'writing' }).ok).toBe(false)
  })

  test('migration: among other writes at once, none is lost', async () => {
    const dir = project()
    old(dir, { 'epic=thesis;parts=-;kehikko=3': { name: 'writing', sessions: [A] } })
    const ids = Array.from({ length: 20 }, (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`)
    await Promise.all([
      ...ids.map(async (id, n) => attach(dir, { epic: 'thesis', parts: [`part-${n}`], kehikko: { key: '4072c9e5' }, kehikkoName: 'elsewhere' }, id)),
      (async () => rekey(dir, OPEN))(),
    ])
    const read = places(dir)
    expect(Object.keys(read.places).length).toBe(21)
    expect(read.places['epic=thesis;parts=-;kehikko=key:4072c9e5']?.sessions).toEqual([A])
  })
})

describe('what is shared with the project’s history', () => {
  test('the record is not, by default: the first write puts a .gitignore beside it naming it', () => {
    const dir = project()
    attach(dir, METHODS, A)
    const ignore = join(dir, '.kehikot', 'codex', '.gitignore')
    expect(readFileSync(ignore, 'utf8')).toBe(IGNORE)
    const rules = IGNORE.split('\n').filter((line) => line && !line.startsWith('#'))
    expect(rules).toEqual(['places.json', 'places.json.*.tmp'])
  })

  test('one that is already there is the person’s, and is never written over — emptied, the record is shared', () => {
    const dir = project()
    mkdirSync(join(dir, '.kehikot', 'codex'), { recursive: true })
    const ignore = join(dir, '.kehikot', 'codex', '.gitignore')
    writeFileSync(ignore, '# shared on purpose\n')
    attach(dir, METHODS, A)
    attach(dir, METHODS, B)
    expect(readFileSync(ignore, 'utf8')).toBe('# shared on purpose\n')
  })

  test('reading writes nothing, and a project with nothing recorded gets nothing', () => {
    const dir = project()
    expect(places(dir).places).toEqual({})
    expect(existsSync(join(dir, '.kehikot'))).toBe(false)
  })
})

describe('a conversation carried on under another id', () => {
  const C = '33333333-3333-4333-8333-333333333333'
  test('the new id takes the old one’s place everywhere, as current where it was', () => {
    const dir = project()
    const ONE = { epic: 'thesis', parts: [], kehikko: { id: 3 }, kehikkoName: 'writing' }
    const TWO = { epic: 'thesis', parts: ['methods'], kehikko: { id: 3 }, kehikkoName: 'writing' }
    attach(dir, ONE, A, { label: 'first' })
    attach(dir, ONE, B)
    attach(dir, ONE, A)
    attach(dir, TWO, A)
    const read = follow(dir, A, C)
    expect(read.ok).toBe(true)
    const after = readPlaces(dir)
    if (!after.ok) throw new Error(after.error)
    expect(after.value.places[placeKey(ONE)]).toMatchObject({ sessions: [C, B], current: C })
    expect(after.value.places[placeKey(TWO)]).toMatchObject({ sessions: [C], current: C })
    expect(after.value.sessions[C]?.label).toBe('first')
  })

  test('taking the current one off a place leaves it with none', () => {
    const dir = project()
    const ONE = { epic: 'thesis', parts: [], kehikko: { id: 3 }, kehikkoName: 'writing' }
    attach(dir, ONE, A)
    detach(dir, placeKey(ONE), A)
    const after = readPlaces(dir)
    expect(after.ok && after.value.places[placeKey(ONE)]?.current).toBeUndefined()
  })
})
