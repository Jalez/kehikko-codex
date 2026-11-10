import { MANIFEST_KIND, PROTOCOL, manifestSchema, type Manifest } from 'kehikot-module-protocol'
import pkg from './package.json'
import { SETTINGS } from './settings.ts'
import { EVENTS } from './events.ts'
import { ID, NOTICES } from './ids.ts'

/* Written in ids.ts, which the page imports instead of this file; said here for everything else. */
export { ID, NOTICES }

/* This module's introduction (protocol 2.57.0): slides the host shows in its introduction dialog. Also
   read as a file from the repository, so a person can watch it before the module runs or is installed. */
import intro from './intro.json'

/** "How to use" (protocol 2.52.0). Each string one line of plain text. */
export const HELP = {
  summary: 'A terminal holding the Codex session that belongs to the place you are on: this project, its epic, the parts you picked and this kehikko.',
  sections: [
    {
      title: 'What it shows',
      points: [
        'Codex itself, in a terminal, for the place on screen: the project, its epic, the parts picked in the bar and this kehikko.',
        'The footer says what the conversation is doing (Working, Needs you or Finished), how full its context is, and holds Compact and Clear.',
        'In a container too small for a terminal, a tile: a ring for what the session is doing, and its title. Press it to see the session large; Answer replies to a waiting question with its choices.',
        'A new conversation it starts for a place becomes that place’s own by itself once you say something in it, at any size, the tile included. A bar says so while nothing is connected yet.',
      ],
    },
    {
      title: 'How to use it',
      points: [
        'Type in the session as you would anywhere. Pick other parts, another epic or another kehikko, and the session kept for that place opens.',
        'The Conversation chooser in the View menu lists this kehikko’s own conversation and the others here, with what each is doing; choose one to resume it, or New conversation, or Disconnect this conversation.',
        'Type $kehikot-here only in a conversation started elsewhere (a terminal, a background job) to connect it to the kehikko on screen. Copy $kehikot-here, in the footer, copies it for you.',
        'A question a session asks you, or a turn that ended, waits in Kehikot’s Inbox. Answer it there and the answer is typed into the session as yours.',
        'The module’s settings in Kehikot hold its choices, such as resuming conversations that a restart cut off.',
      ],
    },
    {
      title: 'What agents can do',
      points: [
        'sessions lists which sessions belong to which place, and whether each is working, waiting for you or finished.',
        'tell_finished says how a turn ended: done, research, or a decision for you with its choices, which then waits in the Inbox.',
        'send_message and read_messages let the sessions in a project write to each other. A message is typed into the receiving session, quoted as its sender’s.',
      ],
    },
    {
      title: 'Rules',
      points: [
        'The session is yours. No agent can type into it as you, start one or end one; another session’s message is typed in marked as theirs.',
        'A message is never typed into a session waiting for your answer, or with something typed and not sent: it waits.',
        'Codex keeps its own conversations. Which place each belongs to is kept in the project’s .kehikot folder.',
      ],
    },
  ],
}

/** The module's version: package.json's, the one place it is written. A release is tagged with it. */
export const VERSION: string = pkg.version

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
 * - **`reacts: ['parts']`**, **`scope: 'kehikko'`** (2.29.0): a session is kept for a place — this
 *   kehikko, the open epic and its picked parts.
 * - **`uses: ['activity:report']`** (1.5.0): the whole list of its sessions' states, for the Inbox;
 *   **`uses: ['events:emit']`, `emits: [NOTICES]`** for a host that does not answer the list.
 * - **`uses: ['view:expand']`** (protocol 2.58.0): in a container too small for a terminal the page
 *   is a tile, and pressing it asks the host to show the container large over the canvas. A host
 *   that does not answer the method is not asked: the tile shows the conversation in place.
 * - **`uses: ['agents:message']`** (protocol 2.41.0): `send_message` and `read_messages` on its door, a thin
 *   adapter over the host's messages between agent sessions, and a session's unread ones in its notes.
 *   A host before 2.41.0 keeps none: the door lists neither tool and the notes say nothing.
 * - **`agentSessions: { loadsSkills: true, installsSkills: true }`** (2.21.0, 2.23.0): it runs
 *   agent sessions and loads the kehikko-bound skills of the modules on a session's kehikko into
 *   them, and it installs skills itself, where Codex reads them (`~/.agents/skills`, agentSkills.ts):
 *   Codex has no folder for one process. A host routes the kehikko-bound skills here, tells it which
 *   skills it keeps for every conversation (`everywhere`), and installs none of this module's own
 *   skills for Claude Code.
 * - **`skills`**: its own `$kehikot-here`, written for Codex (doors.ts adds the list, whose versions
 *   follow the origin it serves on).
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
  /* The icon a host draws beside the name: a key of the protocol's module icons, the mark of the
     tool this module fronts (`BRAND_MODULE_ICONS`). */
  icon: 'brand:openai',
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
  /* "How to use" (protocol 2.52.0), and the introduction (protocol 2.57.0). */
  help: HELP,
  intro,
  entry: '/app',
  /* What its content belongs to (protocol 2.29.0): one mode per scope, the default first. */
  modes: [
    { id: 'codex', label: 'Codex', scope: 'kehikko', scopeSays: 'the Codex sessions kept for this kehikko, at the open epic and its picked parts' },
  ],
  mcp: {
    url: '/mcp',
    transport: 'http',
    as: 'kehikko-codex',
    about:
      'Which Codex sessions a person keeps for which place, and whether one is working, waiting or finished;'
      + ' tell_finished says how a turn ends: done, a decision, or research.',
  },
  extensions: { emits: [NOTICES], consumes: [] },
  reacts: ['parts'],
  /* Another module may ask for one of a place's conversations to be shown (`view.goto { show }`,
     protocol 2.28.0): Test runs, going to the session that queued a run. See `showStep`. */
  shows: ['agent-session'],
  /* "Research complete" (protocol 2.31.0): a finished turn or subagent that was research names it,
     and the host may give it a sound of its own. A case of `done`; an older host ignores it. See research.ts. */
  events: EVENTS,
  /* Its sessions run in its own process, so a restart of it ends them (protocol 2.33.0): a host does
     not restart it on its own account — an automatic update waits for them to end. */
  holds: ['live-sessions'],
  /* A terminal must not be resized by a hover (protocol 2.42.0): a resize is a SIGWINCH and Codex
     redraws its whole screen. The host's focus-mode header and footer come OVER the page instead, and
     the view keeps its last line above them (`src/view/keep-last.ts`). An older host ignores this. */
  reveal: 'over',
  declares: {
    protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`,
    uses: ['events:emit', 'activity:report', 'agents:message', 'view:expand', 'state:keep'],
    agentSessions: { loadsSkills: true, installsSkills: true },
    storage: true,
    prompt: false,
    settings: SETTINGS,
  },
  health: '/healthz',
})
