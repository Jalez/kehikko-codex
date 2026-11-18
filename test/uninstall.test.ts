import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { readUninstallReport } from 'kehikot-module-protocol'

import { keep } from '../agentSkills.ts'

const ROOT = join(import.meta.dirname, '..')

describe('Uninstall takes away what this module wrote outside its folder', () => {
  test('uninstall.ts, run as Kehikot runs it: its untouched skills and its temporary folder go; a changed one and the person’s own stay', () => {
    const base = realpathSync(mkdtempSync(join(tmpdir(), 'codex-uninstall-')))
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: join(base, 'home'), CODEX_HOME: join(base, 'codex'), TMPDIR: join(base, 'tmp'), KEHIKOT_MODULES_DIR: join(base, 'modules') }
    for (const dir of [env.HOME!, env.CODEX_HOME!, env.TMPDIR!, env.KEHIKOT_MODULES_DIR!]) mkdirSync(dir, { recursive: true })
    const root = join(env.HOME!, '.agents', 'skills')
    const skill = (name: string) => ({ name, module: 'kehikot.notes', text: `---\nname: ${name}\ndescription: d\n---\nbody\n`, yaml: null, bound: false, everywhere: true })
    keep([skill('tidy'), skill('changed')], { root, holder: null, everywhere: new Set(['tidy', 'changed']) })
    writeFileSync(join(root, 'changed', 'SKILL.md'), 'the person wrote this\n')
    mkdirSync(join(root, 'theirs'), { recursive: true })
    writeFileSync(join(root, 'theirs', 'SKILL.md'), 'their own\n')
    const sessions = join(env.TMPDIR!, `kehikot-codex-${process.getuid?.() ?? 'user'}`)
    mkdirSync(sessions, { recursive: true })
    const run = () => readUninstallReport(execFileSync(process.execPath, ['uninstall.ts'], { cwd: ROOT, env, encoding: 'utf8' }))
    const report = run()
    expect(report?.removed).toEqual([
      { what: 'The $tidy skill it installed for Codex', path: join(root, 'tidy') },
      { what: 'Its session folders in the temporary directory', path: sessions },
    ])
    /* What its sessions were told with no folder of their own: nothing here, so nothing said. */
    expect(report?.left).toEqual([{ what: 'The $changed skill it installed for Codex', path: join(root, 'changed'), why: 'you changed it' }])
    expect(existsSync(join(root, 'tidy'))).toBe(false)
    expect(readFileSync(join(root, 'changed', 'SKILL.md'), 'utf8')).toBe('the person wrote this\n')
    expect(readFileSync(join(root, 'theirs', 'SKILL.md'), 'utf8')).toBe('their own\n')
    expect(existsSync(sessions)).toBe(false)
    expect(run()?.removed).toEqual([])
  })
})
