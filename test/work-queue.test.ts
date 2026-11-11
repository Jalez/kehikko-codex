import { afterAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { ServiceProvider, WorkQueue } from 'kehikot-module-protocol'

import { unguardedHook } from '../context.ts'
import { WORK_QUEUE_FRESH_MS, WorkQueueLookup, readKeptWorkQueue, restartNote, unguardedSaid } from '../workQueue.ts'

const scratch = mkdtempSync(join(tmpdir(), 'work-queue-'))
afterAll(() => rmSync(scratch, { recursive: true, force: true }))

/** A provider of `work.queue` under made-up words: everything said must come from these. */
const LINE = "'/opt/Lane Keeper/bin/lane' take --kind verify -- {command}"
const DESCRIPTOR: WorkQueue = { name: 'Lane Keeper', run: { test: LINE }, cli: "'/opt/Lane Keeper/bin/lane'", tool: 'lane_take', direct: 'LANE_SKIP=1', marks: [] }
const provider = (descriptor: unknown = DESCRIPTOR): ServiceProvider => ({ module: 'kehikot.lanes', name: 'Lanes', descriptor, placed: null })

describe('what a session is told about a work queue comes from its descriptor', () => {
  test('after a restart: its name, its tool and its run line', () => {
    const note = restartNote(DESCRIPTOR, 'Type /mcp reconnect all.')
    expect(note).toContain('Kehikot restarted since your last turn')
    expect(note).toContain('(lane_take and the others)')
    expect(note).toContain('through Lane Keeper from the shell')
    expect(note).toContain("`'/opt/Lane Keeper/bin/lane' take --kind verify -- <command>`")
    expect(note).toEndWith('Type /mcp reconnect all.')
  })

  test('after a restart with no work queue: no queue is mentioned', () => {
    const note = restartNote(null, null)
    expect(note).toContain('Kehikot restarted since your last turn')
    expect(note).not.toMatch(/queue/i)
  })

  test('a queue that takes no tests is given its first kind of work', () => {
    expect(restartNote({ ...DESCRIPTOR, run: { build: 'b -- {command}' } }, null)).toContain('`b -- <command>`')
  })

  test('when the guards went unasked: the queue’s words, or none', () => {
    expect(unguardedSaid(DESCRIPTOR)).toContain("through Lane Keeper yourself: `'/opt/Lane Keeper/bin/lane' take --kind verify -- <command>`")
    expect(unguardedSaid(null)).toBe('Kehikot did not answer (it may be restarting), so this command ran without the guards of the modules on your kehikko.')
    const hook = JSON.parse(unguardedHook(DESCRIPTOR))
    expect(hook).toEqual({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: unguardedSaid(DESCRIPTOR) } })
    expect(unguardedHook(null)).not.toMatch(/queue/i)
  })
})

describe('the work queue the host names', () => {
  test('is asked once while fresh, again when old; a descriptor that does not parse is none', async () => {
    let now = 1_000
    let asked = 0
    let answer: ServiceProvider[] | null = [provider({ name: 'Broken' }), provider()]
    const lookup = new WorkQueueLookup(async () => (asked++, answer), null, () => now)
    expect(lookup.current()).toBeNull()
    expect(await lookup.fresh()).toEqual(DESCRIPTOR)
    expect(asked).toBe(1)
    expect(await lookup.fresh()).toEqual(DESCRIPTOR)
    expect(asked).toBe(1)
    /* No answer keeps what was found. */
    now += WORK_QUEUE_FRESH_MS
    answer = null
    expect(await lookup.fresh()).toEqual(DESCRIPTOR)
    expect(asked).toBe(2)
    /* An answer of none forgets it, and says so. */
    const changed: (WorkQueue | null)[] = []
    lookup.onChange((queue) => changed.push(queue))
    answer = []
    expect(await lookup.fresh()).toBeNull()
    expect(changed).toEqual([null])
  })

  test('is kept on disk, for a process that starts while the host is away', async () => {
    const file = join(scratch, 'kept', 'work-queue.json')
    await new WorkQueueLookup(async () => [provider()], file).fresh()
    expect(readKeptWorkQueue(file)).toEqual(DESCRIPTOR)
    const next = new WorkQueueLookup(async () => null, file)
    expect(next.current()).toEqual(DESCRIPTOR)
    expect(await next.fresh()).toEqual(DESCRIPTOR)
  })
})

describe('no module is named', () => {
  /** This module's own code and what it puts in a session: every source file but the tests. */
  function sources(dir: string, top = true): string[] {
    const out: string[] = []
    for (const name of readdirSync(dir)) {
      if (['node_modules', 'test', 'dist', 'notes', '.git', '.github'].includes(name) || name.startsWith('.')) continue
      const path = join(dir, name)
      if (statSync(path).isDirectory()) {
        if (!top || ['src', 'plugin', 'hooks', 'dev'].includes(name)) out.push(...sources(path, false))
      } else if (/\.(ts|tsx|js|mjs|sh)$/.test(name) || (name.endsWith('.json') && !['package.json', 'tsconfig.json', 'components.json'].includes(name))) out.push(path)
    }
    return out
  }

  test('no queue module’s name, program, tools or id is spelled outside the tests', () => {
    const root = join(import.meta.dirname, '..')
    const files = sources(root)
    expect(files.length).toBeGreaterThan(10)
    expect(files.some((file) => file.endsWith('guard.sh'))).toBe(true)
    const found = files.flatMap((file) =>
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap((line, i) => (/kehikot-queue|queue_run|queue_wait|kehikot\.queue|\bQueue\b/.test(line) ? [`${file.slice(root.length + 1)}:${i + 1}: ${line.trim()}`] : [])),
    )
    expect(found).toEqual([])
    expect(existsSync(join(root, 'workQueue.ts'))).toBe(true)
  })
})
