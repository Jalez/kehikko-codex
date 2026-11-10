import { describe, expect, test } from 'bun:test'
import { headerItemsSchema, pressRefusal } from 'kehikot-module-protocol'

import type { Row } from '../doors.ts'
import { DISCONNECT, HERE_COMMAND, MAKE_OWN, NEW, NONE_CONNECTED, NOT_CONNECTED, OTHERS_GROUP, OWN_GROUP, STARTED_HERE, VIEW, TOLD, chooserLabel, connected, disconnectedLine, optionDetail, stateWord, viewHeader } from '../src/view/conversations.ts'

/** The bar's words and the conversation chooser, pure: what is said, and that it fits the header. */

const row = (id: string, more: Partial<Row> = {}): Row => ({ id, label: '', lastActive: null, running: false, ...more })
const NOW = 1_800_000_000_000

describe('the bar', () => {
  test('says what is true and what to type where, word for word', () => {
    expect(NONE_CONNECTED).toBe('No conversation is connected to this kehikko. Type $kehikot-here in the Codex conversation you want here.')
    /* A new conversation this module started is the place's own by itself: the command is only for one started elsewhere. */
    expect(STARTED_HERE).toBe('A new Codex conversation: it becomes this kehikko’s own once you say something in it. For one started elsewhere, type $kehikot-here in it.')
  })
})

describe('the conversations connected here', () => {
  test('the own first, then the most recently active; one not on this computer is not among them', () => {
    const rows = [row('a', { lastActive: 1 }), row('b', { lastActive: 3 }), row('c', { lastActive: 2 }), row('gone', { missing: true, lastActive: 9 })]
    expect(connected({ sessions: rows, own: 'a' }).map((one) => one.id)).toEqual(['a', 'b', 'c'])
    expect(connected({ sessions: rows, own: null }).map((one) => one.id)).toEqual(['b', 'c', 'a'])
    expect(connected(null)).toEqual([])
  })
})

describe('the conversation chooser', () => {
  const options = (items: ReturnType<typeof viewHeader>) => (items[0] as { options: { id: string; label: string; group?: string; detail?: string }[] }).options

  test('nothing connected and a new conversation on screen: nothing declared — the footer says it', () => {
    expect(viewHeader({ rows: [], own: null, viewing: null, now: NOW })).toEqual([])
  })

  test('one switch, labelled with the conversation on screen, its own under one heading and the others here under another', () => {
    const rows = [row('a', { label: 'Fix login bug', lastActive: NOW - 5 * 60_000, state: 'needs-you', running: true }), row('b', { label: 'Draft the results', lastActive: NOW - 2 * 3_600_000 }), row('c', { label: 'Tidy', state: 'working', running: true })]
    const items = viewHeader({ rows, own: 'a', viewing: 'a', now: NOW })
    expect(items[0]).toMatchObject({ kind: 'switch', id: VIEW, label: 'Conversation: Fix login bug', value: 'a' })
    expect(options(items)).toEqual([
      { id: 'a', label: 'Fix login bug', group: OWN_GROUP, detail: 'needs you · 5 min ago' },
      { id: 'b', label: 'Draft the results', group: OTHERS_GROUP, detail: 'idle · 2 h ago' },
      { id: 'c', label: 'Tidy', group: OTHERS_GROUP, detail: 'working' },
      { id: NEW, label: 'New conversation' },
      { id: DISCONNECT, label: 'Disconnect this conversation' },
    ])
    expect(OWN_GROUP).toBe('This kehikko’s conversation')
    expect(OTHERS_GROUP).toBe('Other conversations here')
    expect(headerItemsSchema.safeParse(items).success).toBe(true)
  })

  test('states in words — working, needs you, finished, idle — and "(running elsewhere)" only where another process has it', () => {
    expect(['working', 'needs-you', 'finished', undefined].map((state) => stateWord(state as Row['state']))).toEqual(['working', 'needs you', 'finished', 'idle'])
    expect(optionDetail(row('a', { state: 'finished', lastActive: NOW - 60 * 60_000 }), NOW)).toBe('finished · 1 h ago')
    expect(optionDetail(row('a', { elsewhere: { kind: 'background', called: 'background', pid: 1, cwd: '/p' } as unknown as Row['elsewhere'] }), NOW)).toBe('idle · (running elsewhere)')
    expect(optionDetail(row('a', { running: true, as: 'background' }), NOW)).toBe('idle · (running elsewhere)')
    expect(optionDetail(row('a', { running: true, as: 'copy' }), NOW)).toBe('idle · (running elsewhere)')
    expect(optionDetail(row('a', { running: true }), NOW)).toBe('idle')
  })

  test('plain words: no session ids, no "background" or "copy", no marks', () => {
    const rows = [row('5f3c9a2e-1111-2222-3333-444455556666', { label: '', running: true, as: 'copy' }), row('b', { label: 'two', running: true, as: 'background' })]
    const items = viewHeader({ rows, own: '5f3c9a2e-1111-2222-3333-444455556666', viewing: 'b', now: NOW })
    const words = JSON.stringify([items[0]!.label, ...options(items).map((one) => [one.label, one.group ?? '', one.detail ?? ''])])
    expect(words).not.toContain('5f3c9a2e')
    expect(words).not.toMatch(/background|copy|[●◆○]/)
    expect(options(items)[0]).toMatchObject({ label: 'No prompt yet', detail: 'idle · (running elsewhere)' })
  })

  test('only this place’s conversations: none from another place, none that belongs to no place, and no Go menu', () => {
    const items = viewHeader({ rows: [row('a', { label: 'one' })], own: 'a', viewing: 'a', now: NOW })
    expect(options(items).map((one) => one.id)).toEqual(['a', NEW, DISCONNECT])
    expect(items.some((one) => one.kind === 'go')).toBe(false)
  })

  test('the runs beside it: make-own only when the one on screen is not the own; disconnect is in the chooser, unconfirmed', () => {
    const rows = [row('a', { label: 'one' }), row('b', { label: 'two' })]
    expect(viewHeader({ rows, own: 'a', viewing: 'a', now: NOW }).map((one) => one.id)).toEqual([VIEW, TOLD])
    const other = viewHeader({ rows, own: 'a', viewing: 'b', now: NOW })
    expect(other.map((one) => one.id)).toEqual([VIEW, MAKE_OWN, TOLD])
    expect(other.find((one) => one.id === MAKE_OWN)).toMatchObject({ kind: 'run', label: 'Make this the kehikko’s own' })
    /* A server that does not say which is the own claims nothing about it: no heading for the own. */
    const unsaid = viewHeader({ rows, own: undefined, viewing: 'b', now: NOW })
    expect(unsaid.map((one) => one.id)).toEqual([VIEW, TOLD])
    expect(options(unsaid).filter((one) => one.group).every((one) => one.group === OTHERS_GROUP)).toBe(true)
  })

  test('a new conversation on screen that is not connected yet is said as such, without New or Disconnect, and offers no run', () => {
    const items = viewHeader({ rows: [row('a', { label: 'one' })], own: 'a', viewing: null, now: NOW })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ label: 'Conversation: New conversation', value: NOT_CONNECTED })
    expect(options(items)).toEqual([
      { id: 'a', label: 'one', group: OWN_GROUP, detail: 'idle' },
      { id: NOT_CONNECTED, label: 'New conversation', group: OTHERS_GROUP, detail: 'new · joins this kehikko once you say something' },
    ])
    /* With no own, the new one is the own to be: under that heading, first. */
    const first = viewHeader({ rows: [row('a', { label: 'one' })], own: null, viewing: null, now: NOW })
    expect(options(first).map((one) => [one.id, one.group])).toEqual([[NOT_CONNECTED, OWN_GROUP], ['a', OTHERS_GROUP]])
    expect(headerItemsSchema.safeParse(first).success).toBe(true)
  })

  test('labels within 48 characters and details within 64, whatever the title', () => {
    const items = viewHeader({ rows: [row('a', { label: 'z'.repeat(200), lastActive: NOW - 90 * 60_000, state: 'working', as: 'background', running: true })], own: 'a', viewing: 'a', now: NOW })
    expect(items[0]!.label.length).toBeLessThanOrEqual(48)
    expect(items[0]!.label).toMatch(/^Conversation: z+…$/)
    expect(options(items)[0]!.label.length).toBeLessThanOrEqual(48)
    expect(options(items)[0]!.detail).toBe('working · 2 h ago · (running elsewhere)')
    expect(chooserLabel('')).toBe('Conversation: No prompt yet')
  })

  test('at most 64 options — the one on screen always among them, New and Disconnect kept', () => {
    const rows = Array.from({ length: 80 }, (_, n) => row(`id-${n}`, { label: `conversation ${n} `.repeat(6), lastActive: NOW - n * 60_000 }))
    const items = viewHeader({ rows, own: 'id-0', viewing: 'id-79', now: NOW })
    const all = options(items)
    expect(all.length).toBe(63)
    expect(items[0]).toMatchObject({ value: 'id-79' })
    expect(all.some((one) => one.id === 'id-79')).toBe(true)
    expect(all.slice(-2).map((one) => one.id)).toEqual([NEW, DISCONNECT])
    expect(all.some((one) => one.id === NOT_CONNECTED)).toBe(false)
    expect(headerItemsSchema.safeParse(items).success).toBe(true)
  })

  test('an agent’s press: nothing here is for agents, and every id it may name resolves', () => {
    const rows = [row('a', { label: 'one' }), row('b', { label: 'two' })]
    const items = headerItemsSchema.parse(viewHeader({ rows, own: 'a', viewing: 'b', now: NOW }))
    expect(items.some((one) => one.agents)).toBe(false)
    expect(pressRefusal(items, { item: VIEW, value: 'a' })).toBeNull()
    expect(pressRefusal(items, { item: VIEW, value: NEW })).toBeNull()
    expect(pressRefusal(items, { item: VIEW, value: DISCONNECT })).toBeNull()
    expect(pressRefusal(items, { item: MAKE_OWN })).toBeNull()
    expect(pressRefusal(items, { item: TOLD })).toBeNull()
    /* The old ids are gone, and a press naming one is told what there is. */
    expect(pressRefusal(items, { item: 'connect', value: 'a' })).toContain(`What can be pressed: ${VIEW}, ${MAKE_OWN}, ${TOLD}`)
    expect(pressRefusal(items, { item: 'disconnect' })).not.toBeNull()
    expect(pressRefusal(items, { item: 'connected', value: false })).not.toBeNull()
  })

  test('the disconnect strip says how to connect it again without a menu', () => {
    expect(disconnectedLine('Fix login bug')).toBe(`Disconnected “Fix login bug” from this kehikko — it is kept, and typing ${HERE_COMMAND} in it connects it here again.`)
  })
})
