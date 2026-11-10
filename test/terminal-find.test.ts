import { describe, expect, test } from 'bun:test'
import { Terminal } from '@xterm/headless'
import type { FindCount } from 'kehikot-module-protocol/client'

import { findColours, terminalFind } from '../src/view/terminal-find.ts'

/* By a specifier of its own: `terminal-view.test.tsx` stands a fake in for the addon, and bun's
   `mock.module` holds for the whole run. The query is what makes this the real file. */
const { SearchAddon } = (await import(`${require.resolve('@xterm/addon-search')}?real`)) as typeof import('@xterm/addon-search')

/**
 * Find in the terminal (protocol 2.69.0), with the real search addon on a headless emulator. The
 * headless one has no renderer, so its decorations and selection are stood in for here: what is
 * marked is what the addon registered, and what is current is what it selected.
 */

function emulator() {
  const terminal = new Terminal({ cols: 40, rows: 4, scrollback: 200, allowProposedApi: true })
  const marks = new Set<{ background?: string }>()
  let selected: { x: number; y: number; length: number } | null = null
  const stand = terminal as unknown as Record<string, unknown>
  stand.registerDecoration = (options: { marker: unknown; backgroundColor?: string }) => {
    const mark = { marker: options.marker, background: options.backgroundColor, dispose: () => void marks.delete(mark), onRender: () => ({ dispose() {} }), onDispose: () => ({ dispose() {} }) }
    marks.add(mark)
    return mark
  }
  stand.select = (x: number, y: number, length: number) => void (selected = { x, y, length })
  stand.getSelectionPosition = () => (selected ? { start: { x: selected.x, y: selected.y }, end: { x: selected.x + selected.length, y: selected.y } } : undefined)
  stand.clearSelection = () => void (selected = null)
  stand.hasSelection = () => selected !== null
  const search = new SearchAddon()
  terminal.loadAddon(search as never)
  const write = (text: string) => new Promise<void>((done) => terminal.write(text, done))
  return { terminal, search, marks, write, selected: () => selected }
}

const ask = (direction: 'first' | 'next' | 'prev' | 'close', more = {}) => ({ caseSensitive: false, wholeWord: false, direction, ...more })

describe('find in the terminal', () => {
  test('marks every match in the screen and the scrollback, and counts them', async () => {
    const t = emulator()
    /* Twelve lines in a four-row screen: most of them are scrollback. */
    await t.write(Array.from({ length: 12 }, (_, i) => `line ${i} ${i % 3 === 0 ? 'needle' : 'hay'}`).join('\r\n'))
    const { find } = terminalFind(t.search, t.terminal as never, () => {}, () => findColours('light'))
    expect(find('needle', ask('first'))).toEqual({ total: 4, current: 1 })
    /* Four matches, and one more mark for the current one. */
    expect(t.marks.size).toBe(5)
    expect([...t.marks].filter((m) => m.background === findColours('light').activeMatchBackground)).toHaveLength(1)
    expect(t.selected()).toMatchObject({ y: 0, length: 6 })
  })

  test('next and previous move the current match, and wrap', async () => {
    const t = emulator()
    await t.write('a needle\r\nb needle\r\nc needle')
    const { find } = terminalFind(t.search, t.terminal as never, () => {}, () => findColours('dark'))
    expect(find('needle', ask('first'))).toEqual({ total: 3, current: 1 })
    expect(find('needle', ask('next'))).toEqual({ total: 3, current: 2 })
    expect(t.selected()?.y).toBe(1)
    expect(find('needle', ask('next'))).toEqual({ total: 3, current: 3 })
    expect(find('needle', ask('next'))).toEqual({ total: 3, current: 1 })
    expect(find('needle', ask('prev'))).toEqual({ total: 3, current: 3 })
    expect(t.selected()?.y).toBe(2)
  })

  test('case and whole words narrow it; nothing found is none of none', async () => {
    const t = emulator()
    await t.write('Needle needles needle end')
    const { find } = terminalFind(t.search, t.terminal as never, () => {}, () => findColours('light'))
    expect(find('needle', ask('first'))).toEqual({ total: 3, current: 1 })
    expect(find('needle', ask('first', { caseSensitive: true }))).toEqual({ total: 2, current: 1 })
    expect(find('haystack', ask('first'))).toEqual({ total: 0, current: 0 })
    const w = emulator()
    await w.write('the needles only')
    const words = terminalFind(w.search, w.terminal as never, () => {}, () => findColours('light'))
    expect(words.find('needle', ask('first', { wholeWord: true }))).toEqual({ total: 0, current: 0 })
    expect(words.find('needles', ask('first', { wholeWord: true }))).toEqual({ total: 1, current: 1 })
  })

  test('close clears every mark and the selection, and answers nothing', async () => {
    const t = emulator()
    await t.write('needle needle')
    const { find } = terminalFind(t.search, t.terminal as never, () => {}, () => findColours('light'))
    find('needle', ask('first'))
    expect(t.marks.size).toBeGreaterThan(0)
    expect(find('', ask('close'))).toBeUndefined()
    expect(t.marks.size).toBe(0)
    expect(t.selected()).toBeNull()
    find('needle', ask('first'))
    expect(find('', ask('first'))).toEqual({ total: 0, current: 0 })
    expect(t.marks.size).toBe(0)
  })

  test('a count that changes by itself is said; one it asked for is returned, not said twice', () => {
    const said: FindCount[] = []
    let hear: (e: { resultIndex: number; resultCount: number }) => void = () => {}
    const search = {
      findNext: () => {
        hear({ resultIndex: 0, resultCount: 2 })
        return true
      },
      findPrevious: () => true,
      clearDecorations: () => {},
      onDidChangeResults: (listener: typeof hear) => {
        hear = listener
        return { dispose() {} }
      },
    }
    const { find } = terminalFind(search as never, { clearSelection() {} }, (count) => said.push(count), () => findColours('light'))
    expect(find('x', ask('first'))).toEqual({ total: 2, current: 1 })
    expect(said).toEqual([])
    hear({ resultIndex: 0, resultCount: 3 })
    expect(said).toEqual([{ total: 3, current: 1 }])
  })

  test('new output under an open search is counted again and said', async () => {
    const t = emulator()
    await t.write('needle\r\n')
    const said: FindCount[] = []
    const { find } = terminalFind(t.search, t.terminal as never, (count) => said.push(count), () => findColours('light'))
    expect(find('needle', ask('first'))).toEqual({ total: 1, current: 1 })
    await t.write('more needle\r\n')
    await new Promise((settle) => setTimeout(settle, 300))
    expect(said.at(-1)).toEqual({ total: 2, current: 1 })
  })
})
