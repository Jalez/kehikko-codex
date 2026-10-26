import { describe, expect, test } from 'bun:test'
import { notificationPayload } from 'kehikot-module-protocol'

import type { Listing, Row } from '../doors.ts'
import { STATES } from '../program.ts'
import { COPY, LEAVE, MARKS, ago, brief, decide, elsewhereSaid, noticeLine, placeId, placeWords, since, standing, standingWords, surplus, whereWords, type View } from '../src/view/places.ts'

/**
 * What the page does when the canvas names a place. Pure, so the rule that
 * was asked for — none, one, more than one — is pinned without a browser.
 */

const row = (id: string, more: Partial<Row> = {}): Row => ({ id, label: '', lastActive: null, running: false, ...more })
const listing = (sessions: Row[], program: Partial<Listing['program']> = {}): Listing => ({
  ok: true,
  program: { name: 'Codex', found: '/bin/claude', foundAt: '/bin/claude', looked: [], where: 'PATH', lacks: null, install: { line: 'install', lands: '~/.local/bin/claude' }, asked: 'yes', ...program },
  sessions,
  others: [],
  running: [],
})

describe('opening the module on a place', () => {
  test('no session recorded there: a new one, at once', () => {
    expect(decide(listing([]))).toEqual({ do: 'open', session: null })
  })

  test('more than one, one of them last open here: that one, at once', () => {
    expect(decide({ ...listing([row('a'), row('b')]), current: 'b' })).toEqual({ do: 'open', session: 'b' })
    /* One last open here that this computer does not have is not opened on that account. */
    expect(decide({ ...listing([row('a'), row('b', { missing: true })]), current: 'b' })).toEqual({ do: 'open', session: 'a' })
  })

  test('exactly one: that one, at once', () => {
    expect(decide(listing([row('a')]))).toEqual({ do: 'open', session: 'a' })
  })

  test('a session the record lists and this computer does not have is not opened, and is not a reason to ask', () => {
    const away = row('away', { label: 'started on the laptop', missing: true })
    /* The only one recorded is somewhere else: a new session, as if the place were empty. */
    expect(decide(listing([away]))).toEqual({ do: 'open', session: null })
    /* One here and one elsewhere is exactly one that can be opened. */
    expect(decide(listing([away, row('a')]))).toEqual({ do: 'open', session: 'a' })
    /* Not even on the strength of what this page was showing. */
    expect(decide(listing([away, row('a', { lastActive: 1 }), row('b', { lastActive: 2 })]), 'away')).toEqual({ do: 'open', session: 'b' })
  })

  test('more than one: never a question — the one last open there, else its own, else the most recently active', () => {
    expect(decide({ ...listing([row('a'), row('b')]), current: 'a', own: 'b' })).toEqual({ do: 'open', session: 'a' })
    expect(decide({ ...listing([row('a'), row('b')]), own: 'b' })).toEqual({ do: 'open', session: 'b' })
    expect(decide(listing([row('a', { lastActive: 1 }), row('b', { lastActive: 9 })]))).toEqual({ do: 'open', session: 'b' })
  })

  test('what this page was showing for the place is shown again — while it still belongs there', () => {
    expect(decide({ ...listing([row('a'), row('b')]), own: 'a' }, 'b')).toEqual({ do: 'open', session: 'b' })
    expect(decide({ ...listing([row('a'), row('b')]), own: 'a' }, 'gone')).toEqual({ do: 'open', session: 'a' })
    expect(decide(listing([]), 'gone')).toEqual({ do: 'open', session: null })
  })

  test('the program missing, or too old, comes before any session', () => {
    expect(decide(listing([row('a')], { found: null }))).toEqual({ do: 'install', update: false })
    expect(decide(listing([row('a')], { lacks: '--session-id' }), 'a')).toEqual({ do: 'install', update: true })
  })
})

describe('the place the canvas is about', () => {
  const host = {
    where: 'hosted' as const,
    projectPath: '/p/thesis',
    epic: 'thesis',
    parts: [
      { id: 'results', picked: true },
      { id: 'intro', picked: false },
      { id: 'methods', picked: true },
    ],
    kehikko: { id: 3, name: 'writing' },
  }

  test('is the project, the epic, the picked parts as a set, and the kehikko by its id', () => {
    expect(standing(host)).toEqual({
      projectPath: '/p/thesis',
      epic: 'thesis',
      parts: ['methods', 'results'],
      kehikko: { id: 3 },
      kehikkoName: 'writing',
      partNames: {},
      kehikkoId: 3,
      key: 'epic=thesis;parts=methods+results;kehikko=3',
    })
  })

  test('by the kehikko’s key when the host sends one: the row number changing moves nothing', () => {
    const keyed = { ...host, kehikko: { id: 3, name: 'writing', key: '4072c9e5' } }
    expect(standing(keyed)).toEqual({
      projectPath: '/p/thesis',
      epic: 'thesis',
      parts: ['methods', 'results'],
      kehikko: { key: '4072c9e5' },
      kehikkoName: 'writing',
      partNames: {},
      kehikkoId: 3,
      key: 'epic=thesis;parts=methods+results;kehikko=key:4072c9e5',
    })
    /* Removed from the host and added again: 3, then 28. The same place. */
    const again = standing({ ...host, kehikko: { id: 28, name: 'writing', key: '4072c9e5' } })!
    expect(again.key).toBe(standing(keyed)!.key)
    expect(again.kehikkoId).toBe(28)
    /* Another key is another kehikko, whatever its number. */
    expect(standing({ ...host, kehikko: { id: 3, name: 'writing', key: 'review-2' } })!.key).not.toBe(again.key)
  })

  test('a key that is all digits is still a key, and never the place a row number names', () => {
    const keyed = standing({ ...host, kehikko: { id: 9, name: 'writing', key: '12345678' } })!
    const numbered = standing({ ...host, kehikko: { id: 12345678, name: 'writing' } })!
    expect(keyed.key).toBe('epic=thesis;parts=methods+results;kehikko=key:12345678')
    expect(numbered.key).toBe('epic=thesis;parts=methods+results;kehikko=12345678')
  })

  test('a host that sends no key — an older one — is still a place, by the row number', () => {
    expect(standing(host)!.kehikko).toEqual({ id: 3 })
    /* And a key that is not spelled like one is not stored: the place falls back rather than inventing a spelling. */
    expect(standing({ ...host, kehikko: { id: 3, name: 'writing', key: 'Not A Key' } })!.key).toBe(standing(host)!.key)
  })

  test('moves when the epic, the picked parts or the kehikko does, and not when a name does', () => {
    const here = standing(host)!.key
    expect(standing({ ...host, epic: 'other' })!.key).not.toBe(here)
    expect(standing({ ...host, parts: [{ id: 'methods', picked: true }] })!.key).not.toBe(here)
    expect(standing({ ...host, kehikko: { id: 4, name: 'writing' } })!.key).not.toBe(here)
    expect(standing({ ...host, kehikko: { id: 3, name: 'renamed' } })!.key).toBe(here)
    /* The same place in another project is another place. */
    expect(placeId(standing({ ...host, projectPath: '/p/other' })!)).not.toBe(placeId(standing(host)!))
  })

  test('with no project there is nothing to open — not a session somewhere else instead', () => {
    expect(standing({ ...host, projectPath: null })).toBeNull()
    expect(standing({ ...host, where: 'unhosted' })).toBeNull()
    expect(standing({ ...host, where: 'listening' })).toBeNull()
  })

  test('no epic, no parts and no kehikko is still a place', () => {
    expect(standing({ ...host, epic: null, parts: [], kehikko: null })!.key).toBe('epic=-;parts=-;kehikko=-')
  })
})

describe('the small words', () => {
  test('views are let go least recently shown first, and never the one on screen', () => {
    const at = standing({ where: 'hosted', projectPath: '/p', epic: null, parts: [], kehikko: null })!
    const views: View[] = [1, 2, 3, 4].map((n) => ({ n, at, session: null, shownAt: n, kept: true }))
    expect(surplus(views, 1, 2).map((one) => one.n)).toEqual([2, 3])
    expect(surplus(views, 4, 8)).toEqual([])
  })

  test('a label short enough for the corner, and a session with no prompt yet still has a name', () => {
    expect(brief('')).toBe('New session')
    expect(brief('tighten the methods section and then everything after it')).toBe('tighten the methods section…')
  })

  test('when something last happened', () => {
    const now = Date.parse('2026-10-12T12:00:00Z')
    expect(ago(null, now)).toBe('')
    expect(ago(now - 20_000, now)).toBe('just now')
    expect(ago(now - 5 * 60_000, now)).toBe('5 min ago')
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 h ago')
    expect(ago(now - 2 * 86_400_000, now)).toBe('2 d ago')
    expect(ago(Date.parse('2026-07-01T00:00:00Z'), now)).toBe('2026-07-01')
  })
})

describe('a notice, as the line a panel draws', () => {
  const notice = { state: 'finished' as const, label: 'tighten the methods section', epic: 'thesis', parts: ['Methods', 'Results'], kehikko: 'writing' }

  test('says which of the two it is, which session, and where — in a person’s words', () => {
    expect(noticeLine(notice, null)).toEqual({ epic: 'thesis', level: 'done', message: 'Finished: “tighten the methods section” — thesis · Methods + Results · writing', place: { epic: 'thesis' } })
    expect(noticeLine({ ...notice, state: 'needs-you' }, null)).toEqual({ epic: 'thesis', level: 'attention', message: 'Waiting for you: “tighten the methods section” — thesis · Methods + Results · writing', place: { epic: 'thesis' } })
  })

  test('says where a press goes: the epic, the parts’ ids and the kehikko’s key (protocol 1.4.0)', () => {
    const placed = { ...notice, partIds: ['methods', 'results'], kehikkoKey: 'writing-ab' }
    expect(noticeLine(placed, null)?.place).toEqual({ epic: 'thesis', parts: ['methods', 'results'], kehikko: 'writing-ab' })
    /* No key: the place names none. More parts than a place may hold: the epic alone, not a cut-down selection. */
    expect(noticeLine({ ...placed, kehikkoKey: null }, null)?.place).toEqual({ epic: 'thesis', parts: ['methods', 'results'] })
    expect(noticeLine({ ...placed, partIds: Array.from({ length: 17 }, (_, i) => `p${i}`) }, null)?.place).toEqual({ epic: 'thesis', kehikko: 'writing-ab' })
    /* A session with no epic of its own has no place to point at, only the canvas's epic to be filed under. */
    expect(noticeLine({ ...placed, epic: null }, 'another')?.place).toBeUndefined()
  })

  test('names only what there is: no parts picked, no kehikko, no prompt yet', () => {
    expect(noticeLine({ ...notice, parts: [] }, null)?.message).toBe('Finished: “tighten the methods section” — thesis · writing')
    expect(noticeLine({ ...notice, parts: [], kehikko: '' }, null)?.message).toBe('Finished: “tighten the methods section” — thesis')
    expect(noticeLine({ ...notice, label: '' }, null)?.message).toBe('Finished: a session with no prompt yet — thesis · Methods + Results · writing')
    expect(placeWords({ epic: null, parts: [], kehikko: '' })).toBe('')
  })

  test('is filed under the session’s own epic, and under the canvas’s only when the session has none', () => {
    expect(noticeLine(notice, 'another')?.epic).toBe('thesis')
    expect(noticeLine({ ...notice, epic: null }, 'another')).toMatchObject({ epic: 'another', message: 'Finished: “tighten the methods section” — Methods + Results · writing' })
    /* Nothing true to file it under: nothing is invented. */
    expect(noticeLine({ ...notice, epic: null }, null)).toBeNull()
  })

  test('is a payload the protocol’s own format accepts', () => {
    const line = noticeLine(notice, null)!
    expect(notificationPayload.safeParse({ ...line, refs: [] }).success).toBe(true)
  })
})

describe('the mark for what a session is doing', () => {
  test('three states, three shapes, three words', () => {
    expect(new Set(Object.values(MARKS).map((one) => one.glyph)).size).toBe(3)
    expect(Object.keys(MARKS).sort()).toEqual([...STATES].sort())
    expect(since('needs-you', 1_000_000 - 10 * 60_000, 1_000_000)).toBe('needs you · 10 min ago')
    expect(since('working', 1_000_000, 1_000_000)).toBe('working')
    expect(since('finished', null, 1_000_000)).toBe('finished')
  })

  test('the picked parts go with a place by what a person calls them', () => {
    const at = standing({
      where: 'hosted',
      projectPath: '/p',
      epic: 'thesis',
      parts: [
        { id: 'methods', heading: 'Methods', picked: true },
        { id: 'intro', heading: 'Introduction', picked: false },
        { id: 'results', heading: '', picked: true },
      ],
      kehikko: { id: 3, name: 'writing' },
    })
    expect(at?.partNames).toEqual({ methods: 'Methods' })
  })
})

/* ------------------------------------------------------------------ *
 * A place with no session in a project that has some (#6), and the words for a session running elsewhere (#5)
 * ------------------------------------------------------------------ */

describe('a place with no session', () => {
  const others = (rows: Row[]): Listing => ({ ...listing([]), others: rows })

  test('a new one, at once, whatever else the project holds: nothing is offered from it', () => {
    expect(decide(others([row('x'), row('y')]))).toEqual({ do: 'open', session: null })
    /* Whatever this page remembers showing: it no longer belongs here. */
    expect(decide(others([row('x')]), 'x')).toEqual({ do: 'open', session: null })
  })

  test('a place whose only recorded session is not on this computer is a place with none', () => {
    expect(decide({ ...listing([row('away', { missing: true })]), others: [row('x')] })).toEqual({ do: 'open', session: null })
  })

  test('the program missing still comes first', () => {
    expect(decide({ ...listing([], { found: null }), others: [row('x')] })).toEqual({ do: 'install', update: false })
  })
})

describe('the words for a session that is open somewhere else', () => {
  const NOW = Date.parse('2026-10-12T12:00:00Z')
  const terminal = { kind: 'interactive' as const, called: 'a Codex process', pid: 82070, cwd: '/Users/someone/Projects/thesis', since: null, name: '' }

  test('say where it is open, from what the lock file says', () => {
    expect(whereWords(terminal, NOW)).toBe('a Codex process in a terminal, an editor or the Codex app, process 82070, in /Users/someone/Projects/thesis')
    /* What was not said is left out, not made up. */
    expect(whereWords({ kind: 'other', called: 'sdk', pid: null, cwd: '', since: null, name: '' }, NOW)).toBe('a “sdk” session')
  })

  test('the question says what is true and that nothing has been started', () => {
    expect(elsewhereSaid('Codex', 'tighten the methods', terminal, NOW)).toBe(
      '“tighten the methods” is already open in another Codex process on this computer: a Codex process in a terminal, an editor or the Codex app, process 82070, in /Users/someone/Projects/thesis. Nothing has been started here.',
    )
    expect(elsewhereSaid('Codex', '', null, NOW)).toBe('This conversation is already open in another Codex process on this computer. Nothing has been started here.')
  })

  test('the two answers are in words, and opening it anyway says what Codex will do before it is chosen', () => {
    expect(LEAVE.word).toBe('Leave it')
    expect(LEAVE.means).toContain('the other process is not touched')
    expect(COPY.word).toBe('Open it here anyway')
    expect(COPY.means).toContain('open in another app')
    expect(COPY.means).toContain('fork')
  })

  test('a session on screen says what it is when it is not simply this module’s own', () => {
    expect(standingWords(undefined, 'Codex', NOW)).toBeNull()
    expect(standingWords({}, 'Codex', NOW)).toBeNull()
    const copy = standingWords({ copyOf: terminal }, 'Codex', NOW)
    expect(copy?.word).toBe('also open')
    expect(copy?.means).toContain('Opened here while another Codex process has it (a Codex process in a terminal, an editor or the Codex app, process 82070')
    expect(standingWords({ unchecked: 'too-old' }, 'Codex', NOW)?.means).toBe('Resumed without checking whether it is already open somewhere else: this Codex cannot be asked. Update it to have that checked.')
    expect(standingWords({ unchecked: 'failed' }, 'Codex', NOW)?.means).toContain('could not be asked')
  })
})
