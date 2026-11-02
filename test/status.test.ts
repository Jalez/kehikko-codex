import { describe, expect, test } from 'bun:test'

import { StatusReader, readReport } from '../status.ts'

/** Codex's terminal program status reports (OSC 7501), as its TUI writes them (`terminal_program_status.rs`, rust-v0.166.0). */
const report = (state: string) => `\u001b]7501;state=${state}:app=codex\u001b\\`

describe('a report', () => {
  test('each state Codex writes, as where the session is', () => {
    expect(readReport('state=idle:app=codex')).toBe('idle')
    expect(readReport('state=working:app=codex')).toBe('busy')
    expect(readReport('state=blocked:app=codex:kind=permission')).toBe('waiting')
    expect(readReport('state=blocked:app=codex:kind=auth')).toBe('waiting')
    expect(readReport('state=done:app=codex')).toBe('idle')
    expect(readReport('state=error:app=codex')).toBe('idle')
  })

  test('clear, another program’s, or a word that is not a state, is nothing', () => {
    expect(readReport('state=clear')).toBeNull()
    expect(readReport('state=working:app=vibe')).toBeNull()
    expect(readReport('state=dancing:app=codex')).toBeNull()
  })
})

describe('reading a terminal’s output', () => {
  test('reports in order, with the screen around them left alone, a split one read once it ends', () => {
    expect(new StatusReader().feed(`\u001b[2J${report('idle')}hello${report('working')}`)).toEqual(['idle', 'busy'])
    const whole = report('blocked:kind=question')
    for (let at = 1; at < whole.length; at++) {
      const reader = new StatusReader()
      expect([...reader.feed(`x${whole.slice(0, at)}`), ...reader.feed(`${whole.slice(at)}y`)]).toEqual(['waiting'])
    }
  })
})
