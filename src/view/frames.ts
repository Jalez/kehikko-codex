/**
 * A frame that is owed, and drawing without waiting for it.
 *
 * ## The failure this prevents
 *
 * "It stops showing what I type until I switch to another app." Reported four
 * times now. The keystrokes are not lost: the shell answers, the socket
 * delivers, `terminal.write()` parses every byte into xterm's buffer. What does
 * not happen is the DRAW, because xterm puts rows on screen only inside a
 * `requestAnimationFrame` — one `RenderDebouncer` that every renderer sits
 * behind — and in the window this was reported from, that frame does not come.
 *
 * Measured on 2026-09-02 from the module's own trace
 * (`curl 127.0.0.1:7920/api/trace`), on the page in front of the person, while
 * it was happening:
 *
 *     frames: 92 landed, last 0.6s ago, worst wait 9.4s
 *     worst timer lag 1.2s, visibility visible, up 15m21s
 *     xterm: 65 writes, 9 renders
 *     14:31:19  an animation frame took 9.1s to arrive; the page was visible for it
 *     14:31:29  an animation frame took 8.6s to arrive; the page was visible for it
 *     … one such line every ten seconds, for the whole life of the page
 *
 * Not stopped, as the `hidden` case the desktop shell fixed was — served once
 * every ten seconds, to a page that says it is visible, with its repeating
 * timers aligned to whole seconds. Those two numbers together are one
 * specific thing. WebKit gives a SUBFRAME whose visible rect it computes as
 * empty `ThrottlingReason::OutsideViewport`
 * (`LocalFrameView::updateScriptedAnimationsAndTimersThrottlingState`): its
 * animation frames go to `AggressiveThrottlingAnimationInterval`, which is
 * ten seconds, and its nested timers to `hiddenPageAlignmentInterval`, which
 * is one — and nothing else in WebKit produces a ten-second frame. This
 * module is a subframe; the host frames it in an iframe. In that window WebKit
 * had decided the frame was off screen while the person was typing into it.
 * Put the frame genuinely off screen and the trace reads identically, to the
 * digit, which is how the number was tied to the reason.
 *
 * What could NOT be reproduced is the decision itself. The same host, framing
 * the same module, in a fresh WKWebView window built by the same shell —
 * frontmost, behind another app, off screen entirely, fullscreen, the canvas
 * scrolled, the frame sized late the way the host really sizes it — painted
 * every frame on time. `dev/framed-like-the-host.html` and `dev/framed-probe.sh`
 * are the instrument, with the runs in the README. Whatever puts a window
 * that has been open for a day and a half into that state is the shell's or
 * WebKit's to find. This file is what the module can do regardless, and it is
 * enough to make the symptom go away wherever the decision comes from.
 *
 * ## Why drawing from a timer works here, and the note that said it would not
 *
 * `terminal-view.tsx` used to argue that a repaint timer is pointless because
 * "a page whose rendering update is suspended does not paint what you write
 * into it". True of the `hidden` case; not of this one. Here the PAGE is
 * painting — the host's canvas around the terminal answers the pointer, and
 * the terminal's backlog appears the instant its throttled frame lands, which
 * is a paint. What is throttled is one document's animation frame callbacks
 * and its repeating timers, not the rendering update they would have run
 * inside. Rows written into the DOM from anything else are laid out and
 * painted at the page's own cadence.
 *
 * "Anything else" has to be chosen with the same throttling in mind. A
 * `setInterval`, or a `setTimeout` that re-arms itself, reaches WebKit's
 * maximum timer nesting level and is then aligned to the same one-second grid
 * the trace's heartbeat shows being late by. A one-shot `setTimeout` created
 * from an event handler — a socket message, a keystroke, a resize — is nesting
 * level one or two, below the threshold, and fires when asked.
 *
 * So this replaces the window's `requestAnimationFrame` with one that asks the
 * real one for a frame AND arms a one-shot timer, and runs the callback from
 * whichever comes first, exactly once. On a window that serves frames the
 * timer is cancelled sixteen milliseconds later and nothing is different. On
 * a window that owes a frame, the timer draws it after `OWED` milliseconds —
 * four frames' worth: late enough never to pre-empt a frame that is merely
 * busy, early enough that typing still reads as typing.
 *
 * It is not a loop. Nothing here runs unless something asked for a frame, and
 * xterm asks only when it has rows to draw, so the cost on a terminal sitting
 * still is zero — which is the bar every timer in this workspace has to clear.
 *
 * ## What it does to the instrument
 *
 * `src/view/trace.ts` measures whether frames arrive. It must keep measuring
 * the REAL ones, or the report would say the window was fine on the day this
 * fallback was quietly doing all the drawing. So the native function is kept
 * here from before it is replaced, and the probe asks it directly; and every
 * callback this file ran from the timer rather than the frame is counted, so
 * the same report can say "N drawn without waiting for a frame" — the sentence
 * that names this bug the next time it happens.
 */

/** How long a requested frame may be late before it is drawn from here. */
export const OWED = 64

export type FrameCallback = (time: number) => void

/** The two functions this file replaces, on whatever object holds them. */
export interface FrameSource {
  requestAnimationFrame(callback: FrameCallback): number
  cancelAnimationFrame(id: number): void
}

/** The page's own functions, kept from before they were replaced. */
let real: FrameSource | null = null

/** Sources already dealt with, so a second install cannot stack two timers. */
const installed = new WeakSet<FrameSource>()

/** Callbacks run from the timer because the frame had not come. */
let driven = 0

/** How many frames have been drawn without waiting for the window. */
export function framesDriven(): number {
  return driven
}

/**
 * Ask the window itself for a frame, bypassing the fallback.
 *
 * For the probe, and only the probe: it exists to say whether the window is
 * serving frames, and a probe that went through the fallback would answer yes
 * on a window that has not served one all afternoon. Returns null where there
 * is no window to ask.
 */
export function requestRealFrame(callback: FrameCallback): number | null {
  if (real) return real.requestAnimationFrame(callback)
  if (typeof window === 'undefined' || typeof window.requestAnimationFrame !== 'function') return null
  return window.requestAnimationFrame(callback)
}

/**
 * Replace `requestAnimationFrame` on `source` with one that will not wait
 * forever. Once per source; a second call is a no-op.
 *
 * `source` is a parameter so a test can hand in a window that never serves a
 * frame, which is the case this exists for and the one a real test window
 * cannot be made to produce.
 */
export function keepFramesComing(source: FrameSource | null = typeof window === 'undefined' ? null : window): void {
  if (!source || installed.has(source)) return
  if (typeof source.requestAnimationFrame !== 'function' || typeof source.cancelAnimationFrame !== 'function') return
  installed.add(source)

  const request = source.requestAnimationFrame.bind(source)
  const cancel = source.cancelAnimationFrame.bind(source)
  if (typeof window !== 'undefined' && source === window) {
    real = { requestAnimationFrame: request, cancelAnimationFrame: cancel }
  }

  let next = 1
  const pending = new Map<number, { frame: number; timer: ReturnType<typeof setTimeout> }>()

  source.requestAnimationFrame = (callback: FrameCallback): number => {
    const id = next
    next += 1

    /* One of the two paths settles it; the other finds nothing pending and
       does nothing. That map lookup is the whole guarantee that a callback runs
       once, whichever way it was reached, and it holds even if the frame and
       the timer are both already queued when the first of them runs. */
    const settle = (time: number, late: boolean) => {
      const held = pending.get(id)
      if (!held) return
      pending.delete(id)
      if (late) {
        cancel(held.frame)
        driven += 1
      } else {
        clearTimeout(held.timer)
      }
      callback(time)
    }

    const frame = request((time) => settle(time, false))
    const timer = setTimeout(() => settle(performance.now(), true), OWED)
    pending.set(id, { frame, timer })
    return id
  }

  source.cancelAnimationFrame = (id: number): void => {
    const held = pending.get(id)
    if (!held) return
    pending.delete(id)
    cancel(held.frame)
    clearTimeout(held.timer)
  }
}
