import { describe, expect, test } from 'bun:test'

import { cutOffWords, cutOffs, midTurn, movedOn } from '../cutoff.ts'

/** How a Codex conversation's record says it ended (rows measured on 0.164.0). */

const ev = (type: string, at = '2026-10-26T01:00:00.000Z', more: Record<string, unknown> = {}) => JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type, ...more } })
const said = (text: string, at: string) => ev('item_completed', at, { item: { type: 'UserMessage', content: [{ type: 'text', text }] } })

describe('a turn cut off', () => {
  test('a turn begun and never ended is mid-turn; one that completed or was interrupted is not', () => {
    expect(midTurn([ev('task_started'), ev('task_complete')].join('\n'))).toBe(false)
    expect(midTurn([ev('task_started'), ev('turn_aborted', undefined, { reason: 'interrupted' })].join('\n'))).toBe(false)
    expect(midTurn([ev('task_started'), ev('task_complete'), ev('task_started')].join('\n'))).toBe(true)
    expect(midTurn('')).toBe(false)
  })

  test('the person has moved on when they said something after, and a line of this module’s own is not them', () => {
    const text = [said('Kehikot restarted.', '2026-10-26T01:00:05.000Z'), said('carry on please', '2026-10-26T01:00:09.000Z')].join('\n')
    expect(movedOn(text, Date.parse('2026-10-26T01:00:00.000Z'), ['Kehikot restarted.'])).toBe(true)
    expect(movedOn(text, Date.parse('2026-10-26T01:00:10.000Z'))).toBe(false)
    expect(movedOn(said('Kehikot restarted.', '2026-10-26T01:00:05.000Z'), 0, ['Kehikot restarted.'])).toBe(false)
  })

  test('Codex writes nothing about background work a session’s end cut off, so none is found', () => {
    expect(cutOffs([ev('task_started'), said('x', '2026-10-26T01:00:00.000Z')].join('\n'))).toEqual([])
  })

  test('a cut-off turn is said in words, with what opening it does', () => {
    const words = cutOffWords([{ at: 1, kind: 'turn', summary: 'Its turn was cut off when Kehikot restarted', tasks: 1 }])
    expect(words.said).toBe('its turn was cut off when Kehikot restarted')
    expect(words.detail).toContain('Open it to carry on')
  })
})
