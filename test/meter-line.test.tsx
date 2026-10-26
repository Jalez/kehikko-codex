import { afterEach, describe, expect, test } from 'bun:test'
import { act, cleanup, fireEvent, render } from '@testing-library/react'

import { contextOf, readLines } from '../meter.ts'
import { CLEAR_ARMED, ContextLine, NO_SPLIT, type Command } from '../src/view/meter.tsx'

/** The line under the session on screen: what it says, its breakdown, and Compact and Clear. */

afterEach(cleanup)

const count = (at: string, total: number) => JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: total - 20, cached_input_tokens: total - 60, output_tokens: 20, total_tokens: total }, model_context_window: 258_400 } } })
const near = contextOf(readLines([JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.5' } }), count('2026-10-24T11:55:51.076Z', 225_000)].join('\n')))!
const compacted = contextOf(
  readLines(
    [
      JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.5' } }),
      count('2026-10-24T11:55:51.076Z', 171_260),
      JSON.stringify({ timestamp: '2026-10-24T11:56:05.800Z', type: 'event_msg', payload: { type: 'task_started' } }),
      JSON.stringify({ timestamp: '2026-10-24T11:56:05.800Z', type: 'compacted', payload: { message: 'summary' } }),
      count('2026-10-24T11:56:05.900Z', 2_743),
    ].join('\n'),
  ),
)!

function line(props: { ready?: string | null; context?: typeof near | null; armedMs?: number } = {}) {
  const sent: Command[] = []
  const view = render(
    <ContextLine context={props.context === undefined ? near : props.context} ready={props.ready ?? null} armedMs={props.armedMs} onCommand={(which) => (sent.push(which), true)} />,
  )
  const q = (selector: string) => view.container.querySelector(selector) as HTMLElement | null
  return { view, sent, q }
}

describe('the context line', () => {
  test('says the share, the figure and the warning in words — never by colour alone', () => {
    const { q, view } = line()
    expect(q('[data-context-percent]')?.textContent).toBe('87% — compacts soon')
    expect(view.container.textContent).toContain('225k / 258k')
    expect(q('[data-meter-bar]')?.getAttribute('data-meter-bar')).toBe('87')
    expect(q('[data-context-trigger]')?.getAttribute('title')).toContain('compacts by itself at about 95%')
  })

  test('nothing sent yet is said as such', () => {
    const { q } = line({ context: null })
    expect(q('[data-context-percent]')?.textContent).toBe('nothing sent yet')
  })

  test('pressed, it opens a breakdown with the figures it has, and says the split by kind is not written; Escape closes it', () => {
    const { q, view } = line({ context: compacted })
    fireEvent.click(q('[data-context-trigger]')!)
    const panel = q('[data-breakdown]')!
    expect(panel.textContent).toContain('about 2,743 of 258,400 tokens')
    expect(panel.textContent).toContain('once — last by /compact')
    expect(panel.textContent).toContain('171k → 3k')
    expect(panel.textContent).toContain(NO_SPLIT)
    expect(q('[data-context-trigger]')?.getAttribute('aria-expanded')).toBe('true')
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    expect(q('[data-breakdown]')).toBeNull()
    expect(view.container.querySelector('[data-compacted]')).not.toBeNull()
  })

  test('Compact goes at once; Clear asks first, saying the session starts over and the old one is kept', () => {
    const { q, sent } = line()
    fireEvent.click(q('[data-command="compact"]')!)
    expect(sent).toEqual(['compact'])
    fireEvent.click(q('[data-command="clear"]')!)
    expect(sent).toEqual(['compact'])
    expect(q('[data-context-said]')?.textContent).toBe(CLEAR_ARMED)
    expect(CLEAR_ARMED).toContain('new conversation')
    expect(CLEAR_ARMED).toContain('This one is kept')
    expect(q('[data-command="clear"]')?.textContent).toBe('Clear: sure?')
    fireEvent.click(q('[data-command="clear"]')!)
    expect(sent).toEqual(['compact', 'clear'])
  })

  test('an armed Clear lets go by itself, and on Escape', async () => {
    const { q, sent } = line({ armedMs: 30 })
    fireEvent.click(q('[data-command="clear"]')!)
    await act(() => new Promise((done) => setTimeout(done, 60)))
    expect(q('[data-command="clear"]')?.textContent).toBe('Clear')
    fireEvent.click(q('[data-command="clear"]')!)
    act(() => void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
    fireEvent.click(q('[data-command="clear"]')!)
    expect(sent).toEqual([])
  })

  test('while Codex is working both wait, and a press says why in words', () => {
    const why = 'Codex is working. Compact and Clear wait until it is back at its prompt.'
    const { q, sent, view } = line({ ready: why })
    expect(q('[data-command="compact"]')?.getAttribute('aria-disabled')).toBe('true')
    expect(q('[data-command="clear"]')?.getAttribute('title')).toBe(`Clear waits: ${why}`)
    fireEvent.click(q('[data-command="clear"]')!)
    fireEvent.click(q('[data-command="clear"]')!)
    fireEvent.click(q('[data-command="compact"]')!)
    expect(sent).toEqual([])
    expect(q('[data-context-said]')?.textContent).toBe(`Compact waits: ${why}`)
    expect(view.container.querySelector('[data-context-line]')?.getAttribute('data-ready')).toBe('no')
  })
})
