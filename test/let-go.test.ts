import { describe, expect, test } from 'bun:test'

import { letGo, type Letting } from '../src/view/let-go.ts'

/**
 * A socket a view is done with. Closing one that has not opened is what the
 * browser logs as "WebSocket is closed before the connection is established".
 */

const socket = (readyState: number) => {
  const said: string[] = []
  const held: Letting & { said: string[] } = {
    readyState,
    said,
    onopen: () => said.push('the opening frame'),
    onmessage: () => said.push('output'),
    onclose: () => said.push('closed'),
    onerror: () => said.push('failed'),
    close: () => said.push('close()'),
  }
  return held
}

describe('letting go of a socket', () => {
  test('one that is open is closed, and its handlers still hear it', () => {
    const live = socket(1)
    expect(letGo(live)).toBe(false)
    expect(live.said).toEqual(['close()'])
    expect(live.onclose).not.toBeNull()
  })

  test('one that is still connecting is not closed yet: nothing for the browser to call a failure', () => {
    const live = socket(0)
    expect(letGo(live)).toBe(true)
    expect(live.said).toEqual([])
  })

  test('…it closes itself when it opens, without sending a frame and without telling the view', () => {
    const live = socket(0)
    letGo(live)
    live.readyState = 1
    live.onopen?.({} as Event)
    expect(live.said).toEqual(['close()'])
    expect(live.onmessage).toBeNull()
    expect(live.onclose).toBeNull()
    expect(live.onerror).toBeNull()
  })

  test('one that is closing or closed is closed as before, which does nothing', () => {
    for (const state of [2, 3]) {
      const live = socket(state)
      expect(letGo(live)).toBe(false)
      expect(live.said).toEqual(['close()'])
    }
  })
})
