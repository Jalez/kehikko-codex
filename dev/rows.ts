/**
 * The rows this module declares, from the real header and footer functions, for `kehikot-check-rows`
 * (protocol 2.70.0): one state per view a person meets. `bun dev/rows.ts` writes `kehikot.rows.json`;
 * `test/rows.test.ts` says when the file is behind the functions, and runs the check over it.
 */
import { writeFileSync } from 'node:fs'

import { resumeToggle, viewHeader } from '../src/view/conversations.ts'
import { footerItems, type FooterState } from '../src/view/footer.ts'

/** A fixed clock, so the file is the same on every run. */
const NOW = Date.UTC(2026, 10, 10, 12)
const row = (id: string, label: string, more: Record<string, unknown> = {}) => ({ id, label, lastActive: NOW - 5 * 60_000, running: true, ...more })
const quiet: FooterState = { line: null, moved: null, doors: null, ended: null, installFailed: null }
const header = (viewing: string | null) => [
  ...viewHeader({ rows: [row('a1', 'Write the intro', { state: 'working' }), row('b2', 'Fix the build')] as never, own: 'a1', viewing, now: NOW }),
  ...resumeToggle(true),
]

export const rows = [
  {
    name: 'a conversation on screen, live',
    header: header('a1'),
    footer: footerItems({ ...quiet, session: { state: 'working', label: 'Write the intro', how: null }, line: { context: null, ready: null, said: null } }),
    state: true,
  },
  {
    name: 'a new conversation, not connected yet',
    header: header(null),
    footer: footerItems({ ...quiet, session: { state: null, label: '', how: null }, unconnected: { copy: true, copied: null, started: true } }),
    state: true,
  },
  {
    name: 'the session ended, its folder renamed',
    header: header('b2'),
    footer: footerItems({ ...quiet, session: { state: null, label: 'Fix the build', how: null }, moved: { to: '/p/new', notMoved: null, working: false, canRestart: true }, ended: { why: 'The session ended.' } }),
    state: true,
  },
  {
    name: 'nothing connected, the program missing',
    header: [],
    footer: footerItems({ ...quiet, installFailed: { failed: 'exit 1', log: false } }),
    state: true,
  },
]

if (import.meta.main) {
  writeFileSync(new URL('../kehikot.rows.json', import.meta.url), `${JSON.stringify(rows, null, 2)}\n`)
  console.log(`kehikot.rows.json: ${rows.length} states`)
}
