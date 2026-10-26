import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

import { KEHIKOT_DIR, kehikotDir, moduleDir, moduleFile, within } from 'kehikot-module-protocol'

import type { CutOff } from './cutoff.ts'
import { DEFAULTS, settingsOf, type Settings } from './settings.ts'
export type { Settings } from './settings.ts'
import { ID } from './manifest.ts'
import { isKehikkoKey, placeKey, readPlaceKey, sortedParts, type Place } from './place.ts'

/** A place token's spelling (protocol 2.4.0, `PLACE_TOKEN`). Written out here until the protocol pin moves. */
export const PLACE_TOKEN = /^[A-Za-z0-9_-]{22,64}$/

/**
 * Which session belongs to which place, kept inside the project it is about:
 * `<project>/.kehikot/codex/places.json`.
 *
 *     {
 *       "version": 1,
 *       "places": {
 *         "epic=thesis;parts=methods+results;kehikko=key:4072c9e5": {
 *           "epic": "thesis",
 *           "parts": ["methods", "results"],
 *           "kehikko": { "key": "4072c9e5", "id": 3, "name": "writing" },
 *           "sessions": ["6f0c…", "a41e…"],
 *           "current": "a41e…"
 *         }
 *       },
 *       "sessions": {
 *         "6f0c…": { "added": "2026-10-12T14:03:11.000Z", "label": "tighten the methods…", "lastActive": "2026-10-12T15:40:02.000Z" }
 *       }
 *     }
 *
 * ## What is in it, and why each thing
 *
 * - **The key** is `placeKey`: ids only, parts sorted, the kehikko by its
 *   stable `key`. It is what is looked up.
 * - **The names beside it** (`epic`, `parts`, the kehikko's `name`) are for a
 *   person reading the file and for the list an agent is given. Never compared
 *   — with the one exception of `rekey` below, which reads a kehikko's name
 *   once, to bring an older file across.
 * - **The kehikko's `id`** beside a `key` is the row number the host last
 *   called it by: a note for a person lining this file up with a host's
 *   database, nothing more. It is never compared and never looked up.
 * - **A session's `label` and `lastActive`** are what Codex's own record
 *   said the last time this module looked, so the list can be drawn from this
 *   file alone — for a session whose transcript has since been cleaned away,
 *   and for an agent asking through the MCP door.
 *
 * A session may be listed under several places: attaching one to a second
 * place does not take it from the first.
 *
 * ## What is NOT in it
 *
 * A session that does not exist. An id is written here once the program has a
 * record for it and not before — a session that was opened, shown a sign-in
 * screen, and closed again was never a session, and a record of it would be a
 * row that can never be resumed. Until then it is held in memory by `live.ts`.
 * And nothing of a transcript beyond the one line used as a label.
 *
 * ## A part or a kehikko that is deleted
 *
 * Its key can no longer be reached, because the host will never name that
 * combination again. Nothing is deleted on that account: the entry stays in
 * the file, readable, and its sessions stay in Codex's own records for
 * the folder — which is where "attach an existing session" lists them from,
 * for every other place in the project. A rename changes nothing at all, since
 * a rename does not change a key.
 *
 * ## The kehikko by its key, and files written before there was one
 *
 * A host renumbers a kehikko whenever its project is removed and added again,
 * and numbers it afresh on another machine: the `id` in `context.kehikko` is
 * a row in that host's database. Protocol 1.1.0 carries the kehikko's `key`
 * beside it — the one the host keeps in the project's own
 * `.kehikot/host/kehikot.json` (`.kehikot/kehikko/` before protocol 2.2.0) — and that is what a place is filed under
 * (`kehikko=key:4072c9e5`). A host that sends no key leaves the id, and a
 * place filed under it (`kehikko=3`) is as fragile as it always was.
 *
 * Entries written under an id are brought across by `rekey`, once, the first
 * time a host names a kehikko by key: see there for the rule, which matches
 * by the kehikko's NAME because that is the only thing in an old entry that
 * still means what it meant. Reading never does this. `readPlaces` returns
 * what the file says; only `rekey` moves an entry, and it is a write like any
 * other.
 *
 * ## What travels with the project, and what does not
 *
 * This file is in the project, and the sessions it names are not: a session
 * is a transcript in Codex's own folder on the computer where it ran.
 * On another computer — or on this one, after Codex has cleaned an old
 * transcript away — the file names a session there is no record of. Such an
 * id is never removed here on that account (the other computer still has
 * it), and never started: `doors.ts` marks it `missing`, the list shows it
 * muted, and `live.ts` refuses to open it rather than start a new
 * conversation under an old one's id.
 *
 * Because it means so little elsewhere, and holds the first line of what
 * somebody asked, the file is NOT shared by default: the first write puts a
 * `.gitignore` beside it naming it, the way the host does for its tracker
 * reading in its own folder (`.kehikot/host/`, `.kehikot/kehikko/` before protocol 2.2.0). Written only when there is none, so a
 * person who empties it to share the file is not overruled.
 *
 * ## One writer at a time, with nothing awaited in the middle
 *
 * Every change is read-modify-write, and every one of them is synchronous
 * from the read to the rename. That is the whole of the locking: this server
 * is one process on one thread, so two writes cannot interleave unless one of
 * them yields between reading the file and writing it back — and a write that
 * did would put back a copy missing whatever the other had added. So nothing
 * here is `async`, and the test that fires many writes at once is the one to
 * keep green if that ever changes.
 *
 * There is no default project. With no `projectPath` every read is empty and
 * every write refused: a guessed folder is one where work is written and
 * never seen again. Both sides are realpath'd before the containment check,
 * so a `.kehikot` that is a symlink out of the project is refused rather than
 * followed.
 */
export const FILE = 'places'
export const WHERE = `<project>/${KEHIKOT_DIR}/codex/${FILE}.json`

export interface PlaceEntry {
  epic: string | null
  parts: string[]
  /**
   * The kehikko, as a person reads it. With a `key`, that is what the place is
   * filed under and `id` is only the row number a host last called it by.
   * Without one, the place is filed under `id` (an older host).
   */
  kehikko: { key?: string; id?: number; name: string } | null
  sessions: string[]
  /**
   * The session last open at this place: the one a person last chose, opened
   * or carried the conversation on in. Opened directly the next time, however
   * many others the place lists. One of `sessions`, or absent.
   */
  current?: string
  /**
   * The conversation that is this place's OWN: the one its frame names as
   * its own and goes back to. Set when the first conversation is started here,
   * and by a person's "Make this the kehikko's own". Viewing another one here
   * does not change it. One of `sessions`, or absent.
   */
  own?: string
}

export interface SessionEntry {
  /** When this module first recorded it. */
  added: string
  label: string
  lastActive: string | null
  /**
   * The place this conversation BELONGS to (a `placeKey`): what an agent in it
   * is told its place is (`my_place`). Written when it is started at a place,
   * when a person assigns or attaches it to one, and by "Make this the
   * kehikko's own" — never by merely viewing it somewhere. Absent: not yet
   * assigned.
   */
  home?: string
  /**
   * The token its sessions carry on every Kehikot door (protocol 2.4.0,
   * `PLACE_PARAM`): what a door hands back to find this record. Random, kept
   * with the conversation, carried on when Codex continues it under a
   * new id.
   */
  token?: string
  /**
   * How this module learnt of a conversation it did not start: Codex's
   * SessionStart hook (`hook`), or `claude agents --json` (`agents`). With no
   * `home`, it is listed as not yet assigned.
   */
  seen?: { via: 'hook' | 'agents'; at: string }
  /**
   * A person's say that this conversation is NOT a Kehikot one — a background
   * job, an agent's own run, something started for the computer and not for a
   * kehikko. Kept like an assignment, so it is never listed or asked about
   * again; assigning it later takes it back.
   */
  ignored?: { at: string }
  /**
   * When a person last took it off the place it belonged to (`detach`): from then on it belongs
   * where a person says, and this module never files it anywhere on its own again
   * (`autoFile` in context.ts). Cleared when a person assigns it.
   */
  detached?: string
  /**
   * Started or woken in the background (`claude --bg`) by this module: its saved options — the
   * name, the plugin folder and the doors file — are this module's, so it is woken with none
   * given (a flag would carry it on as a copy). See "The background" in program.ts.
   */
  background?: true
  /**
   * Since when this module has seen it working, while it still is: cleared when its turn ends,
   * when it stops for the person, and when a person ends it here. Still set at the next start of
   * this module and not running: a restart cut it off mid-turn (see `recover` in live.ts).
   */
  working?: string
  /** When this module last woke it after a restart had cut it off; `told` once the person has had it on screen. */
  resumed?: { at: string; told?: boolean }
  /**
   * Its background tasks that were cut off or failed, as its transcript says (cutoff.ts): read up
   * to `through` (ms), so each is said once; `open` until the person moves the conversation on.
   */
  cutOff?: { through: number; open: CutOff[] }
  /**
   * A restart cut it off mid-turn and the person's setting says to carry on: the next time its place
   * is opened it is resumed with this module's one sentence (`RESUME_LINE`), once.
   */
  resumeLine?: boolean
}

export interface Places {
  version: 1
  places: Record<string, PlaceEntry>
  sessions: Record<string, SessionEntry>
}

/** A place with the names a person knows it by. */
export interface NamedPlace extends Place {
  /** What the kehikko is called now. Stored for reading, never compared. */
  kehikkoName?: string
  /** The host's row number for it today. Stored beside a key as a note, never compared. */
  kehikkoId?: number
  /**
   * What a person calls each of `parts`, in the same order. Never stored and
   * never compared: it is carried so that a notice can name the place in
   * words (see `Notice` in live.ts).
   */
  partNames?: string[]
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: string }

const NO_PROJECT =
  'Nothing has said which project this is, so there is nowhere to keep anything. Open a project in the host, '
  + 'or send projectPath.'

const empty = (): Places => ({ version: 1, places: {}, sessions: {} })

/** Everything recorded for one project. Empty when nothing has been yet. */
export function readPlaces(projectPath: string | null | undefined): Result<Places> {
  const file = fileFor(projectPath, false)
  if (!file.ok) return file
  return load(file.value)
}

/** The sessions recorded for one place, in the order they were added. */
export function sessionsAt(places: Places, key: string): string[] {
  return Object.hasOwn(places.places, key) ? [...(places.places[key]?.sessions ?? [])] : []
}

/**
 * Every session id the record names, at any place or in its list of sessions.
 * What is looked for outside the project's own folder when the project was
 * renamed (`sessions` in program.ts).
 */
export function recordedIds(places: Places): string[] {
  return [...new Set([...Object.keys(places.sessions), ...Object.values(places.places).flatMap((place) => place?.sessions ?? [])])]
}

/**
 * Record that a session belongs to a place. Adding one that is already there
 * changes nothing but the names beside the key, which are brought up to date.
 */
export function attach(
  projectPath: string | null | undefined,
  place: NamedPlace,
  id: string,
  about: { label?: string; lastActive?: number } = {},
  now = Date.now(),
): Result<Places> {
  return change(projectPath, (places) => {
    const key = placeKey(place)
    const was = Object.hasOwn(places.places, key) ? places.places[key] : undefined
    places.places[key] = {
      epic: place.epic,
      parts: sortedParts(place.parts),
      kehikko: beside(place.kehikko, place.kehikkoName ?? was?.kehikko?.name ?? '', place.kehikkoId ?? was?.kehikko?.id),
      sessions: was?.sessions.includes(id) ? was.sessions : [...(was?.sessions ?? []), id],
      /* What was opened here last is what opens here next. */
      current: id,
      /* Viewing a conversation here does not make it the place's own: that is a person's say (`assign`). */
      ...(was?.own ? { own: was.own } : {}),
    }
    describe(places, id, about, now)
  })
}

/** The kehikko as it is written beside a key: tagged the way the place is, with the id as a note when keyed. */
function beside(kehikko: Place['kehikko'], name: string, seen?: number): PlaceEntry['kehikko'] {
  if (kehikko === null) return null
  if ('id' in kehikko) return { id: kehikko.id, name }
  return typeof seen === 'number' && Number.isSafeInteger(seen) ? { key: kehikko.key, id: seen, name } : { key: kehikko.key, name }
}

/**
 * Bring the entries an older release filed under a kehikko's row number
 * across to its key. Asked for by the page, once, when a host first names the
 * kehikko it is standing on by key.
 *
 * ## The rule
 *
 * An entry is moved when it is still filed under an id AND the kehikko NAME
 * stored beside it equals the open kehikko's name. It becomes
 * `kehikko=key:<key>` with its epic and parts unchanged.
 *
 * - **By name, never by id.** Ids are handed out again: after a project is
 *   removed and added back, id 3 may be a different kehikko, or one in
 *   another project. The name is what the person called it, and it is the
 *   only thing in an old entry that still means what it meant. It also means
 *   the entries a renumbering had already split — the same kehikko filed
 *   under 2 and later under 9 — come back together.
 * - **Merged, not replaced.** Where the key already has an entry for the same
 *   epic and parts, the session lists are joined as a set: the key's own
 *   first, then whatever the old entry adds.
 * - **Once.** If any entry filed under a key already carries this name, the
 *   name has been claimed — by this migration having run, or by another
 *   kehikko of the same name — and entries under ids are left alone rather
 *   than guessed at.
 * - **Everything else stays exactly as it is.** An entry whose name matches
 *   nothing is not touched and not removed; its sessions are in Codex's
 *   records for the folder and can be attached from any place. When nothing
 *   matches at all, the file is not written.
 *
 * `moved` is how many entries were re-keyed.
 */
export function rekey(
  projectPath: string | null | undefined,
  kehikko: { key: string; name: string; id?: number },
): Result<{ moved: number }> {
  if (!isKehikkoKey(kehikko.key)) return { ok: false, error: 'That is not a kehikko’s key.' }
  /* Looked at first without making a folder: most projects have nothing to move. */
  const read = readPlaces(projectPath)
  if (!read.ok) return read
  if (!movable(read.value, kehikko.name).length) return { ok: true, value: { moved: 0 } }

  let moved = 0
  const written = change(projectPath, (places) => {
    /* Decided again from what was just read: this is the read the write follows. */
    const from = new Set(movable(places, kehikko.name))
    moved = from.size
    if (!moved) return false
    const next: Places['places'] = {}
    for (const [key, entry] of Object.entries(places.places)) {
      const moving = from.has(key)
      const to = moving ? placeKey({ epic: entry.epic, parts: entry.parts, kehikko: { key: kehikko.key } }) : key
      const had = Object.hasOwn(next, to) ? next[to] : undefined
      /* The key's own entry leads, wherever in the file it was. */
      const [first, second] = moving ? [had, entry] : [entry, had]
      next[to] = {
        epic: entry.epic,
        parts: entry.parts,
        kehikko: moving && had ? had.kehikko : moving ? beside({ key: kehikko.key }, kehikko.name, kehikko.id) : entry.kehikko,
        sessions: [...new Set([...(first?.sessions ?? []), ...(second?.sessions ?? [])])],
        ...((first?.current ?? second?.current) ? { current: (first?.current ?? second?.current)! } : {}),
        ...((first?.own ?? second?.own) ? { own: (first?.own ?? second?.own)! } : {}),
      }
      /* A conversation that belonged to the moved entry belongs to it under its new key. */
      if (moving) for (const session of Object.values(places.sessions)) if (session.home === key) session.home = to
    }
    places.places = next
    return true
  })
  return written.ok ? { ok: true, value: { moved } } : written
}

/** The keys of the entries `rekey` would move for a kehikko called `name`. Empty when the name is already claimed. */
function movable(places: Places, name: string): string[] {
  if (!name) return []
  const entries = Object.entries(places.places)
  if (entries.some(([, entry]) => entry.kehikko?.key !== undefined && entry.kehikko.name === name)) return []
  return entries.filter(([, entry]) => entry.kehikko && entry.kehikko.key === undefined && entry.kehikko.name === name).map(([key]) => key)
}

/**
 * A conversation that Codex carried on under a new id: wherever `from`
 * is listed, `to` takes its place — in the same position, and as the place's
 * current one where `from` was. `from` was a step behind the conversation and
 * opening it again would start another copy of an old point in it, so it is
 * not kept beside `to`. Its entry in `sessions` stays, as every entry does.
 */
export function follow(projectPath: string | null | undefined, from: string, to: string, about: { label?: string; lastActive?: number } = {}): Result<Places> {
  if (from === to) return readPlaces(projectPath)
  const read = readPlaces(projectPath)
  if (!read.ok) return read
  if (!Object.values(read.value.places).some((entry) => entry.sessions.includes(from))) return read
  return change(projectPath, (places) => {
    let moved = false
    for (const entry of Object.values(places.places)) {
      if (!entry.sessions.includes(from)) continue
      moved = true
      entry.sessions = [...new Set(entry.sessions.map((one) => (one === from ? to : one)))]
      if (entry.current === from) entry.current = to
      if (entry.own === from) entry.own = to
    }
    if (!moved) return false
    const was = Object.hasOwn(places.sessions, from) ? places.sessions[from] : undefined
    describe(places, to, { label: about.label || was?.label, lastActive: about.lastActive })
    /* The conversation goes on under `to`: where it belongs and its token go with it. */
    const now = places.sessions[to]!
    if (was?.home && !now.home) now.home = was.home
    if (was?.token && !now.token) now.token = was.token
    /* One token, one conversation: the step behind it gives it up. */
    if (was?.token && now.token === was.token) delete was.token
  })
}

/* ------------------------------------------------------------------------ *
 * Where a conversation belongs, and a place's own
 * ------------------------------------------------------------------------ */

/**
 * The place a conversation belongs to, as the record says — or null. A file
 * written before `home` existed says it too, when it can be read as a fact:
 * the one place that lists the conversation, or, of several, the one place
 * that has it as its last open. Anything else is not assigned: never guessed.
 */
export function homeOf(places: Places, id: string): string | null {
  const said = Object.hasOwn(places.sessions, id) ? places.sessions[id]?.home : undefined
  if (said && Object.hasOwn(places.places, said)) return said
  const listing = Object.entries(places.places).filter(([, entry]) => entry.sessions.includes(id))
  if (listing.length === 1) return listing[0]![0]
  const current = listing.filter(([, entry]) => entry.current === id)
  return current.length === 1 ? current[0]![0] : null
}

/** A place's own conversation: the one it says, or — in a file from before `own` — its last open. */
export function ownOf(places: Places, key: string): string | null {
  const entry = Object.hasOwn(places.places, key) ? places.places[key] : undefined
  return entry?.own ?? entry?.current ?? null
}

/** The conversation a token was given to, and where it belongs. Null for a token the record does not hold. */
export function byToken(places: Places, token: string): { id: string; home: string | null } | null {
  if (!PLACE_TOKEN.test(token)) return null
  for (const [id, entry] of Object.entries(places.sessions)) if (entry.token === token) return { id, home: homeOf(places, id) }
  return null
}

/**
 * The conversations the record has seen and that belong nowhere: started
 * outside, reported, not yet assigned — and not said to be no Kehikot
 * conversation at all (`ignore`).
 */
export function unassigned(places: Places): string[] {
  return Object.entries(places.sessions)
    .filter(([id, entry]) => entry.seen && !entry.ignored && !homeOf(places, id))
    .map(([id]) => id)
}

/**
 * A person's say: this conversation is not a Kehikot one. Recorded on its
 * entry (`ignored`), so it stays out of every list and every Inbox count
 * through restarts, and a later report of it changes nothing. Refused for one
 * that belongs to a place: that is undone by taking it off the place.
 */
export function ignore(projectPath: string | null | undefined, id: string, now = Date.now()): Result<Places> {
  const read = readPlaces(projectPath)
  if (!read.ok) return read
  const home = homeOf(read.value, id)
  if (home) return { ok: false, error: 'That conversation belongs to a place already; take it off that place instead.' }
  if (Object.hasOwn(read.value.sessions, id) && read.value.sessions[id]!.ignored) return read
  return change(projectPath, (places) => {
    describe(places, id, {}, now)
    places.sessions[id]!.ignored = { at: new Date(now).toISOString() }
  })
}

/**
 * A conversation STARTED at a place: it belongs there from the first moment,
 * it is the place's own when the place had none, and it keeps its token.
 */
export function born(
  projectPath: string | null | undefined,
  place: NamedPlace,
  id: string,
  token: string | null,
  about: { label?: string; lastActive?: number } = {},
  now = Date.now(),
): Result<Places> {
  return change(projectPath, (places) => {
    listAt(places, place, id)
    const key = placeKey(place)
    describe(places, id, about, now)
    const entry = places.sessions[id]!
    if (!entry.home) entry.home = key
    if (token && PLACE_TOKEN.test(token)) entry.token = token
    if (!places.places[key]!.own) places.places[key]!.own = id
  })
}

/**
 * A person's say: this conversation belongs to this place — by assigning one
 * that belonged nowhere, or by "Make this the kehikko's own". `own: true`
 * also makes it the place's own conversation. Written as asked; the place it
 * belonged to before keeps it in its list.
 */
export function assign(
  projectPath: string | null | undefined,
  place: NamedPlace,
  id: string,
  options: { own?: boolean; label?: string; lastActive?: number } = {},
  now = Date.now(),
): Result<Places> {
  return change(projectPath, (places) => {
    listAt(places, place, id)
    const key = placeKey(place)
    describe(places, id, { label: options.label, lastActive: options.lastActive }, now)
    places.sessions[id]!.home = key
    /* Assigning one that was said to be no Kehikot conversation is the person changing their mind. */
    delete places.sessions[id]!.ignored
    delete places.sessions[id]!.detached
    if (options.own || !places.places[key]!.own) places.places[key]!.own = id
  })
}

/** A conversation this module did not start, reported by Codex: listed as not yet assigned until somebody says. */
export function sighted(projectPath: string | null | undefined, id: string, via: 'hook' | 'agents', now = Date.now(), label = ''): Result<Places> {
  const read = readPlaces(projectPath)
  if (!read.ok) return read
  const had = Object.hasOwn(read.value.sessions, id) ? read.value.sessions[id] : undefined
  if (had?.seen || had?.ignored || homeOf(read.value, id)) return read
  return change(projectPath, (places) => {
    describe(places, id, { label }, now)
    places.sessions[id]!.seen = { via, at: new Date(now).toISOString() }
  })
}

/** Give a recorded conversation its token, when it has none. The token it has, either way. */
export function tokenFor(projectPath: string | null | undefined, id: string, fresh: () => string): string | null {
  const read = readPlaces(projectPath)
  if (!read.ok) return null
  const had = Object.hasOwn(read.value.sessions, id) ? read.value.sessions[id]?.token : undefined
  if (had) return had
  if (!Object.hasOwn(read.value.sessions, id)) return null
  const token = fresh()
  const written = change(projectPath, (places) => {
    places.sessions[id]!.token = token
  })
  return written.ok ? token : null
}

/** The place's entry with `id` in its list, made when there is none: what `attach` does, without the `current`. */
function listAt(places: Places, place: NamedPlace, id: string): void {
  const key = placeKey(place)
  const was = Object.hasOwn(places.places, key) ? places.places[key] : undefined
  places.places[key] = {
    epic: place.epic,
    parts: sortedParts(place.parts),
    kehikko: beside(place.kehikko, place.kehikkoName ?? was?.kehikko?.name ?? '', place.kehikkoId ?? was?.kehikko?.id),
    sessions: was?.sessions.includes(id) ? was.sessions : [...(was?.sessions ?? []), id],
    current: id,
    ...(was?.own ? { own: was.own } : {}),
  }
}

/** Take a session off a place. The session itself, and its entry here, are kept. */
export function detach(projectPath: string | null | undefined, key: string, id: string): Result<Places> {
  if (!readPlaceKey(key)) return { ok: false, error: 'That is not a place this module wrote.' }
  return change(projectPath, (places) => {
    if (!Object.hasOwn(places.places, key)) return
    const entry = places.places[key]!
    entry.sessions = entry.sessions.filter((one) => one !== id)
    if (entry.current === id) delete entry.current
    if (entry.own === id) delete entry.own
    /* Taken off the place it belongs to: it belongs nowhere until somebody says. */
    const session = Object.hasOwn(places.sessions, id) ? places.sessions[id] : undefined
    if (session?.home === key) {
      delete session.home
      session.detached = new Date().toISOString()
    }
  })
}

/**
 * Bring what is known about a recorded session up to date. Does nothing —
 * and writes nothing — for a session no place lists, or when nothing differs.
 */
export function note(
  projectPath: string | null | undefined,
  id: string,
  about: { label?: string; lastActive?: number },
): Result<Places> {
  const read = readPlaces(projectPath)
  if (!read.ok) return read
  const was = Object.hasOwn(read.value.sessions, id) ? read.value.sessions[id] : undefined
  if (!was) return read
  const label = about.label || was.label
  const lastActive = about.lastActive ? new Date(about.lastActive).toISOString() : was.lastActive
  if (label === was.label && lastActive === was.lastActive) return read
  return change(projectPath, (places) => describe(places, id, about))
}

function describe(places: Places, id: string, about: { label?: string; lastActive?: number }, now = Date.now()): void {
  const was = Object.hasOwn(places.sessions, id) ? places.sessions[id] : undefined
  places.sessions[id] = {
    added: was?.added ?? new Date(now).toISOString(),
    label: about.label || was?.label || '',
    lastActive: about.lastActive ? new Date(about.lastActive).toISOString() : (was?.lastActive ?? null),
    ...(was?.home ? { home: was.home } : {}),
    ...(was?.token ? { token: was.token } : {}),
    ...(was?.seen ? { seen: was.seen } : {}),
    ...(was?.ignored ? { ignored: was.ignored } : {}),
    ...(was?.detached ? { detached: was.detached } : {}),
    ...(was?.background ? { background: was.background } : {}),
    ...(was?.working ? { working: was.working } : {}),
    ...(was?.resumed ? { resumed: was.resumed } : {}),
    ...(was?.cutOff ? { cutOff: was.cutOff } : {}),
  }
}

/**
 * Change what is kept about one recorded session — its background, working, resumed and cut-off
 * marks — and write only when `edit` says it changed something. Nothing for a session the record
 * does not hold.
 */
export function markSession(projectPath: string | null | undefined, id: string, edit: (entry: SessionEntry) => boolean): Result<Places> {
  const read = readPlaces(projectPath)
  if (!read.ok) return read
  if (!Object.hasOwn(read.value.sessions, id)) return read
  /* Asked of a copy first, so that a change of nothing writes nothing. */
  const trial = structuredClone(read.value.sessions[id]!)
  if (!edit(trial)) return read
  return change(projectPath, (places) => {
    if (!Object.hasOwn(places.sessions, id)) return false
    return edit(places.sessions[id]!)
  })
}

/** `markSession` for several sessions at once: one write for all of them. */
export function markSessions(projectPath: string | null | undefined, edits: ReadonlyMap<string, (entry: SessionEntry) => boolean>): Result<Places> {
  if (edits.size === 0) return readPlaces(projectPath)
  return change(projectPath, (places) => {
    let changed = false
    for (const [id, edit] of edits) if (Object.hasOwn(places.sessions, id) && edit(places.sessions[id]!)) changed = true
    return changed
  })
}

const SETTINGS = 'settings'

/** A project's settings for this module, the defaults where the file says nothing (`settingsOf`). */
export function readSettings(projectPath: string | null | undefined): Settings {
  const file = fileFor(projectPath, false, SETTINGS)
  if (!file.ok || !existsSync(file.value)) return { ...DEFAULTS }
  try {
    return settingsOf(JSON.parse(readFileSync(file.value, 'utf8')))
  } catch {
    return { ...DEFAULTS }
  }
}

/** Write a project's settings, whole. A person's press — in the page, or the host's Settings with its pass — is the only caller. */
export function writeSettings(projectPath: string | null | undefined, settings: Settings): Result<Settings> {
  const file = fileFor(projectPath, true, SETTINGS)
  if (!file.ok) return file
  const value = settingsOf(settings)
  const temporary = `${file.value}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`)
  renameSync(temporary, file.value)
  return { ok: true, value }
}

/**
 * Read, change, write — with no `await` anywhere between, on purpose (see the
 * essay above). Written to a temporary file and renamed, so a crash never
 * leaves half a file.
 */
function change(projectPath: string | null | undefined, edit: (places: Places) => void | boolean): Result<Places> {
  const file = fileFor(projectPath, true)
  if (!file.ok) return file
  const read = load(file.value)
  if (!read.ok) return read
  /* An edit that answers false found nothing to do, and nothing is written. */
  if (edit(read.value) === false) return read
  unshared(file.value)
  const temporary = `${file.value}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(read.value, null, 2)}\n`)
  renameSync(temporary, file.value)
  return read
}

/**
 * What the `.gitignore` beside the record says, when this module writes it.
 * See "What travels with the project" at the top.
 */
export const IGNORE = `# Which Codex session belongs to which place in this project.
#
# Not shared by default. The sessions themselves are on the computer where
# they ran (Codex's own folder, ~/.codex), so the list means little
# anywhere else, and it holds the first line of what was asked in each.
#
# To share it anyway, delete the two lines below and keep this file: it is
# only written when there is none.
${FILE}.json
${FILE}.json.*.tmp
`

/** Put the `.gitignore` beside the record if the folder has none. A courtesy: failing to is not a reason to lose a write. */
function unshared(file: string): void {
  const ignore = join(dirname(file), '.gitignore')
  try {
    /* `wx`: only ever a new file. One that is there — a link included — is somebody's, and is left. */
    writeFileSync(ignore, IGNORE, { flag: 'wx' })
  } catch {
    /* There already, or the folder cannot be written to — in which case the write below says so. */
  }
}

function load(file: string): Result<Places> {
  if (!existsSync(file)) return { ok: true, value: empty() }
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return { ok: false, error: `${file} is not readable JSON. Nothing was changed; fix or remove the file.` }
  }
  return { ok: true, value: tidy(parsed) }
}

/**
 * What was read, in the shape this file promises. Anything that is not that
 * shape is left out rather than trusted: the file is in somebody's project
 * and may have been edited by hand, or by a release that wrote more.
 */
function tidy(raw: unknown): Places {
  const out = empty()
  if (typeof raw !== 'object' || raw === null) return out
  const { places, sessions } = raw as { places?: unknown; sessions?: unknown }
  if (typeof places === 'object' && places !== null) {
    for (const [key, value] of Object.entries(places)) {
      const place = readPlaceKey(key)
      if (!place || typeof value !== 'object' || value === null) continue
      const entry = value as { kehikko?: { id?: unknown; name?: unknown } | null; sessions?: unknown; current?: unknown; own?: unknown }
      const seen = entry.kehikko?.id
      const listed: string[] = Array.isArray(entry.sessions) ? [...new Set(entry.sessions.filter((one): one is string => typeof one === 'string' && one.length > 0 && one.length <= 128))] : []
      out.places[key] = {
        epic: place.epic,
        parts: place.parts,
        /* Which kehikko is read off the KEY. Of what is beside it only the name is taken, and the id as a note. */
        kehikko: beside(place.kehikko, typeof entry.kehikko?.name === 'string' ? entry.kehikko.name : '', typeof seen === 'number' ? seen : undefined),
        sessions: listed,
        ...(typeof entry.current === 'string' && listed.includes(entry.current) ? { current: entry.current } : {}),
        ...(typeof entry.own === 'string' && listed.includes(entry.own) ? { own: entry.own } : {}),
      }
    }
  }
  if (typeof sessions === 'object' && sessions !== null) {
    for (const [id, value] of Object.entries(sessions)) {
      if (!id || id.length > 128 || typeof value !== 'object' || value === null) continue
      const entry = value as {
        added?: unknown
        label?: unknown
        lastActive?: unknown
        home?: unknown
        token?: unknown
        seen?: { via?: unknown; at?: unknown }
        ignored?: { at?: unknown }
        detached?: unknown
        background?: unknown
        working?: unknown
        resumed?: { at?: unknown; told?: unknown }
        cutOff?: { through?: unknown; open?: unknown }
        resumeLine?: unknown
      }
      const via = entry.seen?.via
      const cut = cutOffOf(entry.cutOff)
      out.sessions[id] = {
        added: typeof entry.added === 'string' ? entry.added : '',
        label: typeof entry.label === 'string' ? entry.label.slice(0, 200) : '',
        lastActive: typeof entry.lastActive === 'string' ? entry.lastActive : null,
        ...(typeof entry.home === 'string' && readPlaceKey(entry.home) ? { home: entry.home } : {}),
        ...(typeof entry.token === 'string' && PLACE_TOKEN.test(entry.token) ? { token: entry.token } : {}),
        ...((via === 'hook' || via === 'agents') && typeof entry.seen?.at === 'string' ? { seen: { via, at: entry.seen.at } } : {}),
        ...(typeof entry.ignored?.at === 'string' ? { ignored: { at: entry.ignored.at } } : {}),
        ...(typeof entry.detached === 'string' ? { detached: entry.detached } : {}),
        ...(entry.background === true ? { background: true as const } : {}),
        ...(typeof entry.working === 'string' ? { working: entry.working } : {}),
        ...(typeof entry.resumed?.at === 'string' ? { resumed: { at: entry.resumed.at, ...(entry.resumed.told === true ? { told: true } : {}) } } : {}),
        ...(cut ? { cutOff: cut } : {}),
        ...(entry.resumeLine === true ? { resumeLine: true } : {}),
      }
    }
  }
  return out
}

/** A cut-off mark as read back, or null for anything that is not one. At most eight tasks are kept open. */
function cutOffOf(raw: { through?: unknown; open?: unknown } | undefined): { through: number; open: CutOff[] } | null {
  if (!raw || typeof raw.through !== 'number' || !Number.isFinite(raw.through)) return null
  const open = Array.isArray(raw.open)
    ? raw.open.flatMap((one: unknown): CutOff[] => {
        const said = one as Partial<CutOff> | null
        if (!said || typeof said.at !== 'number' || typeof said.summary !== 'string' || (said.kind !== 'turn' && said.kind !== 'ended' && said.kind !== 'stopped' && said.kind !== 'failed')) return []
        return [{ at: said.at, kind: said.kind, summary: said.summary.slice(0, 200), tasks: typeof said.tasks === 'number' && said.tasks > 0 ? Math.min(99, Math.trunc(said.tasks)) : 1 }]
      })
    : []
  return { through: raw.through, open: open.slice(-8) }
}

/** The record's path, checked to resolve inside the project. `make` creates the folder first. */
function fileFor(projectPath: string | null | undefined, make: boolean, name: string = FILE): Result<string> {
  const root = projectRoot(projectPath)
  if (!root.ok) return root

  const dir = moduleDir(root.value, ID)!
  const levels = [kehikotDir(root.value)!, dir]
  /* Checked before making anything, so a folder that escapes is never written
     into, and again after, for what mkdir just made. */
  const escaped = escapesAny(root.value, levels)
  if (escaped) return { ok: false, error: escaped }
  if (make) {
    mkdirSync(dir, { recursive: true })
    const after = escapesAny(root.value, levels)
    if (after) return { ok: false, error: after }
  }
  const file = moduleFile(root.value, ID, name)!
  if (existsSync(file)) {
    const out = escapes(root.value, file)
    if (out) return { ok: false, error: out }
  }
  return { ok: true, value: file }
}

/** The project's folder, resolved, or the sentence saying why it is not one. */
export function projectRoot(projectPath: string | null | undefined): Result<string> {
  const raw = typeof projectPath === 'string' ? projectPath.trim() : ''
  if (!raw) return { ok: false, error: NO_PROJECT }
  if (!isAbsolute(raw)) return { ok: false, error: `"${raw}" is not an absolute path.` }
  try {
    const real = realpathSync(raw)
    if (!statSync(real).isDirectory()) return { ok: false, error: `"${raw}" is not a folder.` }
    return { ok: true, value: real }
  } catch {
    return { ok: false, error: `there is no folder at "${raw}" on this machine.` }
  }
}

function escapesAny(root: string, paths: string[]): string | null {
  for (const path of paths) {
    if (!existsSync(path)) continue
    const escaped = escapes(root, path)
    if (escaped) return escaped
  }
  return null
}

function escapes(root: string, child: string): string | null {
  let real: string
  try {
    real = realpathSync(child)
  } catch {
    return `${child} could not be resolved, so nothing is read or written through it.`
  }
  return within(root, real) ? null : `${child} resolves to ${real}, outside the project. Refused rather than followed.`
}
