import { afterEach, describe, expect, mock, test } from 'bun:test'
import { cleanup, render } from '@testing-library/react'

/**
 * The `agent.tasks` view (protocol 2.88.0): `/app?session=<id>` draws that one conversation's
 * terminal, attached to by its id, with no greeting from a host and no place. The terminal is a
 * stand-in that keeps what it was handed (xterm needs a canvas happy-dom does not have).
 */

const handed: unknown[] = []
mock.module('../src/view/terminal-view.tsx', () => ({
  TerminalView: (props: { target: unknown }) => {
    handed.push(props.target)
    return <div data-terminal />
  },
}))

const { App, taskSession } = await import('../src/app.tsx')

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

afterEach(() => {
  cleanup()
  ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL('about:blank')
  handed.length = 0
})

describe('the task view', () => {
  test('reads the conversation from the address, and only an id', () => {
    expect(taskSession(`?session=${A}`)).toBe(A)
    expect(taskSession('?session=--help')).toBeNull()
    expect(taskSession('')).toBeNull()
  })

  test('draws that conversation alone, attached to by its id, without waiting for a greeting', () => {
    ;(window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM.setURL(`http://127.0.0.1:8100/app?session=${A}`)
    const page = render(<App />)
    expect(page.container.querySelector('[data-terminal]')).not.toBeNull()
    expect(handed.at(-1)).toEqual({ what: 'watch', session: A })
  })
})
