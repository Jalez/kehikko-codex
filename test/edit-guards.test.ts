import { describe, expect, test } from 'bun:test'
import { placedGuardsSchema } from 'kehikot-module-protocol'

import { guardAnswer, type EditFiles } from '../context.ts'
import { GUARD_MATCHER } from '../skills.ts'

/**
 * Edit guards through the protocol's one check (`checkToolCall`, protocol 2.80.0): Codex names its file
 * edits `apply_patch` to a PreToolUse hook, with the patch as `tool_input.command`; a module on the
 * kehikko refuses one that touches a file in a main checkout or under paths it names.
 */

const guards = placedGuardsSchema.parse([
  {
    module: 'kehikot.worktrees',
    name: 'Worktrees',
    guard: { id: 'main-checkout', tool: 'edit', match: { checkouts: ['main'], paths: ['~/Library/Application Support/Kehikot/installed/**'] }, action: 'deny', why: 'Work in a worktree: git worktree add ../<repo>-worktrees/<branch> -b <branch> origin/main' },
  },
])

const files: EditFiles = { home: '/Users/p', checkoutOf: (path) => (path.startsWith('/Users/p/Projects/app/') ? 'main' : path.startsWith('/Users/p/Projects/app-worktrees/') ? 'linked' : null) }
const patch = (...lines: string[]) => ({ tool_name: 'apply_patch', tool_input: { command: ['*** Begin Patch', ...lines, '*** End Patch', ''].join('\n') } })

describe('edit guards', () => {
  test('the hook is matched on the shell tools and apply_patch', () => {
    expect(GUARD_MATCHER).toBe('^(Bash|apply_patch)$')
  })

  test('a patch in a main checkout is refused with the module’s words', () => {
    for (const head of ['*** Update File:', '*** Add File:', '*** Delete File:']) {
      const answer = guardAnswer(patch(`${head} /Users/p/Projects/app/src/a.ts`, '+x'), guards, false, null, files)
      expect(answer?.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' })
      expect(JSON.stringify(answer)).toContain('git worktree add')
    }
  })

  test('a relative path is read against the session’s folder', () => {
    const answer = guardAnswer({ ...patch('*** Update File: src/a.ts'), cwd: '/Users/p/Projects/app' }, guards, false, null, files)
    expect(answer?.hookSpecificOutput).toMatchObject({ permissionDecision: 'deny' })
    expect(guardAnswer({ ...patch('*** Update File: src/a.ts'), cwd: '/Users/p/Projects/app-worktrees/x' }, guards, false, null, files)).toBeNull()
  })

  test('an installed module’s folder is refused, a worktree and elsewhere pass', () => {
    expect(guardAnswer(patch('*** Add File: /Users/p/Library/Application Support/Kehikot/installed/kehikot.queue/x.ts'), guards, false, null, files)).not.toBeNull()
    expect(guardAnswer(patch('*** Update File: /Users/p/Projects/app-worktrees/x/src/a.ts'), guards, false, null, files)).toBeNull()
    expect(guardAnswer(patch('*** Add File: /tmp/note.md'), guards, false, null, files)).toBeNull()
  })

  test('a move into a main checkout is refused', () => {
    expect(guardAnswer(patch('*** Update File: /Users/p/Projects/app-worktrees/x/a.ts', '*** Move to: /Users/p/Projects/app/a.ts'), guards, false, null, files)).not.toBeNull()
  })

  test('KEHIKOT_DIRECT in the session passes, and no edit guard means nothing is asked', () => {
    expect(guardAnswer(patch('*** Update File: /Users/p/Projects/app/a.ts'), guards, true, null, files)).toBeNull()
    expect(guardAnswer(patch('*** Update File: /Users/p/Projects/app/a.ts'), [], false, null, { home: null, checkoutOf: () => { throw new Error('not asked') } })).toBeNull()
  })

  test('an edit guard never touches a shell command', () => {
    expect(guardAnswer({ tool_name: 'Bash', tool_input: { command: 'echo x > /Users/p/Projects/app/a.ts' } }, guards, false, null, files)).toBeNull()
  })
})
