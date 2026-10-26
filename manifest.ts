import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'kehikot-module-protocol'
import pkg from './package.json'
import { SETTINGS } from './settings.ts'

export const ID = 'kehikot.codex'
/** The module's version: package.json's, the one place it is written. A release is tagged with it. */
export const VERSION: string = pkg.version

/**
 * The format a notice is sent in: the protocol's own, by its name. Whatever
 * on the canvas says it shows these is who hears — this module does not know
 * what that is, and names no module.
 */
export const NOTICES = 'kehikot.notifications@1'

/**
 * Where this module would like to answer. Said once, here, and read by `vite.config.ts` and
 * `register.ts`. Modules on this machine sit ten apart; 8100 is past every number Kehikot's
 * official list and this machine's registry give out (8060 Kanban, 8070 Monitor, 8080 is avoided,
 * 8090 Screenplay), and was free when it was chosen.
 *
 * A preference and not a promise: `live.ts` checks a handshake's `Origin` and `Host` against the
 * port this server actually bound, which `vite.config.ts` reads off the listening socket.
 */
export const PREFERRED_PORT = 8100

/**
 * What this app says about itself when a host asks.
 *
 * ## What it is
 *
 * A terminal with one program in it: the Codex CLI session that belongs to the place the person is
 * looking at. The sibling of the Claude module (`kehikot.claude`), with the same promises: a
 * session belongs to the epic, the parts picked out of it and the kehikko, and moves when any of
 * them does.
 *
 * ## What is declared
 *
 * - **`reacts: ['parts']`**, **`scope: 'epic'`**: the picked parts and the epic are what a place is.
 * - **`uses: ['activity:report']`** (1.5.0): the whole list of its sessions' states, for the Inbox;
 *   **`uses: ['events:emit']`, `emits: [NOTICES]`** for a host that does not answer the list.
 * - **`agentSessions: { loadsSkills: true }`** (2.21.0): it runs agent sessions and loads the
 *   kehikko-bound skills of the modules on a session's kehikko into them (skills.ts). A host
 *   routes those skills to whichever module says so.
 * - **No `skills`.** Its own `$kehikot-here` is written for Codex, and a host installs a declared
 *   skill into Claude Code's skills folder; a session started here is given it directly.
 * - **`mcp.as: 'kehikko-codex'`**: the id would derive `codex`, the name of the program an agent
 *   is likely to be, and a door called that reads as the agent's own.
 * - **`prompt: false`**: nothing here sends a prompt to anything. The person types.
 * - **`storage: true`**: the page opens a WebSocket to its own origin.
 * - **An MCP door with one tool that reads**: which sessions belong to which place.
 * - **`settings`** (2.15.0): resuming conversations a restart cut off, the model, its effort and
 *   when Codex asks before acting — each a person's (settings.ts).
 */
export const MANIFEST: Manifest = manifestSchema.parse({
  kind: MANIFEST_KIND,
  protocol: PROTOCOL,
  id: ID,
  name: 'Codex',
  /* The icon a host draws beside the name: a key of the protocol's module icons. The protocol has
     no OpenAI mark (`BRAND_MODULE_ICONS`), so a neutral Lucide one no other module uses. */
  icon: 'lucide:bot',
  version: VERSION,
  /* The format of `.kehikot/codex/places.json`. Raise it only in the release
     that first writes data an older release cannot read. */
  dataVersion: 1,
  summary: 'A terminal holding the Codex session that belongs to this epic, these parts and this kehikko.',
  tags: ['agents', 'code'],
  guidance:
    'A person on this canvas has a Codex CLI session open in a terminal, kept for exactly the epic, the picked '
    + 'parts and the kehikko in front of them. It is theirs: they type in it, and nothing here lets you type into it, '
    + 'start one or end one. Call `sessions` with the project path to see which sessions belong to which place — '
    + 'their first prompt, when each was last active, and whether a running one is working, waiting for its person '
    + 'or finished — before starting work that one of them may already hold. Call `sessions` with `place` to be told '
    + 'in words what a place holds.',
  entry: '/app',
  modes: [{ id: 'codex', label: 'Codex', scope: 'epic' }],
  mcp: {
    url: '/mcp',
    transport: 'http',
    as: 'kehikko-codex',
    about:
      'Which Codex sessions a person keeps for which place (epic, picked parts, kehikko), and whether'
      + ' a running one is working, waiting for them or finished. Read-only: starts, ends and types nothing.',
  },
  extensions: { emits: [NOTICES], consumes: [] },
  reacts: ['parts'],
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['events:emit', 'activity:report'],
    agentSessions: { loadsSkills: true },
    storage: true,
    prompt: false,
    settings: SETTINGS,
  },
  health: '/healthz',
})
