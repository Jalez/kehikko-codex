import { afterEach, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MESSAGE } from 'kehikot-module-protocol'
import { mailbox, resetServerStanding } from 'kehikot-module-protocol/client'
import { createRoot } from 'react-dom/client'

import { ID } from '../ids.ts'

/**
 * The page answers its host's greeting, whatever the host is and whatever its own server says.
 *
 * The whole app, as `main.tsx` starts it, on the real mailbox over the real `window`, greeted by a
 * stand-in host that is a bare object with a `postMessage`. The terminal is a stand-in (xterm needs a
 * canvas happy-dom does not have); everything else is real, including `api.ts` over a `fetch` each
 * case chooses. What is asserted first is `kehikot.ready`: a page that does not send it is a
 * container the host can only call silent.
 */

mock.module('../src/view/terminal-view.tsx', () => ({
  TerminalView: () => <div data-terminal />,
}))

const { App } = await import('../src/app.tsx')
const { start, Broken } = await import('../src/starts.tsx')

type Fetch = typeof fetch
const realFetch = globalThis.fetch
const answering = (status: number, body: unknown = { error: 'no' }): Fetch =>
  (() => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }))) as unknown as Fetch

afterEach(() => {
  cleanup()
  mailbox.forget?.()
  resetServerStanding()
  globalThis.fetch = realFetch
})

const PROJECT = '/Users/somebody/Projects/harbour'

/** A host from inside a frame: something to be greeted by, and what the page said back. */
function stubHost() {
  const said: Record<string, unknown>[] = []
  const source = {
    postMessage: (message: Record<string, unknown>) => {
      said.push(message)
    },
  }
  const post = (data: unknown) => {
    const event = new MessageEvent('message', { data, origin: 'http://localhost:7777' })
    Object.defineProperty(event, 'source', { value: source })
    window.dispatchEvent(event)
  }
  const readies = () => said.filter((one) => one.type === MESSAGE.READY)
  return { said, post, readies }
}

/** The greeting of an old host: protocol 1, no answers, header, footer, carries, footerKinds or pointer, and a bare context. */
const OLD = (context: Record<string, unknown>) => ({ type: MESSAGE.HELLO, protocol: 1, session: 'old-host', context })

/** The greeting of a current host, every 2.58 field said. */
const NEW = {
  type: MESSAGE.HELLO,
  protocol: 2,
  session: 'new-host',
  context: { epic: 'an-epic', projectPath: PROJECT, projectId: null, theme: 'dark', kehikko: { id: 1, key: 'k1', name: 'Main' }, parts: [] },
  state: null,
  answers: ['events.emit', 'activity.set', 'view.expand'],
  header: true,
  footer: true,
  carries: ['copy'],
  footerKinds: ['text', 'run'],
  pointer: true,
}

/** The place's listing from a machine with no `codex` on it. */
const NOT_INSTALLED = {
  ok: true,
  program: { name: 'Codex', found: null, foundAt: null, looked: ['/usr/bin'], where: 'PATH', lacks: null, install: { line: 'npm i -g @openai/codex', lands: '~/.local/bin/codex' }, asked: 'failed' },
  sessions: [],
  others: [],
  running: [],
}

const settle = () => act(() => new Promise((done) => setTimeout(done, 20)))

describe('the greeting is answered', () => {
  const cases: [string, Record<string, unknown>, Fetch][] = [
    ['an old host, no project, its server answering 404', OLD({}), answering(404)],
    ['an old host with a project and no epic, its server answering 500', OLD({ projectPath: PROJECT, epic: null }), answering(500)],
    ['an old host with a project, its server unreachable', OLD({ projectPath: PROJECT, epic: 'an-epic' }), (() => Promise.reject(new TypeError('Failed to fetch'))) as unknown as Fetch],
    ['an old host, its server answering what is not JSON', OLD({ projectPath: PROJECT }), (() => Promise.resolve(new Response('<html>', { status: 200 }))) as unknown as Fetch],
    ['a current host with every field, its server answering 404', NEW, answering(404)],
    ['a current host, its server saying Codex is not installed', NEW, answering(200, NOT_INSTALLED)],
  ]
  for (const [name, hello, fetcher] of cases) {
    test(name, async () => {
      globalThis.fetch = fetcher
      const host = stubHost()
      render(<App />)
      act(() => host.post(hello))
      await settle()
      expect(host.readies()[0]).toMatchObject({ type: MESSAGE.READY, id: ID })
      /* Still drawn, and not the page that says it broke. */
      expect(document.querySelector('[data-broken]')).toBeNull()
    })
  }
})

describe('a page that fails to start still answers', () => {
  const mount = () => {
    const at = document.createElement('div')
    document.body.append(at)
    return createRoot(at)
  }

  test('when loading the app throws — an import that throws while the page is evaluated', async () => {
    const quiet = console.error
    console.error = () => {}
    try {
      const host = stubHost()
      const root = mount()
      await act(() => start(root, () => Promise.reject(new Error('Module "node:path" has been externalized for browser compatibility.'))))
      act(() => host.post(OLD({ projectPath: PROJECT })))
      expect(host.readies()[0]).toMatchObject({ type: MESSAGE.READY, id: ID })
      expect(screen.getByText('Codex’s page could not start.')).toBeTruthy()
      expect(screen.getByText(/externalized for browser compatibility/)).toBeTruthy()
      /* And the host is told what failed (protocol 2.59.0), kept from before its greeting. */
      expect(host.said).toContainEqual(expect.objectContaining({ type: MESSAGE.PAGE_ERROR, where: 'error', message: expect.stringContaining('externalized for browser compatibility') }))
      act(() => root.unmount())
    } finally {
      console.error = quiet
    }
  })

  test('when the app throws while drawing, after the greeting arrived', async () => {
    const quiet = console.error
    console.error = () => {}
    try {
      const host = stubHost()
      act(() => host.post(OLD({ projectPath: PROJECT })))
      const Throws = () => {
        throw new Error('drawn wrong')
      }
      const root = mount()
      await act(() => start(root, () => Promise.resolve({ App: Throws })))
      expect(host.readies()[0]).toMatchObject({ type: MESSAGE.READY, id: ID })
      expect(screen.getByText('drawn wrong')).toBeTruthy()
      expect(host.said).toContainEqual(expect.objectContaining({ type: MESSAGE.PAGE_ERROR, where: 'render', message: 'Error: drawn wrong' }))
      act(() => root.unmount())
    } finally {
      console.error = quiet
    }
  })

  test('when its own server answers with something the page cannot read, it says so and still answers', async () => {
    const quiet = console.error
    console.error = () => {}
    try {
      globalThis.fetch = answering(200, { ok: true, sessions: [] })
      const host = stubHost()
      const root = mount()
      await act(() => start(root, () => Promise.resolve({ App })))
      act(() => host.post(NEW))
      await settle()
      expect(host.readies()[0]).toMatchObject({ type: MESSAGE.READY, id: ID })
      expect(screen.getByText('Codex’s page could not start.')).toBeTruthy()
      act(() => root.unmount())
    } finally {
      console.error = quiet
    }
  })

  test('says something when the failure said nothing', () => {
    render(<Broken error={{}} />)
    expect(screen.getByText('It failed without saying why.')).toBeTruthy()
  })
})
