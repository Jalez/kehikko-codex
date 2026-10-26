import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { TICKET, answer } from '../doors.ts'
import { placeKey } from '../place.ts'
import { assign, attach, born, byToken, detach, follow, homeOf, ignore, ownOf, readPlaces, sighted, unassigned } from '../record.ts'

/**
 * Where a conversation belongs, and which is a place's own — the record the
 * Kehikot doors answer from (protocol 2.4.0), never a guess.
 */

const made: string[] = []
const dir = () => {
  const one = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-own-')))
  made.push(one)
  return one
}
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const METHODS = { epic: 'thesis', parts: ['methods'], kehikko: { key: 'k1a2b3c4' }, kehikkoName: 'writing' }
const RESULTS = { epic: 'thesis', parts: ['results'], kehikko: { key: 'k1a2b3c4' }, kehikkoName: 'writing' }
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345'
const none = new URLSearchParams()

const read = (project: string) => {
  const got = readPlaces(project)
  if (!got.ok) throw new Error(got.error)
  return got.value
}

describe('the record', () => {
  test('a conversation started at a place belongs there, is its own, and keeps its token', () => {
    const p = dir()
    born(p, METHODS, A, TOKEN)
    const r = read(p)
    expect(homeOf(r, A)).toBe(placeKey(METHODS))
    expect(ownOf(r, placeKey(METHODS))).toBe(A)
    expect(byToken(r, TOKEN)).toEqual({ id: A, home: placeKey(METHODS) })
    /* A second one started there belongs there too; the place's own stays the first. */
    born(p, METHODS, B, null)
    expect(ownOf(read(p), placeKey(METHODS))).toBe(A)
    expect(homeOf(read(p), B)).toBe(placeKey(METHODS))
  })

  test('viewing a conversation at another place lists it there and moves nothing', () => {
    const p = dir()
    born(p, METHODS, A, TOKEN)
    attach(p, RESULTS, A)
    const r = read(p)
    expect(homeOf(r, A)).toBe(placeKey(METHODS))
    expect(r.places[placeKey(RESULTS)]?.sessions).toEqual([A])
    expect(r.places[placeKey(RESULTS)]?.own).toBeUndefined()
  })

  test('"Make this the kehikko’s own" rewrites where it belongs and the place’s own', () => {
    const p = dir()
    born(p, METHODS, A, TOKEN)
    born(p, RESULTS, B, null)
    assign(p, RESULTS, A, { own: true })
    const r = read(p)
    expect(homeOf(r, A)).toBe(placeKey(RESULTS))
    expect(ownOf(r, placeKey(RESULTS))).toBe(A)
    expect(byToken(r, TOKEN)?.home).toBe(placeKey(RESULTS))
  })

  test('a conversation carried on under a new id keeps where it belongs, its token and its place’s own', () => {
    const p = dir()
    born(p, METHODS, A, TOKEN)
    follow(p, A, C)
    const r = read(p)
    expect(homeOf(r, C)).toBe(placeKey(METHODS))
    expect(ownOf(r, placeKey(METHODS))).toBe(C)
    expect(byToken(r, TOKEN)?.id).toBe(C)
  })

  test('one reported started outside belongs nowhere until assigned; taken off its place, it belongs nowhere again', () => {
    const p = dir()
    sighted(p, A, 'hook')
    expect(unassigned(read(p))).toEqual([A])
    expect(homeOf(read(p), A)).toBeNull()
    assign(p, METHODS, A)
    expect(unassigned(read(p))).toEqual([])
    expect(homeOf(read(p), A)).toBe(placeKey(METHODS))
    detach(p, placeKey(METHODS), A)
    expect(homeOf(read(p), A)).toBeNull()
    /* A person took it off: kept, so nothing files it anywhere on its own again — and read back as written. */
    expect(read(p).sessions[A]?.detached).toMatch(/^\d{4}-/)
    /* A person assigning it again is their say: the mark goes. */
    assign(p, RESULTS, A)
    expect(read(p).sessions[A]?.detached).toBeUndefined()
  })

  test('a file from before `home` says it only where it is a fact: one place lists it', () => {
    const p = dir()
    attach(p, METHODS, A)
    attach(p, RESULTS, B)
    attach(p, RESULTS, C)
    attach(p, METHODS, B)
    const r = read(p)
    expect(homeOf(r, A)).toBe(placeKey(METHODS))
    /* Listed at two places, and the last opened at one of them. */
    expect(homeOf(r, B)).toBe(placeKey(METHODS))
    attach(p, RESULTS, B)
    /* Last opened at both now: not a fact, so not assigned. */
    expect(homeOf(read(p), B)).toBeNull()
  })
})

describe('not a Kehikot conversation', () => {
  test('ignored is a record: never listed again, not by a later report, and it survives a re-read', () => {
    const p = dir()
    sighted(p, A, 'agents', 1_000, 'kehikko modules issue triage')
    sighted(p, B, 'hook')
    expect(unassigned(read(p))).toEqual([A, B])
    expect(read(p).sessions[A]?.label).toBe('kehikko modules issue triage')
    expect(ignore(p, A, 2_000).ok).toBe(true)
    expect(unassigned(read(p))).toEqual([B])
    /* Reported again — by the hook or the agents list — it stays ignored. */
    sighted(p, A, 'hook')
    sighted(p, A, 'agents')
    expect(unassigned(read(p))).toEqual([B])
    /* What is on disk is what a restarted server reads. */
    const onDisk = JSON.parse(readFileSync(join(p, '.kehikot', 'codex', 'places.json'), 'utf8'))
    expect(onDisk.sessions[A].ignored).toEqual({ at: new Date(2_000).toISOString() })
  })

  test('a conversation that belongs to a place is not ignored; assigning an ignored one takes it back', () => {
    const p = dir()
    born(p, METHODS, A, null)
    expect(ignore(p, A).ok).toBe(false)
    sighted(p, B, 'hook')
    ignore(p, B)
    assign(p, RESULTS, B)
    expect(read(p).sessions[B]?.ignored).toBeUndefined()
    expect(homeOf(read(p), B)).toBe(placeKey(RESULTS))
  })

})

describe('the doors', () => {
  test('/api/kehikot/place answers the host from the record, for a program', async () => {
    const p = dir()
    born(p, METHODS, A, TOKEN)
    const reply = await answer('GET', '/api/kehikot/place', new URLSearchParams({ 'kehikot-place': TOKEN, project: p }), null, null)
    expect(reply?.body).toEqual({ ok: true, place: { conversation: A, epic: 'thesis', parts: ['methods'], kehikko: 'k1a2b3c4' } })
    const unknown = await answer('GET', '/api/kehikot/place', new URLSearchParams({ 'kehikot-place': 'z'.repeat(32), project: p }), null, null)
    expect(unknown?.body).toEqual({ ok: true, place: null })
  })

  test('/api/assign is the page’s: ticketed, and it writes the record', async () => {
    const p = dir()
    sighted(p, A, 'hook')
    const body = { projectPath: p, key: placeKey(METHODS), session: A, own: true }
    expect((await answer('POST', '/api/assign', none, body, null))?.status).toBe(403)
    expect((await answer('POST', '/api/assign', none, body, TICKET))?.status).toBe(200)
    expect(homeOf(read(p), A)).toBe(placeKey(METHODS))
    expect(ownOf(read(p), placeKey(METHODS))).toBe(A)
  })

  test('the answers that went with the "Not yet assigned" line are gone: /api/ignore is no door', async () => {
    const p = dir()
    sighted(p, A, 'hook')
    const reply = await answer('POST', '/api/ignore', none, { projectPath: p, session: A }, TICKET)
    expect(reply?.status ?? 404).toBe(404)
    expect(read(p).sessions[A]?.ignored).toBeUndefined()
  })
})
