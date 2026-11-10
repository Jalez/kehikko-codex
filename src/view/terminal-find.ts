import type { ISearchOptions, SearchAddon } from '@xterm/addon-search'
import type { FindAnswer, FindAsk, FindCount } from 'kehikot-module-protocol/client'

/**
 * Find in the terminal (protocol 2.69.0): the host's find bar searches the session's screen AND its
 * scrollback, which only the emulator holds — its rows are not text in the page, so the client's own
 * search would find nothing. `@xterm/addon-search` does the searching, marks every match with a
 * decoration and the current one with another, and says the count (`onDidChangeResults`); this is
 * the thin layer between it and `onFind`.
 *
 * The count is said again by itself when it changes under an open search — new output arrived — and
 * `onCount` carries that to the host (`findResult`). While a search this asked for is running the
 * count is returned instead, so it is not said twice.
 */

/** The marks' colours: xterm paints them itself and does not read the page's CSS. */
export function findColours(theme: 'light' | 'dark'): NonNullable<ISearchOptions['decorations']> {
  return theme === 'dark'
    ? { matchBackground: '#5c4d14', activeMatchBackground: '#c2741a', matchOverviewRuler: '#a08a2a', activeMatchColorOverviewRuler: '#ff9632' }
    : { matchBackground: '#ffe48a', activeMatchBackground: '#ff9632', matchOverviewRuler: '#d9b200', activeMatchColorOverviewRuler: '#ff7a00' }
}

/** What of the emulator a search needs besides the addon: taking its selection away on close. */
export interface Selectable {
  clearSelection(): void
}

export type TerminalFind = (query: string, ask: FindAsk) => FindAnswer

export function terminalFind(
  search: Pick<SearchAddon, 'findNext' | 'findPrevious' | 'clearDecorations' | 'onDidChangeResults'>,
  terminal: Selectable,
  onCount: (count: FindCount) => void,
  colours: () => NonNullable<ISearchOptions['decorations']>,
): { find: TerminalFind; dispose: () => void } {
  let answering = false
  let last: FindCount = { total: 0, current: 0 }
  /* The options of the search the marks are for: the addon keeps its marks while the query is the same, so another case or word rule clears them first. */
  let marked = ''
  const listening = search.onDidChangeResults(({ resultIndex, resultCount }) => {
    last = { total: resultCount, current: resultIndex < 0 || resultCount === 0 ? 0 : resultIndex + 1 }
    if (!answering) onCount(last)
  })

  const clear = () => {
    search.clearDecorations()
    terminal.clearSelection()
    last = { total: 0, current: 0 }
    marked = ''
  }

  return {
    find(query, ask) {
      if (ask.direction === 'close') {
        clear()
        return
      }
      if (!query) {
        clear()
        return { total: 0, current: 0 }
      }
      const options: ISearchOptions = {
        caseSensitive: ask.caseSensitive,
        wholeWord: ask.wholeWord,
        regex: false,
        /* A query being typed keeps the match it is on while that still matches. */
        incremental: ask.direction === 'first',
        decorations: colours(),
      }
      const rule = `${ask.caseSensitive}:${ask.wholeWord}`
      if (marked && marked !== rule) search.clearDecorations()
      marked = rule
      answering = true
      let found = false
      try {
        found = ask.direction === 'prev' ? search.findPrevious(query, options) : search.findNext(query, options)
      } finally {
        answering = false
      }
      if (!found) last = { total: 0, current: 0 }
      return last
    },
    dispose() {
      listening.dispose()
    },
  }
}
