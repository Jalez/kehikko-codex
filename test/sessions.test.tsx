import { afterEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, fireEvent, render } from '@testing-library/react'
import { headerItemsSchema } from 'kehikot-module-protocol'
import { resetServerStanding } from 'kehikot-module-protocol/client'
import { useEffect, useRef } from 'react'

import type { Listing, Row } from '../doors.ts'
import type { ActivityRow, Notice, SessionsChanged, Stated } from '../live.ts'
import { NOTICES } from '../manifest.ts'
import type { Api } from '../src/api.ts'
import type { Hosted } from '../src/app.tsx'
import { showStep } from '../src/view/conversations.ts'
import { standing } from '../src/view/places.ts'
import type { Said, Standing, Target } from '../src/view/terminal-view.tsx'

/**
 * The component that keeps a session per place, rendered with a stand-in for
 * the terminal.
 *
 * The real `TerminalView` builds an xterm emulator and opens a socket;
 * neither exists in `happy-dom` and neither is the thing under test. What
 * matters here is what the parent DOES when the canvas speaks: what it opens,
 * what it asks before opening, and which views it leaves alone. So the
 * stand-in records every mount and unmount by what it was asked to open, and
 * hands the test the two callbacks the server would drive.
 *
 * `mock.module` has to run before `app.tsx` is imported, which is why the
 * import of `Sessions` is dynamic and below it.
 */

interface Mounted {
  target: Target
  tell: (standing: Standing) => void
  say: (said: Said) => void
}
const mounted: Mounted[] = []
const unmounted: Target[] = []
const which = (kehikko: Extract<Target, { what: 'session' }>['place']['kehikko']) => (kehikko === null ? '-' : 'key' in kehikko ? `key:${kehikko.key}` : kehikko.id)
const naming = (target: Target) => (target.what === 'install' ? 'install' : `${target.place.parts.join('+') || 'whole'}@${which(target.place.kehikko)}:${target.session ?? 'new'}`)

mock.module('../src/view/terminal-view.tsx', () => ({
  TerminalView: ({ target, shown, watched, onStanding, onSaid }: { target: Target; shown: boolean; watched?: boolean; onStanding?: (s: Standing) => void; onSaid?: (s: object) => void }) => {
    /* The callbacks as they are NOW, as the real view holds them: it reads them from a ref on every call. */
    const latest = useRef({ onStanding, onSaid })
    latest.current = { onStanding, onSaid }
    useEffect(() => {
      const mine: Mounted = { target, tell: (next) => latest.current.onStanding?.(next), say: (said) => latest.current.onSaid?.(said) }
      mounted.push(mine)
      return () => {
        unmounted.push(target)
        mounted.splice(mounted.indexOf(mine), 1)
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [])
    return <div data-terminal={naming(target)} data-shown={shown ? 'yes' : 'no'} data-watched={(watched ?? shown) ? 'yes' : 'no'} data-path={target.what === 'session' ? target.projectPath : ''} />
  },
}))

const { Sessions: Real } = await import('../src/app.tsx')
/* A new session waits for the canvas to stop moving; here it does not have to, except where that wait is the thing under test. */
const Sessions = (props: Parameters<typeof Real>[0]) => <Real settleMs={0} {...props} />

const P = '/Users/someone/Projects/thesis'
const row = (id: string, more: Partial<Row> = {}): Row => ({ id, label: '', lastActive: null, running: false, ...more })

/** A server in a variable: what each place holds, and what was asked of it. */
function server(start: Record<string, Row[]> = {}) {
  const held: Record<string, Row[]> = { ...start }
  const state = { found: '/bin/claude' as string | null, lacks: null as string | null, running: [] as Listing['running'], others: [] as Row[], own: undefined as string | null | undefined, current: undefined as string | null | undefined }
  const asked: string[] = []
  /** What the page asked to have brought across to a kehikko's key, in order with the reads. */
  const order: string[] = []
  const api: Api = {
    rekey: async (_projectPath, kehikko) => {
      order.push(`rekey ${kehikko.key} ${kehikko.name} ${kehikko.id}`)
      await new Promise((done) => setTimeout(done, 1))
      order.push('rekeyed')
    },
    place: async (_projectPath, key) => {
      asked.push(key)
      order.push(`read ${key}`)
      return {
        ok: true,
        program: { name: 'Codex', found: state.found, foundAt: state.found, looked: ['/usr/bin', '/Users/someone/.local/bin'], where: 'PATH, ~/.local/bin', lacks: state.lacks, install: { line: 'curl -fsSL https://claude.ai/install.sh | bash', lands: '~/.local/bin/claude' }, asked: 'yes' },
        sessions: held[key] ?? [],
        others: state.others,
        running: state.running,
        ...(state.own !== undefined ? { own: state.own } : {}),
        ...(state.current !== undefined ? { current: state.current } : {}),
      }
    },
    assign: async (_projectPath, key, session, own, kehikkoName) => {
      asked.push(`assign ${session} ${key}${own ? ' own' : ''} ${kehikkoName ?? ''}`.trimEnd())
      if (own) state.own = session
    },
    end: async (session) => {
      asked.push(`end ${session}`)
      state.running = state.running.filter((one) => one.id !== session)
    },
    detach: async (_projectPath, key, session) => {
      asked.push(`detach ${session}`)
      held[key] = (held[key] ?? []).filter((one) => one.id !== session)
    },
  }
  return { api, held, state, asked, order }
}

const at = (parts: string[] = [], kehikko = 3, epic: string | null = 'thesis', projectPath = P) =>
  standing({ where: 'hosted', projectPath, epic, parts: parts.map((id) => ({ id, picked: true })), kehikko: { id: kehikko, name: `k${kehikko}` } })!
/** The same, from a host that names the kehikko by its key (protocol 1.1.0). */
const keyed = (parts: string[] = [], id = 3, key = '4072c9e5', name = 'writing') =>
  standing({ where: 'hosted', projectPath: P, epic: 'thesis', parts: parts.map((part) => ({ id: part, picked: true })), kehikko: { id, name, key } })!
const KEY = (parts: string[] = [], kehikko = 3) => at(parts, kehikko).key

/* Twice: what the server said is drawn when the first round ends, and a new session is started on a timer set by that drawing. */
const round = () => act(async () => void (await new Promise((done) => setTimeout(done, 5))))
const flush = async () => {
  await round()
  await round()
}
const shown = (container: HTMLElement) => [...container.querySelectorAll('[data-shown="yes"]')].map((one) => one.getAttribute('data-terminal'))
const all = (container: HTMLElement) => [...container.querySelectorAll('[data-terminal]')].map((one) => one.getAttribute('data-terminal'))
const view = (name: string) => mounted.find((one) => naming(one.target) === name)!

afterEach(() => {
  cleanup()
  mounted.length = 0
  unmounted.length = 0
  sessionStorage.clear()
  resetServerStanding()
})

describe('opening the module on a place', () => {
  test('no session there: a new one opens at once, with no question', async () => {
    const s = server()
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:new'])
  })

  test('exactly one: it opens at once', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
  })

  test('more than one: one of them opens at once — its own — and nothing asks which', async () => {
    const s = server({ [KEY()]: [row('a', { label: 'the first', lastActive: 9 }), row('b', { label: 'the second', lastActive: 1 })] })
    s.state.own = 'b'
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:b'])
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    /* With no own, the one last open there; with neither, the most recently active. */
    cleanup()
    mounted.length = 0
    sessionStorage.clear()
    s.state.own = null
    const latest = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(latest.container)).toEqual(['whole@3:a'])
  })
  test('with no project there is one sentence and no session — not a session somewhere else', async () => {
    const s = server()
    const { container } = render(<Sessions theme="dark" at={null} cover="no-project" api={s.api} />)
    await flush()
    expect(container.textContent).toContain('No project is open')
    expect(mounted.length).toBe(0)
    expect(s.asked).toEqual([])
  })
})

describe('the kehikko by its key', () => {
  test('the host renumbering a kehikko moves nothing: the same place, the same session, nothing reopened', async () => {
    const s = server({ [keyed().key]: [row('a')] })
    const { container, rerender } = render(<Sessions theme="dark" at={keyed([], 2)} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@key:4072c9e5:a'])
    const before = view('whole@key:4072c9e5:a')
    /* Removed from the host and added again: 2, then 9, then 28. */
    rerender(<Sessions theme="dark" at={keyed([], 9)} api={s.api} />)
    await flush()
    rerender(<Sessions theme="dark" at={keyed([], 28)} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@key:4072c9e5:a'])
    expect(view('whole@key:4072c9e5:a')).toBe(before)
    expect(unmounted).toEqual([])
    /* The place was read once: the number is not part of it. */
    expect(s.asked).toEqual([keyed().key])
  })

  test('a page opened after the renumbering finds the session by itself, with nothing attached by hand', async () => {
    const s = server({ [keyed().key]: [row('a')] })
    const { container } = render(<Sessions theme="dark" at={keyed([], 28)} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@key:4072c9e5:a'])
    expect(container.querySelector('[data-chooser]')).toBeNull()
  })

  test('what an older release filed under the row number is asked to be brought across BEFORE the place is read, once per kehikko', async () => {
    const s = server({ [keyed().key]: [row('a')] })
    const { rerender } = render(<Sessions theme="dark" at={keyed([], 28)} api={s.api} />)
    await flush()
    expect(s.order).toEqual(['rekey 4072c9e5 writing 28', 'rekeyed', `read ${keyed().key}`])
    /* Another place on the same kehikko: read, and not asked again. */
    rerender(<Sessions theme="dark" at={keyed(['methods'], 28)} api={s.api} />)
    await flush()
    expect(s.order.filter((one) => one.startsWith('rekey ')).length).toBe(1)
    expect(s.order.at(-1)).toBe(`read ${keyed(['methods']).key}`)
    /* Another kehikko is asked about in its turn. */
    rerender(<Sessions theme="dark" at={keyed([], 4, 'review-2', 'review')} api={s.api} />)
    await flush()
    expect(s.order.filter((one) => one.startsWith('rekey '))).toEqual(['rekey 4072c9e5 writing 28', 'rekey review-2 review 4'])
  })

  test('a host that sends no key is not asked about one: the place is the row number, as before', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(KEY()).toBe('epic=thesis;parts=-;kehikko=3')
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(s.order).toEqual([`read ${KEY()}`])
  })

  test('if the bringing across is refused, nothing is read and nothing opened — a new session is not started beside the old ones', async () => {
    const s = server({ [keyed().key]: [] })
    s.api.rekey = async () => {
      throw new Error('places.json is not readable JSON.')
    }
    const { container } = render(<Sessions theme="dark" at={keyed()} api={s.api} />)
    await flush()
    expect(all(container)).toEqual([])
    expect(s.asked).toEqual([])
    expect(container.textContent).toContain('places.json is not readable JSON.')
  })
})

describe('a session from another computer', () => {
  test('the only one recorded here is somewhere else: a new session, at once, and no question', async () => {
    const s = server({ [KEY()]: [row('away', { label: 'started on the laptop', missing: true })] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:new'])
  })

  test('one here and one elsewhere: the one here opens, and the other is not offered', async () => {
    const s = told({ [KEY()]: [row('away', { label: 'started on the laptop', missing: true }), row('a', { label: 'here' })] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(lastHeader(s)[0]!.options!.map((one) => one.id)).toEqual(['a'])
    expect(typeof pressOn(s, 'conversation', 'away')).toBe('string')
    expect(all(container)).toEqual(['whole@3:a'])
  })
})

describe('moving between places', () => {
  test('picking a part is another place with a session of its own; the one left behind is not touched', async () => {
    const s = server()
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    act(() => view('whole@3:new').say({ session: 'first', typed: true }))
    rerender(<Sessions theme="dark" at={at(['methods'])} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['methods@3:new'])
    /* Still mounted, still attached: hidden is all that happened to it. */
    expect(all(container).length).toBe(2)
    expect(unmounted).toEqual([])
  })

  test('coming back shows the view that was there, as it was, without asking the server to open anything', async () => {
    const s = server()
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    const first = view('whole@3:new')
    act(() => first.say({ session: 'first', exists: true }))
    rerender(<Sessions theme="dark" at={at(['methods'])} api={s.api} />)
    await flush()
    rerender(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:first'])
    expect(mounted.includes(first)).toBe(true)
    expect(unmounted.map(naming)).toEqual(['methods@3:new'])
  })

  test('a new session nobody typed into is let go when the canvas moves on, so a walk through places leaves nothing behind', async () => {
    const s = server()
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    rerender(<Sessions theme="dark" at={at(['methods'])} api={s.api} />)
    await flush()
    rerender(<Sessions theme="dark" at={at(['methods', 'results'])} api={s.api} />)
    await flush()
    expect(all(container)).toEqual(['methods+results@3:new'])
    expect(unmounted.map(naming)).toEqual(['whole@3:new', 'methods@3:new'])
  })

  test('a new session is not started for a place the canvas only passed through', async () => {
    const s = server({ [KEY(['results'])]: [row('r')] })
    const { container, rerender } = render(<Real theme="dark" at={at()} api={s.api} settleMs={40} />)
    await flush()
    rerender(<Real theme="dark" at={at(['methods'])} api={s.api} settleMs={40} />)
    await flush()
    expect(mounted.length).toBe(0)
    /* A session that exists does not wait: it is opened as soon as the place is known. */
    rerender(<Real theme="dark" at={at(['results'])} api={s.api} settleMs={40} />)
    await flush()
    expect(shown(container)).toEqual(['results@3:r'])
    act(() => view('results@3:r').say({ session: 'r', exists: true }))
    rerender(<Real theme="dark" at={at(['methods', 'results'])} api={s.api} settleMs={40} />)
    await flush()
    await act(async () => void (await new Promise((done) => setTimeout(done, 80))))
    expect(shown(container)).toEqual(['methods+results@3:new'])
    expect(mounted.map((one) => naming(one.target)).sort()).toEqual(['methods+results@3:new', 'results@3:r'])
  })

  test('another kehikko and another epic are other places too, and the order parts were picked in is not', async () => {
    const s = server()
    const { container, rerender } = render(<Sessions theme="dark" at={at(['methods', 'results'])} api={s.api} />)
    await flush()
    const first = view('methods+results@3:new')
    rerender(<Sessions theme="dark" at={at(['results', 'methods'])} api={s.api} />)
    await flush()
    expect(mounted).toEqual([first])
    act(() => first.say({ typed: true }))
    rerender(<Sessions theme="dark" at={at(['methods', 'results'], 4)} api={s.api} />)
    await flush()
    act(() => view('methods+results@4:new').say({ typed: true }))
    rerender(<Sessions theme="dark" at={at(['methods', 'results'], 4, 'other-epic')} api={s.api} />)
    await flush()
    expect(all(container).length).toBe(3)
  })

  test('a place with several sessions: what was chosen in the View menu is what is there on return', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'the first' }), row('b', { label: 'the second' })] })
    s.state.own = 'b'
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:b'])
    expect(pressOn(s, 'conversation', 'a')).toBe(true)
    await flush()
    rerender(<Sessions theme="dark" at={at(['methods'])} api={s.api} hosted={s.hosted} />)
    await flush()
    rerender(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
  })
  test('a page that reloads comes back to what it was showing; a page opened afresh opens the place’s own', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'the first' }), row('b', { label: 'the second' })] })
    s.state.own = 'a'
    const one = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    pressOn(s, 'conversation', 'b')
    await flush()
    one.unmount()

    /* The same tab: its session storage is what `held` kept. */
    const again = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(again.container)).toEqual(['whole@3:b'])
    again.unmount()

    sessionStorage.clear()
    const fresh = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(fresh.container)).toEqual(['whole@3:a'])
  })
})

describe('what is drawn beside the terminal', () => {
  test('with a conversation connected, nothing at all: no list, no corner control, no row', async () => {
    const s = server({ [KEY()]: [row('a', { label: 'tighten the methods section and everything after it' })] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(container.querySelector('[data-sessions]')).toBeNull()
    expect(container.querySelector('[role="listbox"]')).toBeNull()
    expect(bar(container)).toBeNull()
    expect(container.querySelector('[data-ended]')).toBeNull()
    expect(container.querySelector('[role="status"]')).toBeNull()
  })
  test('a session that ended keeps its last screen, with Resume beside the reason', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const { container, getByText } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    act(() => view('whole@3:a').tell({ at: 'closed', code: 4000, why: 'the session ended (0)' }))
    expect(container.querySelector('[data-ended]')?.textContent).toContain('the session ended (0)')
    expect(shown(container)).toEqual(['whole@3:a'])
    const before = view('whole@3:a')
    fireEvent.click(getByText('Resume'))
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(view('whole@3:a')).not.toBe(before)
    expect(container.querySelector('[data-ended]')).toBeNull()
  })

  test('when this module’s server goes, the screen stays and the words go in a strip', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    rerender(<Sessions theme="dark" at={at()} cover="down" api={s.api} />)
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(container.textContent).toContain('own server is not answering')
  })
})

describe('nothing stands between a place and its session', () => {
  const elsewhere = (n: number): Listing['running'] => Array.from({ length: n }, (_, k) => ({ id: `r${k}`, label: '', projectPath: '/p/other', place: null, here: false, startedAt: k }))

  test('however many are running, a place with one recorded session opens it, and one with none gets a new one', async () => {
    const s = server({ [KEY()]: [row('a')] })
    s.state.running = elsewhere(12)
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(container.querySelector('[data-chooser]')).toBeNull()
    rerender(<Sessions theme="dark" at={at(['methods'])} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['methods@3:new'])
    expect(container.querySelector('[data-chooser]')).toBeNull()
    expect(container.textContent).not.toContain('as many as')
  })

  test('the server is told which view is on screen: the one of the place the canvas is on, and no other', async () => {
    const s = server({ [KEY()]: [row('a')], [KEY(['methods'])]: [row('b')] })
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    act(() => view('whole@3:a').say({ session: 'a', exists: true }))
    rerender(<Sessions theme="dark" at={at(['methods'])} api={s.api} />)
    await flush()
    const watched = () => Object.fromEntries([...container.querySelectorAll('[data-terminal]')].map((one) => [one.getAttribute('data-terminal'), one.getAttribute('data-watched')]))
    expect(watched()).toEqual({ 'whole@3:a': 'no', 'methods@3:b': 'yes' })
  })

  test('a session put away behind another view is let go without a word, and its place resumes it', async () => {
    const s = server({ [KEY()]: [row('a')], [KEY(['methods'])]: [row('b')] })
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    act(() => view('whole@3:a').say({ session: 'a', exists: true }))
    rerender(<Sessions theme="dark" at={at(['methods'])} api={s.api} />)
    await flush()
    expect(all(container)).toEqual(['whole@3:a', 'methods@3:b'])

    /* The server put the first one's process away (`CLOSED.rested`). */
    act(() => view('whole@3:a').tell({ at: 'closed', code: 4001, why: 'put away while it was quiet' }))
    await flush()
    expect(all(container)).toEqual(['methods@3:b'])
    expect(shown(container)).toEqual(['methods@3:b'])
    expect(container.querySelector('[data-ended]')).toBeNull()
    expect(container.querySelector('[data-chooser]')).toBeNull()
    expect(container.textContent).not.toContain('put away')

    /* Back to the place: the same session, asked for by its id, with no question. */
    rerender(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(container.querySelector('[data-chooser]')).toBeNull()
    expect(container.querySelector('[data-ended]')).toBeNull()
  })

  test('were the one on screen ever put away, it is opened again at once and no strip is drawn', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    const before = view('whole@3:a')
    act(() => before.tell({ at: 'closed', code: 4001, why: 'put away while it was quiet' }))
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(view('whole@3:a')).not.toBe(before)
    expect(container.querySelector('[data-ended]')).toBeNull()
  })
})

describe('when the program is not installed', () => {
  test('one sentence saying what is missing and where it was looked for, and one press', async () => {
    const s = server()
    s.state.found = null
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(container.textContent).toContain('Codex is not installed — looked in PATH, ~/.local/bin.')
    expect([...container.querySelectorAll('button')].map((one) => one.textContent)).toEqual(['Install'])
    /* Nothing runs until the press. */
    expect(mounted.length).toBe(0)
  })

  test('the press runs the installer in a terminal here; found afterwards, the session opens without another press', async () => {
    const s = server()
    s.state.found = null
    const { container, getByText } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    fireEvent.click(getByText('Install'))
    await flush()
    expect(shown(container)).toEqual(['install'])

    s.state.found = '/Users/someone/.local/bin/claude'
    act(() => view('install').tell({ at: 'closed', code: 4010, why: 'installed at /Users/someone/.local/bin/claude' }))
    await flush()
    expect(shown(container)).toEqual(['whole@3:new'])
    expect(container.querySelector('[data-install]')).toBeNull()
  })

  test('an install that does not finish says plainly what happened and what to do; the output waits behind "See the log"', async () => {
    const s = server()
    s.state.found = null
    const { container, getByText } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    fireEvent.click(getByText('Install'))
    await flush()
    const why = "npm can't write to /usr/local without admin rights. Install into your home folder instead: npm install -g --prefix ~/.local @openai/codex"
    act(() => view('install').tell({ at: 'closed', code: 4011, why }))
    await flush()
    expect(container.querySelector('[data-install-why]')?.textContent).toBe(why)
    expect(container.querySelector('[data-installing]')?.hasAttribute('hidden')).toBe(true)
    fireEvent.click(getByText('See the log'))
    expect(container.querySelector('[data-installing]')?.hasAttribute('hidden')).toBe(false)
    expect(shown(container)).toEqual(['install'])
    fireEvent.click(getByText('Hide the log'))
    expect(container.querySelector('[data-installing]')?.hasAttribute('hidden')).toBe(true)
    fireEvent.click(getByText('Try again'))
    await flush()
    expect(container.textContent).toContain('is not installed')
  })

  test('a copy that is too old says so, and the press is Update', async () => {
    const s = server({ [KEY()]: [row('a')] })
    s.state.lacks = '--session-id'
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(container.textContent).toContain('Codex at /bin/claude is too old for this: it has no --session-id.')
    expect([...container.querySelectorAll('button')].map((one) => one.textContent)).toEqual(['Update'])
    expect(mounted.length).toBe(0)
  })

  test('a session refused because the program vanished falls back to the same sentence', async () => {
    const s = server()
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    s.state.found = null
    act(() => view('whole@3:new').tell({ at: 'closed', code: 4404, why: 'Codex is not installed.' }))
    await flush()
    expect(container.textContent).toContain('is not installed')
  })
})

/* ------------------------------------------------------------------ *
 * What a session is doing: the mark, the notice, the header
 * ------------------------------------------------------------------ */

/** A server whose feed the test drives, and a host that writes down what it is asked. */
function told(start: Record<string, Row[]> = {}) {
  const s = server(start)
  const feeds: { notices: boolean; heard: { state(stated: Stated): void; notice(notice: Notice): void; activity?(items: ActivityRow[]): void; sessions?(event?: SessionsChanged): void }; stopped: boolean }[] = []
  s.api.feed = (notices, heard) => {
    const one = { notices, heard, stopped: false }
    feeds.push(one)
    return () => {
      one.stopped = true
    }
  }
  const emitted: { extension: string; payload: Record<string, unknown> }[] = []
  const headers: unknown[][] = []
  const activities: unknown[][] = []
  const hosted: Hosted = {
    emit: async (extension, payload) => void emitted.push({ extension, payload }),
    activity: (items) => void activities.push(items),
    header: (items) => void headers.push(items),
    presses: { current: null },
  }
  return { ...s, feeds, emitted, headers, activities, hosted }
}
/** The header as last declared, and a press on it as the host would send it. */
const lastHeader = (s: ReturnType<typeof told>) => s.headers.at(-1) as { kind: string; id: string; label: string; value?: string; confirm?: boolean; agents?: boolean; options?: { id: string; label: string }[] }[]
const pressOn = (s: ReturnType<typeof told>, item: string, value?: string | boolean) => {
  let answer: unknown
  act(() => {
    answer = s.hosted.presses.current?.({ item, ...(value === undefined ? {} : { value }) })
  })
  return answer
}
const bar = (container: HTMLElement) => container.querySelector('[data-no-conversation]')

const NOTICE: Notice = { seq: 1, session: 'far', state: 'finished', label: 'draft the results', projectPath: P, epic: 'thesis', parts: ['Results'], kehikko: 'writing', at: 1 }
const height = (container: HTMLElement) => [...(container.firstElementChild as HTMLElement).children].filter((one) => !(one as HTMLElement).className.includes('absolute')).length

describe('what the session on screen is doing', () => {
  test('is one glyph before its title in the View menu — and no row', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'tighten the methods', running: true })] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    const option = () => lastHeader(s)[0]!.options![0]!.label
    const rows = height(container)
    expect(option()).toBe('tighten the methods')
    act(() => view('whole@3:a').say({ session: 'a', state: 'needs-you', since: Date.now() }))
    act(() => s.feeds[0]!.heard.state({ session: 'a', state: 'needs-you', since: Date.now() }))
    expect(option()).toBe('◆ tighten the methods')
    act(() => s.feeds[0]!.heard.state({ session: 'a', state: 'working', since: Date.now() }))
    expect(option()).toBe('● tighten the methods')
    act(() => s.feeds[0]!.heard.state({ session: 'a', state: 'finished', since: Date.now() }))
    expect(option()).toBe('○ tighten the methods')
    /* Taken back: no mark, rather than a mark that says idle. */
    act(() => s.feeds[0]!.heard.state({ session: 'a', state: null, since: Date.now() }))
    expect(option()).toBe('tighten the methods')
    expect(height(container)).toBe(rows)
  })
  test('the View menu shows what the feed has said since it was read, for conversations this page has no view of', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'one', running: true }), row('b', { label: 'two', running: true, state: 'working', since: 1 })] })
    s.state.own = 'a'
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    const labels = () => lastHeader(s)[0]!.options!.map((one) => one.label)
    expect(labels()).toEqual(['one · own', '● two'])
    act(() => s.feeds[0]!.heard.state({ session: 'b', state: 'finished', since: Date.now() }))
    expect(labels()).toEqual(['one · own', '○ two'])
  })
})

describe('a notice for a person who is not looking', () => {
  test('a framed page asks for notices and passes one to the host, in the protocol’s format, once', async () => {
    const s = told()
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} canvasEpic="thesis" />)
    await flush()
    expect(s.feeds.map((one) => one.notices)).toEqual([true])
    act(() => s.feeds[0]!.heard.notice(NOTICE))
    await flush()
    expect(s.emitted).toEqual([{ extension: NOTICES, payload: { epic: 'thesis', level: 'done', message: 'Finished: “draft the results” — thesis · Results · writing', refs: [], place: { epic: 'thesis' } } }])
    act(() => s.feeds[0]!.heard.notice({ ...NOTICE, seq: 2, state: 'needs-you' }))
    expect(s.emitted[1]?.payload).toMatchObject({ level: 'attention', message: 'Waiting for you: “draft the results” — thesis · Results · writing' })
    expect(s.emitted.length).toBe(2)
  })

  test('a host that holds the activity list makes the notice itself: no events.emit, the list is sent', async () => {
    const s = told()
    s.hosted.answers = ['parts.set', 'events.emit', 'activity.set']
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} canvasEpic="thesis" />)
    await flush()
    const one = { id: 'far', state: 'done' as const, label: 'draft the results', since: 1, detail: 'turn ended', project: '/work/p' }
    act(() => s.feeds[0]!.heard.notice(NOTICE))
    act(() => s.feeds[0]!.heard.activity!([one]))
    await flush()
    expect(s.emitted).toEqual([])
    expect(s.activities).toEqual([[one]])
  })

  test('a host without activity.set is sent the notice as before, and no activity', async () => {
    const s = told()
    s.hosted.answers = ['parts.set', 'events.emit']
    s.hosted.activity = undefined
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} canvasEpic="thesis" />)
    await flush()
    act(() => s.feeds[0]!.heard.notice(NOTICE))
    act(() => s.feeds[0]!.heard.activity!([]))
    await flush()
    expect(s.emitted.length).toBe(1)
    expect(s.activities).toEqual([])
  })

  test('a host that did not say what it answers (null) is sent the notice, and the list is attempted', async () => {
    const s = told()
    s.hosted.answers = null
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} canvasEpic="thesis" />)
    await flush()
    act(() => s.feeds[0]!.heard.notice(NOTICE))
    act(() => s.feeds[0]!.heard.activity!([]))
    await flush()
    expect(s.emitted.length).toBe(1)
    expect(s.activities).toEqual([[]])
  })

  test('nothing is drawn for it here: no banner, no row', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'one' })] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} canvasEpic="thesis" />)
    await flush()
    const before = container.innerHTML
    act(() => s.feeds[0]!.heard.notice(NOTICE))
    await flush()
    expect(container.innerHTML).toBe(before)
  })

  test('the whole list the server writes goes to the host as it is, and again when it changes', async () => {
    const s = told()
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    const one = { id: 'a', state: 'attention' as const, label: 'draft', since: 1, detail: 'waiting for you', project: '/work/p' }
    act(() => s.feeds[0]!.heard.activity!([one]))
    act(() => s.feeds[0]!.heard.activity!([]))
    expect(s.activities).toEqual([[one], []])
    /* No notice is made of it: the one-time lines are the notices' own. */
    expect(s.emitted).toEqual([])
  })

  test('a page nothing is framing hands the list to nobody', async () => {
    const s = told()
    render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(() => act(() => s.feeds[0]!.heard.activity!([]))).not.toThrow()
    expect(s.activities).toEqual([])
  })

  test('a page nothing is framing follows the states and asks for no notices', async () => {
    const s = told()
    const { unmount } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(s.feeds.map((one) => one.notices)).toEqual([false])
    unmount()
    expect(s.feeds[0]!.stopped).toBe(true)
  })

  test('one about a place with no epic is filed under the canvas’s, and under nothing when there is none', async () => {
    const s = told()
    const { rerender } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} canvasEpic="another" />)
    await flush()
    act(() => s.feeds[0]!.heard.notice({ ...NOTICE, epic: null }))
    expect(s.emitted[0]?.payload.epic).toBe('another')
    rerender(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} canvasEpic={null} />)
    act(() => s.feeds[0]!.heard.notice({ ...NOTICE, epic: null }))
    expect(s.emitted.length).toBe(1)
    /* The canvas moving does not open a second feed. */
    expect(s.feeds.length).toBe(1)
  })

  test('a host that will not carry it is not an error anybody sees', async () => {
    const s = told()
    s.hosted.emit = async () => {
      throw new Error('nothing on this canvas shows these')
    }
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} canvasEpic="thesis" />)
    await flush()
    /* It is said to the console, which is where whoever can act on it looks. */
    const info = console.info
    const said: unknown[][] = []
    console.info = (...words: unknown[]) => void said.push(words)
    try {
      act(() => s.feeds[0]!.heard.notice(NOTICE))
      await flush()
    } finally {
      console.info = info
    }
    expect(said.length).toBe(1)
    expect(container.querySelector('[data-terminal]')).not.toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * A place with no session in a project that has some (#6)
 * ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ *
 * A session that is running somewhere this module did not start it (#5)
 * ------------------------------------------------------------------ */

describe('a session that is already running somewhere else', () => {
  const terminal = { kind: 'interactive' as const, called: 'interactive', pid: 82070, cwd: '/Users/someone/Projects/thesis', since: Date.now() - 17 * 60_000, name: 'project-ea' }
  const job = { kind: 'background' as const, called: 'background', pid: 82454, cwd: '/Users/someone/Projects/thesis', since: Date.now() - 60 * 60_000, name: 'stand-in' }
  /** The server refuses to resume it: it says who has it, and closes. */
  const refuse = (name: string) => {
    const one = view(name)
    act(() => one.say({ elsewhere: terminal, session: 'a' }))
    act(() => one.tell({ at: 'closed', code: 4409, why: 'open in another process; nothing was started' }))
  }

  test('open in another terminal: the place says where and for how long, and offers the two choices in words — nothing is started by itself', async () => {
    const s = server({ [KEY()]: [row('a', { label: 'tighten the methods' })] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
    refuse('whole@3:a')
    await flush()
    await flush()
    /* The view is gone and nothing took its place: no second attempt, however often the list is read. */
    expect(all(container)).toEqual([])
    expect(mounted.length).toBe(0)
    const question = container.querySelector('[data-elsewhere-question]') as HTMLElement
    expect(question.getAttribute('data-elsewhere-question')).toBe('interactive')
    expect(question.textContent).toContain('“tighten the methods” is already open in another Codex process on this computer: a Codex process in a terminal, an editor or the Codex app, process 82070, in /Users/someone/Projects/thesis, started 17 min ago.')
    expect(question.textContent).toContain('Nothing has been started here')
    const rows = [...question.querySelectorAll('[data-row]')]
    expect(rows.map((one) => one.getAttribute('data-row'))).toEqual(['leave', 'copy'])
    expect(rows[0]?.textContent).toContain('Leave it')
    expect(rows[1]?.textContent).toContain('Open it here anyway')
    /* What a copy means is beside the word, before it is chosen. */
    expect(rows[1]?.textContent).toContain('offers to retry once it is closed there, or to fork it')
    /* The keyboard starts on the answer that starts nothing. */
    expect(question.querySelector('[aria-selected="true"]')?.getAttribute('data-row')).toBe('leave')
    expect(document.activeElement).toBe(question)
  })

  test('"Open it here anyway" opens it with the word for a copy, and the View menu says it is one for as long as it is on screen', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'tighten the methods' })] })
    const { container, getByText } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    const before = view('whole@3:a').target
    expect(before.what === 'session' && before.copy).toBeFalsy()
    refuse('whole@3:a')
    await flush()
    fireEvent.click(getByText('Open it here anyway'))
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
    const target = view('whole@3:a').target
    expect(target.what === 'session' && target.copy).toBe(true)
    expect(container.querySelector('[data-elsewhere-question]')).toBeNull()

    act(() => view('whole@3:a').say({ opened: 'copy', session: 'a', label: 'tighten the methods', exists: true, copyOf: terminal }))
    await flush()
    expect(lastHeader(s)[0]!.options![0]!.label).toBe('tighten the methods · also open')
  })
  test('"Leave it" starts nothing: one sentence says so, a copy is still one press, and reading the list again does not try the session again', async () => {
    const s = server({ [KEY()]: [row('a', { label: 'tighten the methods', elsewhere: terminal })] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    refuse('whole@3:a')
    await flush()
    fireEvent.keyDown(container.querySelector('[data-elsewhere-question]') as HTMLElement, { key: 'Enter' })
    await flush()
    await flush()
    expect(container.querySelector('[data-elsewhere-question]')).toBeNull()
    const left = container.querySelector('[data-left-alone]') as HTMLElement
    expect(left.textContent).toContain('“tighten the methods” stays open in the other Codex process. Nothing was started here.')
    expect(left.textContent).toContain('Open it here anyway')
    expect(mounted.length).toBe(0)
    expect(all(container)).toEqual([])
  })
  test('coming back to the place asks the program again: what was running is never remembered', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    refuse('whole@3:a')
    await flush()
    expect(container.querySelector('[data-elsewhere-question]')).not.toBeNull()
    rerender(<Sessions theme="dark" at={at(['results'])} api={s.api} />)
    await flush()
    rerender(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    /* A fresh view, which is a fresh socket and a fresh check on the server. */
    expect(container.querySelector('[data-elsewhere-question]')).toBeNull()
    expect(shown(container)).toEqual(['whole@3:a'])
  })

  test('a server that closes that way without saying who has it is still asked about, never retried silently', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    act(() => view('whole@3:a').tell({ at: 'closed', code: 4409, why: 'open in another process; nothing was started' }))
    await flush()
    expect(container.querySelector('[data-elsewhere-question]')?.textContent).toContain('This conversation is already open in another Codex process on this computer.')
    expect(mounted.length).toBe(0)
  })

  test('running in the background: it is simply on screen, attached, and the View menu says so without a row', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'a background job' })] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    act(() => view('whole@3:a').say({ opened: 'background', session: 'a', label: 'a background job', exists: true, background: job }))
    await flush()
    expect(container.querySelector('[data-elsewhere-question]')).toBeNull()
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(lastHeader(s)[0]!.options![0]!.label).toBe('a background job · background')
  })
  test('resumed by a copy too old to be asked: the View menu says it was not checked', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'an old install' })] })
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    act(() => view('whole@3:a').say({ opened: 'resumed', session: 'a', label: 'an old install', exists: true, unchecked: 'too-old' }))
    await flush()
    expect(lastHeader(s)[0]!.options![0]!.label).toBe('an old install · unchecked')
  })
  test('an ordinary session says none of it', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'only here' })] })
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    act(() => view('whole@3:a').say({ opened: 'resumed', session: 'a', label: 'only here', exists: true }))
    await flush()
    expect(lastHeader(s)[0]!.options![0]!.label).toBe('only here')
  })
})

describe('a project folder renamed while its session runs', () => {
  const ID = 'c1a2b3c4-d5e6-4f70-8a9b-0c1d2e3f4a5b'
  const OTHER = 'f0e1d2c3-b4a5-4968-8776-655443322110'
  const RENAMED = '/Users/someone/Projects/thesis-renamed'
  const ELSE = '/Users/someone/Projects/another'
  const by = (projectPath: string, projectId: string) =>
    standing({ where: 'hosted', projectPath, projectId, epic: 'thesis', parts: [], kehikko: { id: 3, name: 'k3' } })!
  const line = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-moved]')
  const button = (container: HTMLElement, text: string) => [...container.querySelectorAll('button')].find((one) => one.textContent === text) as HTMLButtonElement | undefined

  test('the same id at a new folder keeps the view and its session, points it at the new folder, and says so once', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const restarted: string[] = []
    s.api.restart = async (session) => void restarted.push(session)
    const { container, rerender } = render(<Sessions theme="dark" at={by(P, ID)} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
    act(() => view('whole@3:a').say({ session: 'a', exists: true }))

    rerender(<Sessions theme="dark" at={by(RENAMED, ID)} api={s.api} />)
    await flush()
    /* Nothing let go, nothing reopened: the same view, now saying the new folder should it connect. */
    expect(unmounted).toEqual([])
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(container.querySelector('[data-terminal="whole@3:a"]')?.getAttribute('data-path')).toBe(RENAMED)
    expect(line(container)).toBeNull()

    /* The server followed the run there (reading the list does that) and said the program is still in the old folder. */
    act(() => view('whole@3:a').say({ session: 'a', moved: RENAMED, cwd: P }))
    expect(line(container)?.textContent).toContain(`This folder was renamed to ${RENAMED}. Codex still uses the old path; restart in the new folder when it's idle.`)

    /* Working: the restart waits. */
    act(() => view('whole@3:a').say({ session: 'a', state: 'working', since: 1 }))
    expect(button(container, 'Restart in the new folder')?.disabled).toBe(true)
    act(() => view('whole@3:a').say({ session: 'a', state: 'finished', since: 2 }))
    expect(button(container, 'Restart in the new folder')?.disabled).toBe(false)
    await act(async () => button(container, 'Restart in the new folder')!.click())
    expect(restarted).toEqual(['a'])

    /* The server ended it to be resumed there: a fresh view of the same session, at the new folder. */
    act(() => view('whole@3:a').tell({ at: 'closed', code: 4002, why: 'restarting in the new folder' }))
    await flush()
    expect(unmounted.length).toBe(1)
    expect(shown(container)).toEqual(['whole@3:a'])
    const fresh = mounted.find((one) => naming(one.target) === 'whole@3:a')!
    expect(fresh.target).toMatchObject({ what: 'session', projectPath: RENAMED, projectId: ID, session: 'a' })
    expect(line(container)).toBeNull()
  })

  test('the line can be dismissed, and nothing else changes', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const { container, rerender } = render(<Sessions theme="dark" at={by(P, ID)} api={s.api} />)
    await flush()
    rerender(<Sessions theme="dark" at={by(RENAMED, ID)} api={s.api} />)
    await flush()
    act(() => view('whole@3:a').say({ session: 'a', moved: RENAMED, cwd: P }))
    expect(line(container)).not.toBeNull()
    act(() => button(container, 'Dismiss')!.click())
    expect(line(container)).toBeNull()
    expect(unmounted).toEqual([])
    expect(shown(container)).toEqual(['whole@3:a'])
  })

  test('a different id is a different project: its own place and session, and no line', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const { container, rerender } = render(<Sessions theme="dark" at={by(P, ID)} api={s.api} />)
    await flush()
    act(() => view('whole@3:a').say({ session: 'a', exists: true }))
    s.held[KEY()] = [row('b')]
    rerender(<Sessions theme="dark" at={by(ELSE, OTHER)} api={s.api} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:b'])
    expect(container.querySelector('[data-terminal="whole@3:a"]')?.getAttribute('data-path')).toBe(P)
    expect(line(container)).toBeNull()
  })
})

/* ------------------------------------------------------------------ *
 * Connecting conversations: the bar, the View menu, $kehikot-here
 * ------------------------------------------------------------------ */

describe('the bar, when no conversation is connected to this kehikko', () => {
  const WORDS = 'No conversation is connected to this kehikko. Type $kehikot-here in the Codex conversation you want here.'

  test('is drawn above Codex — a new conversation, started all the same — and copies the command', async () => {
    const s = told()
    s.state.others = [row('elsewhere', { label: 'a conversation of another kehikko' })]
    const copied: string[] = []
    const was = Object.getOwnPropertyDescriptor(navigator, 'clipboard')
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (text: string) => void copied.push(text) } })
    try {
      const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
      await flush()
      expect(bar(container)?.textContent).toContain(WORDS)
      /* Codex's own UI, not a list: nothing from the rest of the project is offered. */
      expect(shown(container)).toEqual(['whole@3:new'])
      expect(container.textContent).not.toContain('a conversation of another kehikko')
      /* Above the terminal, not an Inbox item. */
      expect((container.firstElementChild as HTMLElement).firstElementChild).toBe(bar(container))
      expect(s.activities.flat()).toEqual([])
      const button = bar(container)!.querySelector('[data-copy-command]') as HTMLElement
      expect(button.textContent).toBe('Copy $kehikot-here')
      fireEvent.click(button)
      await flush()
      expect(copied).toEqual(['$kehikot-here'])
      expect(button.textContent).toBe('Copied')
      /* Nothing to choose from: the header declares nothing. */
      expect(lastHeader(s)).toEqual([])
    } finally {
      if (was) Object.defineProperty(navigator, 'clipboard', was)
      else delete (navigator as { clipboard?: unknown }).clipboard
    }
  })

  test('is not drawn while a conversation is connected, nor while the program is missing', async () => {
    const s = server({ [KEY()]: [row('a')] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(bar(container)).toBeNull()
    cleanup()
    const missing = server()
    missing.state.found = null
    const other = render(<Sessions theme="dark" at={at()} api={missing.api} />)
    await flush()
    expect(bar(other.container)).toBeNull()
  })

  test('a conversation on another computer only is not one connected here: the bar says so', async () => {
    const s = server({ [KEY()]: [row('away', { missing: true })] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} />)
    await flush()
    expect(bar(container)).not.toBeNull()
  })

  test('goes once the new conversation is spoken to: started here, it is this kehikko’s from then on', async () => {
    const s = told()
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    expect(bar(container)).not.toBeNull()
    /* The server records it at its place when Codex has a record of it, and says so. */
    s.held[KEY()] = [row('x', { label: 'what was first asked', running: true })]
    s.state.own = 'x'
    act(() => view('whole@3:new').say({ session: 'x', exists: true, typed: true }))
    await flush()
    expect(bar(container)).toBeNull()
    /* The same view, not reopened: it only knows its id now. */
    expect(shown(container)).toEqual(['whole@3:x'])
    expect(mounted.length).toBe(1)
    expect(unmounted).toEqual([])
    expect(lastHeader(s)[0]).toMatchObject({ kind: 'switch', id: 'conversation', value: 'x', options: [{ id: 'x', label: 'what was first asked · own' }] })
  })

  test('$kehikot-here connecting another conversation: the bar goes and the container switches to it', async () => {
    const s = told()
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:new'])
    /* The server wrote the record, and the feed says where it went. */
    s.held[KEY()] = [row('t', { label: 'started in my terminal' })]
    s.state.own = 't'
    s.state.current = 't'
    act(() => s.feeds[0]!.heard.sessions?.({ project: P, key: KEY(), session: 't' }))
    await flush()
    expect(bar(container)).toBeNull()
    expect(shown(container)).toEqual(['whole@3:t'])
  })

  test('$kehikot-here to another place, or another kehikko, moves nothing here', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'mine' })] })
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    s.held[KEY(['methods'])] = [row('t')]
    act(() => s.feeds[0]!.heard.sessions?.({ project: P, key: KEY(['methods']), session: 't' }))
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
  })

  test('$kehikot-here while another of this kehikko’s conversations is on screen: that one is put on screen', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'mine' })] })
    s.state.own = 'a'
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    act(() => view('whole@3:a').say({ session: 'a', exists: true, typed: true }))
    s.held[KEY()] = [row('a', { label: 'mine' }), row('t', { label: 'from the terminal' })]
    s.state.current = 't'
    act(() => s.feeds[0]!.heard.sessions?.({ project: P, key: KEY(), session: 't' }))
    await flush()
    expect(shown(container)).toEqual(['whole@3:t'])
  })
})

describe('the View menu: this kehikko’s conversations', () => {
  test('a switch over the conversations connected here and nothing else — the own first, marked, with when each was last active', async () => {
    const now = Date.now()
    const s = told({
      [KEY()]: [row('a', { label: 'draft the results', lastActive: now - 5 * 60_000 }), row('b', { label: 'tighten the methods', lastActive: now - 2 * 3_600_000 }), row('gone', { missing: true })],
      [KEY(['methods'])]: [row('m', { label: 'another place’s' })],
    })
    s.state.own = 'b'
    s.state.others = [row('loose', { label: 'started in a terminal' })]
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    const items = lastHeader(s)
    expect(items[0]).toEqual({
      kind: 'switch',
      id: 'conversation',
      label: 'This kehikko’s conversations',
      icon: 'list',
      value: 'b',
      options: [
        { id: 'b', label: 'tighten the methods · 2 h ago · own' },
        { id: 'a', label: 'draft the results · 5 min ago' },
      ],
    } as unknown as (typeof items)[number])
    /* Viewing the own one: nothing to make own; disconnecting it is there. */
    expect(items.map((one) => one.id)).toEqual(['conversation', 'disconnect'])
    expect(headerItemsSchema.safeParse(items).success).toBe(true)
    /* Person-only, every one of them. */
    expect(items.some((one) => one.agents)).toBe(false)
  })

  test('choosing one resumes it in the container; what is not connected here is refused', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'one' }), row('b', { label: 'two' })] })
    s.state.own = 'a'
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(pressOn(s, 'conversation', 'b')).toBe(true)
    await flush()
    expect(shown(container)).toEqual(['whole@3:b'])
    const target = view('whole@3:b').target
    expect(target.what === 'session' && target.session).toBe('b')
    expect(lastHeader(s)[0]!.value).toBe('b')
    /* The one on screen again: taken, and nothing reopened. */
    const before = view('whole@3:b')
    expect(pressOn(s, 'conversation', 'b')).toBe(true)
    await flush()
    expect(view('whole@3:b')).toBe(before)
    expect(typeof pressOn(s, 'conversation', 'zzz')).toBe('string')
    expect(typeof pressOn(s, 'conversation', true)).toBe('string')
    expect(typeof pressOn(s, 'sessions', 'a')).toBe('string')
  })

  test('"Make this the kehikko’s own" for one that is not, which rewrites the record', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'one' }), row('b', { label: 'two' })] })
    s.state.own = 'a'
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    pressOn(s, 'conversation', 'b')
    await flush()
    const items = lastHeader(s)
    expect(items.map((one) => one.id)).toEqual(['conversation', 'make-own', 'disconnect'])
    expect(items[1]).toMatchObject({ kind: 'run', label: 'Make this the kehikko’s own' })
    expect(pressOn(s, 'make-own')).toBe(true)
    await flush()
    expect(s.asked).toContain(`assign b ${KEY()} own k3`)
    /* Read again: it is the own one now, and there is nothing left to make own. */
    expect(lastHeader(s).map((one) => one.id)).toEqual(['conversation', 'disconnect'])
    expect(lastHeader(s)[0]!.options!.find((one) => one.id === 'b')!.label).toBe('two · own')
  })

  test('"Disconnect from this kehikko" is a confirmed run no agent may press; it takes the one on screen off the record and opens what is left', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'one' }), row('b', { label: 'two' })] })
    s.state.own = 'a'
    const { container } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    pressOn(s, 'conversation', 'b')
    await flush()
    const item = lastHeader(s).find((one) => one.id === 'disconnect')!
    expect(item).toMatchObject({ kind: 'run', label: 'Disconnect from this kehikko', confirm: true })
    expect(item.agents).toBeUndefined()
    expect(pressOn(s, 'disconnect')).toBe(true)
    await flush()
    expect(s.asked).toContain('detach b')
    /* Not ended: only taken off. The place opens its own. */
    expect(s.asked.some((one) => one.startsWith('end'))).toBe(false)
    expect(shown(container)).toEqual(['whole@3:a'])
    expect(lastHeader(s)[0]!.options!.map((one) => one.id)).toEqual(['a'])

    /* The last one: Codex all the same, a new conversation, and the bar. */
    pressOn(s, 'disconnect')
    await flush()
    expect(s.asked).toContain('detach a')
    expect(shown(container)).toEqual(['whole@3:new'])
    expect(bar(container)).not.toBeNull()
    expect(lastHeader(s)).toEqual([])
  })

  test('fits the header at every width: every label within the protocol’s 48 characters, and what it says does not depend on the width', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'x'.repeat(120), lastActive: Date.now() - 3 * 86_400_000, running: true, state: 'needs-you', since: 1 }), row('b', { label: 'y'.repeat(60) })] })
    s.state.own = 'a'
    render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    pressOn(s, 'conversation', 'b')
    await flush()
    const items = lastHeader(s)
    /* The host folds a module's menus into icons under 300 px and one "⋯" under 220, keeping every item: each
       item has an icon it can be drawn as, and every label fits one line of the menu at 380, 280 and 200 px. */
    expect(items.every((one) => typeof (one as { icon?: string }).icon === 'string')).toBe(true)
    const labels = [...items.map((one) => one.label), ...items.flatMap((one) => (one.options ?? []).map((option) => option.label))]
    expect(labels.every((label) => label.length <= 48)).toBe(true)
    expect(items[0]!.options![0]!.label).toMatch(/^◆ x+… · 3 d ago · own$/)
    expect(headerItemsSchema.safeParse(items).success).toBe(true)
  })
})

/*
 * `context.show` (protocol 2.28.0): Test runs going to the conversation that queued a run.
 */
describe('asked to show a conversation', () => {
  const ask = (id: string, at = '2026-10-28T10:00:00.000Z') => ({ subject: 'agent-session', id, by: 'kehikot.queue', at })

  test('one connected to this place is put on screen', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'mine' }), row('t', { label: 'queued the run' })] })
    s.state.own = 'a'
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
    rerender(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} show={ask('t')} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:t'])
  })

  test('one that is not this place’s moves nothing: it may be another place’s, or Claude’s', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'mine' })] })
    s.state.own = 'a'
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} />)
    await flush()
    rerender(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} show={ask('elsewhere')} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:a'])
  })

  test('the same ask is acted on once; the person may move away from it after', async () => {
    const s = told({ [KEY()]: [row('a', { label: 'mine' }), row('t', { label: 'queued the run' })] })
    s.state.own = 'a'
    const { container, rerender } = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} show={ask('t')} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:t'])
    rerender(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} show={ask('t')} />)
    await flush()
    expect(shown(container)).toEqual(['whole@3:t'])
  })
})

describe('showStep', () => {
  const listing = { sessions: [row('a'), row('gone', { missing: true })], own: 'a' } as unknown as Parameters<typeof showStep>[2]
  const news = (show: { at?: string }, acted: { at?: string | null } | null) => !acted || show.at !== acted.at
  test('waits for the list, switches to a connected one, and leaves the rest', () => {
    expect(showStep(null, null, listing, news)).toEqual({ do: 'none' })
    expect(showStep({ subject: 'agent-session', id: 'a', at: '1' }, null, null, news)).toEqual({ do: 'wait' })
    expect(showStep({ subject: 'agent-session', id: 'a', at: '1' }, null, listing, news)).toEqual({ do: 'switch', session: 'a' })
    expect(showStep({ subject: 'agent-session', id: 'gone', at: '1' }, null, listing, news)).toEqual({ do: 'not-here' })
    expect(showStep({ subject: 'slide', id: 'a', at: '1' }, null, listing, news)).toEqual({ do: 'not-here' })
    expect(showStep({ subject: 'agent-session', id: 'a', at: '1' }, { at: '1' }, listing, news)).toEqual({ do: 'none' })
  })
})

describe('what this page has on screen, said to the server', () => {
  test('is said when it changes and as the feed (re)opens — never on a clock', async () => {
    const s = told()
    const said: { page: string; at: { key: string; onScreen: boolean } | null }[] = []
    s.api.showing = async (page, at) => void said.push({ page, at })
    const heard = s.feeds as unknown as { heard: { attached?(): void } }[]
    const intervals: unknown[] = []
    const timeouts: number[] = []
    const realInterval = globalThis.setInterval
    const realTimeout = globalThis.setTimeout
    globalThis.setInterval = ((...args: Parameters<typeof setInterval>) => (intervals.push(args[1]), realInterval(...args))) as typeof setInterval
    globalThis.setTimeout = ((...args: Parameters<typeof setTimeout>) => (timeouts.push(Number(args[1] ?? 0)), realTimeout(...args))) as typeof setTimeout
    let rerender: ReturnType<typeof render>['rerender']
    try {
      rerender = render(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} containers="" />).rerender
      /* Counted before anything of the test's own waits. */
      expect(intervals).toEqual([])
      expect(timeouts.filter((ms) => ms >= 1000)).toEqual([])
    } finally {
      globalThis.setInterval = realInterval
      globalThis.setTimeout = realTimeout
    }
    await flush()
    expect(said.length).toBe(1)
    expect(said[0]!.at?.key).toBe(KEY())
    /* Time passing says nothing. */
    await new Promise((done) => setTimeout(done, 50))
    expect(said.length).toBe(1)
    /* The feed (re)opening says it again: the server keeps it only while a feed is open. */
    act(() => heard[0]!.heard.attached?.())
    expect(said.length).toBe(2)
    expect(said[1]).toEqual(said[0]!)
    /* A render that changes nothing says nothing; a change of place does. */
    rerender(<Sessions theme="dark" at={at()} api={s.api} hosted={s.hosted} containers="" />)
    await flush()
    expect(said.length).toBe(2)
    rerender(<Sessions theme="dark" at={at(['methods'])} api={s.api} hosted={s.hosted} containers="" />)
    await flush()
    expect(said.length).toBe(3)
    expect(said[2]!.at?.key).toBe(KEY(['methods']))
    act(() => heard[0]!.heard.attached?.())
    expect(said.at(-1)!.at?.key).toBe(KEY(['methods']))
  })
})

describe('the feed, as the page opens it', () => {
  test('tells `attached` each time the stream opens, and asks nothing else', async () => {
    const { api: real } = await import('../src/api.ts')
    const opened: FakeSource[] = []
    class FakeSource {
      readyState = 0
      onopen: (() => void) | null = null
      onmessage: ((message: { data: string }) => void) | null = null
      onerror: (() => void) | null = null
      constructor(readonly url: string) {
        opened.push(this)
      }
      addEventListener() {}
      close() {
        this.readyState = 2
      }
    }
    const was = globalThis.EventSource
    const fetched: string[] = []
    const wasFetch = globalThis.fetch
    globalThis.EventSource = FakeSource as unknown as typeof EventSource
    globalThis.fetch = (async (url: string) => (fetched.push(String(url)), new Response('{}'))) as typeof fetch
    try {
      let attached = 0
      const stop = real.feed!(true, { state() {}, notice() {}, attached: () => void attached++ }, P, 'page-abcdefgh')
      expect(opened.length).toBe(1)
      expect(opened[0]!.url).toContain('page=page-abcdefgh')
      opened[0]!.onopen?.()
      expect(attached).toBe(1)
      /* The browser reconnecting by itself opens it again: said again. */
      opened[0]!.onopen?.()
      expect(attached).toBe(2)
      stop()
      expect(fetched).toEqual([])
    } finally {
      globalThis.EventSource = was
      globalThis.fetch = wasFetch
    }
  })
})
