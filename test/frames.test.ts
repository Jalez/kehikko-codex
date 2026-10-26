import { describe, expect, test } from 'bun:test'

import {
  OWED,
  type FrameSource,
  framesDriven,
  keepFramesComing,
  requestRealFrame,
} from '../src/view/frames.ts'

/**
 * The fallback, tested against the window it was written for — one that owes
 * a frame — which no real test window can be made to be. So the window here
 * is an object with the two functions the fallback replaces, and the tests
 * hand it one that serves frames and one that never will.
 *
 * What these can prove: a callback runs exactly once whichever path reaches
 * it; a cancelled frame is drawn by neither; and the debt is counted, so the
 * report can say how much drawing the window did not do. What they cannot
 * prove is that rows drawn this way are painted by WebKit while it throttles
 * the frame. That was measured instead, with `dev/framed-probe.sh`, and the
 * numbers are in the README.
 */

const sleep = (ms: number) => new Promise((done) => setTimeout(done, ms))

/** A window that answers every frame request a millisecond later. */
function serving(): FrameSource & { served: number } {
  const win = {
    served: 0,
    requestAnimationFrame(callback: (time: number) => void) {
      win.served += 1
      setTimeout(() => callback(performance.now()), 1)
      return win.served
    },
    cancelAnimationFrame() {},
  }
  return win
}

/** A window that takes every request and answers none of them. */
function owing(): FrameSource & { cancelled: number[] } {
  const win = {
    cancelled: [] as number[],
    requestAnimationFrame() {
      return 7
    },
    cancelAnimationFrame(id: number) {
      win.cancelled.push(id)
    },
  }
  return win
}

describe('a frame that is owed', () => {
  test('a window that serves frames is left alone: the callback runs once, from the frame, and nothing is counted', async () => {
    const win = serving()
    keepFramesComing(win)
    const before = framesDriven()
    let ran = 0
    win.requestAnimationFrame(() => {
      ran += 1
    })
    await sleep(OWED * 3)
    expect(ran).toBe(1)
    expect(framesDriven()).toBe(before)
  })

  test('a window that owes a frame has it drawn from the timer, once, and the debt is counted', async () => {
    const win = owing()
    keepFramesComing(win)
    const before = framesDriven()
    let ran = 0
    const asked = performance.now()
    let at = 0
    win.requestAnimationFrame(() => {
      ran += 1
      at = performance.now()
    })
    await sleep(OWED * 3)
    expect(ran).toBe(1)
    expect(framesDriven()).toBe(before + 1)
    /* Drawn late, not immediately: a fallback that fired at once would
       pre-empt every real frame on a healthy window. */
    expect(at - asked).toBeGreaterThanOrEqual(OWED - 5)
    /* And the frame that was still owed is handed back, so a window that
       eventually serves it does not run the callback a second time. */
    expect(win.cancelled).toEqual([7])
  })

  test('a frame cancelled before it is drawn is drawn by neither path', async () => {
    const win = owing()
    keepFramesComing(win)
    const before = framesDriven()
    let ran = 0
    const id = win.requestAnimationFrame(() => {
      ran += 1
    })
    win.cancelAnimationFrame(id)
    await sleep(OWED * 3)
    expect(ran).toBe(0)
    expect(framesDriven()).toBe(before)
    expect(win.cancelled).toEqual([7])
  })

  test('two requests are two callbacks, each once, in the order they were made', async () => {
    const win = owing()
    keepFramesComing(win)
    const order: number[] = []
    win.requestAnimationFrame(() => order.push(1))
    win.requestAnimationFrame(() => order.push(2))
    await sleep(OWED * 3)
    expect(order).toEqual([1, 2])
  })

  test('installing twice on one window does not stack two fallbacks', () => {
    const win = serving()
    keepFramesComing(win)
    const once = win.requestAnimationFrame
    keepFramesComing(win)
    expect(win.requestAnimationFrame).toBe(once)
  })

  test('the probe still reaches the real frame after the window has been replaced', async () => {
    keepFramesComing(window)
    let ran = 0
    const id = requestRealFrame(() => {
      ran += 1
    })
    expect(id).not.toBeNull()
    await sleep(100)
    expect(ran).toBe(1)
  })
})
