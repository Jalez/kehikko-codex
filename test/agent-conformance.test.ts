import { afterAll, test } from 'bun:test'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { expectAgentConformance } from 'kehikot-module-protocol/testing'

import { answer } from '../doors.ts'
import { freshToken } from '../doorConfig.ts'
import { here, type HereNeeds } from '../here.ts'
import { Runs, headless } from '../live.ts'
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
  })
})
