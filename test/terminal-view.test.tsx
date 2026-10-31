import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from 'bun:test'
import { act, cleanup, render } from '@testing-library/react'
import { StrictMode } from 'react'

/**
 * The real `TerminalView`, with a stand-in emulator and a stand-in socket, and
 * the one question asked of it: is every byte the program said written into
 * the emulator exactly once?
 *
 * "It sometimes adds previously written text as duplicate" has a short list of
 * causes on this side of the socket: two sockets to one view (an effect that
 * ran twice without its cleanup, a re-render that reconnected), the screen the
 * server sends on attach written into an emulator that already holds it, or a
 * resize the pty was told about over and over — each a SIGWINCH, and Codex
 * Code reprints its conversation on every one. The first two are asserted here
 * directly; the server's half of the third (the screen, then what followed, and
 * nothing twice) is in `live.test.ts`. The last is asserted by counting what
 * the view sends: one resize for a box that moved for a while.
 */

/* Every emulator made, with everything written into it. */
const emulators: FakeTerminal[] = []
class FakeTerminal {
  cols = 80
  rows = 24
  written: string[] = []
  disposed = false
  options: Record<string, unknown> = {}
  private typed: ((data: string) => void) | null = null
  constructor() {
    emulators.push(this)
  }
  loadAddon(addon: { activate?: (terminal: FakeTerminal) => void }) {
    addon.activate?.(this)
  }
  open() {}
  focus() {}
  write(data: string | Uint8Array) {
    this.written.push(typeof data === 'string' ? data : new TextDecoder().decode(data))
  }
  onRender() {
    return { dispose() {} }
  }
  onData(heard: (data: string) => void) {
    this.typed = heard
    return {
      dispose: () => {
        this.typed = null
      },
    }
  }
  type(data: string) {
    this.typed?.(data)
  }
  dispose() {
    this.disposed = true
  }
}

/* What the next fit measures. */
let measured = { cols: 100, rows: 30 }
/* How many times anything fitted the emulator: a hover must not. */
let fits = 0
class FakeFit {
  private terminal: FakeTerminal | null = null
  activate(terminal: FakeTerminal) {
    this.terminal = terminal
  }
  fit() {
    fits += 1
    if (!this.terminal) return
    this.terminal.cols = measured.cols
    this.terminal.rows = measured.rows
  }
}

mock.module('@xterm/xterm', () => ({ Terminal: FakeTerminal }))
mock.module('@xterm/addon-fit', () => ({ FitAddon: FakeFit }))
mock.module('@xterm/xterm/css/xterm.css', () => ({}))

/* Every socket opened, with every frame the page sent on it. */
const sockets: FakeSocket[] = []
class FakeSocket {
  static CONNECTING = 0
  static OPEN = 1
  static CLOSING = 2
  static CLOSED = 3
  readyState = FakeSocket.CONNECTING
  sent: string[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: unknown }) => void) | null = null
  onclose: ((event: { code: number; reason: string }) => void) | null = null
  onerror: (() => void) | null = null
  constructor(readonly url: string) {
    sockets.push(this)
  }
  send(frame: string) {
    this.sent.push(frame)
  }
  close() {
    this.readyState = FakeSocket.CLOSED
  }
  addEventListener() {}
  removeEventListener() {}
  /* The server's side. */
  opens() {
    act(() => {
      this.readyState = FakeSocket.OPEN
      this.onopen?.()
    })
  }
  /* The program's bytes arrive binary; the server's own word arrives as text. */
  says(data: string) {
    this.onmessage?.({ data: new TextEncoder().encode(data).buffer })
  }
  drops() {
    act(() => {
      this.readyState = FakeSocket.CLOSED
      this.onclose?.({ code: 1006, reason: '' })
    })
  }
  get resizes() {
    return this.sent.map((frame) => JSON.parse(frame) as { r?: unknown }).filter((frame) => frame.r)
  }
  binaryType = 'blob'
}

/* The observers, so a test can say the box moved. */
const observers: { fire: () => void }[] = []
class FakeObserver {
  constructor(private readonly heard: () => void) {}
  observe() {
    observers.push({ fire: () => this.heard() })
  }
  disconnect() {}
}

const saved = { WebSocket: globalThis.WebSocket, ResizeObserver: globalThis.ResizeObserver }
const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth')
const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight')
beforeAll(() => {
  globalThis.WebSocket = FakeSocket as unknown as typeof WebSocket
  globalThis.ResizeObserver = FakeObserver as unknown as typeof ResizeObserver
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 400 })
})
afterAll(() => {
  globalThis.WebSocket = saved.WebSocket
  globalThis.ResizeObserver = saved.ResizeObserver
  if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width)
  if (height) Object.defineProperty(HTMLElement.prototype, 'clientHeight', height)
})
afterEach(() => {
  cleanup()
  emulators.length = 0
  sockets.length = 0
  observers.length = 0
  measured = { cols: 100, rows: 30 }
})

/* By a specifier of its own: `sessions.test.tsx` stands a fake in for this module, and bun's
   `mock.module` holds for the whole run. The query is what makes this the real file. */
const real = '../src/view/terminal-view.tsx?real'
const { TerminalView } = (await import(real)) as typeof import('../src/view/terminal-view.tsx')
const { SETTLE_MS } = await import('../src/view/settle-size.ts')
type Target = import('../src/view/terminal-view.tsx').Target

const turn = (ms = 0) => act(() => new Promise((done) => setTimeout(done, ms)))
const live = () => emulators.filter((one) => !one.disposed)
const times = (emulator: FakeTerminal, line: string) => emulator.written.join('').split('\r\n').filter((one) => one === line).length

const PLACE = { epic: 'thesis', parts: [], kehikko: { key: '4072c9e5' }, kehikkoName: 'writing' }
const at = (projectPath: string): Target => ({ what: 'session', projectPath, projectId: 'p_aaaaaaaaaaaaaaaa', place: PLACE, session: null })

describe('every byte the program says is written once', () => {
  test('mounted under StrictMode: one emulator left, one socket, each line once', async () => {
    render(
      <StrictMode>
        <TerminalView theme="light" target={at('/p/a')} shown />
      </StrictMode>,
    )
    await turn()
    expect(live().length).toBe(1)
    expect(sockets.length).toBe(1)
    sockets[0]!.opens()
    for (let n = 0; n < 5; n += 1) sockets[0]!.says(`line ${n}\r\n`)
    for (let n = 0; n < 5; n += 1) expect(times(live()[0]!, `line ${n}`)).toBe(1)
  })

  test('rendered again — another theme, hidden and shown, the project renamed (same id), twice quickly — opens nothing and writes nothing twice', async () => {
    const view = render(<TerminalView theme="light" target={at('/p/a')} shown />)
    await turn()
    sockets[0]!.opens()
    sockets[0]!.says('first\r\n')
    view.rerender(<TerminalView theme="dark" target={at('/p/a')} shown />)
    view.rerender(<TerminalView theme="dark" target={at('/p/a')} shown={false} watched={false} />)
    view.rerender(<TerminalView theme="dark" target={at('/p/renamed')} shown />)
    view.rerender(<TerminalView theme="dark" target={at('/p/renamed')} shown />)
    await turn()
    sockets[0]!.says('second\r\n')
    expect(sockets.length).toBe(1)
    expect(emulators.length).toBe(1)
    expect(times(emulators[0]!, 'first')).toBe(1)
    expect(times(emulators[0]!, 'second')).toBe(1)
  })

  test('a dropped socket is not reconnected into the emulator that holds the screen; a new view starts from an empty one', async () => {
    const view = render(<TerminalView key="1" theme="light" target={at('/p/a')} shown />)
    await turn()
    sockets[0]!.opens()
    sockets[0]!.says('one\r\ntwo\r\n')
    sockets[0]!.drops()
    await turn(50)
    expect(sockets.length).toBe(1)
    /* The page reopens it as a new view: the server sends the screen as it stands, into a new emulator. */
    view.rerender(<TerminalView key="2" theme="light" target={at('/p/a')} shown />)
    await turn()
    expect(sockets.length).toBe(2)
    expect(live().length).toBe(1)
    sockets[1]!.opens()
    sockets[1]!.says('one\r\ntwo\r\nthree\r\n')
    for (const line of ['one', 'two', 'three']) expect(times(live()[0]!, line)).toBe(1)
  })
})

describe('the pty is told a size once the box holds still', () => {
  test('a box that moves for a while — the host grid animating a fold — is one resize, at the size it ended at', async () => {
    render(<TerminalView theme="light" target={at('/p/a')} shown />)
    await turn()
    sockets[0]!.opens()
    for (let step = 0; step < 12; step += 1) {
      measured = { cols: 100 - step * 2, rows: 30 }
      for (const one of observers) one.fire()
      await turn(15)
    }
    await turn(SETTLE_MS + 20)
    expect(sockets[0]!.resizes).toEqual([{ r: { cols: 78, rows: 30 } }])
  })

  test('a box shown again at the size the pty already has says nothing', async () => {
    render(<TerminalView theme="light" target={at('/p/a')} shown />)
    await turn()
    sockets[0]!.opens()
    for (const one of observers) one.fire()
    await turn(SETTLE_MS + 20)
    expect(sockets[0]!.resizes).toEqual([])
  })
})

describe('the host\u2019s header and footer revealed over the terminal (protocol 2.42.0)', () => {
  test('a hover in and out fits nothing and tells the pty nothing; the terminal is moved, then put back', async () => {
    const view = render(<TerminalView theme="light" target={at('/p/a')} shown />)
    await turn()
    sockets[0]!.opens()
    await turn(SETTLE_MS + 20)
    const before = fits
    const holder = view.container.querySelector('.overflow-hidden > div') as HTMLElement
    view.rerender(<TerminalView theme="light" target={at('/p/a')} shown covered={{ top: 32, bottom: 32 }} />)
    await turn(SETTLE_MS + 20)
    expect(holder.style.transform).toMatch(/^translateY\(-?\d+px\)$/)
    view.rerender(<TerminalView theme="light" target={at('/p/a')} shown covered={{ top: 0, bottom: 0 }} />)
    await turn(SETTLE_MS + 20)
    expect(holder.style.transform).toBe('')
    expect(fits).toBe(before)
    expect(sockets[0]!.resizes).toEqual([])
  })
})
