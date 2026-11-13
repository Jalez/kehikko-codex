import { afterAll, test } from 'bun:test'
import { chmodSync, copyFileSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

import { expectAgentConformance } from 'kehikot-module-protocol/testing'

import { answer } from '../doors.ts'
import { freshToken } from '../doorConfig.ts'
import { here, type HereNeeds } from '../here.ts'
import { Runs, headless, theRuns } from '../live.ts'
import { START_PATH, hostDoor } from '../hostServices.ts'
import { ID, MANIFEST } from '../manifest.ts'
import { placeKey } from '../place.ts'
import { PROGRAM, type Active, type Program } from '../program.ts'
import { assign, tokenFor } from '../record.ts'

/**
 * The shared agent-module conformance (protocol 2.96.0): messaging is the host's, and this module
 * proves which conversation is calling, delivers, and places a conversation started outside Kehikot
 * (`/kehikot-here`) with a key it can message with.
 */

const made: string[] = []
const dir = () => {
  const one = realpathSync(mkdtempSync(join(tmpdir(), 'kehikko-codex-conformance-')))
  made.push(one)
  return one
}
afterAll(() => {
  for (const one of made) rmSync(one, { recursive: true, force: true })
})


/**
 * Protocol 2.99.0, the END-TO-END proof of `agent.tasks` with no fake provider on this module's side:
 * the host's request goes through this module's real door (the vouch round trip to the stand-in host,
 * the body, the start), the real `Runs` and the real program.ts, which runs the stand-in codex
 * (test/stand-in) taking 20 s to boot. `start` must answer within a second, accepting; a stand-in that
 * fails must reach the host as `tasks.report` failed, with why; one that boots as started.
 */
function standIn(behaviour: { bootMs: number; fails?: boolean }): () => void {
  const bin = dir()
  for (const name of ['codex', 'codex.ts']) {
    copyFileSync(join(import.meta.dir, 'stand-in', name), join(bin, name))
    chmodSync(join(bin, name), 0o755)
  }
  const had = { PATH: process.env.PATH, STANDIN_BOOT_MS: process.env.STANDIN_BOOT_MS, STANDIN_BOOT_FAILS: process.env.STANDIN_BOOT_FAILS }
  process.env.PATH = `${bin}${delimiter}${process.env.PATH ?? ''}`
  process.env.STANDIN_BOOT_MS = String(behaviour.bootMs)
  if (behaviour.fails) process.env.STANDIN_BOOT_FAILS = '1'
  else delete process.env.STANDIN_BOOT_FAILS
  return () => {
    for (const [name, value] of Object.entries(had)) {
      if (value === undefined) delete process.env[name]
      else process.env[name] = value
    }
    for (const run of theRuns().sessions()) theRuns().end(run.id)
  }
}

/** A request from the host to `start`, through this module's real door. */
async function startThroughTheDoor(body: unknown, headers: Record<string, string>): Promise<{ status: number; body: unknown }> {
  const url = new URL(`http://127.0.0.1:1${START_PATH}`)
  const request = new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })
  const said = await hostDoor(() => ({ program: PROGRAM, runs: theRuns() }))(request)
  if (!said) return { status: 404, body: null }
  return { status: said.status, body: await said.json().catch(() => null) }
}

const OUTSIDE = '44444444-4444-4444-8444-444444444444'
const LAUNCHED = '55555555-5555-4555-8555-555555555555'
const WRITING = { epic: 'thesis', parts: [], kehikko: { key: 'k1a2b3c4' }, kehikkoName: 'writing' }

test('meets the agent-module conformance', async () => {
  const project = dir()
  const running: Active[] = [{ session: OUTSIDE, kind: 'interactive', called: 'interactive', handle: null, pid: 4242, cwd: project, startedAt: 1, name: '' }]
  const program: Program = {
    ...PROGRAM,
    find: () => ({ file: '/fake/bin/claude', looked: ['/fake/bin'], usual: [] }),
    supports: async () => ({ ok: true, missing: null, tells: false, lists: true, names: false, configures: false, plugins: false }),
    active: async () => ({ known: true, active: running }),
  }
  const runs = new Runs({ program, spawn: () => { throw new Error('nothing is started here') }, screen: headless, every: null, watchEvery: null })
  runs.feeds('page-conformance')
  runs.show('page-conformance', { projectPath: project, key: placeKey(WRITING), place: WRITING, onScreen: true })
  const needs: HereNeeds = {
    program,
    showingIn: (path) => runs.showingIn(path),
    knownProjects: () => [project],
    hostHas: async (folder) => folder === project,
    told: (path, assigned) => runs.told(path, assigned),
  }
  await expectAgentConformance({
    manifest: MANIFEST,
    door: (method, path, query, body) => answer(method, path, query, body, null),
    project,
    adopt: async () => ({ said: await here(OUTSIDE, '', needs), conversation: OUTSIDE }),
    launched: async (host) => {
      assign(project, WRITING, LAUNCHED, { own: false })
      const token = tokenFor(project, LAUNCHED, freshToken)!
      host.issued.set(token, { module: ID, project })
      return { token }
    },
    tasks: {
      start: startThroughTheDoor,
      program: async (behaviour) => standIn(behaviour),
    },
    /* A started task is reported once Codex names its conversation, or after TASK_SETTLE (20 s). */
    reportWithinMs: 30_000,
  })
}, 90_000)
