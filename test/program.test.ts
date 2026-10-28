import { afterAll, describe, expect, test } from 'bun:test'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, openSync, closeSync, realpathSync, rmSync, writeFileSync, symlinkSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { spawnSync } from 'node:child_process'

import { HOOK_KEYS, PROGRAM, deniedWrite, hasBrew, installFor, npmPrefix, TELLS, codexHome, firstPrompt, headOf, hookHash, home, learnSession, metaOf, nativeOf, readLsof, recordFile, sessionName } from '../program.ts'
import { CONFIG, HOME } from './setup.ts'

/**
 * The adapter, against a stand-in `codex` and a scratch `CODEX_HOME`.
 *
 * Nothing here runs the real program or reads a real record: `test/setup.ts` has already pointed
 * the home folder, `CODEX_HOME` and PATH at scratch.
 */

const STAND_IN = join(import.meta.dir, 'stand-in', 'codex')
const made: string[] = []
const scratch = (name: string) => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), `kehikko-codex-${name}-`)))
  made.push(dir)
  return dir
}
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
  rmSync(join(HOME, '.local'), { recursive: true, force: true })
  rmSync(join(CONFIG, 'sessions'), { recursive: true, force: true })
})

const A = '01a175cc-82f0-77b1-a11b-77a47b470116'
const B = '01a175cd-511f-7de0-b010-09ebe2616f33'

/** A rollout as Codex 0.164.0 writes one: the meta row, then the person's line. */
function rollout(id: string, cwd: string, said: string, more: Record<string, unknown> = {}): string {
  const dir = join(CONFIG, 'sessions', '2026', '10', '26')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, `rollout-2026-10-26T03-21-39-${id}.jsonl`)
  writeFileSync(
    file,
    [
      { timestamp: '2026-10-26T01:22:36.741Z', type: 'session_meta', payload: { id, cwd, source: 'cli', thread_source: 'user', base_instructions: 'You are Codex.'.repeat(500), ...more } },
      { timestamp: '2026-10-26T01:22:36.746Z', type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>…</environment_context>' }] } },
      { timestamp: '2026-10-26T01:22:36.766Z', type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: said }] } } },
    ].map((one) => JSON.stringify(one)).join('\n') + '\n',
  )
  return file
}

describe('finding the binary', () => {
  test('the test’s machine is scratch: a home of its own and Codex’s folder beside it', () => {
    expect(home()).toBe(HOME)
    expect(codexHome()).toBe(CONFIG)
  })

  test('on PATH first, then the usual places a thin PATH leaves out, the desktop app’s among them', () => {
    const bin = scratch('bin')
    copyFileSync(STAND_IN, join(bin, 'codex'))
    chmodSync(join(bin, 'codex'), 0o755)
    const found = PROGRAM.find({ HOME, PATH: `/nowhere:${bin}`, KEHIKOT_CODEX_TOOL_DIRS: '' })
    expect(found.file).toBe(join(bin, 'codex'))
    expect(found.looked).toEqual(['/nowhere', bin])
    const none = PROGRAM.find({ HOME, PATH: '/usr/bin:/bin', KEHIKOT_CODEX_TOOL_DIRS: '' })
    expect(none.file).toBeNull()
    expect(none.looked).toContain('/opt/homebrew/bin')
    expect(none.looked).toContain('/Applications/Codex.app/Contents/Resources')
  })

  test('an npm launcher is run as the binary behind it, so no `node` has to be on PATH', () => {
    const root = scratch('npm')
    const pkg = join(root, 'lib', 'node_modules', '@openai', 'codex')
    mkdirSync(join(pkg, 'bin'), { recursive: true })
    writeFileSync(join(pkg, 'bin', 'codex.js'), '#!/usr/bin/env node\n')
    chmodSync(join(pkg, 'bin', 'codex.js'), 0o755)
    const key = `${process.platform}-${process.arch}`
    const triple = { 'darwin-arm64': 'aarch64-apple-darwin', 'darwin-x64': 'x86_64-apple-darwin', 'linux-x64': 'x86_64-unknown-linux-musl', 'linux-arm64': 'aarch64-unknown-linux-musl' }[key]!
    const native = join(pkg, 'node_modules', '@openai', `codex-${key}`, 'vendor', triple, 'bin', 'codex')
    mkdirSync(join(native, '..'), { recursive: true })
    writeFileSync(native, '#!/bin/sh\n')
    chmodSync(native, 0o755)
    mkdirSync(join(root, 'bin'))
    symlinkSync(join(pkg, 'bin', 'codex.js'), join(root, 'bin', 'codex'))
    expect(nativeOf(join(root, 'bin', 'codex'))).toBe(native)
    expect(PROGRAM.find({ HOME, PATH: join(root, 'bin'), KEHIKOT_CODEX_TOOL_DIRS: '' }).file).toBe(native)
    /* Anything else is what it was. */
    expect(nativeOf(STAND_IN)).toBe(STAND_IN)
  })
})

describe('whether a copy can do what is asked of it', () => {
  test('one with `resume`, `--config` and hook trust can, and reports when its hooks are on', async () => {
    const able = await PROGRAM.supports(STAND_IN)
    expect(able).toMatchObject({ ok: true, missing: null, tells: true, lists: true, configures: true, plugins: true, backgrounds: false, names: false })
  })

  test('one with no `resume` is too old, and says what it lacks', async () => {
    const bin = scratch('old')
    writeFileSync(join(bin, 'codex'), `#!/bin/sh\nSTANDIN_OLD=1 exec ${JSON.stringify(STAND_IN)} "$@"\n`)
    chmodSync(join(bin, 'codex'), 0o755)
    expect(await PROGRAM.supports(join(bin, 'codex'))).toMatchObject({ ok: false, missing: 'resume' })
  })

  test('one whose hooks are off has no state, and is otherwise the same', async () => {
    const bin = scratch('nohooks')
    writeFileSync(join(bin, 'codex'), `#!/bin/sh\nSTANDIN_NOHOOKS=1 exec ${JSON.stringify(STAND_IN)} "$@"\n`)
    chmodSync(join(bin, 'codex'), 0o755)
    expect(await PROGRAM.supports(join(bin, 'codex'))).toMatchObject({ ok: true, tells: false, configures: true, plugins: false })
  })

  test('one whose help cannot be read is not called too old: nothing was learned, and nothing extra is passed', async () => {
    const bin = scratch('mute')
    writeFileSync(join(bin, 'codex'), '#!/bin/sh\nexit 3\n')
    chmodSync(join(bin, 'codex'), 0o755)
    expect(await PROGRAM.supports(join(bin, 'codex'))).toMatchObject({ ok: true, tells: false, configures: false })
  })
})

describe('starting and resuming', () => {
  test('a new session has no arguments of its own — Codex chooses the id; a resumed one is `resume <id>`', () => {
    expect(PROGRAM.fresh(A)).toEqual([])
    expect(PROGRAM.resume(A)).toEqual(['resume', A])
    expect(PROGRAM.resume(A, undefined, 'Kehikot restarted.')).toEqual(['resume', A, 'Kehikot restarted.'])
    /* A line that could read as a flag is not passed. */
    expect(PROGRAM.resume(A, undefined, '--yolo')).toEqual(['resume', A])
    expect(() => PROGRAM.resume('--last')).toThrow()
  })

  test('an id it mints is one it accepts, and what is not an id is refused', () => {
    expect(PROGRAM.isId(PROGRAM.newId())).toBe(true)
    expect(PROGRAM.isId(A)).toBe(true)
    for (const not of ['', '../x', '--last', 'A1A175CC-82F0-77B1-A11B-77A47B470116 ']) expect(PROGRAM.isId(not)).toBe(false)
  })

  test('the session’s environment does not say it is inside another Codex’s command', () => {
    const env = PROGRAM.environment({ PATH: '/bin', CODEX_THREAD_ID: A, CODEX_SANDBOX: 'seatbelt', CODEX_HOME: '/h', OPENAI_API_KEY: 'k' })
    expect(env).toEqual({ PATH: '/bin', CODEX_HOME: '/h', OPENAI_API_KEY: 'k' })
  })

  test('a session runs the person’s bun and node, never the ones the host put first on this module’s PATH', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'codex-person-env-'))
    try {
      const hostShim = join(scratch, 'kehikot-bun-1')
      const bunNode = join(scratch, 'bun-node-502-x')
      for (const dir of [hostShim, bunNode]) {
        mkdirSync(dir)
        symlinkSync(process.execPath, join(dir, 'bun'))
      }
      symlinkSync(process.execPath, join(bunNode, 'node'))
      const person = join(scratch, 'person')
      mkdirSync(person)
      writeFileSync(join(person, 'bun'), '#!/bin/sh\necho person-bun\n')
      chmodSync(join(person, 'bun'), 0o755)
      const env = PROGRAM.environment({
        PATH: [bunNode, hostShim, person, '/usr/bin', '/bin'].join(delimiter),
        KEHIKOT_HOST_PATH: hostShim,
        BUN_BE_BUN: '1',
        CODEX_THREAD_ID: A,
      })
      expect(env.BUN_BE_BUN).toBeUndefined()
      expect(env.KEHIKOT_HOST_PATH).toBeUndefined()
      expect(env.CODEX_THREAD_ID).toBeUndefined()
      expect(env.PATH).toBe([person, '/usr/bin', '/bin'].join(delimiter))
      const ran = spawnSync('/bin/sh', ['-c', 'command -v bun; bun --version'], { env, encoding: 'utf8' })
      expect(ran.stdout).toBe(`${join(person, 'bun')}\nperson-bun\n`)
    } finally {
      rmSync(scratch, { recursive: true, force: true })
    }
  })
})

describe('the hooks, given for one process and trusted for it alone', () => {
  test('the trust hash is the one Codex 0.164.0 wrote when the same hook was trusted in its /hooks screen', () => {
    /* Measured: `[hooks.state."/<session-flags>/config.toml:session_start:0:0"] trusted_hash = …` after "Trust all". */
    expect(hookHash('SessionStart', undefined, '/bin/sh /tmp/cx/scratch/hook/tell.sh SessionStart', 5)).toBe('sha256:a322356ad3ea596fa4afd4f50e015eb29c1d60298e33041aa149145ce8eb13a2')
  })

  test('each event is one `-c hooks.<Event>`, and one `-c hooks.state` trusts exactly those handlers by key and hash', () => {
    const args = PROGRAM.hookArgs([
      { event: 'Stop', commands: [{ command: "/bin/sh '/m/tell.sh' Stop", timeout: 5 }] },
      { event: 'UserPromptSubmit', commands: [{ command: 'a', timeout: 5 }, { command: 'b', timeout: 10 }] },
      { event: 'PreToolUse', matcher: '^request_user_input', commands: [{ command: 'q', timeout: 5 }] },
      { event: 'Interrupt', commands: [{ command: 'i', timeout: 5 }] },
    ])
    expect(args.filter((one) => one === '-c').length).toBe(5)
    expect(args).toContain('hooks.Stop=[{hooks=[{type="command",command="/bin/sh \'/m/tell.sh\' Stop",timeout=5}]}]')
    expect(args).toContain('hooks.UserPromptSubmit=[{hooks=[{type="command",command="a",timeout=5},{type="command",command="b",timeout=10}]}]')
    expect(args).toContain('hooks.PreToolUse=[{matcher="^request_user_input",hooks=[{type="command",command="q",timeout=5}]}]')
    /* Codex caps an Interrupt hook at three seconds. */
    expect(args).toContain('hooks.Interrupt=[{hooks=[{type="command",command="i",timeout=3}]}]')
    const state = args.at(-1)!
    expect(state.startsWith('hooks.state={')).toBe(true)
    expect(state).toContain(`"/<session-flags>/config.toml:user_prompt_submit:0:1"={trusted_hash="${hookHash('UserPromptSubmit', undefined, 'b', 10)}"}`)
    expect(state).toContain(`"/<session-flags>/config.toml:pre_tool_use:0:0"={trusted_hash="${hookHash('PreToolUse', '^request_user_input', 'q', 5)}"}`)
    /* Never the switch that would run the person's own untrusted hooks too. */
    expect(args.join(' ')).not.toContain('bypass')
    expect(PROGRAM.hookArgs([])).toEqual([])
  })

  test('what each report means: working, needs you, finished — and an interrupt is a turn that is over', () => {
    expect(PROGRAM.signal('UserPromptSubmit')).toBe('working')
    expect(PROGRAM.signal('PostToolUse')).toBe('working')
    expect(PROGRAM.signal('PermissionRequest')).toBe('needs-you')
    expect(PROGRAM.signal('AskUser')).toBe('needs-you')
    expect(PROGRAM.signal('Stop')).toBe('finished')
    expect(PROGRAM.signal('Interrupt')).toBe('finished')
    expect(PROGRAM.signal('SessionStart')).toBeNull()
    expect(PROGRAM.signal('constructor')).toBeNull()
    expect(TELLS.find((one) => one.says === 'AskUser')).toMatchObject({ event: 'PreToolUse', matcher: '^request_user_input' })
    expect(Object.keys(HOOK_KEYS)).toContain('Interrupt')
  })
})

describe('reading a project’s sessions', () => {
  test('the meta row says the folder and whether it is a person’s conversation', () => {
    const head = JSON.stringify({ type: 'session_meta', payload: { id: A, cwd: '/p', source: 'cli', thread_source: 'user' } })
    expect(metaOf(`${head}\n`)).toEqual({ id: A, cwd: '/p', source: 'cli', person: true })
    expect(metaOf(JSON.stringify({ type: 'session_meta', payload: { id: A, cwd: '/p', source: { subagent: 'x' } } }))?.person).toBe(false)
    expect(metaOf('{"type":"response_item"}')).toBeNull()
  })

  test('the label is the first line of the first thing a person said, as Codex noted it, and nothing else is read', () => {
    const text = [
      JSON.stringify({ type: 'response_item', payload: { type: 'message', role: 'user', content: [{ type: 'input_text', text: '<environment_context>' }] } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'tighten the methods\nsecond line' }] } } }),
      JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'later' }] } } }),
    ].join('\n')
    expect(firstPrompt(text)).toBe('tighten the methods')
    expect(firstPrompt(JSON.stringify({ type: 'event_msg', payload: { type: 'item_completed', item: { type: 'UserMessage', content: [{ type: 'text', text: 'x'.repeat(200) }] } } })).length).toBe(80)
  })

  test('a folder’s sessions, most recently active first, from wherever in the dated folders they are; `codex exec` runs are not conversations', async () => {
    const dir = scratch('project')
    rollout(A, dir, 'tighten the methods')
    rollout(B, dir, 'draft the results')
    rollout('01a175cd-0000-7000-8000-000000000001', dir, 'a script', { source: 'exec' })
    rollout('01a175cd-0000-7000-8000-000000000002', '/elsewhere', 'not here')
    const listed = await PROGRAM.sessions(dir)
    expect(listed.map((one) => one.id).sort()).toEqual([A, B].sort())
    expect(listed.find((one) => one.id === A)?.label).toBe('tighten the methods')
    /* A record the project names is found wherever it ran (a folder that was renamed). */
    expect((await PROGRAM.sessions(dir, ['01a175cd-0000-7000-8000-000000000002'])).map((one) => one.id)).toContain('01a175cd-0000-7000-8000-000000000002')
  })

  test('a session exists once Codex has a record of it; a new one is named by its own hooks', async () => {
    const dir = scratch('settle')
    /* Ids of this test's own: the scratch CODEX_HOME is shared with every other test file. */
    const opened = randomUUID()
    const chosen = randomUUID()
    expect(await PROGRAM.settled(dir, opened, 0)).toBeNull()
    learnSession(opened, chosen)
    expect(await PROGRAM.settled(dir, opened, 0)).toBeNull()
    rollout(chosen, dir, 'hello')
    expect(await PROGRAM.settled(dir, opened, 0)).toBe(chosen)
    expect(await recordFile(dir, '../etc')).toBeNull()
  })

  test('a conversation keeps one id: where it is now is that id', () => {
    expect(headOf(A)).toBe(A)
  })

  test('a place’s name is one line, never a flag', () => {
    expect(sessionName(['--x', 'thesis\nmethods'])).toBe('x · thesis methods')
  })
})

describe('which process holds which conversation', () => {
  test('lsof’s fields are read for the lock files and nothing else', () => {
    const said = readLsof(`p4545\nf46\nn/h/thread-writer-locks/${A}.lock\np77\nn/h/thread-writer-locks/not-a-lock\nn/h/thread-writer-locks/${B}.lock\n`)
    expect([...said]).toEqual([[A, 4545], [B, 77]])
  })

  test('a lock file a process holds is a conversation running there; one nobody holds is not', async () => {
    const dir = scratch('locks')
    const C = '01a175cf-2222-7222-8222-222222222222'
    rollout(C, dir, 'held')
    const locks = join(CONFIG, 'thread-writer-locks')
    mkdirSync(locks, { recursive: true })
    writeFileSync(join(locks, `${B}.lock`), '')
    const fd = openSync(join(locks, `${C}.lock`), 'a')
    try {
      const running = await PROGRAM.active('codex')
      expect(running.known).toBe(true)
      if (running.known) {
        expect(running.active.map((one) => one.session)).toEqual([C])
        expect(running.active[0]).toMatchObject({ kind: 'interactive', pid: process.pid, cwd: dir, handle: null })
      }
    } finally {
      closeSync(fd)
      rmSync(locks, { recursive: true, force: true })
    }
    expect(await PROGRAM.active('codex')).toEqual({ known: true, active: [] })
  })
})

/** A scratch folder holding an executable `name` that runs `body`. */
function tool(dir: string, name: string, body: string): void {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(dir, name), 0o755)
}
const executable = (file: string) => {
  mkdirSync(join(file, '..'), { recursive: true })
  writeFileSync(file, '#!/bin/sh\n')
  chmodSync(file, 0o755)
}

describe('finding it where an install lands', () => {
  test('in ~/.local/bin, which a thin PATH leaves out', () => {
    const home = scratch('home')
    executable(join(home, '.local', 'bin', 'codex'))
    const found = PROGRAM.find({ HOME: home, PATH: '/usr/bin:/bin', KEHIKOT_CODEX_TOOL_DIRS: '' })
    expect(found.file).toBe(join(home, '.local', 'bin', 'codex'))
    expect(found.usual[0]).toBe(join(home, '.local', 'bin'))
  })

  test('in the bin folder of npm’s own global prefix, as `npm prefix -g` says it', () => {
    const root = scratch('prefix')
    const prefix = join(root, 'custom-prefix')
    tool(join(root, 'tools'), 'npm', `[ "$1 $2" = "prefix -g" ] && echo ${prefix}`)
    executable(join(prefix, 'bin', 'codex'))
    const env = { HOME: root, PATH: join(root, 'tools'), KEHIKOT_CODEX_TOOL_DIRS: '' }
    expect(npmPrefix(env)).toBe(prefix)
    const found = PROGRAM.find(env)
    expect(found.file).toBe(join(prefix, 'bin', 'codex'))
    expect(found.usual).toContain(join(prefix, 'bin'))
  })

  test('npm that cannot say, or is not there, is no reason to fail', () => {
    const root = scratch('nonpm')
    expect(npmPrefix({ HOME: root, PATH: '/nonexistent', KEHIKOT_CODEX_TOOL_DIRS: '' })).toBeNull()
    tool(join(root, 'tools'), 'npm', 'exit 1')
    expect(PROGRAM.find({ HOME: root, PATH: join(root, 'tools'), KEHIKOT_CODEX_TOOL_DIRS: '' }).file).toBeNull()
  })

  test('a binary that appears after the first look is found by the next one, without a restart', () => {
    const home = scratch('later')
    const env = { HOME: home, PATH: '/usr/bin:/bin', KEHIKOT_CODEX_TOOL_DIRS: '' }
    expect(PROGRAM.find(env).file).toBeNull()
    executable(join(home, '.local', 'bin', 'codex'))
    expect(PROGRAM.find(env).file).toBe(join(home, '.local', 'bin', 'codex'))
  })
})

describe('installing', () => {
  test('without admin rights: into the home folder when there is no Homebrew', () => {
    const root = scratch('nobrew')
    const env = { HOME: root, PATH: '/usr/bin:/bin', KEHIKOT_CODEX_TOOL_DIRS: '' }
    expect(hasBrew(env)).toBe(false)
    expect(PROGRAM.install(env)).toMatchObject({ line: 'npm install -g --prefix ~/.local @openai/codex', lands: '~/.local/bin', source: 'https://developers.openai.com/codex/cli' })
  })

  test('with Homebrew on PATH, or in a usual prefix, its cask', () => {
    const root = scratch('brew')
    tool(join(root, 'bin'), 'brew', 'exit 0')
    expect(PROGRAM.install({ HOME: root, PATH: join(root, 'bin'), KEHIKOT_CODEX_TOOL_DIRS: '' }).line).toBe('brew install --cask codex')
    const prefix = scratch('prefix-brew')
    tool(prefix, 'brew', 'exit 0')
    expect(installFor({ HOME: root, PATH: '/usr/bin:/bin', KEHIKOT_CODEX_TOOL_DIRS: prefix }).line).toBe('brew install --cask codex')
  })

  test('never sudo, and never npm’s own configuration', () => {
    for (const dirs of ['', '/nowhere']) {
      const line = PROGRAM.install({ HOME, PATH: '/usr/bin:/bin', KEHIKOT_CODEX_TOOL_DIRS: dirs }).line
      expect(line).not.toMatch(/sudo|npm config|\bset\b/)
    }
  })

  test('is run with the places npm and brew live on its PATH', () => {
    const env = PROGRAM.installEnvironment({ PATH: '/usr/bin' })
    expect(env.PATH).toContain('/opt/homebrew/bin')
    expect(env.PATH!.startsWith('/usr/bin')).toBe(true)
  })

  test('a stand-in can be named by whoever started the server', () => {
    expect(PROGRAM.install({ KEHIKOT_CODEX_INSTALL_LINE: 'sh stand-in.sh' }).line).toBe('sh stand-in.sh')
  })
})

describe('when the install did not finish', () => {
  const EACCES = [
    'npm error code EACCES',
    'npm error syscall mkdir',
    "npm error path /usr/local/lib/node_modules/@openai",
    "npm error errno -13",
    "npm error Error: EACCES: permission denied, mkdir '/usr/local/lib/node_modules/@openai'",
    'npm error     at async mkdir (node:internal/fs/promises:857:10)',
  ].join('\r\n')
  const OLD_LINE = 'npm install -g @openai/codex'
  const noBrew = { HOME, PATH: '/usr/bin:/bin', KEHIKOT_CODEX_TOOL_DIRS: '' }

  test('EACCES is known by its code and by its words, through the terminal’s colours', () => {
    expect(deniedWrite(EACCES)).toBe(true)
    expect(deniedWrite('\u001b[1mEACC\u001b[0mES')).toBe(true)
    expect(deniedWrite('\u001b[31mnpm error\u001b[0m EACCES')).toBe(true)
    expect(deniedWrite('Error: permission denied, open')).toBe(true)
    expect(deniedWrite('npm error 404 Not Found')).toBe(false)
  })

  test('is said plainly, with the home-folder command, and without npm’s trace', () => {
    const said = PROGRAM.explain(EACCES, 243, OLD_LINE, noBrew)
    expect(said).toBe("npm can't write to /usr/local without admin rights. Install into your home folder instead: npm install -g --prefix ~/.local @openai/codex")
    expect(said).not.toMatch(/node:internal|at async|errno/)
  })

  test('offers the Homebrew one instead when Homebrew is here', () => {
    const root = scratch('explain-brew')
    tool(join(root, 'bin'), 'brew', 'exit 0')
    const said = PROGRAM.explain(EACCES, 243, OLD_LINE, { HOME: root, PATH: join(root, 'bin'), KEHIKOT_CODEX_TOOL_DIRS: '' })
    expect(said).toContain('Install into your home folder instead: brew install --cask codex')
  })

  test('a refusal of the home-folder command itself does not send the person round again', () => {
    const said = PROGRAM.explain("EACCES: permission denied, mkdir '/Users/x/.local/lib/node_modules/@openai'", 243, 'npm install -g --prefix ~/.local @openai/codex', noBrew)
    expect(said).toContain('/Users/x/.local')
    expect(said).not.toContain('Install into your home folder instead')
  })

  test('other endings are said in a sentence with the next step', () => {
    expect(PROGRAM.explain('', 0, 'x', noBrew)).toContain('See the log')
    expect(PROGRAM.explain('sh: npm: command not found', 127, OLD_LINE, noBrew)).toContain('npm was not found')
    expect(PROGRAM.explain('boom', 7, 'brew install --cask codex', noBrew)).toBe('The installer exited with 7. See the log, or run brew install --cask codex in a terminal.')
  })
})
