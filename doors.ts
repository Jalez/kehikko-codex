import { PROJECT_ID, doorContext, manifestSchema, type Manifest } from 'kehikot-module-protocol'
import { answerMessageTool, messageToolsFor, establishBuild, hostHasProject, hostVouches, refuseTicket, sameTicket, settingsDoor, type Reply, type Stream } from 'kehikot-module-protocol/serve'
import { SETTINGS, SETTINGS_FILE, settingIssue } from './settings.ts'

import { TICKET, elsewhereOf, sameProject, theRuns, type Elsewhere, type Run, type Runs } from './live.ts'
import { ID, MANIFEST as DECLARED, VERSION } from './manifest.ts'
import { isKehikkoKey, kehikkoOf, placeKey, readPlaceKey, type Place } from './place.ts'
import { PROGRAM, headOf, home, type Program, type Recorded, type Running, type State } from './program.ts'
import { PLACE_TOKEN, WHERE, assign, detach, follow, homeOf, ownOf, projectRoot, readPlaces, readSettings, recordedIds, rekey, sessionsAt, writeSettings, type Places } from './record.ts'
import { here } from './here.ts'
import { EVENT_IDS } from './events.ts'
import { isSkillPath, serveFrom, skillAt, skillDeclarations } from './skills.ts'
import { contextWords, costSaid, percentOf, type Context } from './meter.ts'

/**
 * The HTTP doors, as one function: `answer` takes a request and returns a
 * status and a body, or `null` for "not ours, let Vite have it". `doors()` in
 * vite.config.ts is the only thing that touches a socket, which is what lets
 * the tests call this directly.
 *
 * Almost everything this module does happens on the socket in `live.ts`.
 * What is here is what the page needs to know BEFORE it opens one — which
 * sessions this place has, whether the program is installed — and the two
 * things a person can do to a session that are not typing into it.
 *
 * ## Reads carry the ticket too
 *
 * `GET /api/place` says what somebody has been working on: the first line of
 * each session's first prompt, and when. Terminal deleted the one door it had
 * like that (`/api/chats`) and was right to. This one is needed — it is the
 * list the person chooses from — so it is fenced the way a write is: the
 * ticket this process printed into its own page. The MCP door says the same
 * things to an agent without one, because an agent has no page to have been
 * handed a ticket by; what fences that is what fences every module's MCP
 * door, the loopback bind and the absence of any CORS header.
 *
 * ## Nothing here starts anything
 *
 * A session is started by the socket's first frame, from the page, and the
 * installer by a press in the page. No door below runs a program, and the MCP
 * door has one tool, which reads.
 *
 * ## One door is not the page's
 *
 * `POST /api/state` is where a session's own program says what it is doing
 * (see "Told, not read" in live.ts). It carries no page ticket and is not
 * asked for one: what it must carry is the secret of the one session it
 * speaks for, in the same header. It answers 204 to a report it took and 403
 * to everything else — a wrong secret, no secret, a session that is not
 * running — in one sentence that does not say which. It reads no body, and
 * nothing in a report is stored or shown.
 */

export { TICKET }

/**
 * The manifest as served: the one in manifest.ts with the skills this module offers (skills.ts),
 * written for Codex. It installs them itself (`installsSkills`), so a host shows them and installs
 * none of them for Claude Code.
 */
export const MANIFEST: Manifest = manifestSchema.parse({ ...DECLARED, declares: { ...DECLARED.declares, skills: skillDeclarations() } })

/**
 * Say the origin this process really serves on, once it is listening (vite.config.ts): the skills'
 * text is filled in for it, and the versions the manifest declares follow. In place, because the
 * manifest `doors()` serves is this object's `declares`, read on every request.
 */
export function servingAt(origin: string): void {
  serveFrom(origin)
  const skills = MANIFEST.declares?.skills
  if (skills) skills.splice(0, skills.length, ...skillDeclarations())
}

/** The paths `answer` and `stream` are asked about, under Vite (`doors()`) and the built server (`run`) alike. */
export const ours = (path: string): boolean => path === '/healthz' || path === '/mcp' || path.startsWith('/api/') || isSkillPath(path)

/** The largest body a door reads. */
export const MOST_READ = 64 * 1024

/** Whether the host holds a folder as a project: the protocol's question, here so a test can stand a host in. */
export const hostCheck = { has: (folder: string) => hostHasProject(folder) }

/** What this process is built from, said in the manifest, at `/healthz`, in the page and on every answer. */
export const BUILD = establishBuild({ version: VERSION, dir: import.meta.dirname })

const ok = (body: unknown): Reply => ({ status: 200, body })
const bad = (why: string, status = 400): Reply => ({ status, body: { ok: false, error: why } })

/**
 * This project's settings at the module's door, for the host (protocol 2.15.0): `settings.get` and
 * `settings.set` at `/api/kehikot/settings`, over the same `.kehikot/codex/settings.json` the
 * page's toggle writes. A program's door like `/api/kehikot/place`, for a project the host holds.
 * "Resume conversations cut off by a restart" is the person's: a change is taken only with the
 * page's ticket or a pass the host vouches for, asked of the origins the host started this module
 * with (`KEHIKOT_ORIGINS`), never of an address a request names.
 */
const settings = settingsDoor({
  module: ID,
  fields: SETTINGS,
  ticket: TICKET,
  vouch: (pass, about) => hostVouches(pass, about, { env: process.env }),
  read: async (project) => {
    const root = projectRoot(project)
    if (!root.ok) return { values: {}, problem: root.error }
    if (!(await hostCheck.has(root.value))) return { values: {}, problem: `${root.value} is not a project open in Kehikot.` }
    return { values: { ...readSettings(root.value) }, file: SETTINGS_FILE }
  },
  write: async (project, key, value) => {
    const root = projectRoot(project)
    if (!root.ok) return root.error
    if (!(await hostCheck.has(root.value))) return `${root.value} is not a project open in Kehikot.`
    const issue = settingIssue(key, value)
    if (issue) return issue
    const written = writeSettings(root.value, { ...readSettings(root.value), [key]: value })
    return written.ok ? null : written.error
  },
})

/** One session, as a row in a list. */
export interface Row {
  id: string
  /** What it is called: its name, else Codex's title for it, else its first prompt. `''` when it has none yet. */
  label: string
  /** The first line of its first prompt, when that is not already the label. */
  firstPrompt?: string
  /** The last thing its person said. */
  lastPrompt?: string
  /** The pull requests it opened or pushed to, newest last. */
  prs?: { number: number; url: string }[]
  /** Milliseconds, or null when nothing is known. */
  lastActive: number | null
  /** Whether this module is running it now. */
  running: boolean
  /**
   * What its program last said it is doing, and since when — for one that is
   * running and has said. Absent otherwise: a copy too old to say, a session
   * nobody has spoken to yet, one that is not running.
   */
  state?: State
  since?: number
  /**
   * Set when the record lists it for this place and Codex has nothing
   * by that id on this computer: it ran on another one, or its transcript has
   * been cleaned away here. It cannot be opened, and is shown so that the
   * list agrees with the file.
   */
  missing?: true
  /**
   * Set when Codex is running it in a process this module did not
   * start, as the program itself said a moment ago (`agents --json`):
   * `background` is a session with no terminal, and opening it here attaches
   * to it — no second process; anything else is open in a terminal or an
   * editor, cannot be attached to, and opening it here asks first. Absent
   * when nothing else has it, and when the program cannot be asked.
   */
  elsewhere?: Elsewhere
  /**
   * For one this module is running: `background` when what runs here is a
   * view of a background session, `copy` when a person opened it here beside
   * another process that has it too. Absent for a session that is only here.
   */
  as?: 'background' | 'copy'
  /**
   * How full its context window is, its model, cost and compactions, as its transcript and — for
   * one started here — its own status line say (meter.ts). Only on the place's own rows; absent
   * when nothing is known.
   */
  context?: Context
  /**
   * Among the project's others: the places of the SAME EPIC that already
   * hold this session — under other parts, or on another kehikko — in words.
   * Those are the ones most likely to be wanted, and they are listed first.
   */
  near?: string[]
  /**
   * Among the project's others: it belongs to no place (never assigned, or taken off one with
   * "Disconnect from this kehikko") and was not said to be no Kehikot conversation. These are the
   * ones the Go menu offers to connect here.
   */
  unplaced?: true
}

export interface Listing {
  ok: true
  program: {
    name: string
    /** The binary, or null when it was not found. `foundAt` is the same with the home folder as `~`. */
    found: string | null
    foundAt: string | null
    looked: string[]
    /** The same, short enough for one sentence: PATH as one word, then the usual places. */
    where: string
    /** What an installed copy lacks, when it is too old to use. Null otherwise. */
    lacks: string | null
    install: { line: string; lands: string }
    /**
     * Whether the program could be asked what is running elsewhere: `yes`, or
     * why not. `too-old` is a copy from before `agents --json` and `attach`;
     * its rows never say `elsewhere`, which is then not the same as nothing
     * running elsewhere.
     */
    asked: 'yes' | 'too-old' | 'failed'
  }
  /** The sessions of this place, in the order they were added. */
  sessions: Row[]
  /** The one last open here, which opens directly. Null, or absent, when the place has none. */
  current?: string | null
  /** This place's OWN conversation: the one its frame names as its own. Null when it has none. */
  own?: string | null
  /** Where each listed conversation belongs, by id, when it belongs to another place: that place in a few words. */
  homes?: Record<string, string>
  /** Whether sessions started outside Kehikot are reported here (the SessionStart hook is installed). */
  hook?: boolean
  /**
   * The project's other sessions: they belong to no place, or to another.
   * The ones another place of this epic holds first (`near`), then the rest,
   * each by when it was last active.
   */
  others: Row[]
  /**
   * Everything running, in any project. Said, and not counted against
   * anything: there is no number of sessions at which an open is refused.
   */
  running: { id: string; label: string; projectPath: string; place: string | null; here: boolean; startedAt: number; state?: State; since?: number }[]
}

/**
 * A session's context as the MCP tool says it: the figures, and one line in words. What cannot be
 * known is said as such: `windowFromCodex` is false until Codex has said its window, and the split
 * of the window by kind (instructions, tools, messages) is written nowhere.
 */
export function contextSaid(context: Context) {
  return {
    said: `${contextWords(context).line}${context.soon ? ' — compacts soon' : ''}`,
    tokens: context.tokens,
    window: context.window,
    windowFromCodex: context.windowSure,
    percent: context.percent,
    compactsAtAbout: context.compactAt,
    compactsAtPercent: percentOf(context.compactAt, context.window),
    compactsSoon: context.soon,
    ...(context.afterCompact ? { afterCompact: true } : {}),
    model: context.model,
    ...(context.cost ? { cost: { usd: Number(context.cost.usd.toFixed(4)), said: costSaid(context.cost.usd), live: context.cost.live } } : {}),
    ...(context.compacted ? { compacted: { times: context.compacted.times, last: { ...context.compacted.last, at: context.compacted.last.at === null ? null : new Date(context.compacted.last.at).toISOString() } } } : {}),
    ...(context.split ? { lastRequest: context.split } : {}),
    at: context.at === null ? null : new Date(context.at).toISOString(),
  }
}

/**
 * The run that is running conversation `id` now: the one whose process is on it. A run is on the
 * conversation it last settled on — after `/clear` or `/resume` in it, the new one — so the
 * conversation it was opened under, and has left, is not running in it any more.
 */
export function runOf(live: readonly Run[], id: string): Run | undefined {
  return live.find((one) => (one.settled ?? one.id) === id)
}

/** A state in words an agent reads without the key to `needs-you`. */
const DOING = { working: 'working on a turn', 'needs-you': 'waiting for its person (a permission or an answer)', finished: 'its turn is over; at its prompt' } as const

/** A running session's state, as the fields a row carries: nothing when nothing is known. */
const stated = (run: Run | undefined): { state?: State; since?: number } => (run?.state ? { state: run.state, since: run.stateSince } : {})

/**
 * Where a session is running besides here, as a row says it.
 *
 * For one this module runs, what the run itself knows: the background
 * session it is a view of, or the process it was opened as a copy beside.
 * For one it does not, what the program said just now.
 */
function besides(id: string, run: Run | undefined, running: Running, runs: Runs): { elsewhere?: Elsewhere; as?: 'background' | 'copy' } {
  if (run) {
    if (run.joined) return { elsewhere: elsewhereOf(run.joined), as: 'background' }
    if (run.copyOf) return { elsewhere: elsewhereOf(run.copyOf), as: 'copy' }
    return {}
  }
  const { background, open } = runs.others(running, id)
  const there = background ?? open
  return there ? { elsewhere: elsewhereOf(there) } : {}
}

/** A recorded place in a few words: its parts, or "whole epic", and what its kehikko is called. */
function placeSaid(entry: Places['places'][string]): string {
  return [entry.parts.length ? entry.parts.join(' + ') : 'whole epic', entry.kehikko?.name || ''].filter(Boolean).join(' · ')
}

/**
 * The project's sessions that are not this place's, most likely wanted first:
 * the ones another place of the SAME EPIC holds — other parts, another
 * kehikko — and then the rest, each group by when it was last active (which
 * is the order `held` arrives in).
 *
 * A place with no epic has no "same epic": nothing is near it.
 */
export function ordered(held: readonly Recorded[], here: readonly string[], key: string, places: Places): { one: Recorded; near: string[] }[] {
  const epic = readPlaceKey(key)?.epic ?? null
  const all = held
    .filter((one) => !here.includes(one.id))
    .map((one) => ({
      one,
      near: epic === null ? [] : Object.entries(places.places).filter(([other, entry]) => other !== key && entry.epic === epic && entry.sessions.includes(one.id)).map(([, entry]) => placeSaid(entry)),
    }))
  return [...all.filter((each) => each.near.length), ...all.filter((each) => !each.near.length)]
}

/**
 * What the page draws a place from.
 *
 * A place's sessions are the ones the record lists for it, plus any that is
 * running for it and does not exist yet — a new session nobody has spoken to
 * is in memory only (see `record.ts`), and a page that reloads has to find it
 * rather than start a second one beside it.
 */
export async function listing(
  projectPath: string,
  key: string,
  runs: Runs = theRuns(),
  program: Program = PROGRAM,
  /** The project's permanent id (`context.projectId`), when the page has one: what a run is matched by. */
  projectId: string | null = null,
): Promise<Listing | { ok: false; error: string }> {
  const root = projectRoot(projectPath)
  if (!root.ok) return root
  if (!readPlaceKey(key)) return { ok: false, error: 'That is not a place.' }
  const recorded = readPlaces(root.value)
  if (!recorded.ok) return recorded
  /* The page framed in this project: the background sessions of all its places are listed from now on, viewed or not. */
  runs.know(root.value)

  const found = program.find()
  const able = found.file ? await program.supports(found.file) : { ok: true, missing: null, tells: false, lists: false }
  const live = runs.sessions()
  /* A session started before this project's folder was renamed is still this project's: it is
     followed to the new folder (`claim`), never matched by the path string alone. */
  for (const run of live) runs.claim(run, root.value, projectId)
  const ours = (run: Run) => sameProject(run, root.value, projectId)
  /* A running session that had not been recorded, or named, the last time the
     program spoke may have been since: somebody is about to read the list. */
  await Promise.all(live.filter((run) => !run.settled || !run.label).map((run) => runs.settle(run).catch(() => {})))
  /* With the ids the record names, which may be under the folder's old name (a renamed project). */
  const all = await program.sessions(root.value, recordedIds(recorded.value))
  const known = new Map(all.map((one) => [one.id, one]))
  /* Asked now, for this list, and kept nowhere: what is running elsewhere a
     moment from now is asked again when a session is opened (live.ts). */
  const running: Running = found.file && able.ok ? await runs.running(found.file) : { known: false, why: 'failed' }

  /* A conversation Codex carried on under a new id is listed under the new one: the old id
     is a step behind it, and opening it would start another copy of an old point in it. The
     record is brought along, so that the next open — here or anywhere — goes straight there. */
  const holding = new Set<string>([...(running.known ? running.active.map((one) => one.session) : []), ...runs.sessions().flatMap((run) => (run.settled ? [run.settled] : []))])
  let read = recorded
  for (const id of sessionsAt(recorded.value, key)) {
    const head = headOf(id, known, holding)
    if (head === id) continue
    const moved = follow(root.value, id, head, { label: known.get(head)?.label, lastActive: known.get(head)?.lastActive })
    if (!moved.ok) continue
    const again = readPlaces(root.value)
    if (!again.ok) return again
    read = again
  }
  /* What has been carried on elsewhere is not offered beside where it went. */
  const held = all.filter((one) => !(one.next ?? []).some((next) => known.has(next)))

  /* A session running in this folder that nothing here started and no place holds is a fact
     about this project too: listed as not yet assigned, never guessed into a place. */
  if (running.known) {
    for (const one of running.active) {
      if (one.cwd !== root.value || live.some((run) => run.id === one.session || run.settled === one.session)) continue
      if (!homeOf(read.value, one.session)) runs.sighted(root.value, one.session, 'agents', one.name)
    }
    const again = readPlaces(root.value)
    if (again.ok) read = again
  }

  const row = (id: string): Row => {
    const run = runOf(live, id)
    const kept = Object.hasOwn(read.value.sessions, id) ? read.value.sessions[id] : undefined
    const keptAt = kept?.lastActive ? Date.parse(kept.lastActive) : NaN
    const said = known.get(id)
    const label = said?.label || run?.label || kept?.label || ''
    return {
      id,
      label,
      ...(said?.firstPrompt && said.firstPrompt !== label ? { firstPrompt: said.firstPrompt } : {}),
      ...(said?.lastPrompt && said.lastPrompt !== label ? { lastPrompt: said.lastPrompt } : {}),
      ...(said?.prs?.length ? { prs: said.prs } : {}),
      lastActive: known.get(id)?.lastActive ?? (Number.isFinite(keptAt) ? keptAt : (run?.startedAt ?? null)),
      running: Boolean(run),
      ...stated(run),
      /* Neither the program's nor running: all there is of it here is the row in the record. */
      ...(known.has(id) || run ? {} : { missing: true as const }),
      ...besides(id, run, running, runs),
    }
  }

  const here = sessionsAt(read.value, key)
  for (const run of live) {
    const id = run.settled ?? run.id
    if (ours(run) && run.key === key && !here.includes(id)) here.push(id)
  }

  const install = program.install()
  return {
    ok: true,
    program: {
      name: program.name,
      found: found.file,
      foundAt: found.file ? tidy(found.file) : null,
      looked: found.looked,
      where: lookedIn(found.usual),
      lacks: able.ok ? null : able.missing,
      install: { line: install.line, lands: install.lands },
      asked: running.known ? 'yes' : running.why,
    },
    sessions: await Promise.all(
      here.map(async (id) => {
        const one = row(id)
        const context = one.missing ? null : await runs.contextOf(root.value, id).catch(() => null)
        return context ? { ...one, context } : one
      }),
    ),
    current: (() => {
      const entry = Object.hasOwn(read.value.places, key) ? read.value.places[key] : undefined
      return entry?.current && here.includes(entry.current) ? entry.current : null
    })(),
    own: (() => {
      const own = ownOf(read.value, key)
      return own && here.includes(own) ? own : null
    })(),
    homes: Object.fromEntries(
      here.flatMap((id) => {
        const home = homeOf(read.value, id)
        return home && home !== key && Object.hasOwn(read.value.places, home) ? [[id, placeSaid(read.value.places[home]!)]] : []
      }),
    ),
    hook: false,
    others: ordered(held, here, key, read.value).map(({ one, near }) => ({
      ...row(one.id),
      ...(near.length ? { near } : {}),
      ...(!homeOf(read.value, one.id) && !(Object.hasOwn(read.value.sessions, one.id) && read.value.sessions[one.id]!.ignored) ? { unplaced: true as const } : {}),
    })),
    running: live.map((run) => ({
      id: run.settled ?? run.id,
      label: run.label,
      projectPath: run.projectPath,
      place: run.key,
      here: ours(run) && run.key === key,
      startedAt: run.startedAt,
      ...stated(run),
    })),
  }
}

/** Where the program was looked for, in few enough words for one sentence. The whole list is `looked`. */
export function lookedIn(usual: readonly string[], at = home()): string {
  return ['PATH', ...usual.slice(0, 3).map((dir) => tidy(dir, at))].join(', ')
}

/** A path with the home folder written as `~`, as a person would say it. */
function tidy(path: string, at = home()): string {
  return at && path.startsWith(`${at}/`) ? `~${path.slice(at.length)}` : path
}

/* ------------------------------------------------------------------ *
 * The MCP door, for agents. One tool, and it reads.
 * ------------------------------------------------------------------ */

function tools() {
  return [
    {
      name: 'sessions',
      description:
        `The ${PROGRAM.name} sessions a person keeps in a project, by place. A place is an epic, the set of parts picked `
        + 'out of it and a kehikko; each lists its sessions with the first line of their first prompt, when each was '
        + 'last active, whether it is running now, and `missing: true` when Codex has no record of it on this '
        + 'computer (sessions stay on the computer they ran on). A running session that has said so also has `state` — '
        + '`working` (a turn is under way), `needs-you` (it has stopped at a question only its person can answer) or '
        + '`finished` (its turn is over and it is at its prompt) — and `since`. No `state` means it has not said, not that '
        + 'it is idle. `runningElsewhere` is on a session a Codex process this module did not start holds open (a '
        + 'terminal, an editor, the Codex app): its person is asked before it is opened here. '
        + '`context`, when its transcript says it, is how full its context window is: `tokens` of `window` and '
        + '`percent`, as Codex itself counts them; about where Codex compacts it by itself and `compactsSoon` near '
        + 'there; the model; and how often it was `compacted`. Codex reports no cost. '
        + `Read from ${WHERE}. Give the absolute project directory as `
        + 'project, and an epic slug to see only that epic’s places. Give `place` — the epic, the picked parts and '
        + 'the kehikko — to be told in words what opening the module there will do: a place with sessions opens one at '
        + 'once (the one last open there, else its own, else the most recently active); a place with none starts a new '
        + 'one and says that no conversation is connected, which the person does by typing $kehikot-here in the one they '
        + 'want there. Nothing is offered from the rest of the project. Reads only: nothing here starts, ends, attaches '
        + 'or types into a session.',
      inputSchema: {
        type: 'object',
        properties: {
          project: { type: 'string', description: 'The absolute directory of the project.' },
          epic: { type: 'string', description: 'An epic’s slug, to list only its places.' },
          place: {
            type: 'object',
            description: 'One place, to be told what it holds and what opening the module there does.',
            properties: {
              epic: { type: ['string', 'null'], description: 'The epic’s slug, or null when none is open.' },
              parts: { type: 'array', items: { type: 'string' }, description: 'The ids of the picked parts. Empty, or left out, is the whole epic.' },
              kehikko: { type: ['string', 'number', 'null'], description: 'The kehikko’s key (a string), or — for a host that has no keys — its row number.' },
            },
          },
        },
        required: ['project'],
      },
      annotations: { title: 'Sessions by place', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    {
      name: 'tell_finished',
      description:
        'Say that what this conversation just finished was research, so its person gets a "Research complete" notice in '
        + 'Kehikot’s Inbox, with its own sound. Call it when you or a subagent finish a research task — investigating, '
        + 'comparing, auditing, reading up, finding out how something works — with event "research-complete" and a label of a '
        + 'few words saying what was researched ("Protocol audit"). From the session’s own agent it is told when the turn '
        + 'ends; from a subagent, when that subagent finishes. An explorer subagent, or one whose task reads as research, is '
        + 'noticed without this. Only this conversation’s own item is tagged; nothing else is started, typed or changed.',
      inputSchema: {
        type: 'object',
        properties: {
          event: { type: 'string', enum: [...EVENT_IDS], description: 'The kind of finished work: "research-complete".' },
          label: { type: 'string', maxLength: 120, description: 'A few words saying what was researched, e.g. "Protocol audit".' },
        },
        required: ['event', 'label'],
      },
      annotations: { title: 'Tell the person it finished', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
  ]
}

/**
 * `tell_finished`: the session's agent (or one of its subagents) says a finished piece of work was
 * one of this module's Inbox events (research.ts). Known by the place token on this door's URL,
 * which only the conversation's own doors carry: nothing here can tag another conversation.
 */
function tellFinished(args: Record<string, unknown>, token: string | null): string {
  const event = typeof args.event === 'string' ? args.event : ''
  if (!EVENT_IDS.includes(event)) throw new Error(`event is one of: ${EVENT_IDS.join(', ')}.`)
  const label = typeof args.label === 'string' ? args.label : ''
  if (!label.trim()) throw new Error('label is a few words saying what was researched, e.g. "Protocol audit".')
  const said = token ? theRuns().tellFinished(token, event, label) : null
  if (said === null) {
    throw new Error(
      'This conversation is not one Kehikot’s Codex module is running with its doors (it was not started from the Codex container, '
      + 'or it has ended), so there is no item of its own to tag. Nothing was told.',
    )
  }
  return said
}

/** A place an agent named, or the sentence saying why it is not one. */
function placeAsked(raw: unknown): Place | string {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return 'place must be an object: { epic, parts, kehikko }.'
  const said = raw as { epic?: unknown; parts?: unknown; kehikko?: unknown }
  const parts = said.parts ?? []
  if (!Array.isArray(parts) || parts.some((one) => typeof one !== 'string')) return 'place.parts must be a list of part ids.'
  const kehikko = said.kehikko ?? null
  if (kehikko !== null && typeof kehikko !== 'string' && typeof kehikko !== 'number') return 'place.kehikko must be the kehikko’s key, or its row number.'
  const epic = said.epic ?? null
  if (epic !== null && typeof epic !== 'string') return 'place.epic must be an epic’s slug, or null.'
  const which = kehikko === null ? null : kehikkoOf(typeof kehikko === 'string' ? { key: kehikko } : { id: kehikko })
  if (kehikko !== null && which === null) return 'place.kehikko is not a kehikko’s key or row number.'
  const place: Place = { epic, parts: parts as string[], kehikko: which }
  /* Round-tripped: an epic or a part that is not a slug does not name a place this module could have written. */
  return readPlaceKey(placeKey(place)) ? place : 'That is not a place: an epic and a part are named by their slugs.'
}

async function call(name: string, args: Record<string, unknown>): Promise<string> {
  if (name !== 'sessions') throw new Error(`no tool "${name.slice(0, 60)}" here`)
  /* `project` and `epic`, or `projectPath`, the name this door used before the protocol agreed one. */
  const named = doorContext(args)
  const root = projectRoot(named.project)
  if (!root.ok) throw new Error(root.error)
  const read = readPlaces(root.value)
  if (!read.ok) throw new Error(read.error)
  const epic = named.epic
  const recorded = await PROGRAM.sessions(root.value, recordedIds(read.value))
  const held = new Map(recorded.map((one) => [one.id, one]))
  const runs = theRuns()
  const live = runs.sessions()
  const running = await runs.running()
  /* Each listed session's context, read from its transcript (only what was appended since the last look). */
  const ids = [...new Set([...recordedIds(read.value), ...recorded.map((one) => one.id), ...live.map((run) => run.settled ?? run.id)])].slice(0, 300)
  const contexts = new Map(await Promise.all(ids.map(async (id) => [id, await runs.contextOf(root.value, id).catch(() => null)] as const)))
  const session = (id: string) => {
    const kept = Object.hasOwn(read.value.sessions, id) ? read.value.sessions[id] : undefined
    const at = held.get(id)?.lastActive
    const run = runOf(live, id)
    const { elsewhere } = besides(id, run, running, runs)
    return {
      id,
      firstPrompt: held.get(id)?.label || kept?.label || '',
      lastActive: at ? new Date(at).toISOString() : (kept?.lastActive ?? null),
      running: Boolean(run),
      ...(run?.state ? { state: run.state, doing: DOING[run.state], since: new Date(run.stateSince).toISOString() } : {}),
      ...(elsewhere ? { runningElsewhere: { kind: elsewhere.called || elsewhere.kind, since: elsewhere.since ? new Date(elsewhere.since).toISOString() : null, pid: elsewhere.pid, cwd: elsewhere.cwd } } : {}),
      ...(held.has(id) || run ? {} : { missing: true }),
      ...(contexts.get(id) ? { context: contextSaid(contexts.get(id)!) } : {}),
    }
  }
  /* The project's sessions that are not one place's, as that place would offer them. */
  const offered = (here: readonly string[], key: string) =>
    ordered(recorded, here, key, read.value).map(({ one, near }) => ({ ...session(one.id), ...(near.length ? { sameEpicAt: near } : {}) }))
  const unasked = running.known
    ? ''
    : ` (${PROGRAM.name} ${running.why === 'too-old' ? 'here is too old to say' : 'could not be asked'} what is running elsewhere, so no session below says \`runningElsewhere\` — which is not the same as none being so.)`

  if (args.place !== undefined) {
    const place = placeAsked(args.place)
    if (typeof place === 'string') throw new Error(place)
    const key = placeKey(place)
    const all = sessionsAt(read.value, key)
    for (const run of live) {
      const id = run.settled ?? run.id
      if (sameProject(run, root.value) && run.key === key && !all.includes(id)) all.push(id)
    }
    const here = all.map(session)
    const openable = here.filter((one) => !('missing' in one))
    const kept = here.length > openable.length ? ` It also lists ${here.length - openable.length} that ${PROGRAM.name} has no record of on this computer, which cannot be opened here.` : ''
    if (openable.length > 1) return `This place (${key}) has ${openable.length} sessions. Opening the module here opens one at once — the one last open there, else its own, else the most recently active — and its View menu lists the others.${kept}${unasked}\n${JSON.stringify(here, null, 2)}`
    if (openable.length === 1) {
      const one = openable[0]!
      const how = one.running
        ? 'which this module is already running'
        : one.runningElsewhere?.kind === 'background'
          ? 'which is running in the background: it is attached to, and no second process is started'
          : one.runningElsewhere
            ? 'which is open in another process that cannot be attached to: its person is asked whether to open a copy anyway or leave it, and nothing is started until they answer'
            : 'which is resumed'
      return `This place (${key}) has one session, and opening the module here opens it at once — ${how}.${kept}${unasked}\n${JSON.stringify(here, null, 2)}`
    }
    return (
      `This place (${key}) has no conversation connected. Opening the module here starts a new ${PROGRAM.name} conversation in the project’s folder, `
      + 'which becomes this place’s once its person says something in it, and says above it that none is connected: '
      + `typing $kehikot-here in another conversation connects that one instead. Nothing is offered from the project’s other sessions.${kept}`
    )
  }

  const places = Object.entries(read.value.places)
    .filter(([, place]) => epic === null || place.epic === epic)
    .map(([key, place]) => ({
      place: key,
      epic: place.epic,
      parts: place.parts,
      kehikko: place.kehikko,
      sessions: place.sessions.map(session),
    }))
  if (!places.length) {
    const said = epic ? `No session is recorded for the epic "${epic}" in that project.` : 'No session is recorded for that project yet.'
    const loose = offered([], placeKey({ epic, parts: [], kehikko: null }))
    if (!loose.length) return said
    return (
      `${said} ${PROGRAM.name} has ${loose.length} session${loose.length === 1 ? '' : 's'} for the folder that ${epic ? 'no place of that epic holds' : loose.length === 1 ? 'belongs to no place' : 'belong to no place'}: `
      + `none is connected to a place until $kehikot-here is typed in it.${unasked}\n${JSON.stringify(loose, null, 2)}`
    )
  }
  return JSON.stringify(places, null, 2)
}

interface Rpc {
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown> }
}

async function mcp(rpc: Rpc, token: string | null = null): Promise<Reply> {
  const reply = (result: unknown) => ok({ jsonrpc: '2.0', id: rpc.id ?? null, result })
  const text = (s: string, isError = false) => reply({ content: [{ type: 'text', text: s }], ...(isError ? { isError } : {}) })

  if (rpc.method === 'initialize') {
    return reply({
      protocolVersion: '2025-06-18',
      capabilities: { tools: {} },
      serverInfo: { name: ID, version: VERSION },
      instructions: MANIFEST.mcp?.about ?? '',
    })
  }
  /* A notification carries no id and is answered with nothing. */
  if (typeof rpc.method === 'string' && rpc.method.startsWith('notifications/')) return { status: 202, body: null }
  /* The message tools (protocol 2.41.0) only for a session the host keeps messages for. */
  /* (2.43.0) What a message is to this session — text to read, or a request it may act on — is the person's setting for its project. */
  const act = token ? theRuns().actsOnMessages(token) : false
  if (rpc.method === 'tools/list') return reply({ tools: [...tools(), ...(await messageToolsFor(token, { module: ID, act }))] })
  if (rpc.method === 'tools/call') {
    try {
      const name = String(rpc.params?.name ?? '')
      /* send_message and read_messages: a thin adapter over the host's messages (protocol 2.41.0). */
      const messaged = await answerMessageTool(name, rpc.params?.arguments ?? {}, { module: ID, token, act })
      if (messaged) return text(messaged.text, messaged.isError)
      if (name === 'tell_finished') return text(tellFinished(rpc.params?.arguments ?? {}, token))
      return text(await call(name, rpc.params?.arguments ?? {}))
    } catch (e) {
      /* A refusal is an answer the agent reads, not a transport failure it retries. */
      return text(e instanceof Error ? e.message : String(e), true)
    }
  }
  return { status: 404, body: { jsonrpc: '2.0', id: rpc.id ?? null, error: { code: -32601, message: String(rpc.method) } } }
}

/* ------------------------------------------------------------------ *
 * The doors.
 * ------------------------------------------------------------------ */

export async function answer(
  method: string,
  path: string,
  query: URLSearchParams,
  body: Record<string, unknown> | null,
  ticket: string | null,
): Promise<Reply | null> {
  if (path === '/healthz') return ok({ ok: true, id: ID, version: VERSION, where: WHERE })

  if (path === '/mcp') {
    if (method !== 'POST') return bad('the MCP door takes POST', 405)
    if (!body || typeof body.method !== 'string') {
      return { status: 400, body: { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'not a request' } } }
    }
    return mcp(body as Rpc, query.get('kehikot-place'))
  }

  /* The skills this module offers (protocol 2.5.0): each one's SKILL.md, as text. Public: it is
     what a host shows a person before they install it, and holds nothing of anybody's. */
  const skill = skillAt(path)
  if (skill) {
    if (method !== 'GET') return bad('this door takes GET', 405)
    return { status: 200, body: null, raw: { bytes: skill.text, type: 'text/markdown; charset=utf-8' } }
  }

  if (!path.startsWith('/api/')) return null

  /* Settings, for the host (protocol 2.15.0): before the page's ticket rule, which it keeps itself. */
  const said = await settings(method, path, query, body, ticket)
  if (said) return said

  /* A session's program saying what it is doing. Before the page's ticket is
     asked for, because it does not have one: see "One door is not the page's". */
  if (path === '/api/state') {
    if (method !== 'POST') return bad('this door takes POST', 405)
    /* `thread` is the conversation Codex says the hook is in: a session id, or nothing. */
    const thread = query.get('thread') ?? ''
    /* A subagent's thread and role, on SubagentStart and SubagentStop only (research.ts): checked again in `heard`. */
    const agent = query.get('agent')
    const took = theRuns().heard(
      query.get('session') ?? '',
      ticket,
      query.get('event') ?? '',
      PROGRAM.isId(thread) ? thread : null,
      agent ? { id: agent.slice(0, 64), type: query.get('type')?.slice(0, 64) ?? null } : null,
    )
    return took ? { status: 204, body: null } : bad('that is not a running session’s own report', 403)
  }

  /* What this module's record says about a place token (protocol 2.4.0): asked by the host, for
     a Kehikot door a session called with it. A program's door, like `/api/state`: the token is a
     pointer to a record, and grants nothing. */
  if (path === '/api/kehikot/place' && method === 'GET') {
    const token = query.get('kehikot-place') ?? ''
    if (!PLACE_TOKEN.test(token)) return ok({ ok: true, place: null })
    return ok({ ok: true, place: theRuns().placeOf(token, query.get('project')) })
  }

  /* `$kehikot-here`, typed by a person in a Codex conversation (see here.ts): the skill
     posts the conversation's own id. A program's door, with no ticket, so the id is a claim, and
     it is believed only for a conversation Codex lists as running in a project the host
     holds. The answer is plain text, which the skill repeats word for word. */
  if (path === '/api/here') {
    if (method !== 'POST') return bad('this door takes POST', 405)
    const runs = theRuns()
    const said = await here((query.get('session') ?? '').slice(0, 64), query.get('say') ?? '', {
      program: PROGRAM,
      showingIn: (project) => runs.showingIn(project),
      knownProjects: () => runs.knownProjects(),
      hostHas: (folder) => hostCheck.has(folder),
      told: (project, assigned) => runs.told(project, assigned),
    })
    return { status: 200, body: null, raw: { bytes: `${said}\n`, type: 'text/plain; charset=utf-8' } }
  }

  /* A session's own hooks, through `context.sh` (see context.ts): at its start and at each prompt,
     what it is to be told of its place and the modules on its kehikko — and the filing of it under
     the place it was started at. A program's door like `/api/state`: what it must carry is the
     session's place token, which this module wrote into that session's own plugin. The answer is
     what Codex reads from a hook, or nothing (204). */
  if (path === '/api/context') {
    if (method !== 'POST') return bad('this door takes POST', 405)
    const said = await theRuns().context(query.get('event') ?? '', (query.get('session') ?? '').slice(0, 64), ticket)
    return said ? { status: 200, body: null, raw: { bytes: JSON.stringify(said), type: 'application/json' } } : { status: 204, body: null }
  }

  /* Every other door under /api, the read included: see "Reads carry the ticket too". */
  const refused = refuseTicket(ticket, TICKET)
  if (refused) return refused

  if (path === '/api/place' && method === 'GET') {
    const id = query.get('projectId') ?? ''
    const said = await listing(query.get('projectPath') ?? '', query.get('key') ?? '', undefined, undefined, PROJECT_ID.test(id) ? id : null)
    return said.ok ? ok(said) : bad(said.error)
  }

  /* Bring the entries an older release filed under this kehikko's row number
     across to its key (see `rekey` in record.ts). A write, so a POST: the read
     above never moves anything. */
  if (path === '/api/rekey' && method === 'POST') {
    const said = (typeof body?.kehikko === 'object' && body.kehikko !== null ? body.kehikko : {}) as { key?: unknown; name?: unknown; id?: unknown }
    if (!isKehikkoKey(said.key)) return bad('that is not a kehikko’s key')
    const written = rekey(typeof body?.projectPath === 'string' ? body.projectPath : null, {
      key: said.key,
      name: typeof said.name === 'string' ? said.name.slice(0, 120) : '',
      id: typeof said.id === 'number' && Number.isSafeInteger(said.id) ? said.id : undefined,
    })
    return written.ok ? ok({ ok: true, moved: written.value.moved }) : bad(written.error)
  }

  /* "What this conversation was told" (context.ts): the last notes a conversation of this project was
     given by its hooks, and what was added at prompts since, as plain text for the page to show. A
     person's read, through the page's ticket; no MCP tool reads it. */
  if (path === '/api/told' && method === 'GET') {
    const said = theRuns().toldFor(query.get('projectPath'), (query.get('session') ?? '').slice(0, 64))
    return ok({ ok: true, told: said })
  }

  /* This project's settings for this module: "Resume conversations cut off by a restart". A
     person's, through the page's ticket; no MCP tool reads or changes them. */
  if (path === '/api/settings' && method === 'GET') {
    const root = projectRoot(query.get('projectPath'))
    if (!root.ok) return bad(root.error)
    return ok({ ok: true, settings: readSettings(root.value) })
  }
  if (path === '/api/settings' && method === 'POST') {
    const project = typeof body?.projectPath === 'string' ? body.projectPath : null
    const change = Object.entries(body ?? {}).filter(([key]) => key !== 'projectPath')
    if (!change.length) return bad('say which setting changes: resumeCutOff, model, effort or approvals')
    for (const [key, value] of change) {
      const issue = settingIssue(key, value)
      if (issue) return bad(issue)
    }
    const written = writeSettings(project, { ...readSettings(project), ...Object.fromEntries(change) })
    return written.ok ? ok({ ok: true, settings: written.value }) : bad(written.error)
  }

  /* End a running session, because a person chose that one. Never asked OF a
     person: nothing is refused for want of one being ended (see live.ts). */
  if (path === '/api/end' && method === 'POST') {
    const id = typeof body?.session === 'string' ? body.session : ''
    if (!PROGRAM.isId(id)) return bad('that is not a session id')
    return ok({ ok: true, ended: theRuns().end(id) })
  }

  /* Resume a running session in its project's new folder, because a person pressed that: the
     folder was renamed while it ran. Refused while it is working (see `restartIn` in live.ts). */
  if (path === '/api/restart' && method === 'POST') {
    const id = typeof body?.session === 'string' ? body.session : ''
    if (!PROGRAM.isId(id)) return bad('that is not a session id')
    const done = theRuns().restartIn(id, body?.why === 'doors' ? 'doors' : 'moved')
    return done === true ? ok({ ok: true }) : bad(done, 409)
  }

  /* A person's say about where a conversation belongs: "Make this the kehikko's own" for the one on
     screen (`own`). `$kehikot-here` assigns through its own door below. */
  if (path === '/api/assign' && method === 'POST') {
    const id = typeof body?.session === 'string' ? body.session : ''
    const key = typeof body?.key === 'string' ? body.key : ''
    const place = readPlaceKey(key)
    if (!PROGRAM.isId(id)) return bad('that is not a session id')
    if (!place) return bad('that is not a place')
    const names = (typeof body?.names === 'object' && body.names !== null ? body.names : {}) as { kehikko?: unknown }
    const written = assign(typeof body?.projectPath === 'string' ? body.projectPath : null, { ...place, ...(typeof names.kehikko === 'string' ? { kehikkoName: names.kehikko.slice(0, 120) } : {}) }, id, { own: body?.own === true })
    if (written.ok) theRuns().recorded()
    return written.ok ? ok({ ok: true }) : bad(written.error)
  }

  /* What this page has on screen: its project, its place, and whether its kehikko has a Codex
     container — what `$kehikot-here` assigns to. Said by the page on every change and as its feed
     opens; kept only while that feed is open. */
  if (path === '/api/showing' && method === 'POST') {
    const page = typeof body?.page === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(body.page) ? body.page : null
    if (!page) return bad('that is not a page')
    const key = typeof body?.key === 'string' ? body.key : ''
    const place = readPlaceKey(key)
    const root = place ? projectRoot(typeof body?.projectPath === 'string' ? body.projectPath : null) : null
    if (!place || !root?.ok) {
      theRuns().show(page, null)
      return ok({ ok: true, showing: false })
    }
    const names = Array.isArray(body?.partNames) ? body.partNames.slice(0, place.parts.length).map((one) => (typeof one === 'string' ? one.slice(0, 120) : '')) : []
    const kept = theRuns().show(page, {
      projectPath: root.value,
      key,
      place: {
        ...place,
        ...(typeof body?.kehikkoName === 'string' ? { kehikkoName: body.kehikkoName.slice(0, 120) } : {}),
        ...(names.length === place.parts.length && names.every(Boolean) ? { partNames: names } : {}),
      },
      onScreen: body?.onScreen === true,
    })
    /* Not kept when the page's feed is not open: it says it again as the feed opens. */
    return ok({ ok: true, showing: kept })
  }

  /* Which doors a running session would be given now that it was not: the line offering a restart. */
  if (path === '/api/doors' && method === 'GET') {
    const id = query.get('session') ?? ''
    if (!PROGRAM.isId(id)) return bad('that is not a session id')
    return ok({ ok: true, changed: await theRuns().doorsChanged(id) })
  }

  /* Take a session off a place. The session is kept, and so is its transcript:
     it goes back among the ones that can be attached. */
  if (path === '/api/detach' && method === 'POST') {
    const id = typeof body?.session === 'string' ? body.session : ''
    const key = typeof body?.key === 'string' ? body.key : ''
    if (!PROGRAM.isId(id)) return bad('that is not a session id')
    const written = detach(typeof body?.projectPath === 'string' ? body.projectPath : null, key, id)
    return written.ok ? ok({ ok: true }) : bad(written.error)
  }

  return bad('not here', 404)
}

/**
 * `GET /api/feed`: what changes while a page is open, as server-sent events.
 *
 * Every change of a running session's state (an unnamed event), and — for a
 * page that says a host is framing it — the notices raised for a person who
 * is not looking (`notice`), which only a framed page can pass on, and the whole
 * activity list (`activity`: on arrival and on every change) that the page hands to
 * the host as `activity.set`. The page
 * opens it instead of asking on a clock.
 *
 * Ticketed like the read it sits beside, since a notice carries a session's
 * label. An `EventSource` cannot send a header, so the ticket is in the
 * query; the address is this module's own origin and is asked by its own
 * page, and nothing logs it.
 */
export const stream: Stream = (method, path, query, emit, ticket) => {
  if (path !== '/api/feed') return null
  if (method !== 'GET') return { reply: bad('this door takes GET', 405) }
  if (!sameTicket(ticket ?? query.get('ticket'), TICKET)) return { reply: refuseTicket(null, TICKET)! }
  /* The project the page is framed in: its activity list is that project's sessions only. */
  const asked = query.get('project')
  const project = asked ? projectRoot(asked) : null
  const page = query.get('page')
  /* What the page says it shows is kept while this stream is open: the page says it on every change
     and again whenever this stream (re)opens, and never on a clock. */
  const fed = page ? theRuns().feeds(page) : null
  const stop = theRuns().subscribe({
    notices: query.get('notices') === '1',
    project: project?.ok ? project.value : null,
    state: (stated) => emit(stated),
    notice: (notice) => emit(notice, 'notice'),
    activity: (items) => emit({ items }, 'activity'),
    sessions: (project, assigned) => emit({ project, ...(assigned ?? {}) }, 'sessions'),
    context: (said) => emit(said, 'context'),
  })
  /* A page that stops following has nothing on screen any more, as far as `$kehikot-here` knows. */
  const close = () => {
    stop()
    fed?.()
  }
  return { close }
}

