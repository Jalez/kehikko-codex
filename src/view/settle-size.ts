/**
 * One resize for a container that is still moving, sent once it holds still.
 *
 * ## Why a burst of sizes is somebody's text twice
 *
 * Every size the pty is told is a SIGWINCH, and a program that draws its own
 * screen redraws on every one. Codex — the program this module holds —
 * reprints its conversation for the new width, and what it printed for the
 * old width stays in the scrollback above. One resize leaves one copy; that is the program's, and a terminal
 * window dragged by hand does the same.
 *
 * What made it "sometimes, previously written text again" here was how MANY
 * sizes this view sent. The host's grid animates a container's width and height
 * over 200ms whenever it changes — a fold, an unfold, a neighbour placed, a
 * drag — and the `ResizeObserver` fires on every frame of that. Each frame was
 * fitted and sent, so one fold was nine sizes the pty went through
 * (measured in kehikko-terminal, `dev/resize-burst.mjs`, whose copy of this
 * file this is), and nine reprints of the conversation stacked up in the
 * scrollback, each at a slightly different width.
 *
 * So the view does not fit or send while the box is moving. Each observation
 * restarts a wait; when the size has held for `SETTLE_MS` the emulator is fitted
 * once and the pty is told once — and not at all when the fitted size is the
 * one it already has. The emulator and the pty keep agreeing throughout, on
 * the old size and then on the new one, because they are resized together.
 */

/** Longer than the host grid's 200ms size transition, so the whole of one is a single resize. */
export const SETTLE_MS = 250

export interface Size {
  cols: number
  rows: number
}

export interface Timers {
  set: (run: () => void, ms: number) => unknown
  clear: (handle: unknown) => void
}

const REAL: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export interface Settler {
  /** The box was observed at some size. Waits for it to hold still. */
  observe(): void
  /** The pty is at this size already (it was opened at it). A settle that fits to it sends nothing. */
  known(size: Size): void
  /** Stop waiting: the view is going. */
  dispose(): void
}

/**
 * `fit` measures and fits the emulator, returning its size, or null when there
 * is nothing to measure (hidden, folded, being laid out). `send` tells the pty.
 */
export function settleSize(fit: () => Size | null, send: (size: Size) => void, wait = SETTLE_MS, timers: Timers = REAL): Settler {
  let pending: unknown = null
  let last: string | null = null
  const key = (size: Size) => `${size.cols}x${size.rows}`
  return {
    observe() {
      if (pending !== null) timers.clear(pending)
      pending = timers.set(() => {
        pending = null
        const size = fit()
        if (!size || key(size) === last) return
        last = key(size)
        send(size)
      }, wait)
    },
    known(size) {
      last = key(size)
    },
    dispose() {
      if (pending !== null) timers.clear(pending)
      pending = null
    },
  }
}
