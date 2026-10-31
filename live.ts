import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { open as openFile, stat } from 'node:fs/promises'
import type { IncomingMessage } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { Duplex } from 'node:stream'

import { PROJECT_ID, projectFile, readProjectFile } from 'kehikot-module-protocol'
import type { RunSockets } from 'kehikot-module-protocol/run'
import { mintTicket, sameTicket } from 'kehikot-module-protocol/serve'

import { emptyPrompt, promptAfter, typedByPerson, type Prompt } from './input.ts'
import { Gauges } from './gauges.ts'
import { contextOf, type Context } from './meter.ts'
import { isKehikkoKey, kehikkoOf, placeKey, sortedParts, type Kehikko } from './place.ts'
import { cutOffs, cutOffWords, midTurn, movedOn, type CutOff } from './cutoff.ts'
import { PROGRAM, TELLS, headOf, home, learnSession, recordFile, sessionName, type Active, type ActiveStatus, type HookGroup, type Program, type Running, type State } from './program.ts'
import { PLACE_TOKEN, assign, attach, born, byToken, follow, homeOf, markSession, markSessions, note, projectRoot, readPlaces, readSettings, recordedIds, sighted, tokenFor, type NamedPlace, type PlaceEntry, type Places, type SessionEntry } from './record.ts'
import { disabledArgs, resyncEverywhere, sweep } from './agentSkills.ts'
import { contextScriptIn, removeKit, sessionKit, sweepKits } from './skills.ts'
import { sessionFlags } from './settings.ts'
import { doorArgs, freshToken, hostDoors, hostPlace, type DoorsAsked, type HostPlace, type SessionDoor } from './doorConfig.ts'
import { readPlaceKey } from './place.ts'
import { AGENT_ID, AGENT_TYPE, EVENT_IDS, FOUND_MOST, isResearch, subagentTask, type Found, type Told } from './research.ts'
import { context, toldWords, type HookAnswer, type Said, type Started } from './context.ts'

/**
 * The sessions that are running, and the socket a page watches one through.
 *
 * ## What is different from Terminal, and it is the point of this file
 *
 * In `kehikko-terminal` a shell lives exactly as long as its socket: the page
 * closes, the socket closes, the pty is killed. That is right for a shell and
 * wrong here. What runs in this pty is an agent that may be twenty minutes
 * into something, and a page reload — which the plumbing does by itself when
 * it finds the page older than its server, and Vite's client does on its own
 * — would end it mid-edit.
 *
 * So a session is owned by THIS PROCESS, not by a socket. A socket is a
 * viewer: it attaches, is sent the screen as it stands, then follows along,
 * and when it goes away nothing else happens. The screen it is sent comes
 * from a second emulator kept here, headless, fed every byte the pty
 * produces — the same arrangement a code editor uses to bring a terminal back
 * after its window reloads. A viewer that returns sees what it would have
 * seen had it never left.
 *
 * A session ends when the program in it exits, when a person ends it from the
 * list, or when this process stops. Never merely because nobody is looking:
 * an agent at work is left to finish.
 *
 * ## There is no limit, and nothing is ever refused for room
 *
 * A place has its session, and going to the place opens it — every time,
 * however many others are running. There used to be a bound here (six), and
 * at it every open was refused and the person was shown a list and asked to
 * end something. Nobody had asked for that, and it locked a person out of
 * their own work: the app does not make a person do its housekeeping. So
 * there is no count anywhere in this file, and no open is refused because of
 * what else is running.
 *
 * What keeps the number of processes down is quiet, and is not a person's
 * business. Two things are ended without anybody choosing, and neither loses
 * anything:
 *
 *  - what was never a session — opened by looking at a place, never typed
 *    into, never recorded — a moment after nobody is looking
 *    (`UNTOUCHED_GRACE`);
 *  - a session nobody is looking at that has been done with its turn for a
 *    long time (`QUIET_REST`). It is a process put away, not a conversation:
 *    a session is resumable by id, and the next visit to its place starts
 *    the program again on the same one, without a question and without a
 *    message.
 *
 * Never one somebody has on screen, never one that is working, and never one
 * that is waiting for an answer.
 *
 * ## Told, not read
 *
 * Whether a session is working, waiting for the person or done with its turn
 * is something the program SAYS (`reports` in program.ts): at each of those
 * moments it runs `tell.sh`, which posts one word to this process over
 * loopback. Nothing here reads a screen to guess at it.
 *
 * What stands behind that word:
 *
 *  - **A secret per run**, minted here when the pty is started and handed to
 *    it in the environment — never on a command line, never in a file. A
 *    report is taken only when it names a running session AND carries that
 *    session's own secret. Everything the program starts inherits the
 *    environment, so the agent in the pty and whatever a project's own hooks
 *    run can read it: the most either can do with it is misstate the state of
 *    the one session they are already inside. It cannot speak for another
 *    session, and it opens no other door — it is not the page's ticket.
 *  - **Only an event's name is heard.** A name this program does not use is
 *    dropped. Nothing a report carries is stored, shown or logged, so a
 *    report cannot put a sentence in front of a person.
 *  - **A report cannot ask for anything.** The most a false one does is move
 *    a dot, send one notice about its own session, or keep its own process
 *    from being put away. Notices are rationed (`NOTICES_AT_ONCE`), so it cannot
 *    fill a panel either.
 *
 * Two things the program does not report are covered from this side, and
 * both are in `program.ts` at length: a person typing into a session that
 * was waiting for them has answered it, and a session called working that
 * has printed nothing for minutes is not (`STALE_WORK`).
 *
 * A program too old to report, or one whose reports never arrive, has no
 * state. Everything else is as it was, including the rule that used to be
 * the only one: put away after a long silence.
 *
 * When this process stops, what stops with it is the pty of each run, and the
 * Codex process in it: a session's hooks and doors are per-run settings, and
 * Codex runs a session with per-run settings in its own process rather than on
 * its shared background server (see `fresh` in program.ts). The next open of
 * the place resumes it by id. What a restart cut off mid-turn is looked for
 * when a project is first named (`recover`).
 *
 * ## A conversation that is already open somewhere else
 *
 * A session this process started is found in `runs`, and a second viewer is
 * put on it. One it did NOT start — open in another terminal, an editor, the
 * Codex app — is asked about before every resume (`active` in program.ts:
 * which process holds the conversation's lock file). Open elsewhere, nothing
 * is started and the page asks; only a person's "open it here anyway" resumes
 * it, and Codex itself then says the conversation is open in another app and
 * offers to retry or fork it. When the program cannot be asked, it is resumed
 * as before, and that is SAID. Nothing here stops, signals or takes over a
 * process this module did not start.
 *
 * ## The fence
 *
 * Unchanged from Terminal, whose `shell.ts` argues it at length: loopback
 * bind, `Origin` and `Host` checked on the upgrade, and the ticket this
 * process printed into its own page carried in the socket's first frame, with
 * nothing started until that frame has been read. It keeps other pages out.
 * It does not keep out a program already running as this user, which could
 * run `codex` itself without asking.
 *
 * What a socket can ask for is narrower than there: not a shell, but this one
 * program, in a folder that exists, on a session id this module minted or the
 * program already holds for that folder — and, once, the vendor's installer
 * when the program is missing. No argument arrives over the wire.
 */

export const TICKET = mintTicket()

/** How long a connection may stay silent before it has proved itself. */
const MUST_SPEAK_WITHIN = 5_000
/** What the program is told it is running in. */
const TERM = 'xterm-256color'
/** How much of what scrolled past a returning viewer is given back. */
const SCROLLBACK = 5000
/** At most this often is the program asked whether a new session exists yet. */
const SETTLE_EVERY = 2_000
/**
 * How long a session that was never a session is kept once nobody is looking.
 *
 * A place is opened by looking at it, and a new session is started for a
 * place that has none — so picking through the parts of an epic would leave a
 * process behind at every stop. One that nobody has typed a character into
 * and that the program has recorded nothing for holds nothing at all: when
 * its last viewer leaves it is given this long (a page reload is back well
 * inside it) and then ended. It is not a session: anything typed into, and
 * anything that exists, is left to `QUIET_REST`.
 *
 * "Typed" means by a person. What the page's emulator answers the program by
 * itself, and where the pointer is, arrive on the same channel and are not
 * typing (see `input.ts`) — counted as such, every session was typed into a
 * third of a second after it started and none was ever ended.
 */
const UNTOUCHED_GRACE = 20_000
/**
 * How long a session nobody is looking at is left before its process is put
 * away — once it is done.
 *
 * Each running session is an agent holding a few hundred megabytes, and a
 * session keeps running when a person looks elsewhere, so one would
 * accumulate for every place ever worked in. The ones worth keeping are the
 * ones in the middle of something, and which those are is no longer guessed
 * at: the program says (see "Told, not read", and `rest` for the rule). A
 * session that has FINISHED its turn, and has been left alone for this long
 * since, is put away. One that is working, or waiting for an answer, never
 * is.
 *
 * Half an hour, so that a person who stepped away from a place mid-thought
 * comes back to the same process: to the line they had typed and not sent.
 *
 * ## When the program says nothing: silence, as before
 *
 * A copy too old to report, and a session whose reports do not arrive, are
 * judged the way every session used to be — by how long the program has
 * printed nothing:
 *
 *  - Waiting at its prompt, Codex prints NOTHING. Measured on 2.1.296:
 *    started in a pty, brought to its prompt, nothing typed, and every byte
 *    it printed in twenty minutes timed. There were 1133 of them, and the
 *    last came eleven seconds after it started.
 *  - Working, it draws a spinner and a running clock for as long as a turn
 *    or a tool lasts: several writes a second (the numbers are at
 *    `STALE_WORK`, below).
 *
 * There the time is counted from the last byte the program printed, the last
 * thing a person typed, or the moment the last person looked away —
 * whichever is latest. It is the weaker rule and it is known to be: a
 * question left on screen is as silent as a prompt, and under this rule is
 * put away with it. That is what being told is for.
 *
 * What is put away is the process. The conversation is the program's record,
 * and the next visit to the place resumes it by id (`open`, below).
 * `KEHIKOT_CODEX_QUIET_MS` moves it; it is not a limit anybody can run into.
 */
export const QUIET_REST = Math.max(1_000, Math.trunc(Number(process.env.KEHIKOT_CODEX_QUIET_MS) || 30 * 60_000))
/** How often the quiet ones are looked for. */
const REST_EVERY = 60_000
/**
 * How often what is kept for every conversation is re-synced against the modules as they are
 * now (`resyncEverywhere` in agentSkills.ts) — a session start is not when a module is removed.
 */
const RESYNC_EVERY = 5 * 60_000
/**
 * How long a session called `working` may print nothing before it is no
 * longer called anything.
 *
 * Measured on 2.1.296, with a stand-in for the model so that a turn could be
 * held open: mid-turn it printed 2834 bytes in 67 writes over ten seconds;
 * the same with its terminal told it had lost focus (3070 in twelve); the
 * same while a tool ran. And a turn interrupted with Esc reported nothing —
 * no `Stop`, and no idle notification in the seventy-five seconds after — and
 * printed nothing either. So two minutes of nothing at all from a session
 * called working means the turn ended without a word, and "unknown" is the
 * true thing to say. It then falls under the silence rule like any session
 * with no state, which is where it would have been before states existed.
 */
const STALE_WORK = 2 * 60_000
/**
 * How often the program is asked what the background sessions this module
 * has a view of are doing, while it has any, and those of every watched
 * project's places while a page follows along (see `watch`, `Unviewed`). For Codex the asking
 * is which process holds each conversation's lock file (`active` in program.ts): it is how a
 * run's process is followed to a conversation it moved to, and nothing Codex runs is ever a
 * background session to view, so the views' part of this never applies.
 */
const WATCH_EVERY = 7_000
/** The longest wait between two askings after the asking has failed: it doubles up to this. */
const WATCH_MOST = 60_000
/**
 * How many notices one session may raise in a row, and how long until it may
 * raise one more. A session that finishes and, on the prompt queued behind
 * it, stops to ask three seconds later has two things to say and says both;
 * one reporting in a loop says four and then one every quarter of a minute.
 */
const NOTICES_AT_ONCE = 4
const NOTICE_EVERY = 15_000
/** How many notices are held for a page that is not there to take them. The oldest go. */
const NOTICES_HELD = 32
/**
 * How long a page that has just arrived waits before it is handed what was
 * held. A page begins following the moment it loads and puts its session on
 * screen a moment after that; handed over at once, the first thing a person
 * opening the app would be told is that the session in front of them has
 * finished.
 */
const HELD_WAIT = 3_000
/** The script a session's program runs to report (see "Told, not read"). */
const TELL = join(import.meta.dirname, 'tell.sh')
/** The environment a report is made from. Read by `tell.sh` and by nothing else. */
export const TELL_ENV = { port: 'KEHIKOT_TELL_PORT', secret: 'KEHIKOT_TELL_SECRET', session: 'KEHIKOT_TELL_SESSION' } as const

/** A word in single quotes for `/bin/sh`, whatever is in it. Used for one thing: this module's own path. */
export const quoted = (text: string): string => `'${text.replace(/'/g, `'\\''`)}'`

/** The line the program is to run for one event. The event is a name out of `program.ts`, never anything heard. */
export const tellLine = (event: string, script: string = TELL): string => `/bin/sh ${quoted(script)} ${event}`
/** A session that still has no first prompt after this many looks is not asked again until it ends. */
const LABEL_TRIES = 8
/** How often a running session's process is asked which conversation it is showing (see `track`). */
const TRACK_EVERY = 10_000

/**
 * How often the context of each session somebody has on screen is looked at again: one `stat` of
 * its transcript, and a read of what was appended when it grew (`Gauges` in gauges.ts). What its
 * own status line posts is said at once, between.
 */
const METER_EVERY = 2_500

/** What Compact and Clear type at the prompt: Codex's own slash commands, exactly as a person types them (both measured on 0.164.0). */
export const COMMANDS = { compact: '/compact', clear: '/clear' } as const
export type Command = keyof typeof COMMANDS
/** How long after a command's text its Enter is typed: Codex's command menu settles on what was typed first (measured on 2.1.310). */
const ENTER_AFTER = 250
/**
 * A sighting of the prompt (`agents --json` saying `idle`) has to be this much later than a line
 * sent to it to count as the program having taken that line: measured on 2.1.310, a process still
 * says `idle` while its `UserPromptSubmit` hooks run, before the turn begins.
 */
const TAKEN_AFTER = 5_000

/**
 * The one sentence this module ever sends a conversation, and only one that a restart cut off
 * mid-turn (see `recover`): once per interruption, behind the person's setting "Resume
 * conversations cut off by a restart", which is on unless they turned it off.
 */
export const RESUME_LINE = 'Kehikot restarted while you were working. Some background work may have been cut off: check your task notifications and resume anything unfinished.'
/** The setting's words, as the page draws them. */
export const RESUME_SETTING = 'Resume conversations cut off by a restart'
/**
 * How recently a conversation recorded before this module kept a "working" mark must have last
 * grown to be judged by its transcript instead (`midTurn`): the update that brought this release
 * ended the sessions the old one held, and only their records say where they were.
 */
const LEGACY_WINDOW = 30 * 60_000
/** How far back a conversation's cut-off tasks are told the first time its transcript is read. */
const FIRST_LOOK = 24 * 60 * 60_000
/** How often the transcripts of the watched projects' conversations are read for cut-off work, at most. */
const CUTOFF_EVERY = 20_000
/** How much of the end of a transcript is read for it. */
const CUTOFF_TAIL = 1024 * 1024
/** How long a "resumed after a restart" line stays in the Inbox when nobody opens the conversation. */
const RESUMED_FOR = 24 * 60 * 60_000

/**
 * What a session is called in Codex's own lists, from where it belongs:
 * the project's folder, the epic, the picked parts by their headings, the
 * kehikko — `hippos-portal · kiosk-info-reel · Reel · main`.
 */
export function placeName(projectPath: string, place: NamedPlace | null): string {
  if (!place) return sessionName([basename(projectPath)])
  const parts = place.parts.map((id, at) => place.partNames?.[at] || id)
  return sessionName([basename(projectPath), place.epic, parts.join(' + '), place.kehikkoName])
}

/**
 * Why a socket was closed, as a number the page can act on. The sentence
 * beside it is for a person; the number is what decides what is drawn.
 */
export const CLOSED = {
  ended: 4000,
  /** Put away for being quiet with nobody looking: not news, and the page draws nothing for it. */
  rested: 4001,
  installed: 4010,
  notInstalled: 4011,
  refused: 4403,
  missing: 4404,
  silent: 4408,
  /** The session is open in another process that cannot be attached to, and nothing was started. The page asks. */
  elsewhere: 4409,
  /** Ended on a person's press to be resumed in the project's new folder: the page opens it again at once. */
  moved: 4002,
  failed: 4500,
} as const

/* ------------------------------------------------------------------------ *
 * The fence, as pure functions (see kehikko-terminal/shell.ts for the essays)
 * ------------------------------------------------------------------------ */

export interface Fenced {
  ok: boolean
  why: string
}

/** Is this handshake from this module's own page? `Origin` and `Host`, both, against the port actually bound. */
export function fenced(headers: { origin?: string; host?: string }, port: number): Fenced {
  const allowed = new Set([`http://127.0.0.1:${port}`, `http://localhost:${port}`])
  const origin = headers.origin
  if (!origin) return { ok: false, why: 'That handshake carried no Origin. Every browser sends one, so this did not come from a page.' }
  if (!allowed.has(origin)) return { ok: false, why: `${origin} is not this module's own page, and only its own page may open a session.` }
  const host = headers.host
  if (!host || !allowed.has(`http://${host}`)) {
    return { ok: false, why: `That request asked for host ${host ?? '(none)'}, which is not this module's address.` }
  }
  return { ok: true, why: '' }
}

/** A close reason short enough that closing does not throw: the protocol caps one at 123 BYTES. */
export function sayable(reason: string, limit = 123): string {
  const bytes = Buffer.from(reason, 'utf8')
  if (bytes.length <= limit) return reason
  let cut = limit
  while (cut > 0 && ((bytes[cut] ?? 0) & 0xc0) === 0x80) cut -= 1
  return Buffer.from(bytes.subarray(0, cut)).toString('utf8')
}

/** The first frame a page sends, before anything is started. */
export type Opening =
  | { what: 'install'; cols: number; rows: number }
  | {
      what: 'session'
      projectPath: string
      /**
       * The project's permanent id (protocol 2.1.0, `context.projectId`), when the host sent one.
       * What tells a project whose folder was renamed from another project (`sameProject`).
       */
      projectId?: string | null
      place: NamedPlace
      /** The session to open, or null for a new one. */
      session: string | null
      /**
       * A person, told that the session is open in another process, chose to
       * open a copy anyway. A word and not an argument: the command it leads
       * to is `--resume <id>`, the same as ever. Absent unless it was said.
       */
      copy?: true
      cols: number
      rows: number
    }

const size = (raw: unknown, least: number, most: number, otherwise: number) => {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(most, Math.max(least, Math.trunc(n))) : otherwise
}

const SLUG = /^[a-z0-9-]{1,80}$/

/**
 * Which kehikko, off the wire: `{ key }`, `{ id }`, or — as pages older than
 * the key sent it — a bare number, which is an id. `undefined` for anything
 * else. Told apart by the field it came in and never by how it looks: a key
 * may be all digits, and a string is never read as a number here.
 */
function readKehikko(raw: unknown): Kehikko | null | undefined {
  if (raw === null || raw === undefined) return null
  if (typeof raw === 'number') return Number.isSafeInteger(raw) ? { id: raw } : undefined
  if (typeof raw !== 'object') return undefined
  const said = raw as { key?: unknown; id?: unknown }
  if (said.key !== undefined) return isKehikkoKey(said.key) && said.id === undefined ? { key: said.key } : undefined
  return typeof said.id === 'number' && Number.isSafeInteger(said.id) ? { id: said.id } : undefined
}

/** A place off the wire, or null. Ids and the kehikko's key are checked; the names — the kehikko's, the parts' — are labels and only bounded. */
export function readPlace(raw: unknown): NamedPlace | null {
  if (typeof raw !== 'object' || raw === null) return null
  const said = raw as { epic?: unknown; parts?: unknown; kehikko?: unknown; kehikkoName?: unknown; kehikkoId?: unknown; partNames?: unknown }
  const epic = said.epic ?? null
  if (epic !== null && (typeof epic !== 'string' || !SLUG.test(epic))) return null
  const parts = said.parts ?? []
  if (!Array.isArray(parts) || parts.length > 200 || parts.some((one) => typeof one !== 'string' || !SLUG.test(one))) return null
  const kehikko = readKehikko(said.kehikko)
  if (kehikko === undefined) return null
  const ids = sortedParts(parts as string[])
  /* Names for the parts, by id: labels like the kehikko's, bounded and never compared. Given in
     any order and for any subset; what comes out is in the order of `parts`. */
  const names = typeof said.partNames === 'object' && said.partNames !== null && !Array.isArray(said.partNames) ? (said.partNames as Record<string, unknown>) : null
  const partNames = names ? ids.map((id) => (Object.hasOwn(names, id) && typeof names[id] === 'string' ? (names[id] as string).slice(0, 120) : '')) : undefined
  return {
    epic,
    parts: ids,
    kehikko,
    kehikkoName: typeof said.kehikkoName === 'string' ? said.kehikkoName.slice(0, 120) : undefined,
    ...(partNames?.some(Boolean) ? { partNames } : {}),
    /* The host's row number, carried only to be written beside a key as a note. */
    ...(kehikko && 'key' in kehikko && typeof said.kehikkoId === 'number' && Number.isSafeInteger(said.kehikkoId) ? { kehikkoId: said.kehikkoId } : {}),
  }
}

/**
 * Read the opening frame, refusing anything that is not one. A string is the
 * sentence to close the socket with. The ticket is compared first, whole and
 * in constant time.
 */
export function opening(raw: unknown, ticket: string = TICKET): Opening | string {
  if (typeof raw !== 'string') return 'The first frame must be text.'
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return 'The first frame must be JSON naming a ticket.'
  }
  if (typeof parsed !== 'object' || parsed === null) return 'The first frame must be a JSON object.'
  const held = parsed as Record<string, unknown>
  if (typeof held.ticket !== 'string' || !sameTicket(held.ticket, ticket)) {
    return 'That did not carry this module’s ticket. Only the page this module serves has it.'
  }
  const cols = size(held.cols, 20, 500, 80)
  const rows = size(held.rows, 5, 200, 24)
  if (held.install === true) return { what: 'install', cols, rows }

  if (typeof held.projectPath !== 'string' || !held.projectPath) return 'A session belongs to a project, and no project was named.'
  const place = readPlace(held.place)
  if (!place) return 'That did not say which place the session is for.'
  const session = held.session ?? null
  if (session !== null && (typeof session !== 'string' || !PROGRAM.isId(session))) return 'That is not a session id.'
  const projectId = typeof held.projectId === 'string' && PROJECT_ID.test(held.projectId) ? held.projectId : null
  return { what: 'session', projectPath: held.projectPath, ...(projectId ? { projectId } : {}), place, session, ...(held.copy === true && session !== null ? { copy: true as const } : {}), cols, rows }
}

/* ------------------------------------------------------------------------ *
 * The runs
 * ------------------------------------------------------------------------ */

/** The least of a pty this file uses, so a test can stand one in. */
export interface Pty {
  pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  kill(): void
  onData(heard: (chunk: string) => void): unknown
  onExit(heard: (exit: { exitCode: number }) => void): unknown
}

export type Spawn = (
  file: string,
  args: string[],
  options: { cwd: string; cols: number; rows: number; env: NodeJS.ProcessEnv },
) => Pty | Promise<Pty>

/** The second emulator: fed what the pty says, asked for the screen when a viewer arrives. */
export interface Screen {
  write(data: string, done?: () => void): void
  resize(cols: number, rows: number): void
  /** The screen and its scrollback, as bytes a fresh emulator can be written. */
  serialize(): string
  dispose(): void
}

/** One socket watching a run. `output` is the program's bytes; `say` is this module's own word. */
export interface Viewer {
  output(data: string): void
  say(message: Record<string, unknown>): void
  close(code: number, reason: string): void
}

export interface Run {
  what: 'session' | 'install'
  /** The id it was opened under. */
  id: string
  /** The id the program recorded it under, once it has recorded anything. */
  settled: string | null
  /**
   * Where the project is NOW: what the record is written in, what the lists compare and what a
   * row says. The folder the program was started in until the project's folder is renamed or moved
   * while it runs; then the new one (`claim`).
   */
  projectPath: string
  /**
   * The folder the program was started in, and so its working directory and the project root it
   * keeps for its whole life. Never changes: after a rename the process goes on in the renamed
   * folder (macOS keeps a running process's directory), but under the old name.
   */
  cwd: string
  /** The project's permanent id: the host's, or read off `.kehikot/project.json` when it started. Null when neither said. */
  projectId: string | null
  /** Ended by a person to be started again where the project is now (`restartIn`): its viewers are told so. */
  restarting: boolean
  /** The place a new session is recorded for once it exists. */
  place: NamedPlace | null
  /** The place it was last opened from, with the names a person knows it by. For a notice. */
  at: NamedPlace | null
  key: string | null
  label: string
  /** How many times the program has been asked what this session is called. Bounded: some never have a first prompt. */
  asked: number
  /** Whether a person has typed anything into it. The emulator's own replies do not count (see `input.ts`). */
  touched: boolean
  /** When the program last printed, a person last typed, or the last person looked away: what `QUIET_REST` counts from when nothing is known. */
  stirredAt: number
  /** When the program last printed anything. */
  printedAt: number
  /** When a person last typed into it or last looked away from it: what a finished session's rest is counted from. */
  attendedAt: number
  /** What the program last said it is doing, or null when it has said nothing that still holds. */
  state: State | null
  /**
   * What its agent said it finished with `tell_finished` (research.ts), waiting for the turn to end
   * (`Stop`) or for a subagent that ran when it was said to (`SubagentStop`). Null for nothing.
   */
  told: Told | null
  /** The tag its last turn ended with: its finished item names the event, until the next prompt. */
  turnTag: Told | null
  /** Its subagents running now, by agent id, with when each started (`SubagentStart`). */
  agents: Map<string, number>
  /** Its subagents that finished research, each an Inbox item of its own until the person opens the session. */
  found: Found[]
  /** Since when. Meaningless while `state` is null. */
  stateSince: number
  /**
   * Whether the conversation has had a turn: resumed from a record, or heard working or finishing
   * since it started. A conversation with no turn yet has asked the person nothing, so nothing it
   * reports makes it need them (`needsYou`).
   */
  turned: boolean
  /**
   * Whether a person has had it on screen since its state last changed. A question they have seen
   * is no longer news: the Inbox line goes (`needsYou`), and no notice is handed over late.
   */
  seen: boolean
  /** What a report has to carry to be believed about this run. Null for one that was not asked to report. */
  secret: string | null
  /** How many notices it may still raise, and when that was last true (see `NOTICES_AT_ONCE`). */
  notices: { left: number; at: number }
  /**
   * How many background tasks the program said were still running when its turn last ended: the
   * number from its `Stop` hook and nothing else of it. Above zero, a finished turn is not a finished
   * session, and it is not put away (see `rest`). Zero when it said none, or said nothing.
   */
  background: number
  /**
   * The background session this run is a VIEW of, in the Claude module this file shares its
   * shape with. Always null for Codex: it has no background session to attach to.
   */
  joined: Active | null
  /** The other process that had this conversation open when a person chose to open a copy of it here. Null otherwise. */
  copyOf: Active | null
  /** Why the program could not be asked whether the session was running elsewhere before it was resumed. Null when it was asked. */
  unchecked: 'too-old' | 'failed' | null
  /** Put away by `rest`, so that its viewers are told that and not that it ended. */
  rested: boolean
  /** When the program was last asked which conversation this run's process is showing (see `track`). */
  trackedAt: number
  /** The clock on an untouched, unrecorded run nobody is watching (see `UNTOUCHED_GRACE`). */
  idle: ReturnType<typeof setTimeout> | null
  startedAt: number
  pty: Pty
  screen: Screen
  viewers: Set<Viewer>
  /**
   * Viewers that have attached and are waiting for the screen as it stands, each with what the
   * program has said since it asked. The screen is taken from inside the emulator's write queue,
   * so it holds everything said BEFORE the viewer asked and nothing after; what is said after is
   * kept here and sent behind the screen. Without it, output that arrived while the screen was
   * being taken reached neither: the viewer was not yet following, and the screen was already cut.
   */
  joining: Map<Viewer, string[]>
  /**
   * The viewers that have it on screen. A page keeps views of other places
   * mounted behind the one it shows, each with its socket open, so "has a
   * viewer" is not "is being looked at"; the page says which (`look`).
   */
  looking: Set<Viewer>
  ended: boolean
  /**
   * The conversation's place token (protocol 2.4.0), on every Kehikot door it
   * was given; null for a copy that cannot be given doors, and for a view of a
   * background session, which was started elsewhere.
   */
  token: string | null
  /** The doors it was started with, by module id: what "Restart to load …" compares against. */
  doors: SessionDoor[]
  /** Its `--mcp-config` file, removed when the process ends. */
  config: string | null
  /** Its own folder (`sessionKit` in skills.ts: its skills and its context hook), removed when the process ends. */
  plugin: string | null
  /**
   * A conversation this module runs in the background, in the Claude module this file shares its
   * shape with. Always false for Codex (see `fresh` in program.ts).
   */
  owned: boolean
  /** The folder its doors file and plugin are kept in while it may be woken (`keptDirOf`). */
  kept: string | null
  /** What `agents --json` last said its process is doing (`status`), and when that was asked. */
  status: ActiveStatus | null
  statusAt: number
  /** When its program was last seen at its prompt: its turn ended (`Stop`), or `agents --json` said `idle`. 0 for never. */
  idleAt: number
  /** What is typed at its prompt and not sent, counted (`promptAfter` in input.ts). */
  prompt: Prompt
}

/** A conversation's place, as this module's record says it: what `/api/kehikot/place` answers. */
export interface RecordedPlace {
  conversation: string
  epic: string | null
  parts: string[]
  /** The kehikko's key; null for a place with none, or filed under an older host's row number. */
  kehikko: string | null
}

export type Refusal = { code: number; why: string; elsewhere?: Elsewhere }

/** The id in `<projectPath>/.kehikot/project.json`, read with the protocol's `readProjectFile`, or null. Never throws. */
export function projectIdAt(projectPath: string): string | null {
  const file = projectFile(projectPath)
  if (!file) return null
  try {
    return readProjectFile(JSON.parse(readFileSync(file, 'utf8')))?.id ?? null
  } catch {
    return null
  }
}

/**
 * Whether a run belongs to the project at `root` (resolved), asked by `id` when the asker knows it.
 *
 * ## A project whose folder is renamed while a session runs
 *
 * The host gives every project a permanent id (protocol 2.1.0) and, after a rename, sends the new
 * folder with the same id. The process keeps running — macOS keeps its working directory through the
 * rename — so the run is still this project's, at a new path. The path alone cannot say so, and a
 * path alone can also be wrong the other way: another project put where an old one was. So:
 *
 *   - both ids known: the ids decide, and nothing else;
 *   - the same folder, with an id missing on one side: the same project, as before ids;
 *   - otherwise only when the run's folder is gone AND the asked folder's `.kehikot/project.json`
 *     names the run's id — the case of an asker that sent no id (an agent through the MCP door, an
 *     older host).
 *
 * Never by string equality alone when both sides have an id.
 */
export function sameProject(
  run: { projectPath: string; projectId: string | null },
  root: string,
  id: string | null = null,
  idAt: (projectPath: string) => string | null = projectIdAt,
  there: (path: string) => boolean = existsSync,
): boolean {
  if (id && run.projectId) return id === run.projectId
  if (run.projectPath === root) return true
  if (!run.projectId) return false
  if (there(run.projectPath)) return false
  return idAt(root) === run.projectId
}

/** The sentence for a session whose project's folder was renamed under it: the run's word to its viewers. */
export function movedWord(run: Pick<Run, 'cwd' | 'projectPath'>): { moved: string | null; cwd: string } {
  return { moved: run.cwd && run.cwd !== run.projectPath ? run.projectPath : null, cwd: run.cwd }
}

/**
 * Where a session is running that this module did not start, as a page is
 * told it: what the program said, and nothing read off a process table.
 */
export interface Elsewhere {
  kind: Active['kind']
  /** The program's own word for the kind. */
  called: string
  pid: number | null
  cwd: string
  /** Since when, in milliseconds, or null when the program did not say. */
  since: number | null
  name: string
}

export const elsewhereOf = (one: Active): Elsewhere => ({ kind: one.kind, called: one.called, pid: one.pid, cwd: one.cwd, since: one.startedAt, name: one.name })

/**
 * The line put on a terminal's first row when a session was resumed without
 * the program having been asked whether it was already running. Dim, one
 * line, and only ever for a copy that cannot be asked.
 */
export function uncheckedLine(name: string, why: 'too-old' | 'failed'): string {
  const said =
    why === 'too-old'
      ? `This ${name} cannot say whether a conversation is already open somewhere else, so this one was resumed without checking. Update ${name} to have that checked.`
      : `Which process holds this conversation could not be asked (lsof), so it was resumed without checking whether it is open somewhere else.`
  return `\x1b[2m${said}\x1b[0m\r\n`
}

/**
 * Something worth telling a person who is not looking: a session of theirs
 * came to need them, or finished.
 *
 * It is raised here and said by a page, because only a page can speak to a
 * host (the wire is `postMessage`), and it carries no sentence: the page
 * writes one from these fields. What a person wrote — the session's label,
 * the names of the place — is theirs; nothing in it came from a report.
 */
export interface Notice {
  seq: number
  session: string
  state: 'needs-you' | 'finished'
  label: string
  projectPath: string
  epic: string | null
  /** The picked parts by what a person calls them, falling back to their ids. */
  parts: string[]
  kehikko: string
  /** The picked parts' ids, as the place holds them (a press goes by id, never by name). */
  partIds?: string[]
  /** The kehikko's key, when the place is held by one. */
  kehikkoKey?: string | null
  at: number
}

/** One session's state, as a feed says it. */
export interface Stated {
  session: string
  state: State | null
  since: number
}

/**
 * One session as the host's activity list says it (protocol 1.5.0, `activity.set`): the
 * server knows every running session's state, label and place, so it is the one that
 * writes the list, and a page only passes it on. The shape is the protocol's `ActivityItem`.
 */
export interface ActivityRow {
  id: string
  state: 'working' | 'attention' | 'done'
  label: string
  place?: { epic?: string; parts?: string[]; kehikko?: string }
  since: number
  detail: string
  /** How pressing it is (protocol 1.7.0): absent is `normal`. */
  priority?: 'urgent' | 'normal' | 'low'
  /**
   * The Inbox event this item is (protocol 2.31.0, research.ts): `research-complete` for a finished
   * turn or subagent that was research. One of the manifest's `events`; absent for none.
   */
  event?: string
  /**
   * The folder of the project the session runs in (protocol 1.8.0). A session keeps running
   * when the person switches project, and the page framed now is the one that reports it; a
   * host that files by project puts it under its own, and the protocol's client sends a host
   * that does not only the open project's rows, without it.
   */
  project: string
}

/** The protocol's limits (`LIMITS.ACTIVITY_*`, `PLACE_PARTS`), spelled here because the server does not import the client. */
const ACTIVITY_ITEMS = 64
const ACTIVITY_LABEL = 120
const ACTIVITY_DETAIL = 200
const PLACE_PARTS = 16

const ACTIVITY_STATE = { working: 'working', 'needs-you': 'attention', finished: 'done' } as const
const ACTIVITY_ORDER = { attention: 0, working: 1, done: 2 } as const

const clip = (text: string, most: number): string => (text.length <= most ? text : `${text.slice(0, most - 1).trimEnd()}…`)

/**
 * The COMPLETE list of the sessions whose state is known, most urgent first: needs you,
 * working, then finished by recency. A session with no state said is not in it. More than
 * 64 are cut from the end (the finished, oldest first). The label is clipped here, since
 * the protocol refuses a long one; a place with more than 16 parts leaves them out and
 * keeps the epic and the kehikko.
 */
export function activityRows(runs: Iterable<Run>, project: string | null = null, unviewed: Iterable<Unviewed> = [], more: Iterable<ActivityRow> = []): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (const run of runs) {
    if (run.what !== 'session' || run.ended) continue
    /* One project's only, for a follower that asked for one; a page asks for every project's
       and each row says its own (`project`). */
    if (project !== null && !sameProject(run, project)) continue
    const at = run.at
    const parts = at?.parts ?? []
    const place: NonNullable<ActivityRow['place']> = {}
    if (at?.epic) place.epic = at.epic
    if (parts.length > 0 && parts.length <= PLACE_PARTS) place.parts = [...parts]
    if (at?.kehikko && 'key' in at.kehikko) place.kehikko = at.kehikko.key
    /* Its subagents' finished research (research.ts): an item each, until the person opens the session. */
    for (const one of run.found ?? []) {
      rows.push({
        id: `${run.settled ?? run.id}:agent:${one.agent}`,
        state: 'done',
        label: clip(one.label.replace(/\s+/g, ' ').trim() || 'Research', ACTIVITY_LABEL),
        ...(Object.keys(place).length > 0 ? { place: { ...place, ...(place.parts ? { parts: [...place.parts] } : {}) } } : {}),
        since: one.at,
        detail: 'a subagent finished',
        event: one.event,
        project: run.projectPath,
      })
    }
    if (!run.state) continue
    /* A question the person has already seen, or a conversation with no turn yet, is no Inbox line. */
    if (run.state === 'needs-you' && !needsYou(run)) continue
    const state = ACTIVITY_STATE[run.state]
    /* A finished turn its agent said was research (`tell_finished`): the event, and its words. */
    const tag = run.state === 'finished' ? run.turnTag : null
    const detail =
      run.state === 'needs-you'
        ? 'waiting for you: a permission or an answer'
        : run.state === 'finished'
          ? run.background > 0 ? `turn ended; ${run.background} background task${run.background === 1 ? '' : 's'} still running` : 'turn ended'
          : 'working'
    rows.push({
      id: run.settled ?? run.id,
      state,
      label: clip((tag?.label ?? run.label).replace(/\s+/g, ' ').trim() || 'Codex session', ACTIVITY_LABEL),
      ...(Object.keys(place).length > 0 ? { place } : {}),
      since: run.stateSince,
      detail: clip(detail, ACTIVITY_DETAIL),
      ...(tag ? { event: tag.event } : {}),
      project: run.projectPath,
    })
  }
  /* The background sessions of the project's places that no run here is a view of (`Unviewed`).
     One row per session: a run holding the same session is the one that says it. */
  const said = new Set(rows.map((row) => row.id))
  for (const one of unviewed) {
    if (!one.state || said.has(one.session)) continue
    /* No turn yet, or a question seen before: not news (`needsYou`). */
    if (one.state === 'needs-you' && (!one.turned || one.seen)) continue
    if (project !== null && one.projectPath !== project) continue
    said.add(one.session)
    const parts = one.at.parts
    const place: NonNullable<ActivityRow['place']> = {}
    if (one.at.epic) place.epic = one.at.epic
    if (parts.length > 0 && parts.length <= PLACE_PARTS) place.parts = [...parts]
    if (one.at.kehikko && 'key' in one.at.kehikko) place.kehikko = one.at.kehikko.key
    rows.push({
      id: one.session,
      state: ACTIVITY_STATE[one.state],
      label: clip(one.label.replace(/\s+/g, ' ').trim() || 'Codex session', ACTIVITY_LABEL),
      ...(Object.keys(place).length > 0 ? { place } : {}),
      since: one.since,
      detail: clip(one.state === 'needs-you' ? 'waiting for you: a permission or an answer' : one.state === 'finished' ? 'turn ended' : 'working', ACTIVITY_DETAIL),
      project: one.projectPath,
    })
  }
  /* What the conversations' records say besides their state: work a restart cut off, one woken after it (`recover`). */
  for (const row of more) {
    if (said.has(row.id) || (project !== null && row.project !== project)) continue
    said.add(row.id)
    rows.push(row)
  }
  rows.sort((a, b) => ACTIVITY_ORDER[a.state] - ACTIVITY_ORDER[b.state] || b.since - a.since || a.id.localeCompare(b.id))
  return rows.slice(0, ACTIVITY_ITEMS)
}

/** Whether a conversation has had a turn: heard working or finishing, or recorded by the program, which it is from its first prompt on. */
export const hadTurn = (run: Pick<Run, 'turned' | 'settled'>): boolean => run.turned || run.settled !== null

/**
 * Whether a session that says it is waiting (`needs-you`) needs the person: it has had a turn — the
 * program asked something in a conversation, never at an empty prompt — and nobody has had it on
 * screen since it began to wait. A conversation with no turn yet never needs anyone, and a question
 * the person has seen is theirs to answer when they choose: the Inbox line goes, and does not come
 * back when they look away. Answering, ending the session and a new state all end it as well.
 */
export function needsYou(run: Pick<Run, 'state' | 'turned' | 'settled' | 'seen' | 'looking'>): boolean {
  return run.state === 'needs-you' && hadTurn(run) && !run.seen && run.looking.size === 0
}

/** The place a conversation's Inbox line goes to: the place it is open at, else the one it belongs to, else the first that lists it. */
export function placeEntryFor(places: Places, id: string): PlaceEntry | null {
  const entries = Object.entries(places.places).sort(([a], [b]) => a.localeCompare(b))
  const current = entries.find(([, entry]) => entry.current === id)
  if (current) return current[1]
  const home = homeOf(places, id)
  if (home && Object.hasOwn(places.places, home)) return places.places[home]!
  return entries.find(([, entry]) => entry.sessions.includes(id))?.[1] ?? null
}

/** A place as an Inbox line carries it (`ActivityRow['place']`). */
function rowPlace(entry: PlaceEntry | null): ActivityRow['place'] | undefined {
  if (!entry) return undefined
  const place: NonNullable<ActivityRow['place']> = {}
  if (entry.epic) place.epic = entry.epic
  if (entry.parts.length > 0 && entry.parts.length <= PLACE_PARTS) place.parts = [...entry.parts]
  if (entry.kehikko?.key) place.kehikko = entry.kehikko.key
  return Object.keys(place).length > 0 ? place : undefined
}

/**
 * The Inbox lines a project's record holds besides its sessions' states (see `recover`):
 *
 *  - **`cut-off:<session>`, needs you**: background tasks of the conversation that a restart cut
 *    off, or that failed, as its transcript says (cutoff.ts) — until the person moves the
 *    conversation on, which is a prompt typed in it after them. A dismissed one stays dismissed
 *    until another task is cut off (its `since` is the latest one's).
 *  - **`resumed:<session>`, finished**: the conversation was working when a restart cut it off,
 *    and was woken in the background and told so — until the person has it on screen, or a day.
 */
export function recordRows(places: Places, projectPath: string, now: number): ActivityRow[] {
  const rows: ActivityRow[] = []
  for (const [id, entry] of Object.entries(places.sessions)) {
    if (entry.ignored) continue
    const at = placeEntryFor(places, id)
    if (!at) continue
    const place = rowPlace(at)
    const title = entry.label.replace(/\s+/g, ' ').trim() || 'Codex session'
    const open = entry.cutOff?.open ?? []
    if (open.length > 0) {
      const { said, detail } = cutOffWords(open)
      rows.push({
        id: `cut-off:${id}`,
        state: 'attention',
        label: clip(`${title}: ${said}`, ACTIVITY_LABEL),
        ...(place ? { place } : {}),
        since: Math.max(...open.map((one) => one.at)),
        detail: clip(detail, ACTIVITY_DETAIL),
        project: projectPath,
      })
    }
    const resumed = entry.resumed
    const since = resumed ? Date.parse(resumed.at) : NaN
    if (resumed && !resumed.told && Number.isFinite(since) && now - since < RESUMED_FOR) {
      rows.push({
        id: `resumed:${id}`,
        state: 'done',
        label: clip(`${title}: resumed after Kehikot restarted`, ACTIVITY_LABEL),
        ...(place ? { place } : {}),
        since,
        detail: clip('It was working when Kehikot restarted, and was woken in the background and asked to check its background work and carry on.', ACTIVITY_DETAIL),
        project: projectPath,
      })
    }
  }
  return rows
}

/** The last `most` bytes of a file, as text. Empty for anything that cannot be read. */
async function tailOfFile(file: string, most: number): Promise<string> {
  try {
    const handle = await openFile(file, 'r')
    try {
      const { size } = await handle.stat()
      const from = Math.max(0, size - most)
      const buffer = Buffer.alloc(size - from)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, from)
      return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
      await handle.close()
    }
  } catch {
    return ''
  }
}

/**
 * A background session that belongs to one of a project's places and that no run here is a view
 * of — in the Claude module this file shares its shape with. Codex runs none: `active` never
 * lists a `background` kind, so this list stays empty. Its process is not
 * this module's and runs none of its hooks, so what it is doing is what the program says
 * (`agents --json`, its `state`), asked on the same clock as the views (`watch`).
 *
 * Built afresh on every asking from two things and nothing else: what the program says is running,
 * and the project's `places.json` — each place's sessions followed to where the conversation is now
 * (`headOf`). Never written anywhere.
 */
export interface Unviewed {
  /** The session the background process holds. */
  session: string
  /** The project (resolved) whose place holds it. */
  projectPath: string
  /** The place it belongs to: the one whose `current` it is, else the first that lists it. */
  at: NamedPlace
  label: string
  state: State | null
  since: number
  /** Whether it has had a turn (`needsYou`). */
  turned: boolean
  /** A person had it on screen while it was waiting: not news. */
  seen?: boolean
}

/** One page's place, as it said it (see `Runs.show`). */
export interface Showing {
  /** The project, resolved. */
  projectPath: string
  /** The place's key, and the place in words. */
  key: string
  place: NamedPlace
  /** Whether the open kehikko has a Codex container: false when the page is framed but its kehikko holds none. */
  onScreen: boolean
  since: number
}

/** How many pages' places are kept at once: a bound on what anything on loopback with the ticket can grow. */
const SHOWING_PAGES = 32

/** A place as `places.json` holds it, as the rest of this file names one. */
export function placeOf(entry: PlaceEntry): NamedPlace {
  const kehikko = kehikkoOf(entry.kehikko)
  return {
    epic: entry.epic,
    parts: [...entry.parts],
    kehikko,
    ...(entry.kehikko?.name ? { kehikkoName: entry.kehikko.name } : {}),
  }
}

/** Something following along: every change of state, and — when it asked for them — notices. */
export interface Follower {
  /** Whether this one can pass a notice on to a host. */
  notices: boolean
  /** The project (resolved) whose sessions its activity list is about; null for every project's. */
  project?: string | null
  state(stated: Stated): void
  notice(notice: Notice): void
  /** The whole activity list, when it changes and once on arrival. */
  activity?(rows: ActivityRow[]): void
  /** A project's record changed under the page: one was reported started, or one was connected (`assigned`). */
  sessions?(project: string, assigned?: { key: string; session: string }): void
  /** A running session's context changed (meter.ts): what the View menu's line for it says. */
  context?(said: Metered): void
}

/** A session's context, as it is said to a page: the session, and its context or null for none known. */
export interface Metered {
  session: string
  context: Context | null
}

/** What the feed's `sessions` event says: the project whose record changed, and — from `$kehikot-here` — where which conversation was connected. */
export interface SessionsChanged {
  project: string
  key?: string
  session?: string
}

export interface RunsOptions {
  /** Where the first line of a subagent's task is read from (research.ts); a test gives its own. */
  subagentTask?(agent: string): Promise<string | null>
  spawn: Spawn
  screen: (cols: number, rows: number) => Screen | Promise<Screen>
  program?: Program
  /** How long an untouched, unrecorded session outlives its last viewer. */
  grace?: number
  /** How long a session nobody is looking at may print nothing before it is put away. */
  quiet?: number
  /** How long a session called working may print nothing before it is called nothing. */
  stale?: number
  /** How long a page that has just arrived waits for what was held; 0 hands it over at once. */
  heldWait?: number
  /** The port a report is posted to: this server's own. Null (and before it is known) nothing is asked to report. */
  port?: () => number | null
  /** How often the quiet ones are looked for; null for never, when a test calls `rest` itself. */
  every?: number | null
  /** How often background sessions with a view here are asked about (see `watch`); null for never, when a test calls `watch` itself. */
  watchEvery?: number | null
  /** How often the context of the sessions on screen is looked at again (`METER_EVERY`); null for never, when a test calls `meters` itself. */
  meterEvery?: number | null
  now?: () => number
  log?: (line: string) => void
  /** Asks the host for a session's doors (`hostDoors`); a test stands one in. */
  doors?: (asked: DoorsAsked) => Promise<SessionDoor[] | null>
  /** Asks the host for a session's doors and the modules on its kehikko (`hostPlace`), for what a session is told (context.ts); a test stands one in. */
  place?: (asked: DoorsAsked) => Promise<HostPlace | null>
  /** How a session's skills are fetched from the modules on its kehikko; a test stands one in. */
  fetch?: typeof fetch
  /** Where `--mcp-config` files are written; this user's temporary folder by default. */
  configBase?: string
  /** Where Kehikot's skills are installed for Codex: `~/.agents/skills` by default (agentSkills.ts). A test points it at scratch. */
  agentsDir?: string
}

/**
 * Every run this process holds. A class so that a test can have one of its
 * own with a stand-in pty; the server has exactly one (see `theRuns`).
 */
export class Runs {
  readonly runs = new Map<string, Run>()
  private readonly program: Program
  private readonly grace: number
  private readonly quiet: number
  private readonly stale: number
  private readonly heldWait: number
  private readonly now: () => number
  private readonly log: (line: string) => void
  /** Opens in flight, by id, so two viewers arriving together get one run and not two. */
  private readonly starting = new Map<string, Promise<Run | Refusal>>()
  /** Pages following along (see `subscribe`). */
  private readonly followers = new Set<Follower>()
  /** Notices no page was there to take, oldest first. */
  private readonly held: Notice[] = []
  private noticed = 0
  /** The last activity list handed to each follower, as text, so that only a change is said. */
  private readonly activityIs = new Map<Follower, string>()
  /** Where reports are posted. Set by whoever knows the port this server bound. */
  port: () => number | null
  private readonly watchEvery: number | null
  /** The next asking about background sessions, while one is due (see `watch`). */
  private watchTimer: ReturnType<typeof setTimeout> | null = null
  /** An asking in flight: never two at once. */
  private watchBusy = false
  /** How many askings in a row have failed: the wait doubles with each, and only the first is logged. */
  private watchFailed = 0
  /**
   * The projects (resolved) whose places' background sessions are watched: every project a page or
   * an open has named since this server started. A project is named by the page framed in it, so
   * the background sessions of every epic and part of it are watched, not only those with a view.
   */
  private readonly projects = new Set<string>()
  /** The background sessions of those projects' places that no run here is a view of, by session (see `Unviewed`). */
  private readonly unviewed = new Map<string, Unviewed>()
  /** The state each conversation was last seen in, and since when, by session id (see `entered`). */
  private readonly stated = new Map<string, { state: State; since: number }>()
  /** What each framed page has open, by the page's own id (see `show`). */
  private readonly showing = new Map<string, Showing>()
  /** How many feeds each page has open: what it shows is kept only while one is (see `feeds`). */
  private readonly feeding = new Map<string, number>()
  /** Where each project's places' sessions were followed to, kept while the record and what is running are unchanged. */
  private readonly heads = new Map<string, { stamp: string; heads: Map<string, string> }>()
  /** Each watched project's look at what was cut off while this module was not running (`recover`), once per project. */
  private readonly recovering = new Map<string, Promise<void>>()
  /** The Inbox lines the projects' records hold besides the sessions' states (`recordRows`), by project. */
  private readonly extras = new Map<string, ActivityRow[]>()
  /** What each transcript was when it was last read for cut-off work: its size and time, by project and session. */
  private readonly cutRead = new Map<string, string>()
  /** When the transcripts were last read for cut-off work (`CUTOFF_EVERY`). */
  private cutAt = Number.NEGATIVE_INFINITY
  /**
   * Where each token this process gave out was started — the place a session's hooks speak from
   * (context.ts) before its run exists, and after: a background conversation's is also kept in its
   * kept folder (`writeKeptPlace`), for when this process is another one. The newest few hundred.
   */
  private readonly issued = new Map<string, Started>()
  /** Every session's transcript, read as it grows, for its context (meter.ts). */
  private readonly gauges = new Gauges()
  /** What each run's viewers were last told of its context and whether Compact and Clear can be pressed. */
  private readonly metered = new WeakMap<Run, string>()

  constructor(private readonly options: RunsOptions) {
    this.program = options.program ?? PROGRAM
    this.grace = options.grace ?? UNTOUCHED_GRACE
    this.quiet = options.quiet ?? QUIET_REST
    this.stale = options.stale ?? STALE_WORK
    this.heldWait = options.heldWait ?? HELD_WAIT
    this.port = options.port ?? (() => null)
    this.now = options.now ?? Date.now
    this.log = options.log ?? (() => {})
    const every = options.every === undefined ? Math.min(REST_EVERY, this.quiet) : options.every
    if (every !== null) setInterval(() => this.rest(), every).unref?.()
    this.watchEvery = options.watchEvery === undefined ? WATCH_EVERY : options.watchEvery
    const meterEvery = options.meterEvery === undefined ? METER_EVERY : options.meterEvery
    if (meterEvery !== null) setInterval(() => this.meters(), meterEvery).unref?.()
  }

  /** Whether an asking about background sessions is due or under way. */
  get watching(): boolean {
    return this.watchTimer !== null || this.watchBusy
  }

  /** The runs that are views of a background session, still open. */
  private views(): Run[] {
    return [...this.runs.values()].filter((run) => run.what === 'session' && !run.ended && run.joined !== null)
  }

  /**
   * Whether there is anything to ask about: a view of a background session, or a project whose
   * places' background sessions are listed — the latter only while a page follows along, since
   * nothing else reads that list.
   */
  private due(): boolean {
    return this.views().length > 0 || (this.projects.size > 0 && this.followers.size > 0)
  }

  /**
   * Watch the background sessions of this project's places from now on (see `Unviewed`): what
   * every epic and part of it has running in the background is listed, whether or not anybody has
   * a view of it here. Asked at once when it is new, and then on the clock.
   */
  know(projectPath: string): void {
    if (this.projects.has(projectPath)) return
    this.projects.add(projectPath)
    if (!this.recovering.has(projectPath)) {
      this.recovering.set(
        projectPath,
        this.recover(projectPath).catch((error: unknown) => this.log(`codex: looking for what a restart cut off in ${projectPath} failed — ${error instanceof Error ? error.message : String(error)}`)),
      )
    }
    this.kick()
  }

  /** The look at what a restart cut off in this project, when one was begun (for a test, and for `start`). */
  recovered(projectPath: string): Promise<void> {
    return this.recovering.get(projectPath) ?? Promise.resolve()
  }

  /**
   * What happened in this project's conversations while this module was not running — asked once,
   * when a page or an open first names the project after this process started.
   *
   * ## A conversation a restart cut off mid-turn
   *
   * A Codex session started here is a child of this process (see `fresh` in program.ts), so a
   * restart of the module or of Kehikot ends it. Each conversation's record carries `working` while
   * this module sees it working; one still marked and no longer held by any process was cut off.
   * A record from before that mark is judged by its transcript instead: grown in the last half
   * hour, and its last turn not ended (`midTurn`).
   *
   * Each such conversation, at most once per interruption (the mark is cleared first), and never
   * one a person ended here (ending it clears the mark): one Inbox line says its turn was cut off,
   * and — unless the person turned off "Resume conversations cut off by a restart" in this project
   * — the next time its place is opened it is resumed with one sentence of this module's
   * (`RESUME_LINE`, see `start`). Codex has no background to wake it in unasked.
   *
   * ## Background work that did not finish
   *
   * Then every conversation's transcript is read for background tasks that were cut off or failed
   * (`readCutOffs`), so what happened while this module was down is told too.
   */
  async recover(projectPath: string): Promise<void> {
    const read = readPlaces(projectPath)
    if (!read.ok) return
    /* The ones that may have been cut off first, from the record and their transcripts; the program
       is asked what is running only when there is one. */
    const candidates: [string, PlaceEntry][] = []
    for (const [id, entry] of Object.entries(read.value.sessions)) {
      if (entry.ignored || this.find(id)) continue
      const at = placeEntryFor(read.value, id)
      if (at && (entry.working || (await this.wasCut(projectPath, id, entry)))) candidates.push([id, at])
    }
    const file = candidates.length ? this.program.find().file : null
    const running = file ? await this.running(file) : ({ known: false, why: 'failed' } as const)
    if (file && running.known) {
      const settings = readSettings(projectPath)
      const live = new Set(running.active.map((one) => one.session))
      for (const [id] of candidates) {
        if (live.has(id) || this.find(id)) continue
        /* Once per interruption: the mark goes before anything else is tried. */
        markSession(projectPath, id, (one) => {
          if (!one.working) return false
          delete one.working
          return true
        })
        if (!settings.resumeCutOff) {
          this.log(`codex: ${id} was working when it was cut off by a restart; not resumed — "${RESUME_SETTING}" is off in ${projectPath}`)
          markSession(projectPath, id, (one) => {
            one.cutOff = { through: one.cutOff?.through ?? this.now(), open: [...(one.cutOff?.open ?? []), { at: this.now(), kind: 'turn' as const, summary: 'Its turn was cut off when Kehikot restarted', tasks: 1 }].slice(-8) }
            return true
          })
          continue
        }
        /* Codex has no background to wake it in: it is told what happened when the person opens it
           (`start`), and until then one Inbox line says it was cut off. */
        this.log(`codex: ${id} was working when it was cut off by a restart — it is told so when its place is next opened`)
        markSession(projectPath, id, (one) => {
          one.cutOff = { through: one.cutOff?.through ?? this.now(), open: [...(one.cutOff?.open ?? []), { at: this.now(), kind: 'turn' as const, summary: 'Its turn was cut off when Kehikot restarted', tasks: 1 }].slice(-8) }
          one.resumeLine = true
          return true
        })
      }
    }
    await this.readCutOffs(projectPath, true)
  }

  /**
   * Whether a conversation recorded before this module kept a `working` mark was cut off mid-turn:
   * never read by this release (no `cutOff`), never run in the background, its transcript grown in
   * the last half hour, and its last turn not ended.
   */
  private async wasCut(projectPath: string, id: string, entry: SessionEntry): Promise<boolean> {
    if (entry.cutOff || entry.background || entry.resumed) return false
    const file = await recordFile(projectPath, id)
    if (!file) return false
    try {
      if (this.now() - (await stat(file)).mtimeMs > LEGACY_WINDOW) return false
    } catch {
      return false
    }
    return midTurn(await tailOfFile(file, CUTOFF_TAIL))
  }

  /**
   * Read the transcripts of this project's conversations for background tasks that were cut off or
   * failed (cutoff.ts), and keep what is found in the record (`cutOff`): each task once, read up to
   * the last one told; told until the person moves the conversation on. A transcript is read again
   * only when it has grown, and only what is newer than the last one told — the first time, the
   * last day of it. Not more often than `CUTOFF_EVERY` unless `now`.
   */
  async readCutOffs(projectPath: string, now = false): Promise<void> {
    if (!now && this.now() - this.cutAt < CUTOFF_EVERY) return
    if (!now) this.cutAt = this.now()
    const read = readPlaces(projectPath)
    if (!read.ok) return
    const edits = new Map<string, (entry: SessionEntry) => boolean>()
    for (const [id, entry] of Object.entries(read.value.sessions)) {
      if (entry.ignored || !placeEntryFor(read.value, id)) continue
      const file = await recordFile(projectPath, id)
      if (!file) continue
      let stamp = ''
      let grown = 0
      try {
        const said = await stat(file)
        stamp = `${said.size}@${said.mtimeMs}`
        grown = said.mtimeMs
      } catch {
        continue
      }
      const key = `${projectPath}\0${id}`
      if (this.cutRead.get(key) === stamp) continue
      this.cutRead.set(key, stamp)
      const since = entry.cutOff?.through ?? this.now() - FIRST_LOOK
      if (entry.cutOff && grown <= since && entry.cutOff.open.length === 0) continue
      const tail = await tailOfFile(file, CUTOFF_TAIL)
      const fresh = cutOffs(tail).filter((one) => one.at > since)
      const open: CutOff[] = [...(entry.cutOff?.open ?? []), ...fresh].slice(-8)
      const latest = open.reduce((most, one) => Math.max(most, one.at), 0)
      const dealt = open.length > 0 && movedOn(tail, latest, [RESUME_LINE])
      const next = { through: fresh.reduce((most, one) => Math.max(most, one.at), since), open: dealt ? [] : open }
      if (JSON.stringify(next) === JSON.stringify(entry.cutOff ?? null)) continue
      if (fresh.length) this.log(`codex: ${id} — ${fresh.map((one) => one.summary).join('; ')}`)
      if (dealt) this.log(`codex: ${id} moved on since its background work was cut off; its Inbox line goes`)
      edits.set(id, (one) => {
        one.cutOff = next
        return true
      })
    }
    const written = markSessions(projectPath, edits)
    if (!written.ok) this.log(`codex: ${written.error}`)
    this.recount(projectPath)
  }

  /** The Inbox lines of a project's record, read again; said where they changed. */
  private recount(projectPath: string): void {
    const read = readPlaces(projectPath)
    this.extras.set(projectPath, read.ok ? recordRows(read.value, projectPath, this.now()) : [])
    this.changed()
  }

  /**
   * Keep the record's `working` mark with what a conversation is doing: set when it starts working,
   * gone when its turn ends or it stops for the person. Nothing is said of "no state": that is also
   * what a conversation cut off looks like, and the mark is what tells that apart (`recover`).
   */
  private markWorking(projectPath: string, id: string | null, state: State | null): void {
    if (!id || state === null) return
    const working = state === 'working'
    const written = markSession(projectPath, id, (entry) => {
      if (working) {
        if (entry.working) return false
        entry.working = new Date(this.now()).toISOString()
        return true
      }
      if (!entry.working) return false
      delete entry.working
      return true
    })
    if (!written.ok) this.log(`codex: ${written.error}`)
  }

  /** The person has the conversation on screen: its "resumed after a restart" line has been seen, and goes. */
  private toldResumed(run: Run): void {
    const id = run.settled
    if (!id || run.looking.size === 0) return
    if (!(this.extras.get(run.projectPath) ?? []).some((row) => row.id === `resumed:${id}`)) return
    markSession(run.projectPath, id, (entry) => {
      if (!entry.resumed || entry.resumed.told) return false
      entry.resumed.told = true
      return true
    })
    this.recount(run.projectPath)
  }

  /** Ask now, if something is to be asked about and the clock runs, and then keep the clock. */
  private kick(): void {
    if (this.watchEvery === null || this.watchBusy || !this.due()) return
    if (this.watchTimer) clearTimeout(this.watchTimer)
    this.watchTimer = null
    void this.watch().finally(() => this.keepWatching())
  }

  /** Have the next asking due, if there is a view to ask about and none is due or under way. */
  private keepWatching(): void {
    if (this.watchEvery === null || this.watchTimer || this.watchBusy || !this.due()) return
    const wait = this.watchFailed === 0 ? this.watchEvery : Math.min(WATCH_MOST, this.watchEvery * 2 ** Math.min(this.watchFailed, 10))
    this.watchTimer = setTimeout(() => {
      this.watchTimer = null
      void this.watch().finally(() => this.keepWatching())
    }, wait)
    this.watchTimer.unref?.()
  }

  /**
   * Ask the program what each background session this module has a view of is
   * doing (`agents --json`, its `state`), and make that the run's state — so
   * that it is said, listed and noticed exactly as a session that reports is.
   *
   * (In the Claude module a view runs `claude attach`, which runs no hooks; Codex has no such
   * view.) Its state is asked, on a clock, for as long as there is a view open, and the clock
   * stops with the last one. One asking at a time. A failed asking changes
   * nothing, waits longer before the next, and is logged once until one works.
   * A session the program no longer lists has no state that still holds.
   */
  async watch(): Promise<void> {
    if (this.watchBusy || (this.views().length === 0 && this.projects.size === 0)) return
    this.watchBusy = true
    try {
      /* When it was asked, not when it answered: a line sent while the asking was under way is not taken by what it says. */
      const asked = this.now()
      const running = await this.running()
      if (!running.known) {
        if (this.watchFailed === 0) this.log(`codex: could not ask what the background sessions are doing (${running.why === 'too-old' ? 'this copy has no `agents --json`' : 'the asking failed'}) — asking less often until it works`)
        this.watchFailed += 1
        return
      }
      if (this.watchFailed > 0) this.log('codex: asking what the background sessions are doing works again')
      this.watchFailed = 0
      for (const run of this.views()) {
        /* By its handle as well: after /clear the background session is the same job on a new conversation. */
        const handle = run.joined!.handle
        const listed = running.active.find((one) => one.kind === 'background' && (one.session === run.joined!.session || (handle !== null && one.handle === handle)))
        if (listed && listed.session !== run.joined!.session) await this.movedOn(run, listed, running)
        this.placed(run, listed ?? null, asked)
        this.become(run, listed?.state ?? null)
      }
      /* Where each session this module runs in a terminal of its own is: by its process. */
      for (const run of this.runs.values()) {
        if (run.what !== 'session' || run.ended || run.joined) continue
        const listed = running.active.find((one) => one.pid !== null && one.pid === run.pty.pid)
        if (listed) this.placed(run, listed, asked)
      }
      await this.see(running)
      for (const projectPath of this.projects) await this.readCutOffs(projectPath).catch(() => {})
      if (this.projects.size > 0) this.cutAt = this.now()
    } finally {
      this.watchBusy = false
    }
  }

  /**
   * The background sessions of every watched project's places that no run here is a view of, from
   * what the program says is running and each project's `places.json` — and nothing else. A place's
   * session is followed to where its conversation is now (`headOf`), since Codex carries a
   * conversation on under a new id. A session listed under several places is said once, under the
   * place whose `current` it is, else the first place that lists it. A change of state is said to
   * every follower, and a turn that ended or stopped for the person is noticed as a view's is; one
   * first seen in a state is listed and not noticed, since when it got there is not known.
   */
  private async see(running: Extract<Running, { known: true }>): Promise<void> {
    const background = new Map(running.active.filter((one) => one.kind === 'background').map((one) => [one.session, one]))
    const mine = new Set<string>()
    for (const run of this.runs.values()) {
      if (run.what !== 'session' || run.ended) continue
      mine.add(run.id)
      if (run.settled) mine.add(run.settled)
      if (run.joined) mine.add(run.joined.session)
    }
    const next = new Map<string, Unviewed>()
    if (background.size > 0) {
      for (const projectPath of this.projects) {
        const read = readPlaces(projectPath)
        if (!read.ok) continue
        const places = read.value
        const entries = Object.entries(places.places).sort(([a], [b]) => a.localeCompare(b))
        if (entries.length === 0) continue
        const heads = await this.headsOf(projectPath, places, running)
        /* The place whose current session it is first, then every other place that lists it. */
        const claims: [PlaceEntry, string][] = [
          ...entries.flatMap(([, entry]) => (entry.current ? [[entry, entry.current] as [PlaceEntry, string]] : [])),
          ...entries.flatMap(([, entry]) => entry.sessions.map((id) => [entry, id] as [PlaceEntry, string])),
        ]
        for (const [entry, id] of claims) {
          const head = heads.get(id) ?? id
          const listed = background.get(head)
          if (!listed || mine.has(head) || next.has(head)) continue
          const was = this.unviewed.get(head)
          const state = listed.state ?? null
          next.set(head, {
            session: head,
            projectPath,
            at: placeOf(entry),
            label: listed.name || places.sessions[head]?.label || places.sessions[id]?.label || '',
            state,
            since: state === null ? (was && was.state === null ? was.since : this.now()) : this.entered(projectPath, head, state),
            /* Called something in the record: something was said in it. (Codex runs no background session, so this is never reached.) */
            turned: Boolean(places.sessions[head]?.label || places.sessions[id]?.label),
          })
        }
      }
    }
    const before = new Map(this.unviewed)
    const gone = [...before.values()].filter((one) => !next.has(one.session))
    const moved = [...next.values()].filter((one) => (before.has(one.session) ? before.get(one.session)!.state !== one.state : one.state !== null))
    this.unviewed.clear()
    for (const [id, one] of next) this.unviewed.set(id, one)
    for (const one of gone) if (!mine.has(one.session)) this.announce({ session: one.session, state: null, since: this.now() })
    for (const one of moved) {
      this.markWorking(one.projectPath, one.session, one.state)
      this.announce({ session: one.session, state: one.state, since: one.since })
      if (before.has(one.session)) this.noticeOf(one)
    }
    /* Said only where the list differs from what a follower was last handed (`changed`). */
    this.changed()
  }

  /**
   * Where each session `places` names is now (`headOf`): asked of the program's records once, and
   * kept until the record or what is running changes — a conversation is carried on only by a
   * process starting on it, which changes what is running.
   */
  private async headsOf(projectPath: string, places: Places, running: Extract<Running, { known: true }>): Promise<Map<string, string>> {
    const ids = recordedIds(places)
    const live = new Set<string>(running.active.map((one) => one.session))
    for (const run of this.runs.values()) if (run.settled) live.add(run.settled)
    const stamp = JSON.stringify([ids, [...live].sort()])
    const kept = this.heads.get(projectPath)
    if (kept?.stamp === stamp) return kept.heads
    const held = new Map((await this.program.sessions(projectPath, ids)).map((one) => [one.id, one]))
    const heads = new Map(ids.map((id) => [id, headOf(id, held, live)]))
    this.heads.set(projectPath, { stamp, heads })
    return heads
  }

  /** Say a session's state to every page following: one this module has no run for. */
  private announce(stated: Stated): void {
    for (const follower of this.followers) follower.state(stated)
  }

  /** A background session nobody has a view of came to need the person, or finished its turn: noticed once. */
  private noticeOf(one: Unviewed): void {
    if (one.state !== 'needs-you' && one.state !== 'finished') return
    /* Not news: no turn yet, or a question seen before (`needsYou`). */
    if (one.state === 'needs-you' && (!one.turned || one.seen)) return
    const at = one.at
    this.noticed += 1
    this.raise({
      seq: this.noticed,
      session: one.session,
      state: one.state,
      label: one.label,
      projectPath: one.projectPath,
      epic: at.epic,
      parts: at.parts.map((id, index) => at.partNames?.[index] || id),
      kehikko: at.kehikkoName ?? '',
      partIds: [...at.parts],
      kehikkoKey: at.kehikko && 'key' in at.kehikko ? at.kehikko.key : null,
      at: this.now(),
    })
  }

  /* ---------------------------------------------------------------- *
   * The context meter, and Compact and Clear
   * ---------------------------------------------------------------- */

  /** Where a run's process is, as `agents --json` said it when it was asked at `at`. */
  private placed(run: Run, listed: Active | null, at: number): void {
    const before = this.readiness(run)
    run.status = listed?.status ?? null
    run.statusAt = at
    if (run.status === 'idle') run.idleAt = Math.max(run.idleAt, at)
    if (this.readiness(run) !== before) void this.meter(run)
  }

  /**
   * A background session this run is a view of is on another conversation now: `/clear` typed in
   * it starts a new one in the same job (the handle stays; the session id is new — measured on
   * 2.1.310). Recorded as the place's session, as `track` does for a session in a terminal here;
   * the conversation it left stays listed, and can be opened again.
   */
  private async movedOn(run: Run, listed: Active, running?: Running): Promise<void> {
    if (!(await this.program.settled(run.projectPath, listed.session, 0))) return
    if (run.joined) run.joined = { ...listed, handle: listed.handle ?? run.joined.handle }
    await this.moveTo(run, listed.session, running)
  }

  /** A session's context, from its transcript (read as it grows) and its own status line. Null when neither says anything. */
  async contextOf(projectPath: string, session: string): Promise<Context | null> {
    if (!this.program.isId(session)) return null
    const file = await recordFile(projectPath, session)
    return contextOf(await this.gauges.read(file))
  }

  /**
   * Why Compact and Clear cannot be pressed for this run now, or null when they can. They are
   * typed at its prompt, so only when its program is waiting there and nothing is typed at it —
   * never into a turn that is under way, a question on screen, or a line the person has not sent.
   * Decided from the newest of what its hooks said (a session in a terminal here) and what
   * `agents --json` says of its process, which has to be later than the last line sent to it.
   */
  readiness(run: Run): string | null {
    if (run.what !== 'session' || run.ended) return 'The session is not running.'
    if (!run.settled) return 'Nothing has been said in this conversation yet.'
    if (run.prompt.chars > 0) return 'Something is typed at Codex’s prompt and not sent. Send it or clear it first.'
    const said: { at: number; idle: boolean; why: string }[] = []
    const busy = 'Codex is working. Compact and Clear wait until it is back at its prompt.'
    const asking = 'Codex is waiting for an answer on screen.'
    if (run.secret !== null && run.state !== null) {
      said.push({ at: run.stateSince, idle: run.state === 'finished', why: run.state === 'needs-you' ? asking : busy })
    }
    if (run.status !== null) {
      said.push({ at: run.statusAt, idle: run.status === 'idle', why: run.status === 'waiting' ? asking : run.status === 'shell' ? 'A shell command is running in it.' : busy })
    }
    const newest = said.sort((a, b) => b.at - a.at)[0]
    if (!newest) return 'It is not known yet whether Codex is waiting at its prompt.'
    if (!newest.idle) return newest.why
    /* A turn's end its own hook said (`Stop`) comes after the turn; `agents --json` may say `idle` before one begins. */
    const taken = newest.at === run.stateSince && run.state === 'finished' ? 0 : TAKEN_AFTER
    if (newest.at <= run.prompt.sentAt + taken) return 'Codex has not been seen at its prompt since a line was sent to it.'
    /* Not what it prints: an idle program redraws when its terminal gains or loses the keyboard (measured), so printing says nothing here. */
    return null
  }

  /** Say a run's context, and whether Compact and Clear can be pressed, to its viewers when it changed — and to `viewer` regardless. */
  private async meter(run: Run, viewer?: Viewer): Promise<void> {
    if (run.what !== 'session' || run.ended) return
    const session = run.settled
    const context = session ? await this.contextOf(run.projectPath, session).catch(() => null) : null
    if (run.ended || run.settled !== session) return
    const said = { session: session ?? run.id, context, ready: this.readiness(run) }
    const text = JSON.stringify(said)
    if (viewer) viewer.say({ meter: said })
    const was = this.metered.get(run)
    if (was === text) return
    this.metered.set(run, text)
    for (const one of run.viewers) if (one !== viewer) one.say({ meter: said })
    const before = was ? (JSON.parse(was) as { session: string; context: Context | null }) : null
    if (!before || before.session !== said.session || JSON.stringify(before.context) !== JSON.stringify(context)) {
      for (const follower of this.followers) follower.context?.({ session: said.session, context })
    }
  }

  /** Look at the context of every session somebody has a view of again. Called on a clock (`METER_EVERY`). */
  meters(): Promise<void[]> {
    return Promise.all([...this.runs.values()].filter((run) => run.what === 'session' && !run.ended && run.viewers.size > 0).map((run) => this.meter(run)))
  }

  /**
   * Compact or Clear, on a person's press in the page: Codex's own `/compact` or `/clear`,
   * typed at the session's prompt through the pty the person's keys go to — the attach of a
   * background one — exactly as a person types it. Only when it can be (`readiness`); the reason
   * otherwise. Reached from the page's own socket and nothing else: no door and no MCP tool.
   */
  command(run: Run, which: Command): true | string {
    if (!Object.hasOwn(COMMANDS, which)) return 'That is not something here.'
    const why = this.readiness(run)
    if (why) return why
    const text = COMMANDS[which]
    const now = this.now()
    run.prompt = { chars: 0, sentAt: now + ENTER_AFTER }
    run.touched = true
    run.stirredAt = now
    run.attendedAt = now
    run.pty.write(text)
    setTimeout(() => {
      if (!run.ended) run.pty.write('\r')
    }, ENTER_AFTER).unref?.()
    this.log(`codex: ${text} typed into ${run.settled}, on a person's press in the page`)
    void this.meter(run)
    return true
  }

  /** The run a session id names — by the id it was opened under or the one it settled as. */
  find(id: string): Run | null {
    for (const run of this.runs.values()) {
      if (run.what === 'session' && (run.id === id || run.settled === id)) return run
    }
    return null
  }

  /** The sessions running now, oldest first. */
  sessions(): Run[] {
    return [...this.runs.values()].filter((run) => run.what === 'session').sort((a, b) => a.startedAt - b.startedAt)
  }

  /**
   * Open a session for a viewer: attach to it if it is running, start it if
   * it is not. `session: null` is a new one.
   *
   * A new one is started `fresh` under an id minted here. An id that was
   * ASKED for is opened only if the program holds a record for it on this
   * machine, and then it is `resume`d. One it holds nothing for is refused —
   * whatever `places.json` says about it. That file travels with the project
   * and a transcript does not: the id may be a session on another computer,
   * or one whose transcript has been cleaned away here, and starting the
   * program fresh under it would be a new, empty conversation wearing the
   * old one's id — and, back on the other computer, a clash with the real
   * one.
   */
  async open(asked: Extract<Opening, { what: 'session' }>, viewer: Viewer): Promise<Run | Refusal> {
    const root = projectRoot(asked.projectPath)
    if (!root.ok) return { code: CLOSED.refused, why: root.error }
    const projectPath = root.value
    this.know(projectPath)

    const running = asked.session ? this.find(asked.session) : null
    if (running) {
      if (!this.claim(running, projectPath, asked.projectId ?? null)) return { code: CLOSED.refused, why: 'That session is running in another project.' }
      this.remember(running, asked.place)
      this.attach(running, viewer, asked.cols, asked.rows, 'attached')
      return running
    }

    const id = asked.session ?? this.program.newId()
    const inFlight = this.starting.get(id)
    const started = inFlight ?? this.start(projectPath, id, asked)
    if (!inFlight) {
      this.starting.set(id, started)
      void started.finally(() => this.starting.delete(id))
    }
    const run = await started
    if ('code' in run) {
      /* Said before the socket closes: a close reason is 123 bytes, and this is what the page asks its person with. */
      if (run.elsewhere) viewer.say({ elsewhere: run.elsewhere, session: id })
      return run
    }
    this.attach(run, viewer, asked.cols, asked.rows, inFlight ? 'attached' : run.joined && !run.owned ? 'background' : run.copyOf ? 'copy' : run.settled ? 'resumed' : 'new')
    return run
  }

  /**
   * Whether `run` is the project's at `root` (`sameProject`), and if it is and the project's folder
   * has moved since, follow it there: what is recorded is written in the new folder from now on,
   * the lists find it there, and its viewers are told that the program is still in the old one.
   * The process is not touched: it is never ended or restarted here.
   */
  claim(run: Run, root: string, id: string | null = null): boolean {
    if (run.what !== 'session' || !sameProject(run, root, id)) return false
    if (!run.projectId && id) run.projectId = id
    if (run.projectPath === root) return true
    this.log(`codex: the project of ${run.settled ?? run.id} moved from ${run.projectPath} to ${root}; the session runs on, started in ${run.cwd}`)
    run.projectPath = root
    for (const viewer of run.viewers) viewer.say({ session: run.settled ?? run.id, ...movedWord(run) })
    this.changed()
    return true
  }

  /**
   * A conversation this module did not start was reported in a project — by
   * Codex's SessionStart hook or `agents --json`. Recorded as not yet
   * assigned (one this module runs, or one that belongs somewhere, is left as
   * it is), and every page following that project reads its list again.
   */
  sighted(projectPath: string, id: string, via: 'hook' | 'agents', label = ''): boolean {
    if (!this.program.isId(id)) return false
    if ([...this.runs.values()].some((run) => run.id === id || run.settled === id)) return false
    const root = projectRoot(projectPath)
    if (!root.ok) return false
    const before = readPlaces(root.value)
    const written = sighted(root.value, id, via, this.now(), label)
    if (!written.ok) return false
    const was = before.ok ? JSON.stringify(before.value.sessions[id] ?? null) : ''
    if (JSON.stringify(written.value.sessions[id] ?? null) === was) return false
    this.log(`codex: ${id} was reported started in ${root.value} (${via}); it is listed there as not yet assigned`)
    this.projects.add(root.value)
    this.changed()
    for (const follower of this.followers) if (!follower.project || follower.project === root.value) follower.sessions?.(root.value)
    return true
  }

  /**
   * What a framed page has open, as it says (`POST /api/showing`): its project, the place it
   * stands on, and whether a Codex container is on the open kehikko. Kept until the page says
   * otherwise or its last feed closes (`feeds`); what `$kehikot-here` takes as "on screen".
   */
  show(page: string, showing: Omit<Showing, 'since'> | null): boolean {
    if (!showing) {
      this.showing.delete(page)
      return false
    }
    /* Only while the page's feed is open: that is what says the page is there. A page whose feed is
       not open yet says it again as the feed opens; one that has gone leaves nothing behind. */
    if (!this.feeding.has(page)) return false
    while (this.showing.size >= SHOWING_PAGES && !this.showing.has(page)) this.showing.delete(this.showing.keys().next().value!)
    this.showing.set(page, { ...showing, since: this.now() })
    return true
  }

  /**
   * A page's feed opened (`GET /api/feed?page=…`): what it says it shows is kept until the last of
   * its feeds closes. Counted, so that an old connection whose close arrives after the page opened
   * a new one does not forget what the new one said. Returns the close.
   */
  feeds(page: string): () => void {
    this.feeding.set(page, (this.feeding.get(page) ?? 0) + 1)
    let closed = false
    return () => {
      if (closed) return
      closed = true
      const left = (this.feeding.get(page) ?? 1) - 1
      if (left > 0) return void this.feeding.set(page, left)
      this.feeding.delete(page)
      this.showing.delete(page)
    }
  }

  unshow(page: string): void {
    this.showing.delete(page)
  }

  /** The places a page has on screen in this project (resolved), with a Codex container there: the latest first, one per place. */
  showingIn(projectPath: string): Showing[] {
    const seen = new Set<string>()
    return [...this.showing.values()]
      .filter((one) => one.onScreen && one.projectPath === projectPath)
      .sort((a, b) => b.since - a.since)
      .filter((one) => (seen.has(one.key) ? false : (seen.add(one.key), true)))
  }

  /**
   * Every page following this project reads its list again: the record changed under it. `assigned`
   * is `$kehikot-here` having connected a conversation to a place: the page on that place puts it on screen.
   */
  told(projectPath: string, assigned?: { key: string; session: string }): void {
    this.changed()
    /* A conversation a run here has already followed to (a `/clear` in it): its page knows from the
       run's own socket, and is not to be switched to it as if it had been connected from elsewhere —
       that would open a second view of the same session. */
    const followed = assigned && [...this.runs.values()].some((run) => run.what === 'session' && !run.ended && run.settled === assigned.session)
    for (const follower of this.followers) if (!follower.project || follower.project === projectPath) follower.sessions?.(projectPath, followed ? undefined : assigned)
  }

  /** The projects this server has been told of (by a page, an open or a report), resolved. */
  knownProjects(): string[] {
    return [...this.projects]
  }

  /** Remember where a token was given out. */
  private issue(token: string, started: Started): void {
    this.issued.delete(token)
    this.issued.set(token, started)
    while (this.issued.size > 500) this.issued.delete(this.issued.keys().next().value!)
  }

  /** Where the conversation behind a token was started: its run, what this process gave out, or its kept folder. Null for a token this module never gave out. */
  startedOf(token: string): Started | null {
    const run = [...this.runs.values()].find((one) => one.what === 'session' && one.token === token && !one.ended)
    const issued = this.issued.get(token)
    if (run) return { projectPath: run.projectPath, projectId: run.projectId, place: issued && placeKey(issued.place) === run.key ? issued.place : (run.at ?? run.place ?? issued?.place)! }
    return issued ?? null
  }

  /** The names of the doors the conversation behind a token was started with, when known. */
  doorNamesOf(token: string): string[] | null {
    const run = [...this.runs.values()].find((one) => one.what === 'session' && one.token === token && !one.ended)
    return run?.doors.length ? run.doors.map((door) => door.name) : null
  }

  /** The skills folder of the session behind a token, while it runs: what its context lists. */
  kitOf(token: string): string | null {
    return [...this.runs.values()].find((one) => one.what === 'session' && one.token === token && !one.ended)?.plugin ?? null
  }

  /**
   * A session's own hook asking what it is to be told (`POST /api/context`, see context.ts): its
   * place and the modules on its kehikko at a start, what changed at a prompt — and the
   * conversation filed under the place it was started at when it belongs nowhere yet.
   */
  async context(event: string, session: string, token: string | null): Promise<HookAnswer | null> {
    /* A run here whose process starts another conversation (`/clear`, `/resume` in it) follows it now,
       before the conversation is filed and pages are told: from the hook of its own plugin. */
    const run = token && PLACE_TOKEN.test(token) ? [...this.runs.values()].find((one) => one.what === 'session' && !one.ended && one.token === token) : undefined
    if (run && event === 'SessionStart' && this.program.isId(session) && session !== (run.settled ?? run.id)) await this.moveTo(run, session).catch(() => {})
    return context(
      { event, session, token },
      {
        program: this.program,
        startedOf: (one) => this.startedOf(one),
        host: (asked) => (this.options.place ?? hostPlace)(asked),
        doorsOf: (one) => this.doorNamesOf(one),
        toldFile: (one) => this.toldFileOf(one),
        kitOf: (one) => this.kitOf(one),
        told: (projectPath, assigned) => this.told(projectPath, assigned),
        log: this.log,
        later: (run, ms) => setTimeout(run, ms).unref?.(),
      },
    )
  }

  /** Where what the conversation behind a token was last told is kept: beside its kit while it runs. */
  toldFileOf(token: string): string {
    return join(this.kitOf(token) ?? join(this.options.configBase ?? tmpdir(), 'kehikot-codex-told'), 'kehikot', 'told.json')
  }

  /** What the conversation behind a token was last told (context.ts), in words; null when nothing is kept. */
  toldOf(token: string): Said | null {
    if (!PLACE_TOKEN.test(token)) return null
    return toldWords(this.toldFileOf(token))
  }

  /**
   * What a conversation of this project was last told, for the page's "What this conversation was
   * told": by the token of the run holding it, else the token the record gave it. Null when it was
   * told nothing this module kept (started elsewhere, or its session's kit is gone).
   */
  toldFor(projectPath: string | null, session: string): Said | null {
    if (!this.program.isId(session)) return null
    const run = [...this.runs.values()].find((one) => one.what === 'session' && !one.ended && (one.settled ?? one.id) === session && one.token)
    if (run?.token) return this.toldOf(run.token)
    const root = projectRoot(projectPath)
    const read = root.ok ? readPlaces(root.value) : null
    const token = read?.ok && Object.hasOwn(read.value.sessions, session) ? read.value.sessions[session]?.token : undefined
    return token ? this.toldOf(token) : null
  }

  /**
   * The place a token's conversation belongs to, as the record says — what a
   * Kehikot door is told (`/api/kehikot/place`). A conversation running here
   * that the program has not recorded yet belongs to the place it was started
   * at. Null for a token nothing here gave out.
   */
  placeOf(token: string, projectPath: string | null): RecordedPlace | null {
    const run = [...this.runs.values()].find((one) => one.token === token && !one.ended)
    const root = projectRoot(run?.projectPath ?? projectPath)
    const read = root.ok ? readPlaces(root.value) : null
    const recorded = read?.ok ? read.value : null
    const said = (conversation: string, key: string | null): RecordedPlace | null => {
      const place = key ? readPlaceKey(key) : null
      if (!place) return null
      return { conversation, epic: place.epic, parts: place.parts, kehikko: place.kehikko && 'key' in place.kehikko ? place.kehikko.key : null }
    }
    if (run) {
      const conversation = run.settled ?? run.id
      const home = recorded && run.settled ? homeOf(recorded, run.settled) : null
      return said(conversation, home ?? (run.place ? placeKey(run.place) : run.settled ? null : run.key))
    }
    const found = recorded ? byToken(recorded, token) : null
    return found ? said(found.id, found.home) : null
  }

  /**
   * Which doors a running session would be given now that it was not, and
   * which it has that its kehikko no longer holds — by name, for the line that
   * offers a restart. Null when it was given none, or the host does not answer.
   */
  async doorsChanged(id: string): Promise<{ added: string[]; removed: string[] } | null> {
    const run = this.find(id)
    if (!run?.token) return null
    const kehikko = run.at?.kehikko && 'key' in run.at.kehikko ? run.at.kehikko.key : null
    const now = await (this.options.doors ?? hostDoors)({ projectPath: run.projectPath, projectId: run.projectId, token: run.token, kehikko }).catch(() => null)
    if (!now) return null
    const had = new Set(run.doors.map((door) => door.name))
    const has = new Set(now.map((door) => door.name))
    return { added: [...has].filter((name) => !had.has(name)), removed: [...had].filter((name) => !has.has(name)) }
  }

  /**
   * End a session whose project's folder was renamed under it, so that it is resumed in the new
   * folder: only on a person's press, and never while it is working. Its viewers are closed with
   * `CLOSED.moved` and open it again, which resumes the same session with the new folder as its
   * working directory. A sentence when it is not done.
   */
  restartIn(id: string, why: 'moved' | 'doors' = 'moved'): true | string {
    const run = this.find(id)
    if (!run) return 'That session is not running.'
    if (why === 'moved' && run.cwd === run.projectPath) return 'That session already runs in its project’s folder.'
    if (run.state === 'working') return 'It is working. Restart it when it is idle.'
    run.restarting = true
    this.log(`codex: ${run.settled ?? run.id} is ended by a person to be resumed ${why === 'doors' ? 'with the doors of its kehikko now' : `in ${run.projectPath}`}`)
    kill(run.pty)
    return true
  }

  /**
   * What the program says is running, asked now. Not asked of a copy that
   * cannot answer, and that is said as what it is.
   */
  async running(file: string | null = this.program.find().file): Promise<Running> {
    if (!file) return { known: false, why: 'failed' }
    if (!(await this.program.supports(file)).lists) return { known: false, why: 'too-old' }
    return this.program.active(file).catch((): Running => ({ known: false, why: 'failed' }))
  }

  /**
   * Of what is running, the processes that hold this session and are not
   * this module's own: the background one if there is one — a view of it
   * starts nothing, so it is always the one to take — and otherwise a process
   * with a terminal of its own.
   */
  others(running: Running, session: string): { background: Active | null; open: Active | null } {
    if (!running.known) return { background: null, open: null }
    const mine = new Set([...this.runs.values()].map((run) => run.pty.pid))
    const there = running.active.filter((one) => one.session === session && !(one.pid !== null && mine.has(one.pid)))
    return { background: there.find((one) => one.kind === 'background' && one.handle) ?? null, open: there.find((one) => !(one.kind === 'background' && one.handle)) ?? null }
  }

  /**
   * Where the conversation recorded as `id` is now: `id` itself, or the
   * session Codex carried it on in (see `headOf`) — preferring one a
   * process is holding right now.
   */
  async head(projectPath: string, id: string, running?: Running): Promise<string> {
    const held = new Map((await this.program.sessions(projectPath, [id])).map((one) => [one.id, one]))
    const live = new Set<string>(running?.known ? running.active.map((one) => one.session) : [])
    for (const run of this.runs.values()) if (run.settled) live.add(run.settled)
    return headOf(id, held, live)
  }

  /**
   * Which conversation this run's process is showing now, and if it is no
   * longer the one recorded, make it the one recorded — as this place's
   * current session — and tell the viewers.
   *
   * It moves without this module doing anything: Codex resumes a
   * conversation under a new id, and a person may `/resume` another one or
   * `/clear` inside the terminal. Asked of the program itself
   * (`agents --json`, which lists each process with the session it holds, by
   * pid); a copy that cannot be asked is followed by its record instead —
   * the conversation carried on from the recorded one that nobody else holds.
   *
   * Never for a view of a background session: that process is not this
   * module's, and it is `attach`ed to by its handle.
   */
  async track(run: Run): Promise<void> {
    if (run.what !== 'session' || run.ended || run.joined || !run.settled) return
    run.trackedAt = this.now()
    const running = await this.running()
    let now: string | null = null
    if (running.known) {
      const mine = running.active.find((one) => one.pid !== null && one.pid === run.pty.pid)
      if (mine && this.program.isId(mine.session)) now = mine.session
    }
    if (!now) {
      const head = await this.head(run.projectPath, run.settled, running)
      const { background, open } = this.others(running, head)
      if (head !== run.settled && !background && !open) now = head
    }
    if (!now || now === run.settled || run.ended) return
    await this.moveTo(run, now, running)
  }

  /**
   * The process behind a run is on another conversation now — `/resume` or `/clear` typed in it, or
   * the conversation carried on under a new id — once Codex has a record of it: the run
   * follows, and so does the record. Carried on, the old id is the same conversation a step behind
   * and is replaced wherever it is; switched (a `/clear`, a `/resume` of another), the new one is
   * listed at the place and is what opens there next, and the old one stays listed. Asked from
   * three sides — the run's process (`track`), its background job (`movedOn`) and its own
   * `SessionStart` hook (`context`) — and done once.
   */
  private async moveTo(run: Run, now: string, running?: Running): Promise<void> {
    if (run.ended || now === run.settled || !this.program.isId(now)) return
    if (!(await this.program.settled(run.projectPath, now, 0))) return
    if (run.ended || now === run.settled) return
    const was = run.settled ?? run.id
    const continued = (await this.head(run.projectPath, was, running)) === now
    if (run.ended || now === run.settled) return
    run.settled = now
    if (run.joined) run.joined = { ...run.joined, session: now }
    this.log(`codex: the process behind ${run.id} is now on ${now} (${continued ? 'carried on from' : 'switched from'} ${was}) — recorded as its place's session`)
    const known = (await this.program.sessions(run.projectPath, [now])).find((one) => one.id === now)
    /* A new conversation is called what it is called, which may be nothing yet: never the old one's name. */
    run.label = known?.label || (continued ? run.label : '')
    /* Carried on: the old id is the same conversation a step behind, and is replaced wherever it is. */
    if (continued) {
      const moved = follow(run.projectPath, was, now, { label: known?.label, lastActive: known?.lastActive })
      if (!moved.ok) this.log(`codex: ${moved.error}`)
    }
    if (run.at) {
      const written = attach(run.projectPath, run.at, now, { label: known?.label, lastActive: known?.lastActive })
      if (!written.ok) this.log(`codex: ${written.error}`)
    }
    for (const viewer of run.viewers) viewer.say({ exists: true, session: now, label: run.label })
    this.changed()
    void this.meter(run)
  }

  private async start(projectPath: string, id: string, asked: Extract<Opening, { what: 'session' }>): Promise<Run | Refusal> {
    const found = this.program.find()
    if (!found.file) return { code: CLOSED.missing, why: `${this.program.name} is not installed.` }
    /* The look at what a restart cut off goes first: it may be this very conversation. */
    await this.recovered(projectPath)

    const settled = await this.program.settled(projectPath, id, 0)
    if (asked.session && !settled) {
      return { code: CLOSED.refused, why: `${this.program.name} has no session by that id on this computer.` }
    }

    /* A session that exists may be open in a process this module did not start. Asked now, every
       time, and never remembered: see "A conversation that is already open somewhere else". */
    let copyOf: Active | null = null
    let unchecked: Run['unchecked'] = null
    if (settled) {
      const running = await this.running(found.file)
      if (!running.known) unchecked = running.why
      const { open } = this.others(running, settled)
      if (open && asked.copy) copyOf = open
      else if (open) {
        this.log(`codex: ${settled} is open in another ${this.program.name} process (pid ${open.pid ?? '?'}) — nothing was started, and the page asks`)
        return { code: CLOSED.elsewhere, why: 'open in another process; nothing was started', elsewhere: elsewhereOf(open) }
      }
    }

    const able = await this.program.supports(found.file)
    /* Asked to report only when this copy runs per-run hooks and there is somewhere to report to.
       Otherwise the session has no state, and everything else is as it was. */
    const port = this.port()
    const tells = port !== null && able.tells
    const secret = tells ? randomBytes(24).toString('hex') : null
    /* The conversation's place, on every Kehikot door it is given (see `doorConfig.ts`). A copy
       that cannot take `-c` — or no host answering — starts with the person's own config. */
    const projectId = asked.projectId ?? projectIdAt(projectPath)
    let token: string | null = null
    let doors: SessionDoor[] = []
    let present: string[] = []
    let everywhere: HostPlace['everywhere'] = null
    if (able.configures) {
      token = (settled ? tokenFor(projectPath, settled, freshToken) : null) ?? freshToken()
      this.issue(token, { projectPath, projectId, place: asked.place })
      const kehikko = asked.place.kehikko && 'key' in asked.place.kehikko ? asked.place.kehikko.key : null
      /* The doors and, beside them, the modules on the kehikko — the latter for the skills' needs:
         a module with no MCP door is on the kehikko all the same. */
      const door = { projectPath, projectId, token, kehikko }
      const said = this.options.doors ? null : await (this.options.place ?? hostPlace)(door).catch(() => null)
      const got = said?.doors ?? (await (this.options.doors ?? hostDoors)(door).catch(() => null))
      if (said?.modules) present = said.modules.map((one) => one.module)
      everywhere = said?.everywhere ?? null
      if (got?.length) doors = got
      else this.log('codex: no host gave this session its doors; it starts with the agent’s own configuration')
    }
    /* Its folder: the skills of every module on the kehikko and its context hook, for this one
       process, removed with it (skills.ts). Only for a copy that runs hooks: they are how the
       session hears of them. */
    const kit = able.plugins ? await sessionKit(doors, { base: this.options.configBase, agentsDir: this.options.agentsDir, fetch: this.options.fetch, log: this.log, token, present, everywhere }).catch((error: unknown) => {
      this.log(`codex: the session's skills could not be written — ${error instanceof Error ? error.message : String(error)}`)
      return null
    }) : null
    const hooks: HookGroup[] = tells
      ? TELLS.map((one) => ({ event: one.event, ...(one.matcher ? { matcher: one.matcher } : {}), commands: [{ command: tellLine(one.says), timeout: 5 }] }))
      : []
    if (tells && kit && token) {
      for (const event of ['SessionStart', 'UserPromptSubmit'] as const) {
        const group = hooks.find((one) => one.event === event && !one.matcher)
        const command = { command: `/bin/sh ${quoted(contextScriptIn(kit.dir))} ${event}`, timeout: 10 }
        if (group) group.commands.push(command)
        else hooks.push({ event, commands: [command] })
      }
    }
    /* The one sentence this module sends a conversation, once, to one a restart cut off mid-turn
       (`recover`), when the person's setting says so. */
    const settings = readSettings(projectPath)
    let line: string | undefined
    if (settled) {
      const read = readPlaces(projectPath)
      const entry = read.ok && Object.hasOwn(read.value.sessions, settled) ? read.value.sessions[settled] : undefined
      if (entry?.resumeLine && settings.resumeCutOff) line = RESUME_LINE
      /* Opened: the person is looking at it, so the Inbox line about its cut-off turn has done its work. */
      if (entry?.resumeLine || entry?.cutOff?.open.some((one) => one.kind === 'turn')) {
        markSession(projectPath, settled, (one) => {
          if (line) one.resumed = { at: new Date(this.now()).toISOString(), told: true }
          delete one.resumeLine
          if (one.cutOff) one.cutOff = { ...one.cutOff, open: one.cutOff.open.filter((cut) => cut.kind !== 'turn') }
          return true
        })
      }
    }
    const args = [
      ...(settled ? this.program.resume(settled, undefined, line) : this.program.fresh(id)),
      ...this.program.hookArgs(hooks),
      ...(able.configures ? doorArgs(doors) : []),
      /* Kehikot's installs this session is not given — another kehikko's kehikko-bound skills, a
         module's that is not on this one — switched off for this one process (agentSkills.ts). */
      ...(able.configures && kit ? disabledArgs(kit.disabled) : []),
      /* The project's own choices of model, effort and approvals (settings.ts); nothing about the sandbox. */
      ...(able.configures ? sessionFlags(settings) : []),
    ]
    let pty: Pty
    let screen: Screen
    try {
      screen = await this.options.screen(asked.cols, asked.rows)
      pty = await this.options.spawn(found.file, args, {
        cwd: projectPath,
        cols: asked.cols,
        rows: asked.rows,
        env: {
          ...this.program.environment(),
          TERM,
          /* The secret travels here and nowhere else: not in `args`, which any process on the
             machine can list, and not in a file. */
          ...(secret ? { [TELL_ENV.port]: String(port), [TELL_ENV.secret]: secret, [TELL_ENV.session]: id } : {}),
        },
      })
    } catch (error) {
      removeKit(kit?.dir ?? null, this.options.agentsDir)
      const why = error instanceof Error ? error.message : String(error)
      this.log(`codex: could not start ${found.file} in ${projectPath} — ${why}`)
      return { code: CLOSED.failed, why: `${this.program.name} could not be started on this machine.` }
    }

    const run: Run = {
      what: 'session',
      id,
      settled,
      projectPath,
      cwd: projectPath,
      projectId,
      restarting: false,
      place: asked.place,
      at: asked.place,
      key: placeKey(asked.place),
      label: '',
      asked: 0,
      touched: false,
      stirredAt: this.now(),
      printedAt: this.now(),
      attendedAt: this.now(),
      state: null,
      told: null,
      turnTag: null,
      agents: new Map(),
      found: [],
      stateSince: this.now(),
      turned: false,
      seen: false,
      secret,
      notices: { left: NOTICES_AT_ONCE, at: this.now() },
      background: 0,
      joined: null,
      copyOf,
      unchecked,
      rested: false,
      trackedAt: this.now(),
      idle: null,
      startedAt: this.now(),
      pty,
      screen,
      viewers: new Set(),
      joining: new Map(),
      looking: new Set(),
      ended: false,
      token,
      doors,
      config: null,
      plugin: kit?.dir ?? null,
      owned: false,
      kept: null,
      status: null,
      statusAt: this.now(),
      idleAt: 0,
      prompt: emptyPrompt(),
    }
    this.runs.set(id, run)
    this.keepWatching()
    this.log(`codex: ${found.file} ${settled ? `resume ${settled}` : '(new)'}${tells ? ', asked to report' : ''}${doors.length ? `, ${doors.length} door${doors.length === 1 ? '' : 's'}` : ''}${kit?.skills.length ? `, ${kit.skills.length} skill${kit.skills.length === 1 ? '' : 's'}` : ''}${line ? ', told it was cut off' : ''} in ${projectPath} (pid ${pty.pid})`)
    if (copyOf) this.log(`codex: ${settled} is open in another process (pid ${copyOf.pid ?? '?'}) and a person chose to open it here anyway`)
    if (unchecked) {
      this.log(`codex: ${settled} was resumed without asking whether it is open elsewhere — ${unchecked === 'too-old' ? 'this copy cannot be asked' : 'the asking failed'}`)
      run.screen.write(uncheckedLine(this.program.name, unchecked))
    }
    this.recount(projectPath)
    if (settled) this.remember(run, asked.place)
    this.follow(run)
    return run
  }

  /**
   * Record that this run's session belongs to a place — if the session exists.
   * One that does not yet is recorded by `settle` when it does.
   */
  private remember(run: Run, place: NamedPlace): void {
    run.at = place
    this.changed()
    if (!run.settled) return
    /* Opened here: listed here, and the last opened here. It does not become this place's — that
       is a person's say ("Make this the kehikko's own") — unless it belonged nowhere, when a person
       picking it at this place is the say. */
    const read = readPlaces(run.projectPath)
    const homeless = read.ok && !homeOf(read.value, run.settled)
    const written = homeless
      ? assign(run.projectPath, place, run.settled, { label: run.label, lastActive: this.now() })
      : attach(run.projectPath, place, run.settled, { label: run.label, lastActive: this.now() })
    if (!written.ok) this.log(`codex: ${written.error}`)
  }

  private follow(run: Run): void {
    let asked = 0
    run.pty.onData((chunk) => {
      run.stirredAt = this.now()
      run.printedAt = run.stirredAt
      run.screen.write(chunk)
      if (run.what === 'install') {
        const kept = this.installs.get(run)
        if (kept) kept.output = (kept.output + chunk).slice(-INSTALL_LOG)
      }
      for (const viewer of run.viewers) viewer.output(chunk)
      for (const since of run.joining.values()) since.push(chunk)
      /* A new session exists once the program has written its record, which
         is when the person first says something. Asked when the program
         speaks rather than on a clock, and not more often than this. */
      if (run.what === 'session' && (!run.settled || (!run.label && run.asked < LABEL_TRIES)) && this.now() - asked >= SETTLE_EVERY) {
        asked = this.now()
        void this.settle(run)
      } else if (run.what === 'session' && run.settled && this.now() - run.trackedAt >= TRACK_EVERY) {
        /* Which conversation is on screen is asked while the program speaks, and not more often than this. */
        void this.track(run).catch(() => {})
      }
    })
    run.pty.onExit(({ exitCode }) => {
      run.ended = true
      removeKit(run.plugin, this.options.agentsDir)
      if (run.idle) clearTimeout(run.idle)
      this.runs.delete(run.id)
      /* Gone: no state to show for it, and nothing held about it is still true. */
      if (run.what === 'session') {
        run.state = null
        this.tell(run)
      }
      void this.finish(run, exitCode)
    })
  }

  /** Ask the program whether this session exists yet, and what it is called; record what it says. */
  async settle(run: Run): Promise<void> {
    if (run.what !== 'session') return
    if (!run.settled) {
      run.settled = await this.program.settled(run.projectPath, run.id, run.startedAt)
      if (!run.settled) return
      for (const viewer of run.viewers) viewer.say({ exists: true, session: run.settled })
    }
    run.asked += 1
    const known = (await this.program.sessions(run.projectPath, [run.settled])).find((one) => one.id === run.settled)
    const label = known?.label ?? ''
    if (run.place) {
      /* Started here: it belongs here from its first moment, with its token. */
      const written = born(run.projectPath, run.place, run.settled, run.token, { label, lastActive: known?.lastActive })
      if (!written.ok) this.log(`codex: ${written.error}`)
      run.place = null
      if (run.state) this.markWorking(run.projectPath, run.settled, run.state)
    } else {
      note(run.projectPath, run.settled, { label, lastActive: known?.lastActive })
    }
    if (label && label !== run.label) {
      run.label = label
      for (const viewer of run.viewers) viewer.say({ label, session: run.settled })
      this.changed()
    }
  }

  private async finish(run: Run, exitCode: number): Promise<void> {
    let code: number = run.restarting ? CLOSED.moved : run.rested ? CLOSED.rested : CLOSED.ended
    let why = run.restarting ? 'restarting in the new folder' : run.rested ? 'put away while it was quiet' : `the session ended (${exitCode})`
    if (run.what === 'install') {
      const found = this.program.find()
      const done = exitCode === 0 && found.file !== null
      code = done ? CLOSED.installed : CLOSED.notInstalled
      const kept = this.installs.get(run)
      why = done ? `installed at ${found.file}` : this.program.explain(kept?.output ?? '', exitCode, kept?.line ?? '')
      this.log(`codex: the installer exited with ${exitCode}; ${found.file ?? 'no binary found'}`)
    } else {
      await this.settle(run).catch(() => {})
      this.log(`codex: session ${run.settled ?? run.id} ended (${exitCode})`)
    }
    for (const viewer of [...run.viewers, ...run.joining.keys()]) viewer.close(code, why)
    run.viewers.clear()
    run.joining.clear()
    run.looking.clear()
    run.screen.dispose()
  }

  /**
   * Put a viewer on a run: the screen as it stands, then everything after.
   *
   * The screen is asked for from inside the emulator's own write queue, so
   * what is sent is everything the pty said up to this moment. What the pty
   * says between this call and the screen being taken is not in it — it is
   * queued behind the marker — so it is kept for this viewer (`joining`) and
   * sent right behind the screen, and only then does the viewer follow along:
   * nothing twice and nothing missed. A viewer that leaves before its screen
   * is taken is sent nothing and is never added. Then the pty is
   * told this viewer's size, which is also what makes a full-screen program
   * redraw itself for the window it is now in.
   */
  attach(run: Run, viewer: Viewer, cols: number, rows: number, how: 'new' | 'resumed' | 'attached' | 'background' | 'copy' | 'install'): void {
    if (run.idle) clearTimeout(run.idle)
    run.idle = null
    viewer.say({
      opened: how,
      session: run.what === 'session' ? (run.settled ?? run.id) : null,
      label: run.label,
      exists: Boolean(run.settled),
      state: run.state,
      since: run.stateSince,
      /* What this run is, for as long as it is on screen: a view of a session
         running in the background, a copy beside another process, or one
         resumed without the program having been asked. */
      ...(run.joined && !run.owned ? { background: elsewhereOf(run.joined) } : {}),
      ...(run.copyOf ? { copyOf: elsewhereOf(run.copyOf) } : {}),
      ...(run.unchecked ? { unchecked: run.unchecked } : {}),
      /* The project's folder was renamed while it ran: the program still has the old one. */
      ...(run.what === 'session' && movedWord(run).moved ? movedWord(run) : {}),
    })
    /* On screen until the page says otherwise: a view connects when it is shown. */
    run.looking.add(viewer)
    this.opened(run)
    if (run.what === 'session') {
      this.toldResumed(run)
      this.saw(run)
    }
    /* The same viewer attaching again replaces its own wait rather than adding a second. */
    run.viewers.delete(viewer)
    const since: string[] = []
    run.joining.set(viewer, since)
    run.screen.write('', () => {
      if (run.joining.get(viewer) !== since) return
      run.joining.delete(viewer)
      if (run.ended) return
      const screen = run.screen.serialize()
      if (screen) viewer.output(screen)
      for (const chunk of since) viewer.output(chunk)
      run.viewers.add(viewer)
      this.resize(run, cols, rows)
      void this.meter(run, viewer)
    })
  }

  /**
   * The page says whether this viewer has the run on screen. A view mounted
   * behind another keeps following, and is not somebody looking.
   */
  look(run: Run, viewer: Viewer, looking: boolean): void {
    if (run.ended) return
    if (looking) {
      run.looking.add(viewer)
      this.opened(run)
      this.toldResumed(run)
      this.saw(run)
      return
    }
    if (run.looking.delete(viewer) && run.looking.size === 0) this.left(run)
  }

  /**
   * A person opened the session: its subagents' finished research is in front of them, and those
   * items go — the rule every finished item of the session follows.
   */
  private opened(run: Run): void {
    if (!run.found.length) return
    run.found = []
    this.changed()
  }

  /**
   * The session's agent says what it finished (`tell_finished` at this module's door): `event` one
   * of the manifest's, `label` a few words. Believed only from the conversation's own place token,
   * which only its own doors carry — its agent and that agent's subagents. Waits for the turn to
   * end, or for a subagent that was running when it was said to. Null when the token is no running
   * session's.
   */
  tellFinished(token: string, event: string, label: string): string | null {
    if (!PLACE_TOKEN.test(token) || !EVENT_IDS.includes(event)) return null
    const run = [...this.runs.values()].find((one) => one.what === 'session' && !one.ended && one.token === token)
    if (!run) return null
    const words = label.replace(/\s+/g, ' ').trim().slice(0, 120)
    run.told = { event, label: words || run.label || 'Research', at: this.now() }
    if (run.secret === null) return 'Noted, but this conversation does not report when its turn ends, so the person is not told.'
    return run.agents.size
      ? 'Noted. The person is told “Research complete” when this turn ends, or when the subagent saying this finishes.'
      : 'Noted. The person is told “Research complete” when this turn ends.'
  }

  /** A subagent finished: an item when it was research, or said so while it ran (research.ts). */
  private async subagentDone(run: Run, agent: string, agentType: string | null): Promise<void> {
    const started = run.agents.get(agent)
    run.agents.delete(agent)
    const told = run.told && started !== undefined && run.told.at >= started ? run.told : null
    if (told) run.told = null
    let found: { event: string; label: string } | null = told ? { event: told.event, label: told.label } : null
    if (!found) {
      const task = await (this.options.subagentTask ?? subagentTask)(agent).catch(() => null)
      if (isResearch({ agentType, task })) found = { event: 'research-complete', label: task || (agentType ? `${agentType} subagent` : 'A subagent') }
    }
    /* Nothing to say, or the person has the session on screen and saw it finish. */
    if (!found || run.ended || run.looking.size > 0) return
    run.found = [...run.found.filter((one) => one.agent !== agent), { agent, ...found, at: this.now() }].slice(-FOUND_MOST)
    this.changed()
  }

  /** A person has it on screen: what it is waiting for is in front of them, and its Inbox line goes. */
  private saw(run: Run): void {
    if (run.seen) return
    run.seen = true
    if (run.state === 'needs-you') this.changed()
  }

  /** The last person looking at it looked away. */
  private left(run: Run): void {
    run.stirredAt = this.now()
    run.attendedAt = run.stirredAt
  }

  /**
   * The program in a session reported something (see "Told, not read").
   *
   * `session` is the id the pty was started on and `secret` what the report
   * carried. False for anything that is not a running session's own report;
   * the caller answers every such thing the same way, so that what is running
   * cannot be learned by asking.
   */
  heard(session: string, secret: string | null, event: string, thread: string | null = null, agent: { id: string; type: string | null } | null = null): boolean {
    const run = this.runs.get(session)
    if (!run || run.what !== 'session' || run.ended || !run.secret || !sameTicket(secret, run.secret)) return false
    /* A subagent started or finished (research.ts): nothing about the session's own state, and its
       thread is the subagent's, never the conversation's. */
    if (event === 'SubagentStart' || event === 'SubagentStop') {
      if (!agent || !AGENT_ID.test(agent.id)) return true
      if (event === 'SubagentStart') {
        run.agents.set(agent.id, this.now())
        /* Bounded: a subagent whose stop was never heard is forgotten with the oldest. */
        if (run.agents.size > 64) run.agents.delete(run.agents.keys().next().value!)
      } else void this.subagentDone(run, agent.id, agent.type && AGENT_TYPE.test(agent.type) ? agent.type : null)
      return true
    }
    /* A new prompt: what the last turn was tagged with, or was about to be, is over. */
    if (event === 'UserPromptSubmit') {
      run.told = null
      if (run.turnTag) {
        run.turnTag = null
        this.changed()
      }
    }
    /* The turn ended: what its agent said it finished is the finished item's. */
    if (event === 'Stop' && run.told) {
      run.turnTag = run.told
      run.told = null
    }
    /* Which conversation the hook was in: a new one's id, which Codex chose (`learnSession`), or
       another one in the same process (`/clear`, `/new`, `/resume` typed in it). */
    if (thread && this.program.isId(thread)) {
      if (!run.settled) {
        learnSession(run.id, thread)
        void this.settle(run).catch(() => {})
      } else if (thread !== run.settled) void this.moveTo(run, thread).catch(() => {})
    }
    const state = this.program.signal(event)
    if (state) this.become(run, state)
    return true
  }

  /**
   * A session's state changed. Said to everything following, and — when it
   * came to need the person or finished while nobody had it on screen —
   * raised as a notice, once.
   *
   * "Once" is per change: a second report of the same state is not a change.
   * Nothing is raised about a session somebody is looking at — they saw it —
   * and a session that has spent its ration (`NOTICES_AT_ONCE`) waits.
   */
  /**
   * Since when a conversation has been in `state`: when it was first seen there, kept for as long
   * as it stays there. Its Inbox item's `since` is this, so the same state said again is the same
   * item and never news again — whichever of a view (a run) or the background sweep (`Unviewed`)
   * says it, and after this module restarts (the record's `stated`). Only a move to another state
   * starts a new `since`.
   */
  private entered(projectPath: string, id: string | null, state: State | null): number {
    const now = this.now()
    if (!id || state === null) return now
    const kept = this.stated.get(id)
    if (kept) {
      if (kept.state === state) return kept.since
    } else {
      /* Nothing in memory: this module started since. The record says what it last saw. */
      const read = readPlaces(projectPath)
      const recorded = read.ok ? read.value.sessions[id]?.stated : undefined
      if (recorded && recorded.state === state && recorded.since <= now) {
        this.stated.set(id, recorded)
        return recorded.since
      }
    }
    this.stated.set(id, { state, since: now })
    /* Bounded: the oldest is forgotten first, and its record still holds it. */
    if (this.stated.size > 4096) this.stated.delete(this.stated.keys().next().value!)
    const written = markSession(projectPath, id, (entry) => {
      if (entry.stated?.state === state && entry.stated.since === now) return false
      entry.stated = { state, since: now }
      return true
    })
    if (!written.ok) this.log(`codex: ${written.error}`)
    return now
  }

  private become(run: Run, state: State | null): void {
    if (run.state === state) return
    /* A conversation with no turn yet is at an empty prompt: it has asked nothing (`needsYou`). */
    if (state === 'needs-you' && !hadTurn(run)) {
      this.log(`codex: ${run.settled ?? run.id} said it is waiting before its first turn — not taken as needing anyone`)
      return
    }
    run.state = state
    run.stateSince = this.entered(run.projectPath, run.settled ?? run.id, state)
    if (state === 'working' || state === 'finished') run.turned = true
    run.seen = run.looking.size > 0
    if (state === 'finished' && run.secret !== null) run.idleAt = Math.max(run.idleAt, run.stateSince)
    this.markWorking(run.projectPath, run.settled, state)
    this.tell(run)
    void this.meter(run)
    if (state !== 'needs-you' && state !== 'finished') return
    if (run.looking.size > 0) return
    const ration = run.notices
    ration.left = Math.min(NOTICES_AT_ONCE, ration.left + (this.now() - ration.at) / NOTICE_EVERY)
    ration.at = this.now()
    if (ration.left < 1) return
    ration.left -= 1
    const at = run.at
    this.noticed += 1
    this.raise({
      seq: this.noticed,
      session: run.settled ?? run.id,
      state,
      label: run.label,
      projectPath: run.projectPath,
      epic: at?.epic ?? null,
      parts: (at?.parts ?? []).map((id, index) => at?.partNames?.[index] || id),
      kehikko: at?.kehikkoName ?? '',
      partIds: [...(at?.parts ?? [])],
      kehikkoKey: at?.kehikko && 'key' in at.kehikko ? at.kehikko.key : null,
      at: this.now(),
    })
  }

  /** Say a session's state to its viewers and to every page following. */
  private tell(run: Run): void {
    const stated: Stated = { session: run.settled ?? run.id, state: run.state, since: run.stateSince }
    for (const viewer of run.viewers) viewer.say({ ...stated })
    for (const follower of this.followers) follower.state(stated)
    this.changed()
  }

  /** The activity list, whole, to every follower — but only when it differs from the last one. */
  /** The record changed under the lists (a person assigned a conversation): the activity lists are said again. */
  recorded(): void {
    this.changed()
  }

  private changed(): void {
    for (const follower of this.followers) {
      const rows = this.activity(follower.project ?? null)
      const text = JSON.stringify(rows)
      if (text === this.activityIs.get(follower)) continue
      this.activityIs.set(follower, text)
      follower.activity?.(rows)
    }
  }

  /** The activity list as it stands — one project's, or every project's (for a test, and for a page that has just arrived). */
  activity(project: string | null = null): ActivityRow[] {
    /* The sessions, and nothing about conversations that belong to no kehikko: that is said on the
       page of the kehikko that has none, not in the Inbox. A host closes an item absent from the list. */
    return activityRows(this.runs.values(), project, this.unviewed.values(), [...this.extras.values()].flat()).slice(0, ACTIVITY_ITEMS)
  }

  /**
   * Hand a notice to ONE page that can pass it on — the one that began
   * following last — or hold it for the next that arrives. One, because every
   * page of this module could say it and a person should be told once.
   */
  private raise(notice: Notice): void {
    const taker = [...this.followers].reverse().find((one) => one.notices)
    if (taker) return taker.notice(notice)
    this.held.push(notice)
    if (this.held.length > NOTICES_HELD) this.held.shift()
  }

  /**
   * Follow along: told every change of state from now on, and — a moment
   * later (`HELD_WAIT`) — handed the notices nobody was there for: those
   * that are still true then, which is to say the session is still in that
   * state and still on nobody's screen. Returns the function that stops
   * following.
   */
  subscribe(follower: Follower): () => void {
    this.followers.add(follower)
    const rows = this.activity(follower.project ?? null)
    this.activityIs.set(follower, JSON.stringify(rows))
    follower.activity?.(rows)
    for (const run of this.sessions()) {
      if (run.state) follower.state({ session: run.settled ?? run.id, state: run.state, since: run.stateSince })
    }
    for (const one of this.unviewed.values()) {
      if (one.state) follower.state({ session: one.session, state: one.state, since: one.since })
    }
    const hand = () => {
      if (!this.followers.has(follower)) return
      for (const notice of this.held.splice(0)) {
        const run = this.find(notice.session)
        if (run ? run.state === notice.state && run.looking.size === 0 && !run.seen : this.unviewed.get(notice.session)?.state === notice.state) follower.notice(notice)
      }
    }
    if (follower.notices && this.held.length) {
      if (this.heldWait > 0) setTimeout(hand, this.heldWait).unref?.()
      else hand()
    }
    /* The background sessions of the places were not asked about while nobody followed. */
    if (follower.project) this.know(follower.project)
    if (this.followers.size === 1) this.kick()
    else this.keepWatching()
    return () => {
      this.followers.delete(follower)
      this.activityIs.delete(follower)
    }
  }

  /**
   * Put away the sessions that are done and that nobody is looking at
   * (see `QUIET_REST`). Called on a clock; returns the ones it ended.
   *
   * What decides is what the session's program has said it is doing:
   *
   *  - `working`, `needs-you`: never. Not after an hour and not after a day.
   *    One is an agent mid-task; the other holds a question whose answer
   *    exists nowhere but in that process.
   *  - `finished`: once it has been finished, and left alone, for the whole
   *    time. Counted from the turn ending, the last thing a person typed, or
   *    the last person looking away, whichever is latest. What it prints at
   *    its prompt does not start the clock again.
   *  - nothing known — a copy too old to report, or one whose reports do not
   *    arrive: the rule there was before, silence for the whole time.
   *
   * Never one somebody has on screen, and never the installer. Nothing is
   * recorded and nothing is said to a person: a viewer still following from
   * behind another view is told `rested` and lets go, and the place resumes
   * the session when it is next opened.
   *
   * This is also where a `working` that has outlived its evidence is taken
   * back (see `STALE_WORK`).
   */
  rest(): Run[] {
    const put: Run[] = []
    for (const run of this.runs.values()) {
      if (run.what !== 'session' || run.ended || run.rested) continue
      /* Not a view of a background session: the program is asked what that one is doing (`watch`). */
      if (run.state === 'working' && !run.joined && this.now() - run.printedAt >= this.stale) {
        this.log(`codex: ${run.settled ?? run.id} was working and has printed nothing for ${Math.round((this.now() - run.printedAt) / 60_000)} min — its state is no longer known`)
        this.become(run, null)
      }
      if (run.looking.size > 0 || run.state === 'working' || run.state === 'needs-you') continue
      /* A turn that ended with background work still running (a server, a watcher, a build) is not a
         session that is done: putting it away would kill that work. It goes on being kept until the
         program says otherwise — its next turn ends with the count — or a person ends it. */
      if (run.background > 0) continue
      const finished = run.state === 'finished'
      const quietFor = this.now() - (finished ? Math.max(run.stateSince, run.attendedAt) : run.stirredAt)
      if (quietFor < this.quiet) continue
      run.rested = true
      this.log(
        `codex: put away ${run.settled ?? run.id}, which nobody was looking at and which had ${finished ? 'been finished' : 'printed nothing'} for ${Math.round(quietFor / 60_000)} min — its place resumes it`,
      )
      kill(run.pty)
      put.push(run)
    }
    return put
  }

  detach(run: Run, viewer: Viewer): void {
    run.viewers.delete(viewer)
    run.joining.delete(viewer)
    if (run.looking.delete(viewer) && run.looking.size === 0) this.left(run)
    if (run.what !== 'session' || run.ended || run.viewers.size + run.joining.size > 0 || run.touched || run.settled || run.idle) return
    run.idle = setTimeout(() => {
      run.idle = null
      if (run.ended || run.viewers.size + run.joining.size > 0 || run.touched) return
      /* Asked once more: the program may have recorded it since. */
      void this.settle(run)
        .catch(() => {})
        .then(() => {
          if (run.ended || run.viewers.size + run.joining.size > 0 || run.touched || run.settled) return
          this.log(`codex: ended ${run.id}, which nobody had typed into and nobody was looking at`)
          kill(run.pty)
        })
    }, this.grace)
    run.idle.unref?.()
  }

  resize(run: Run, cols: number, rows: number): void {
    if (run.ended) return
    try {
      run.pty.resize(cols, rows)
      run.screen.resize(cols, rows)
    } catch {
      /* A resize the pty refuses is dropped rather than ending somebody's session over a number. */
    }
  }

  /**
   * Hand the program what the page's emulator sent. All of it reaches the
   * program — its questions have to be answered — and only what a person
   * typed marks the session as typed into (see `input.ts`).
   */
  type(run: Run, data: string): void {
    if (run.ended) return
    if (typedByPerson(data)) {
      run.touched = true
      run.stirredAt = this.now()
      run.attendedAt = run.stirredAt
      /* What is at its prompt now, counted: what Compact and Clear wait on (see `readiness`). */
      const before = run.what === 'session' ? this.readiness(run) : null
      run.prompt = promptAfter(run.prompt, data, this.now())
      if (run.what === 'session' && this.readiness(run) !== before) void this.meter(run)
      /* The program reports a question being asked and never one being
         answered (program.ts). A person typing into a session that was
         waiting for them is that answer. A lone Esc is the exception: it
         dismisses the question without answering it, and the session still
         needs them. */
      if (run.state === 'needs-you' && data !== '\x1b') {
        /* What answered it went to the question, not to the prompt (Codex takes `y` with no Enter). */
        run.prompt = { chars: 0, sentAt: this.now() }
        this.become(run, 'working')
      }
    }
    run.pty.write(data)
  }

  /**
   * Run the vendor's installer, in a pty the person is watching.
   *
   * Reached only from a press in the page — there is no other caller, and
   * nothing at server start, in the MCP door or in a project can get here. It
   * is refused outright while a usable copy is installed, so the socket is
   * not a way to run the installer again at will. The command is said on the
   * first line, exactly as it is run, before any of its output.
   */
  /** What the installer ran and printed, kept to say why it failed; the whole of it is in the terminal. */
  private installs = new WeakMap<Run, { line: string; output: string }>()

  async install(asked: Extract<Opening, { what: 'install' }>, viewer: Viewer): Promise<Run | Refusal> {
    const running = this.runs.get(INSTALL)
    if (running) {
      this.attach(running, viewer, asked.cols, asked.rows, 'install')
      return running
    }
    const found = this.program.find()
    if (found.file && (await this.program.supports(found.file)).ok) {
      return { code: CLOSED.installed, why: `installed at ${found.file}` }
    }
    const { line } = this.program.install()
    let pty: Pty
    let screen: Screen
    try {
      screen = await this.options.screen(asked.cols, asked.rows)
      pty = await this.options.spawn('/bin/sh', ['-c', line], {
        cwd: home(),
        cols: asked.cols,
        rows: asked.rows,
        env: { ...this.program.installEnvironment(this.program.environment()), TERM },
      })
    } catch (error) {
      this.log(`codex: the installer could not be started — ${error instanceof Error ? error.message : String(error)}`)
      return { code: CLOSED.failed, why: 'the installer could not be started on this machine' }
    }
    const run: Run = {
      what: 'install',
      id: INSTALL,
      settled: null,
      projectPath: '',
      cwd: '',
      projectId: null,
      restarting: false,
      place: null,
      at: null,
      key: null,
      label: '',
      asked: 0,
      touched: false,
      stirredAt: this.now(),
      printedAt: this.now(),
      attendedAt: this.now(),
      state: null,
      told: null,
      turnTag: null,
      agents: new Map(),
      found: [],
      stateSince: this.now(),
      turned: false,
      seen: false,
      secret: null,
      notices: { left: NOTICES_AT_ONCE, at: this.now() },
      background: 0,
      joined: null,
      copyOf: null,
      unchecked: null,
      rested: false,
      trackedAt: this.now(),
      idle: null,
      startedAt: this.now(),
      pty,
      screen,
      viewers: new Set(),
      joining: new Map(),
      looking: new Set(),
      ended: false,
      token: null,
      doors: [],
      config: null,
      plugin: null,
      owned: false,
      kept: null,
      status: null,
      statusAt: 0,
      idleAt: 0,
      prompt: emptyPrompt(),
    }
    this.runs.set(INSTALL, run)
    this.installs.set(run, { line, output: '' })
    this.log(`codex: installing, on a press in the page — ${line}`)
    run.screen.write(`$ ${line}\r\n`)
    this.follow(run)
    this.attach(run, viewer, asked.cols, asked.rows, 'install')
    return run
  }

  /**
   * End a session because a person chose to. False when nothing by that id is
   * running. The Codex process in its pty ends with it; the conversation is kept, and its place
   * resumes it.
   */
  end(id: string): boolean {
    const run = this.find(id)
    if (!run) return false
    /* A person ended it: whatever it was doing, it was not cut off (`recover`). */
    this.markWorking(run.projectPath, run.settled, 'finished')
    kill(run.pty)
    return true
  }

  /** End everything: this process is stopping, and nothing it started may outlive it. */
  endAll(): void {
    for (const run of this.runs.values()) {
      kill(run.pty)
      /* This process is going: the session's folder goes now, not when the pty says it exited. */
      removeKit(run.plugin, this.options.agentsDir)
    }
  }
}

const INSTALL = 'install'
/** How much of the installer's output is kept to explain a failure. */
const INSTALL_LOG = 16_000

/** The process and everything it started: the group first, then the pty. */
function kill(pty: Pty): void {
  try {
    if (pty.pid > 1) process.kill(-pty.pid, 'SIGHUP')
  } catch {
    /* Already gone, or never had its own group. */
  }
  try {
    pty.kill()
  } catch {
    /* Same. */
  }
}

/* ------------------------------------------------------------------------ *
 * The one set of runs this process has, and the socket in front of it
 * ------------------------------------------------------------------------ */

const HELD = Symbol.for('kehikot.codex.runs')

/**
 * This process's runs, found again by whoever asks.
 *
 * On `globalThis` rather than at module scope, because Vite restarts its dev
 * server IN PROCESS when the config or anything it imports changes, and the
 * restarted server imports this file afresh. A registry at module scope would
 * be a second, empty one, with the first one's sessions still running and
 * nothing left that could find or end them.
 */
export function theRuns(log: (line: string) => void = () => {}): Runs {
  const held = globalThis as { [HELD]?: Runs }
  if (held[HELD]) return held[HELD]

  const runs = new Runs({
    log,
    /* node-pty under Node (Vite), Bun's own pty under Bun (`serve.ts`): `pty.ts` says why.
       Imported when first needed: the tests are about the deciding and must run without a pty. */
    spawn: async (file, args, options) => {
      const { spawnPty } = await import('./pty.ts')
      return spawnPty(file, args, { name: TERM, ...options })
    },
    screen: headless,
  })
  held[HELD] = runs
  /* Skills a session of a process that stopped without ending them held: let go of now (agentSkills.ts). */
  try {
    for (const line of sweep()) log(`codex: ${line}`)
  } catch {
    /* Swept when the next session ends. */
  }

  /* And what is kept for every conversation re-synced against the modules as they are now: now,
     and every RESYNC_EVERY while this process runs. */
  const resync = () => {
    resyncEverywhere()
      .then((lines) => {
        for (const line of lines) log(`codex: ${line}`)
      })
      .catch(() => {
        /* Tried again at the next resync. */
      })
  }
  resync()
  setInterval(resync, RESYNC_EVERY).unref?.()

  /* The folders of sessions a process that stopped without ending them left behind: removed now (skills.ts). */
  try {
    const swept = sweepKits()
    if (swept) log(`codex: removed ${swept} session folder${swept === 1 ? '' : 's'} a stopped process left behind`)
  } catch {
    /* Swept at the next start. */
  }

  /* Stopping, however it is asked. `exit` covers Vite's own handling of
     SIGTERM; the signals are here for when nothing else is listening. */
  process.on('exit', () => runs.endAll())
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
    process.once(signal, () => {
      runs.endAll()
      if (process.listenerCount(signal) === 0) process.exit(0)
    })
  }
  return runs
}

/** The headless emulator behind a run, and the addon that writes its screen out. */
export async function headless(cols: number, rows: number): Promise<Screen> {
  const [xterm, addon] = await Promise.all([import('@xterm/headless'), import('@xterm/addon-serialize')])
  const { Terminal } = (xterm as unknown as { default?: typeof xterm }).default ?? xterm
  const { SerializeAddon } = (addon as unknown as { default?: typeof addon }).default ?? addon
  const terminal = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true })
  const serializer = new SerializeAddon()
  terminal.loadAddon(serializer as unknown as Parameters<typeof terminal.loadAddon>[0])
  return {
    write: (data, done) => terminal.write(data, done),
    resize: (c, r) => terminal.resize(c, r),
    serialize: () => serializer.serialize(),
    dispose: () => terminal.dispose(),
  }
}

/** The least a server has to be for this to attach to it (Vite's may be HTTP/2, which is not `http.Server`). */
export interface Upgradable {
  on(event: 'upgrade', listener: (request: IncomingMessage, socket: Duplex, head: Buffer) => void): unknown
}

/** The path the socket answers on. */
export const SOCKET = '/session'

/**
 * Attach the socket to an HTTP server's upgrade event. `noServer`, because
 * the port is Vite's and a module is one origin: a second listener would make
 * this module's own socket cross-origin to its own page.
 */
export function serveSessions(server: Upgradable, port: number, log: (line: string) => void): void {
  const runs = theRuns(log)
  /* Where a session's program reports to: this server, on the port it really bound. */
  runs.port = () => port
  void (async () => {
    const { WebSocketServer } = await import('ws')
    const sockets = new WebSocketServer({ noServer: true })

    server.on('upgrade', (request: IncomingMessage, socket: Duplex, head: Buffer) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`)
      /* Vite's own HMR websocket shares this server. Anything not ours is left alone. */
      if (url.pathname !== SOCKET) return
      const gate = fenced({ origin: request.headers.origin, host: request.headers.host }, port)
      if (!gate.ok) {
        log(`codex: refused an upgrade — ${gate.why}`)
        /* A bare 403. Which check failed is logged here and not sent. */
        socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
        socket.destroy()
        return
      }
      sockets.handleUpgrade(request, socket, head, (ws) => {
        const held = hold(
          {
            open: () => ws.readyState === ws.OPEN,
            sendBytes: (data) => ws.send(data),
            sendText: (text) => ws.send(text),
            close: (code, reason) => ws.close(code, reason),
            terminate: () => ws.terminate(),
          },
          runs,
          log,
        )
        ws.on('message', (data: unknown, isBinary: boolean) => {
          if (!isBinary) held.heard(String(data))
        })
        ws.on('close', held.gone)
        ws.on('error', held.gone)
      })
    })
    log(`codex: ready on ws://127.0.0.1:${port}${SOCKET}`)
  })().catch((error: unknown) => {
    log(`codex: could not start — ${error instanceof Error ? error.message : String(error)}`)
  })
}

/**
 * The session socket on the BUILT server (`serve.ts`), as the protocol's `run` takes it: the same
 * `hold` as the dev server's, on Bun's own WebSocket. The fence is `run`'s `socketFence` — `fenced`
 * above in the protocol's words — and the ticket is still the first frame's. A binary frame from a
 * page is not read, as under `ws`.
 */
export function sessionSockets(port: () => number, log: (line: string) => void): {
  sockets: RunSockets<{ held: Held | null }>
  listening: (port: number) => void
} {
  const runs = theRuns(log)
  runs.port = port
  return {
    sockets: {
      paths: [SOCKET],
      data: () => ({ held: null }),
      open: (ws) => {
        ws.data.held = hold(
          {
            open: () => ws.readyState === 1,
            sendBytes: (data) => {
              ws.send(data)
            },
            sendText: (text) => {
              ws.send(text)
            },
            close: (code, reason) => ws.close(code, reason),
            terminate: () => ws.terminate(),
          },
          runs,
          log,
        )
      },
      message: (ws, message) => {
        if (typeof message === 'string') ws.data.held?.heard(message)
      },
      close: (ws) => ws.data.held?.gone(),
      refused: (why) => log(`codex: refused an upgrade — ${why}`),
    },
    listening: (bound) => log(`codex: ready on ws://127.0.0.1:${bound}${SOCKET}`),
  }
}

/**
 * One connection: silent, then admitted, then a viewer on a run.
 *
 * The two directions are told apart by the KIND of frame and not by anything
 * inside one. What the program prints goes to the page as binary and is
 * written to the emulator unread; what this module says to its own page is
 * text. A program cannot print its way into the second.
 */
/** One viewer's socket as `hold` needs it, whichever server holds it: `ws` under Vite, Bun's own under `serve.ts`. */
export interface Connection {
  open: () => boolean
  /** Bytes, sent as a binary frame: what the program printed. */
  sendBytes: (data: Uint8Array) => void
  /** Text: what this module says to its own page. */
  sendText: (text: string) => void
  close: (code: number, reason: string) => void
  terminate: () => void
}

/** What a server tells a held connection: a text frame heard, or the socket gone. */
export interface Held {
  heard: (text: string) => void
  gone: () => void
}

function hold(ws: Connection, runs: Runs, log: (line: string) => void): Held {
  let run: Run | null = null
  let admitted = false
  /* What arrives between admission and the run existing: the page sends its
     first resize a millisecond behind the opening frame. Read as a second
     opening frame it would be refused in the words for a wrong ticket — the
     race Terminal had and fixed. */
  const early: string[] = []

  const shut = (code: number, reason: string) => {
    try {
      ws.close(code, sayable(reason))
    } catch {
      try {
        ws.terminate()
      } catch {
        /* Gone. */
      }
    }
  }

  const viewer: Viewer = {
    output: (data) => {
      if (ws.open()) ws.sendBytes(Buffer.from(data, 'utf8'))
    },
    say: (message) => {
      if (ws.open()) ws.sendText(JSON.stringify(message))
    },
    close: shut,
  }

  const silent = setTimeout(() => {
    if (!admitted) shut(CLOSED.silent, 'nothing was said')
  }, MUST_SPEAK_WITHIN)

  const heard = (text: string) => {
    if (!admitted) {
      clearTimeout(silent)
      const said = opening(text)
      if (typeof said === 'string') {
        log(`codex: ${said}`)
        shut(CLOSED.refused, said)
        return
      }
      admitted = true
      void (said.what === 'install' ? runs.install(said, viewer) : runs.open(said, viewer))
        .then((opened) => {
          if ('code' in opened) return shut(opened.code, opened.why)
          /* The socket ended while the run was starting. The run is not ended
             with it: it belongs to this process, and the page that comes back
             finds it. */
          if (!ws.open()) return runs.detach(opened, viewer)
          run = opened
          for (const waiting of early.splice(0)) heard(waiting)
        })
        .catch((error: unknown) => {
          log(`codex: ${error instanceof Error ? error.message : String(error)}`)
          shut(CLOSED.failed, 'that could not be opened')
        })
      return
    }

    if (!run) {
      if (early.length < 64) early.push(text)
      return
    }

    /* Every frame after the first is an envelope: `d` is what the emulator
       sent (typing, and its own replies), `r` a resize, `w` whether the view
       is the one on screen, `c` a person's press of Compact or Clear (one of
       two words, typed only when the session is at its prompt), and anything
       else is dropped rather than typed into somebody's session. */
    let said: unknown
    try {
      said = JSON.parse(text)
    } catch {
      return
    }
    if (typeof said !== 'object' || said === null) return
    const frame = said as Record<string, unknown>
    if (typeof frame.d === 'string') return runs.type(run, frame.d)
    if (typeof frame.w === 'boolean') return runs.look(run, viewer, frame.w)
    if (frame.c === 'compact' || frame.c === 'clear') {
      const done = runs.command(run, frame.c)
      return viewer.say({ commanded: { which: frame.c, ok: done === true, ...(done === true ? {} : { why: done }) } })
    }
    if (typeof frame.r === 'object' && frame.r !== null) {
      const asked = frame.r as { cols?: unknown; rows?: unknown }
      runs.resize(run, size(asked.cols, 20, 500, 80), size(asked.rows, 5, 200, 24))
    }
  }

  const gone = () => {
    clearTimeout(silent)
    /* The viewer leaves. The run stays. */
    if (run) runs.detach(run, viewer)
  }
  return { heard, gone }
}
