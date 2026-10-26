import { describe, expect, test } from 'bun:test'

import { spawnPty, underBun } from '../pty.ts'

/**
 * The pty the built server uses: Bun's own (the same test as Terminal's). These run a real process on a real
 * pty, because what they hold the pty to — a size the program can read, bytes
 * that are characters, the exit code — is exactly what a fake would agree with.
 */
describe('spawnPty under Bun', () => {
  test('is Bun’s pty here', () => {
    expect(underBun).toBe(true)
  })

  test('a program sees its size, a resize, Unicode whole, and its exit code', async () => {
    const pty = await spawnPty('/bin/sh', ['-c', 'stty size; read line; stty size; printf "%s\\n" "$line"; exit 3'], {
      name: 'xterm-256color',
      cols: 90,
      rows: 30,
      cwd: '/',
      env: { ...process.env, LANG: 'en_US.UTF-8' },
    })
    let out = ''
    pty.onData((chunk) => {
      out += chunk
    })
    const exited = new Promise<number>((resolve) => pty.onExit(({ exitCode }) => resolve(exitCode)))
    for (let i = 0; i < 100 && !out.includes('30 90'); i++) await Bun.sleep(10)
    pty.resize(132, 43)
    pty.write('héllo ✓ 日本 🎉\r')
    expect(await exited).toBe(3)
    expect(out).toContain('30 90')
    expect(out).toContain('43 132')
    expect(out).toContain('héllo ✓ 日本 🎉')
    expect(out).not.toContain('�')
  })

  test('kill ends the program', async () => {
    const pty = await spawnPty('/bin/sh', ['-c', 'sleep 30'], { name: 'xterm-256color', cols: 80, rows: 24, cwd: '/', env: { ...process.env } })
    const exited = new Promise<number>((resolve) => pty.onExit(({ exitCode }) => resolve(exitCode)))
    pty.kill()
    expect(typeof (await exited)).toBe('number')
  })
})
