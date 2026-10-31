import { describe, expect, test } from 'bun:test'

import { lastRow, type Screen } from '../src/view/keep-last.ts'

/*
 * Which line has to stay above the host's footer while it is revealed over the shell: the last row
 * with text, or the cursor's, whichever is lower (`src/view/keep-last.ts`).
 */

function screen(lines: string[], rows: number, cursor: { y: number; base?: number; viewport?: number }): Screen {
  return {
    rows,
    buffer: {
      active: {
        viewportY: cursor.viewport ?? 0,
        baseY: cursor.base ?? 0,
        cursorY: cursor.y,
        getLine: (index) => (index < lines.length ? { translateToString: () => lines[index]! } : undefined),
      },
    },
  }
}

describe('the last line', () => {
  test('a fresh shell: its prompt on the first row', () => {
    expect(lastRow(screen(['$ '], 24, { y: 0 }))).toBe(0)
  })

  test('a full screen: the bottom row', () => {
    expect(lastRow(screen(Array.from({ length: 30 }, (_, i) => `line ${i}`), 24, { y: 23, base: 6, viewport: 6 }))).toBe(23)
  })

  test('text below the cursor (a TUI’s status line under its input) wins over the cursor', () => {
    const lines = ['out', '> typing', '', '  status line', '']
    expect(lastRow(screen(lines, 10, { y: 1 }))).toBe(3)
  })

  test('the cursor below the last text (an empty prompt line) wins over the text', () => {
    expect(lastRow(screen(['out', 'more', '', ''], 10, { y: 3 }))).toBe(3)
  })

  test('scrolled back: the cursor is not on screen, so the last visible text is it', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`)
    expect(lastRow(screen(lines, 24, { y: 23, base: 76, viewport: 10 }))).toBe(23)
  })

  test('an emulator that says nothing: the bottom row', () => {
    expect(lastRow({ rows: 24 })).toBe(23)
  })
})
