import type { Listing } from '../../doors.ts'
import type { Elsewhere, Notice } from '../../live.ts'
import { projectKey } from 'kehikot-module-protocol'

import { kehikkoOf, placeKey, type Place } from '../../place.ts'
import type { State } from '../../program.ts'

/**
 * What the page does when the canvas names a place, decided from what the
 * server says is there.
 *
 * ## The rule
 *
 * The container always shows Codex itself — its own UI, in a terminal
 * — and never a list of the project's conversations to pick from:
 *
 *   - the place has conversations connected (`view/conversations.ts`) → one
 *     of them, at once: the one this page was showing for it, else the one
 *     last open there (`current`), else its own, else the most recently
 *     active;
 *   - none → a new conversation in the project's folder, after the canvas
 *     has stopped moving (`SETTLE_MS`). The page says above it that nothing
 *     is connected, and how to connect one.
 *
 * Which conversation that new one becomes is never guessed: it is this
 * place's once the person says something in it (it was started here), and
 * any other conversation is this place's once `$kehikot-here` is typed in it.
 *
 * Nothing is remembered as a default. The one thing that is remembered is
 * narrower and is not a default: which session THIS PAGE was showing for a
 * place, for as long as the page's tab lives (`held`, in `app.tsx`). A page
 * that reloads — which the plumbing does by itself when its server restarts —
 * comes back to what was on screen.
 *
 * ## Why this file holds no socket, no emulator and no React
 *
 * As in Terminal's `sessions.ts`: everything here is a pure function of what
 * was said and what is held, so the tests can say "two sessions, so it opens
 * the own one" without a browser or a pty in the room.
 */

export type Step =
  /** The program is missing, or too old: one sentence and one press. */
  | { do: 'install'; update: boolean }
  /** Open this session; null is a new one. */
  | { do: 'open'; session: string | null }

/**
 * `showing` is the session this page was showing for the place, if it was
 * showing one. It is honoured only while it is still one of the place's
 * sessions: one that was taken off the place in another container is not
 * reopened on the strength of a memory.
 *
 * Only sessions that are HERE count — the ones Codex has on this
 * computer. One the record lists and this computer does not have (`missing`:
 * it ran on another, or its transcript was cleaned away) cannot be opened,
 * so it is not the one to open: a place whose only recorded session is
 * somewhere else gets a new one.
 */
export function decide(listing: Listing, showing: string | null = null): Step {
  if (!listing.program.found) return { do: 'install', update: false }
  if (listing.program.lacks) return { do: 'install', update: true }
  const here = listing.sessions.filter((one) => !one.missing)
  const has = (id: string | null | undefined): id is string => Boolean(id) && here.some((one) => one.id === id)
  if (has(showing)) return { do: 'open', session: showing }
  /* The one last open here opens again, however many others the place lists. */
  if (has(listing.current)) return { do: 'open', session: listing.current }
  if (has(listing.own)) return { do: 'open', session: listing.own }
  if (here.length === 0) return { do: 'open', session: null }
  const latest = [...here].sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))[0]!
  return { do: 'open', session: latest.id }
}

/** A place as the page holds it: the project's folder with the key inside it. */
export interface Standing extends Place {
  /** Where the project's folder is now. After a rename, the same project (`projectId`) at a new path. */
  projectPath: string
  /**
   * The project's permanent id (protocol 2.1.0, `context.projectId`), absent from an older host.
   * What a place, a view and what is remembered are filed under (`projectOf`), so a folder renamed
   * while a session runs is the same project and not a switch to another.
   */
  projectId?: string
  kehikkoName: string
  /** What a person calls each picked part, by id. For a notice's words; never compared. */
  partNames: Record<string, string>
  /** The host's row number for the kehikko today: a note beside a key, and all there is without one. */
  kehikkoId: number | null
  key: string
}

/**
 * What the host said, as a place — or null when there is nothing to open:
 * the page has not been greeted, nothing is framing it, or no project is
 * open. A session with no project is a session in no folder, which nobody
 * asked for; Terminal falls back to a home shell there and this does not.
 *
 * The kehikko is named by its `key` whenever the host sends one (protocol
 * 1.1.0), because the key is the same after the project is removed and added
 * again and on another machine, and the `id` is a row number that is not. A
 * host that sends no key is an older one, and the place falls back to the id.
 */
export function standing(host: {
  where: 'listening' | 'unhosted' | 'hosted'
  projectPath: string | null
  epic: string | null
  parts: readonly { id: string; picked: boolean; heading?: string }[]
  kehikko: { id: number; name: string; key?: string } | null
  projectId?: string | null
}): Standing | null {
  if (host.where !== 'hosted' || !host.projectPath) return null
  const place: Place = {
    epic: host.epic,
    parts: host.parts.filter((part) => part.picked).map((part) => part.id).sort(),
    kehikko: kehikkoOf(host.kehikko),
  }
  return {
    ...place,
    projectPath: host.projectPath,
    ...(host.projectId ? { projectId: host.projectId } : {}),
    kehikkoName: host.kehikko?.name ?? '',
    partNames: Object.fromEntries(host.parts.filter((part) => part.picked && part.heading).map((part) => [part.id, part.heading!])),
    kehikkoId: host.kehikko?.id ?? null,
    key: placeKey(place),
  }
}

/**
 * What a project is known by on this page: its permanent id when the host sent one, else its folder
 * (`projectKey` in the protocol). The same across a rename of the folder.
 */
export const projectOf = (at: { projectPath: string; projectId?: string | null }): string => projectKey(at)?.key ?? at.projectPath

/** One string for a place across projects: what a view is filed under. The same across a rename of the project's folder. */
export const placeId = (at: { projectPath: string; projectId?: string | null; key: string }): string => `${projectOf(at)}\n${at.key}`

/**
 * The views to point at the project's new folder: those of the same project (by id) still holding
 * the old path. Only the path changes — the view, its socket and its session are kept.
 */
export function relinked(views: readonly View[], at: Pick<Standing, 'projectPath' | 'projectId'> | null): View[] | null {
  if (!at?.projectId) return null
  if (!views.some((one) => one.at.projectId === at.projectId && one.at.projectPath !== at.projectPath)) return null
  return views.map((one) => (one.at.projectId === at.projectId && one.at.projectPath !== at.projectPath ? { ...one, at: { ...one.at, projectPath: at.projectPath } } : one))
}

/** How many terminal views the page keeps mounted. A view let go is only a viewer: its session runs on. */
export const MOST_VIEWS = 8

export interface View {
  /** This page's own number for it; a fresh one makes a fresh emulator and a fresh socket. */
  n: number
  at: Standing
  /** The session it is on. Null until the server has said which id a new one got. */
  session: string | null
  shownAt: number
  /**
   * Whether there is anything in it to keep: the program has a record of the
   * session, or somebody has typed into it. A view that is neither is let go
   * when the canvas moves on, and the server ends what was behind it.
   */
  kept: boolean
  /** A person, told the session is open in another process, chose to open a copy of it here anyway. */
  copy?: boolean
}

/**
 * How long a place has to be stood on before a NEW session is started for it.
 * Picking three parts is three places on the way to the fourth, and only the
 * last is wanted. Reopening a session that exists does not wait.
 */
export const SETTLE_MS = 600

/** The views to let go of, least recently shown first, never the one on screen. */
export function surplus(views: readonly View[], shown: number | null, most = MOST_VIEWS): View[] {
  const others = views.filter((view) => view.n !== shown).sort((a, b) => a.shownAt - b.shownAt)
  return others.slice(0, Math.max(0, views.length - most))
}

/** What a session is called where there is room for a few words, short enough to cost nothing. */
export function brief(label: string, most = 28): string {
  const text = label || 'New session'
  return text.length > most ? `${text.slice(0, most - 1).trimEnd()}…` : text
}

/** When something last happened, in the fewest words that are still true. */
export function ago(at: number | null, now: number): string {
  if (at === null) return ''
  const seconds = Math.max(0, Math.round((now - at) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(at).toISOString().slice(0, 10)
}

/**
 * A session's state as a mark: one glyph, the word for it, and a colour.
 *
 * Three shapes and not three colours of one dot, because a colour is a claim
 * a person with any kind of colour blindness cannot read; and a glyph in the
 * text it sits in, because it then costs the width of a character and no
 * height at all. The word is the `title`, and is written out wherever there
 * is room for a word.
 *
 * Colours follow the host's own dots (protocol 1.5.0, docs/activity.md): needs you is yellow,
 * finished is green, working is grey.
 *
 * Nothing known is no mark: a session that has not said what it is doing is
 * not drawn as idle.
 */
export const MARKS: Record<State, { glyph: string; word: string; colour: string }> = {
  working: { glyph: '●', word: 'working', colour: 'text-muted-foreground' },
  'needs-you': { glyph: '◆', word: 'needs you', colour: 'text-needs-you' },
  finished: { glyph: '○', word: 'finished', colour: 'text-done' },
}

/** The mark's `title`: the word, and since when. */
export function since(state: State, at: number | null | undefined, now: number): string {
  const when = at ? ago(at, now) : ''
  return when && when !== 'just now' ? `${MARKS[state].word} · ${when}` : MARKS[state].word
}

/** A place in a person's words: the epic, the picked parts, the kehikko — whichever of them there are. */
export function placeWords(at: Pick<Notice, 'epic' | 'parts' | 'kehikko'>): string {
  return [at.epic, at.parts.join(' + '), at.kehikko].filter(Boolean).join(' · ')
}

/**
 * A notice as the line a panel draws and the level it draws it at, in the
 * protocol's own format. Null when it cannot be filed: the format files
 * every line under an epic, and a session in a place with no epic, noticed
 * while the canvas is on none, has nothing true to be filed under.
 *
 * It says which of the two it is first, then which session, then where —
 * and nothing about who is speaking: the panel says that itself.
 */
export function noticeLine(
  notice: Pick<Notice, 'state' | 'label' | 'epic' | 'parts' | 'kehikko' | 'partIds' | 'kehikkoKey'>,
  canvasEpic: string | null,
): { epic: string; message: string; level: 'attention' | 'done'; place?: { epic: string; parts?: string[]; kehikko?: string } } | null {
  const epic = notice.epic ?? canvasEpic
  if (!epic) return null
  const what = notice.state === 'finished' ? 'Finished' : 'Waiting for you'
  const which = notice.label ? `“${notice.label}”` : 'a session with no prompt yet'
  const where = placeWords(notice)
  return {
    epic,
    message: `${what}: ${which}${where ? ` — ${where}` : ''}`,
    level: notice.state === 'finished' ? 'done' : 'attention',
    /* Where a press on this line goes (protocol 1.4.0): the session's own epic, the parts' ids and the
       kehikko's key. Only for a session that has an epic of its own; more parts than a place may hold
       are left out, so that a press goes to the epic rather than to a cut-down selection. */
    ...(notice.epic
      ? {
          place: {
            epic: notice.epic,
            ...(notice.partIds?.length && notice.partIds.length <= 16 ? { parts: notice.partIds } : {}),
            ...(notice.kehikkoKey ? { kehikko: notice.kehikkoKey } : {}),
          },
        }
      : {}),
  }
}

/* ------------------------------------------------------------------------ *
 * A session that is running somewhere this module did not start it
 * ------------------------------------------------------------------------ */

/** What kind of process has it, in a person's words. The program's own word is kept when it is not one of the two known. */
export function kindWords(there: Pick<Elsewhere, 'kind' | 'called'>): string {
  if (there.kind === 'background') return 'a background session'
  if (there.kind === 'interactive') return 'a Codex process in a terminal, an editor or the Codex app'
  return there.called ? `a “${there.called}” session` : 'a session of another kind'
}

/** Where it is running and for how long: the kind, the process, the folder, since when — whichever of them the program said. */
export function whereWords(there: Elsewhere, now: number): string {
  return [kindWords(there), there.pid ? `process ${there.pid}` : '', there.cwd ? `in ${there.cwd}` : '', there.since ? `started ${ago(there.since, now)}` : ''].filter(Boolean).join(', ')
}

/**
 * The question, when a session cannot be shown because another process has
 * it open: what is true, and that nothing has been done about it.
 */
export function elsewhereSaid(program: string, label: string, there: Elsewhere | null, now: number): string {
  const which = label ? `“${label}”` : 'This conversation'
  const where = there ? `: ${whereWords(there, now)}` : ''
  return `${which} is already open in another ${program} process on this computer${where}. Nothing has been started here.`
}

/** The two answers, and what each means. Said before the choice is made, not after. */
export const LEAVE = { word: 'Leave it', means: 'Nothing is started here, and the other process is not touched.' }
export const COPY = {
  word: 'Open it here anyway',
  means: 'Codex then says the conversation is open in another app, and offers to retry once it is closed there, or to fork it into a new conversation here.',
}

/**
 * What a session on screen is, when it is not simply this module's own: the
 * word beside its label in the corner, and the sentence behind it.
 */
export function standingWords(
  how: { background?: Elsewhere; copyOf?: Elsewhere; unchecked?: 'too-old' | 'failed' } | undefined,
  program: string,
  now: number,
): { word: string; means: string } | null {
  if (how?.background) {
    return { word: 'background', means: `Attached to ${whereWords(how.background, now)}: no second process was started, and Remote Control is where it was. Closing this view leaves the session running.` }
  }
  if (how?.copyOf) {
    return { word: 'also open', means: `Opened here while another ${program} process has it (${whereWords(how.copyOf, now)}). ${COPY.means}` }
  }
  if (how?.unchecked) {
    return {
      word: 'unchecked',
      means:
        how.unchecked === 'too-old'
          ? `Resumed without checking whether it is already open somewhere else: this ${program} cannot be asked. Update it to have that checked.`
          : `Resumed without checking whether it is already open somewhere else: which process holds it could not be asked.`,
    }
  }
  return null
}
