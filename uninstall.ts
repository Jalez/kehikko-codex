#!/usr/bin/env bun
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { removeOwned, runUninstall } from 'kehikot-module-protocol/serve'

import { agentsSkillsDir, removeAll } from './agentSkills.ts'
import { configDirOf } from './doorConfig.ts'

/**
 * What this module wrote outside its own folder, taken away when a person uninstalls it (protocol
 * 2.108.0, `uninstall.ts`). Kehikot runs this after the module is stopped and before its folder is
 * deleted, and says the report to the person.
 *
 *  - The skills it installed where Codex reads them (`~/.agents/skills`, `agentSkills.ts`): only a
 *    folder with this module's marker that nobody changed. One the person changed stays, and is said.
 *  - Its folder in this user's temporary directory: its sessions' doors, skills and notes. Nothing
 *    runs there once the module is stopped.
 *
 * Codex's own configuration (`~/.codex`) is never written by this module, so nothing there is touched;
 * a conversation's history is the person's.
 */
await runUninstall([
  () => {
    const root = agentsSkillsDir()
    const done = removeAll(root)
    return {
      removed: done.removed.map((name) => ({ what: `The $${name} skill it installed for Codex`, path: join(root, name) })),
      left: done.edited.map((name) => ({ what: `The $${name} skill it installed for Codex`, path: join(root, name), why: 'you changed it' })),
    }
  },
  () => removeOwned(configDirOf(), 'Its session folders in the temporary directory'),
  () => removeOwned(join(tmpdir(), 'kehikot-codex-told'), 'What its sessions were told, in the temporary directory'),
])
