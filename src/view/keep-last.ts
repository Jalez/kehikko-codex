import { useEffect, useRef, type RefObject } from 'react'
import { keepInView, type Covered } from 'kehikot-module-protocol/client'

/**
 * The last line kept out from under the host's header and footer, without a resize.
 *
 * ## Why this exists
 *
 * In Kehikot's focus mode a container's header and footer hide, and come back while the pointer is
 * over it. They used to PUSH: the frame shrank by the two rows, the emulator fitted to fewer rows,
 * the pty was told (a SIGWINCH), and the program redrew for the smaller screen — and on leave all of
 * it again the other way. Two full redraws and two scroll jumps per hover, which is what was
 * reported: "the terminal content first gets pushed or pulled and then returns to where it was".
 * Waiting longer before fitting (`settle-size.ts`) only moves the jump later, because the pointer
 * rests over a terminal for as long as somebody works in it.
 *
 * So the manifest says `reveal: 'over'`: the host keeps this page's frame at its size and draws its
 * rows OVER the top and bottom of it, and says how much they cover (`covered`, from `useHost`).
 * Nothing is resized, so nothing is fitted and the pty hears nothing. What this does is move the
 * emulator with a transform — compositing only — so that its last line (the last row with text, or
 * the cursor's row, whichever is lower) sits above the footer; the rows that go under the header are
 * the oldest on screen. A short screen (a fresh shell with its prompt on the first row) moves down
 * instead, out from under the header. The protocol's `keepInView` is the rule.
 *
 * On a host that does not reveal over (an older one, or focus mode off), `covered` is always nothing
 * and this never moves anything.
 */

/** What of an emulator this reads: its rows and the visible part of its buffer. */
export interface Screen {
  rows: number
  buffer?: {
    active: {
      viewportY: number
      baseY: number
      cursorY: number
      getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined
    }
  }
}

/**
 * The visible row, from 0, of the last line that must stay seen: the last row with text, or the
 * cursor's row, whichever is lower. The bottom row when the emulator says nothing.
 */
export function lastRow(screen: Screen): number {
  const rows = Math.max(1, screen.rows)
  const active = screen.buffer?.active
  if (!active) return rows - 1
  let last = -1
  for (let row = rows - 1; row >= 0; row -= 1) {
    if (active.getLine(active.viewportY + row)?.translateToString(true).trim()) {
      last = row
      break
    }
  }
  const cursor = active.baseY + active.cursorY - active.viewportY
  if (cursor >= 0 && cursor < rows) last = Math.max(last, cursor)
  return last < 0 ? rows - 1 : last
}

/**
 * Keep `holder`'s emulator's last line out from under what the host's rows cover. The holder is
 * moved with `transform` only; its parent must clip (`overflow: hidden`). Follows what the emulator
 * draws while anything is covered, so new output keeps its last line in view too.
 */
export function useKeepLast(holder: RefObject<HTMLDivElement | null>, term: RefObject<Screen & { onRender(listener: () => void): { dispose(): void } } | null>, covered: Covered): void {
  const now = useRef(covered)
  now.current = covered
  const { top, bottom } = covered

  useEffect(() => {
    const node = holder.current
    if (!node) return
    const place = () => {
      const terminal = term.current
      const box = node.parentElement?.getBoundingClientRect()
      if (!terminal || !box) return
      const screen = node.querySelector('.xterm-screen')?.getBoundingClientRect().height || node.clientHeight
      const row = screen / Math.max(1, terminal.rows)
      const shift = keepInView(now.current, window.innerHeight, box.top + (lastRow(terminal) + 1) * row)
      node.style.transition = matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'none' : 'transform 140ms ease'
      node.style.transform = shift ? `translateY(${shift}px)` : ''
    }
    place()
    if (top === 0 && bottom === 0) return
    const drawn = term.current?.onRender(place)
    return () => drawn?.dispose()
  }, [holder, term, top, bottom])
}
