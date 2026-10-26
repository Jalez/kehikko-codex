import { describe, expect, test } from 'bun:test'
import { headerItemsSchema } from 'kehikot-module-protocol'

import type { Row } from '../doors.ts'
import { DISCONNECT, MAKE_OWN, NONE_CONNECTED, NOT_CONNECTED, VIEW, connected, optionLabel, viewHeader } from '../src/view/conversations.ts'

/** The bar's words and the View menu, pure: what is said, and that it fits the header. */

const row = (id: string, more: Partial<Row> = {}): Row => ({ id, label: '', lastActive: null, running: false, ...more })
const NOW = 1_800_000_000_000

describe('the bar', () => {
  test('says what is true and what to type where, word for word', () => {
    expect(NONE_CONNECTED).toBe('No conversation is connected to this kehikko. Type $kehikot-here in the Codex conversation you want here.')
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

describe('the View menu', () => {
  test('nothing connected: nothing declared — the bar says it', () => {
    expect(viewHeader({ rows: [], own: null, viewing: null, now: NOW })).toEqual([])
  })

  test('the one on screen is the switch’s value; make-own only when it is not the own; disconnect always, confirmed', () => {
    const rows = [row('a', { label: 'one' }), row('b', { label: 'two' })]
    const own = viewHeader({ rows, own: 'a', viewing: 'a', now: NOW })
    expect(own.map((one) => one.id)).toEqual([VIEW, DISCONNECT])
    const other = viewHeader({ rows, own: 'a', viewing: 'b', now: NOW })
    expect(other.map((one) => one.id)).toEqual([VIEW, MAKE_OWN, DISCONNECT])
    expect(other[0]).toMatchObject({ kind: 'switch', value: 'b' })
    expect(other.find((one) => one.id === DISCONNECT)).toMatchObject({ kind: 'run', confirm: true })
    expect(other.some((one) => 'agents' in one)).toBe(false)
    expect(headerItemsSchema.safeParse(other).success).toBe(true)
    /* A server that does not say which is the own claims nothing about it. */
    expect(viewHeader({ rows, own: undefined, viewing: 'b', now: NOW }).map((one) => one.id)).toEqual([VIEW, DISCONNECT])
  })

  test('a new conversation on screen that is not connected yet is said as such, and offers no run', () => {
    const items = viewHeader({ rows: [row('a', { label: 'one' })], own: 'a', viewing: null, now: NOW })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ value: NOT_CONNECTED, options: [{ id: 'a', label: 'one · own' }, { id: NOT_CONNECTED, label: 'Not connected: a new conversation' }] })
    expect(headerItemsSchema.safeParse(items).success).toBe(true)
  })

  test('a line keeps its mark, when, and own whole however long the title, within 48 characters', () => {
    const label = optionLabel(row('a', { label: 'z'.repeat(200), lastActive: NOW - 90 * 60_000, state: 'working' }), true, NOW, ['copy'])
    expect(label.length).toBeLessThanOrEqual(48)
    expect(label).toMatch(/^● z+… · copy · 2 h ago · own$/)
    expect(optionLabel(row('b'), false, NOW)).toBe('No prompt yet')
  })

  test('a line says how full the conversation’s context is, in words near where it compacts', () => {
    const context = (percent: number | null, soon = false) => ({ tokens: percent === null ? null : percent * 2000, window: 200_000, windowSure: false, percent, compactAt: 167_000, warnAt: 147_000, effective: 180_000, soon, model: null, cost: null, compacted: null, afterCompact: false, split: null, from: 'transcript' as const, at: 1 })
    expect(optionLabel(row('a', { label: 'tighten the methods', lastActive: NOW - 5 * 60_000, context: context(41) }), true, NOW)).toBe('tighten the methods · 41% · 5 min ago · own')
    expect(optionLabel(row('a', { label: 'z'.repeat(200), lastActive: NOW - 5 * 60_000, state: 'finished', context: context(82, true) }), false, NOW)).toMatch(/^○ z+… · 82% soon · 5 min ago$/)
    expect(optionLabel(row('a', { label: 'new', context: context(null) }), false, NOW)).toBe('new')
  })

  test('at most 64 options — the one on screen always among them — and every label within the protocol’s limit', () => {
    const rows = Array.from({ length: 80 }, (_, n) => row(`id-${n}`, { label: `conversation ${n} `.repeat(6), lastActive: NOW - n * 60_000 }))
    const items = viewHeader({ rows, own: 'id-0', viewing: 'id-79', now: NOW })
    const options = (items[0] as { options: { label: string }[] }).options
    expect(options.length).toBe(63)
    /* The one on screen is among them, as itself, past the limit. */
    expect(items[0]).toMatchObject({ value: 'id-79' })
    expect((options as { id?: string }[]).some((one) => one.id === NOT_CONNECTED)).toBe(false)
    expect([...items.map((one) => one.label), ...options.map((one) => one.label)].every((one) => one.length <= 48)).toBe(true)
    expect(headerItemsSchema.safeParse(items).success).toBe(true)
  })
})
