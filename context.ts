import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { researchLine, sessionNotes, type NotesPlace, type NotesTold } from 'kehikot-module-protocol'

import type { DoorsAsked, HostPlace } from './doorConfig.ts'
import { ID } from './manifest.ts'
import { placeKey, readPlaceKey } from './place.ts'
import type { Program } from './program.ts'
import { kitSkills, skillsText } from './skills.ts'
import { PLACE_TOKEN, born, byToken, homeOf, projectRoot, readPlaces, type NamedPlace, type Places } from './record.ts'

/**
 * What a session this module started is told of where it is, without anybody typing anything:
 * its place, and the modules on its kehikko. And the session filed under that place, as
 * `$kehikot-here` would file it.
 *
 * ## How it is told
 *
 * A session started here is given two hooks for that one process — `SessionStart` and
 * `UserPromptSubmit` (`-c hooks.*`, see `hookArgs` in program.ts) — that run `context.sh` from its
 * own folder (`sessionKit` in skills.ts), which posts the session's id and its place token
 * to `POST /api/context` and prints what comes back. Codex gives the model what such a hook
 * prints as `hookSpecificOutput.additionalContext`, as a developer message beside the prompt
 * (measured on 0.164.0 with a scratch `CODEX_HOME` and a stand-in for the model). Codex runs a
 * new conversation's SessionStart hook at its first prompt, not when the program opens. Sessions
 * started outside Kehikot do not have these hooks, so none of this reaches them: assigning one is
 * a person's say (`$kehikot-here`).
 *
 *  - **At every start** — a new conversation, one resumed or woken, one cleared or compacted —
 *    the whole of it: the place, one line per module on the kehikko, with its MCP server's
 *    name in this session and its skills, and the skills installed for it, as `$name` entries (`skillsText`).
 *  - **At a prompt**, only what changed since the session was last told: modules put on the
 *    kehikko or taken off it, or the conversation moved to another place by the person. Nothing
 *    when nothing changed. What it was told is kept beside its doors (`toldFile`), so a restart of
 *    this module does not tell it twice.
 *
 * The modules are the host's to say (`modules` in its answer to `POST /host/place`, asked again
 * with the session's own token each time). A host too old to list them, or one that does not
 * answer, gets the place said and the modules left to `read_canvas`. What a module calls itself
 * and its one line are its own words: quoted, one line each, and said to be text.
 *
 * ## The filing
 *
 * A conversation this module started is filed under the place it was started at as soon as it is
 * a conversation — Codex holds a record of it — exactly as `$kehikot-here` files one: it
 * belongs there, and is that kehikko's own when the kehikko had none (`born`). `settle` in
 * live.ts does this while this process holds the run; the hook does it whatever happened to the
 * run in between (this module restarted, the view closed, the conversation cleared into a new
 * one). Never for a conversation the record already files somewhere — it stays where the person
 * put it — nor one a person took off its place (`detached`) or said is not a Kehikot one
 * (`ignored`).
 */

/** Where a token's conversation was started, as this module gave it out. */
export interface Started {
  projectPath: string
  projectId: string | null
  place: NamedPlace
}

export interface ContextNeeds {
  program: Pick<Program, 'isId' | 'settled'>
  /** Where the conversation behind a token was started: from the runs, what was issued, or its kept folder. Null for a token this module did not give out. */
  startedOf(token: string): Started | null
  /** The host's answer for this token now (`hostPlace`): its doors and the modules on its kehikko. */
  host(asked: DoorsAsked): Promise<HostPlace | null>
  /** The names of the doors the conversation was started with, when known. */
  doorsOf(token: string): string[] | null
  /** Where what the conversation was last told is kept. */
  toldFile(token: string): string
  /** The record changed under this project: what `$kehikot-here` calls after it files one. */
  told(projectPath: string, assigned?: { key: string; session: string }): void
  log(line: string): void
  /** The session's own folder, which holds the skills it was given (skills.ts), while it runs. */
  kitOf?(token: string): string | null
  /** Run something a moment later: the filing is tried again while Codex writes its record. Absent: not again. */
  later?(run: () => void, ms: number): void
}

export type ContextEvent = 'SessionStart' | 'UserPromptSubmit'
const EVENTS: readonly ContextEvent[] = ['SessionStart', 'UserPromptSubmit']

/** What a hook prints for Codex to add to the model's context. */
export interface HookAnswer {
  hookSpecificOutput: { hookEventName: ContextEvent; additionalContext: string }
}

/**
 * What a conversation was last told (the protocol's `NotesTold`: its place by key, the modules on it
 * and the installed ones absent from it), and the words themselves: the last full notes and what
 * was added at prompts since, which the page shows the person ("What this conversation was told").
 */
export interface Told extends NotesTold {
  said?: Said
}

/** The words a conversation was told: the last full notes, and each change told at a prompt after them. */
export interface Said {
  start: { at: number; text: string }
  changes: { at: number; text: string }[]
}

/** How many changes after the last full notes are kept to show. */
const SAID_CHANGES = 20

/** How often, and how far apart, a filing waits for Codex's record of a prompt just sent. */
const FILE_TRIES = 10
const FILE_EVERY = 500

/**
 * This module, as the notes name it: it is not listed among the modules around its own session, and
 * its door is where "Research complete" is said. The words themselves are the protocol's
 * (`sessionNotes`), the same for every module that runs agent sessions.
 */
export const SELF = { module: ID, name: 'Codex', door: 'kehikko-codex' } as const

/**
 * What a session is told about "Research complete" (research.ts): how it says that a finished turn,
 * or a subagent's, was research. An explorer subagent, or one whose task reads as research, is
 * noticed anyway.
 */
export const RESEARCH_LINE = researchLine(SELF)

export function readTold(file: string): Told | null {
  try {
    const said = JSON.parse(readFileSync(file, 'utf8')) as { key?: unknown; version?: unknown; modules?: unknown; absent?: unknown; names?: unknown; said?: unknown }
    const ids = (list: unknown): string[] | null => (Array.isArray(list) ? list.filter((one): one is string => typeof one === 'string') : null)
    const names = said.names && typeof said.names === 'object' && !Array.isArray(said.names) ? Object.fromEntries(Object.entries(said.names).filter((pair): pair is [string, string] => typeof pair[1] === 'string')) : undefined
    return {
      key: typeof said.key === 'string' ? said.key : null,
      /* A record kept before the notes had a version has none: the protocol reads that as the old wording, so the full new notes are said once. */
      ...(typeof said.version === 'number' && Number.isFinite(said.version) ? { version: said.version } : {}),
      modules: ids(said.modules),
      ...(said.absent !== undefined ? { absent: ids(said.absent) } : {}),
      ...(names ? { names } : {}),
      ...(saidOf(said.said) ? { said: saidOf(said.said)! } : {}),
    }
  } catch {
    return null
  }
}

const text = (one: unknown): { at: number; text: string } | null => {
  const it = one as { at?: unknown; text?: unknown } | null
  return it && typeof it.at === 'number' && typeof it.text === 'string' ? { at: it.at, text: it.text } : null
}

function saidOf(raw: unknown): Said | null {
  const it = raw as { start?: unknown; changes?: unknown } | null
  const start = it ? text(it.start) : null
  if (!start) return null
  return { start, changes: Array.isArray(it!.changes) ? it!.changes.flatMap((one) => text(one) ?? []).slice(-SAID_CHANGES) : [] }
}

/** What the conversation behind a token was last told, in words, to show the person; null when nothing is kept. */
export function toldWords(file: string): Said | null {
  return readTold(file)?.said ?? null
}

function writeTold(file: string, told: Told): void {
  try {
    mkdirSync(dirname(file), { recursive: true, mode: 0o700 })
    chmodSync(dirname(file), 0o700)
    const temporary = `${file}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(told), { mode: 0o600 })
    renameSync(temporary, file)
  } catch {
    /* Not kept: the next prompt says it again, which is the most that costs. */
  }
}

/** A place filed under a key, with the names the record and the place it was started at know it by. */
function named(key: string, places: Places, started: NamedPlace): NamedPlace | null {
  const place = readPlaceKey(key)
  if (!place) return null
  const entry = Object.hasOwn(places.places, key) ? places.places[key] : undefined
  const same = placeKey(started) === key
  return {
    ...place,
    ...(entry?.kehikko?.name || (same && started.kehikkoName) ? { kehikkoName: entry?.kehikko?.name || started.kehikkoName } : {}),
    ...(same && started.partNames ? { partNames: started.partNames } : {}),
  }
}

/**
 * File a conversation this module started under the place it was started at, when the record
 * files it nowhere and nobody said otherwise (see "The filing"). True when it was filed now.
 */
export async function autoFile(projectPath: string, place: NamedPlace, session: string, token: string, needs: ContextNeeds): Promise<boolean> {
  const read = readPlaces(projectPath)
  if (!read.ok) return false
  const entry = Object.hasOwn(read.value.sessions, session) ? read.value.sessions[session] : undefined
  if (homeOf(read.value, session) || entry?.ignored || entry?.detached) return false
  if (!(await needs.program.settled(projectPath, session, 0))) return false
  /* One token, one conversation: a conversation cleared into a new one in the same process is filed without it. */
  const free = !byToken(read.value, token)
  const before = ownOfKey(read.value, placeKey(place))
  const written = born(projectPath, place, session, free ? token : null)
  if (!written.ok) {
    needs.log(`codex: ${session} could not be filed under the place it was started at — ${written.error}`)
    return false
  }
  needs.log(`codex: ${session} filed under the place it was started at${before ? '' : ', as its kehikko’s own (it had none)'} — no $kehikot-here needed`)
  needs.told(projectPath, { key: placeKey(place), session })
  return true
}

/** A place as the notes say it: the folder, the epic, the parts by id and name, the kehikko by key and name. */
function notesPlace(projectPath: string, place: NamedPlace): NotesPlace {
  const kehikko = place.kehikko ? ('key' in place.kehikko ? place.kehikko.key : String(place.kehikko.id)) : null
  return {
    project: projectPath,
    epic: place.epic,
    parts: place.parts.map((id, i) => ({ id, ...(place.partNames?.[i] ? { name: place.partNames[i] } : {}) })),
    kehikko: kehikko ? { key: kehikko, ...(place.kehikkoName ? { name: place.kehikkoName } : {}) } : null,
  }
}

const ownOfKey = (places: Places, key: string): string | null => (Object.hasOwn(places.places, key) ? (places.places[key]?.own ?? places.places[key]?.current ?? null) : null)

/** File it now, or a moment later while Codex writes its record of the prompt just sent. */
async function fileSoon(projectPath: string, place: NamedPlace, session: string, token: string, needs: ContextNeeds, left = FILE_TRIES): Promise<void> {
  if (await autoFile(projectPath, place, session, token, needs)) return
  const read = readPlaces(projectPath)
  const entry = read.ok && Object.hasOwn(read.value.sessions, session) ? read.value.sessions[session] : undefined
  if (left <= 1 || !needs.later || (read.ok && homeOf(read.value, session)) || entry?.ignored || entry?.detached) return
  needs.later(() => void fileSoon(projectPath, place, session, token, needs, left - 1).catch(() => {}), FILE_EVERY)
}

/**
 * Answer one hook: file the conversation where it was started if it belongs nowhere yet, and say
 * what it is to be told — everything at a start, what changed at a prompt, or nothing (null).
 */
export async function context(asked: { event: string; session: string; token: string | null }, needs: ContextNeeds): Promise<HookAnswer | null> {
  const event = EVENTS.find((one) => one === asked.event)
  const { session, token } = asked
  if (!event || !needs.program.isId(session) || !token || !PLACE_TOKEN.test(token)) return null
  const started = needs.startedOf(token)
  if (!started) return null
  const root = projectRoot(started.projectPath)
  if (!root.ok) return null
  const projectPath = root.value

  /* A prompt was sent: the conversation exists, or is about to. A start of one the record holds already (resumed, woken) is filed at once. */
  if (event === 'UserPromptSubmit') await fileSoon(projectPath, started.place, session, token, needs)
  else await autoFile(projectPath, started.place, session, token, needs)

  /* Where it belongs now: the record's say, else where it was started (it is filed there at its first prompt). */
  const read = readPlaces(projectPath)
  const places = read.ok ? read.value : null
  const home = places ? homeOf(places, session) : null
  const entry = places && Object.hasOwn(places.sessions, session) ? places.sessions[session] : undefined
  const place = home && places ? named(home, places, started.place) : entry?.detached || entry?.ignored ? null : started.place
  const key = place ? placeKey(place) : null

  const kehikko = place?.kehikko && 'key' in place.kehikko ? place.kehikko.key : null
  const answer = place ? await needs.host({ projectPath, projectId: started.projectId, token, kehikko }).catch(() => null) : null
  const hostDoor = answer?.doors.find((door) => door.module === 'kehikko')?.name ?? null

  /* The words are the protocol's, the same for every agent module; this module only delivers them. */
  const file = needs.toldFile(token)
  const told = readTold(file)
  const notes = sessionNotes(
    {
      place: place ? notesPlace(projectPath, place) : null,
      /* A kehikko this record names only by its old row number was not asked about: its modules are read_canvas's to say. */
      modules: place?.kehikko && !kehikko ? null : (answer?.modules ?? null),
      absent: answer?.absent ?? null,
      hostDoor,
      self: SELF,
      connected: needs.doorsOf(token),
      key,
    },
    event === 'SessionStart' ? 'start' : 'prompt',
    told,
  )
  let text = notes.text
  if (text === null) return null
  if (notes.kind === 'start') {
    /* And the skills it was given, each a `$name` it can call (skills.ts): at every start, since a
       compaction or a /clear leaves the model without the list it was told before — and a
       kehikko-bound skill goes on only where this list names it (`guarded`). How Codex is given
       skills, not what it is told about the modules: Claude Code lists a plugin's skills itself. */
    const kit = needs.kitOf?.(token) ?? null
    const catalog = kit ? skillsText(kitSkills(kit)) : null
    if (catalog) text = `${text}\n\n${catalog}`
  }
  const at = Date.now()
  const said: Said = notes.kind === 'start' || !told?.said ? { start: { at, text }, changes: [] } : { start: told.said.start, changes: [...told.said.changes, { at, text }].slice(-SAID_CHANGES) }
  writeTold(file, { ...notes.told, said })
  return { hookSpecificOutput: { hookEventName: event, additionalContext: text } }
}
