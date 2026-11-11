import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { PlacedGuard } from 'kehikot-module-protocol'

import { readKeptGuards, restartedSince, stableAddress, writeKeptGuards } from '../restarted.ts'

const scratch = mkdtempSync(join(tmpdir(), 'restarted-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

const queue = (rewrite: string): PlacedGuard => ({ module: 'kehikot.queue', name: 'Queue', guard: { id: 'heavy', tool: 'shell', match: { commands: ['tsc'] }, action: 'rewrite', rewrite, why: 'Queued.' } })

describe('a session that outlived a restart', () => {
  test('is told once per restart, never at its first marking', () => {
    const file = join(scratch, 'one', 'boot')
    expect(restartedSince(file, 'a')).toBe(false)
    expect(restartedSince(file, 'a')).toBe(false)
    expect(restartedSince(file, 'b')).toBe(true)
    expect(readFileSync(file, 'utf8')).toBe('b')
    expect(restartedSince(file, 'b')).toBe(false)
  })

  test("the stable address is the host's, read from doors written on it", () => {
    expect(stableAddress([{ url: 'http://127.0.0.1:4170/m/kehikot.queue/mcp?kehikot-place=x' }], 'kehikot.me')).toBe('http://127.0.0.1:4170/m/kehikot.me')
    expect(stableAddress([{ url: 'http://127.0.0.1:4170/mcp' }, { url: 'http://127.0.0.1:8110/mcp' }], 'kehikot.me')).toBeNull()
    expect(stableAddress([{ url: 'not a url' }], 'kehikot.me')).toBeNull()
  })

  test('the guards kept on disk come back old, so the host is asked first', () => {
    const file = join(scratch, 'kept', 'guards.json')
    writeKeptGuards(file, [queue('q run -- sh -c {command}')])
    expect(readKeptGuards(file)).toEqual({ at: 0, guards: [queue('q run -- sh -c {command}')] })
    expect(readKeptGuards(join(scratch, 'none.json'))).toBeNull()
  })
})
