import { afterEach, describe, expect, test } from 'bun:test'
import { cleanup, fireEvent, render } from '@testing-library/react'

import { TOLD, TOLD_LABEL, viewHeader } from '../src/view/conversations.ts'
import { TOLD_NOTHING, ToldPanel, toldText } from '../src/view/told.tsx'

/**
 * "What this conversation was told": the notes its hooks last gave it, on screen as plain text. A
 * module's words in them are text whatever they say: never markup, never a link.
 */

afterEach(cleanup)

const row = { id: '11111111-1111-4111-8111-111111111111', label: 'tighten the methods', lastActive: 1, missing: false } as never

const told = {
  start: { at: Date.UTC(2026, 9, 31, 12, 0), text: 'Kehikot: this conversation belongs to project thesis.\nModules on this kehikko, …:\n- Evil (door x) — "<b>bold</b> <a href=\\"https://example.org\\">link</a> <img src=x onerror=alert(1)>".' },
  changes: [{ at: Date.UTC(2026, 9, 31, 12, 5), text: 'Kehikot: the kehikko "writing" changed since this conversation was told what is on it.' }],
}

describe('the item', () => {
  test('is in the header for the conversation on screen, and not for agents', () => {
    const items = viewHeader({ rows: [row], own: null, viewing: (row as { id: string }).id, now: 2 })
    const item = items.find((one) => one.id === TOLD)
    expect(item).toEqual({ kind: 'run', id: TOLD, label: TOLD_LABEL, icon: 'scroll-text' })
    expect(TOLD_LABEL).toBe('What this conversation was told')
  })

  test('is not there when nothing connected is on screen', () => {
    expect(viewHeader({ rows: [row], own: null, viewing: null, now: 2 }).some((one) => one.id === TOLD)).toBe(false)
  })
})

describe('the panel', () => {
  test('shows the full notes, then each change under when it was told, as one text', () => {
    const text = toldText(told)
    expect(text.split('\n')[0]).toStartWith('Told at its start (')
    expect(text).toContain(told.start.text)
    expect(text).toContain('Told at a prompt (')
    expect(text.endsWith(told.changes[0]!.text)).toBe(true)
  })

  test('renders a module’s words as text: no element, no link, nothing run', () => {
    const { container } = render(<ToldPanel told={told} onClose={() => {}} />)
    const pre = container.querySelector('[data-told-text]')!
    expect(pre.textContent).toBe(toldText(told))
    expect(pre.children.length).toBe(0)
    expect(container.querySelector('a, b, img')).toBeNull()
  })

  test('says so when nothing was kept, while it is read, or when the read failed; Close closes', () => {
    let closed = 0
    const { container, rerender } = render(<ToldPanel told={undefined} onClose={() => closed++} />)
    expect(container.querySelector('[data-told-text]')!.textContent).toBe('Reading…')
    rerender(<ToldPanel told={null} onClose={() => closed++} />)
    expect(container.querySelector('[data-told-text]')!.textContent).toBe(TOLD_NOTHING)
    rerender(<ToldPanel told={null} error="no answer" onClose={() => closed++} />)
    expect(container.querySelector('[data-told-text]')!.textContent).toBe('no answer')
    fireEvent.click(container.querySelector('[data-told-close]')!)
    expect(closed).toBe(1)
  })
})
