import type { HeaderItemInput } from 'kehikot-module-protocol'

import type { Listing, Row } from '../../doors.ts'
import { MARKS, ago } from './places.ts'

/**
 * The conversations connected to the kehikko on screen, said in two places:
 * a bar on the page when there are none, and a View menu in the container's
 * header when there are.
 *
 * ## Connected
 *
 * A conversation is connected to a kehikko (strictly: to its place — the
 * epic, the picked parts and the kehikko) when the record lists it there
 * (`places.json`). Exactly two things put it there, and neither is a guess:
 *
 *  - `$kehikot-here`, typed by the person in that conversation;
 *  - it is the conversation this container itself started (or moved on to,
 *    by `/resume` or `/clear` in it) — written once Codex has a record
 *    of it, which is when the person first says something in it.
 *
 * Nothing else connects one: no conversation of the project is offered or
 * picked here, and none started elsewhere is filed under a kehikko because
 * it happens to be running in the same folder.
 *
 * ## The bar
 *
 * With none connected the container still shows Codex — a fresh
 * conversation in the project's folder — and one slim line above it says
 * that nothing is connected and how to connect one (`NONE_CONNECTED`), with
 * the command to copy. It is not an Inbox item: it is about this container,
 * and is gone the moment the record lists one.
 *
 * ## The View menu
 *
 * A `switch` (protocol 1.1.0, `kehikot.header`): every conversation
 * connected here, the kehikko's own first, each with what it is doing, how
 * full its context window is, when it was last active and whether it is the
 * own one. Choosing one resumes it
 * in the container. For the one on screen go: "Make this the kehikko's own" (a run, when it is not),
 * "Connected to this kehikko" (a toggle, so in the View menu: unchecking disconnects) and "Disconnect
 * from this kehikko" (a run). The protocol draws a switch's options as plain choices, so there is no
 * per-row action: the one on screen is the one acted on, and choosing another row is one press.
 * A disconnected conversation is kept; "Connect a conversation to this kehikko" (a jump, so in the Go
 * menu) lists the project's conversations that belong to no place and connects the one chosen. No
 * agent may press any of these. The host draws them and lays them out at every width.
 */

/** The View menu's switch. */
export const VIEW = 'conversation'
/** Rewrites the record: the conversation on screen becomes this kehikko's own. */
export const MAKE_OWN = 'make-own'
/** Takes the conversation on screen off this kehikko's list. Not confirmed: it is kept, and can be connected again. */
export const DISCONNECT = 'disconnect'
/** A View toggle for the one on screen: checked while it is connected here. Unchecking is "Disconnect from this kehikko". */
export const CONNECTED = 'connected'
/** A Go menu jump: connect one of the project's conversations that belongs to no place to this kehikko. */
export const CONNECT = 'connect'
/** The switch's value while what is on screen is a new conversation that is not connected yet. */
export const NOT_CONNECTED = 'not-connected'
/**
 * The project's setting: wake a conversation a restart cut off mid-turn, and tell it so (live.ts,
 * `recover`). A toggle that says nothing about agents, so only a person can press it.
 */
export const RESUME = 'resume-cut-off'
export const RESUME_LABEL = 'Resume conversations cut off by a restart'

/** The setting's toggle, for the View menu; nothing while the setting is not known. */
export function resumeToggle(checked: boolean | null): HeaderItemInput[] {
  return checked === null ? [] : [{ kind: 'toggle', id: RESUME, label: RESUME_LABEL, icon: 'refresh', checked }]
}

/** What the module types into a conversation to connect it. */
export const HERE_COMMAND = '$kehikot-here'

/** The bar, word for word. */
export const NONE_CONNECTED = `No conversation is connected to this kehikko. Type ${HERE_COMMAND} in the Codex conversation you want here.`

/** The protocol's limits (`HEADER_LABEL`, `HEADER_OPTIONS`). */
const LABEL = 48
const OPTIONS = 64

export const VIEW_LABEL = 'This kehikko’s conversations'
export const MAKE_OWN_LABEL = 'Make this the kehikko’s own'
export const DISCONNECT_LABEL = 'Disconnect from this kehikko'
export const CONNECTED_LABEL = 'Connected to this kehikko'
export const CONNECT_LABEL = 'Connect a conversation to this kehikko'

/**
 * What the strip above the terminal says after a disconnect, in full: the protocol keeps a menu label
 * to 48 characters, so the sentence is here and the labels are short.
 */
export function disconnectedLine(title: string): string {
  return `Disconnected ${title ? `“${cut(title, 40)}” ` : 'the conversation '}from this kehikko — it is kept and can be connected again from the Go menu (${CONNECT_LABEL}) or by typing ${HERE_COMMAND} in it.`
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, Math.max(1, most - 1)).trimEnd()}…` : text)

/** How full a conversation's context is, in a menu line: `41%`, or `82% soon` near where Codex compacts by itself. */
export function contextShort(context: Row['context']): string {
  if (!context || context.percent === null) return ''
  return `${context.percent}%${context.soon ? ' soon' : ''}`
}

/** The conversations connected here that this computer can open: the own one first, then the most recently active. */
export function connected(listing: Pick<Listing, 'sessions' | 'own'> | null): Row[] {
  if (!listing) return []
  const here = listing.sessions.filter((one) => !one.missing)
  const own = here.find((one) => one.id === listing.own)
  const rest = here.filter((one) => one !== own).sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))
  return own ? [own, ...rest] : rest
}

/**
 * One conversation as a line of the menu, at most 48 characters: its mark, its title, and — kept
 * whole however long the title is — when it was last active and whether it is the own one.
 */
export function optionLabel(row: Pick<Row, 'label' | 'lastActive' | 'state' | 'context'>, own: boolean, now: number, extra: readonly string[] = []): string {
  const mark = row.state ? `${MARKS[row.state].glyph} ` : ''
  const tail = [contextShort(row.context), ...extra, row.lastActive ? ago(row.lastActive, now) : '', own ? 'own' : ''].filter(Boolean).join(' · ')
  const room = LABEL - mark.length - (tail ? tail.length + 3 : 0)
  return cut(`${mark}${cut(row.label || 'No prompt yet', room)}${tail ? ` · ${tail}` : ''}`, LABEL)
}

/**
 * The header: nothing when nothing is connected (the bar says so), else the View switch over the
 * connected conversations and, for the one on screen, the two runs.
 */
export function viewHeader(o: {
  rows: readonly Row[]
  /** The kehikko's own, null for none; undefined from a server that does not say, which then claims nothing. */
  own: string | null | undefined
  /** The conversation on screen: its id, or null for a new one nobody has spoken to yet. */
  viewing: string | null
  /** What the one on screen is called, when it is not one of `rows`. */
  viewingLabel?: string
  /** A word for what the one on screen is besides this module's own (`background`, `copy`). */
  how?: string | null
  now: number
  /** The project's conversations that belong to no place: what "Connect a conversation" offers. */
  unplaced?: readonly Row[]
}): HeaderItemInput[] {
  const items: HeaderItemInput[] = []
  const free = (o.unplaced ?? []).filter((one) => !o.rows.some((row) => row.id === one.id)).slice(0, OPTIONS)
  const offer: HeaderItemInput[] = free.length
    ? [{ kind: 'go', id: CONNECT, label: CONNECT_LABEL, icon: 'undo', options: free.map((row) => ({ id: row.id, label: optionLabel(row, false, o.now) })) }]
    : []
  if (!o.rows.length) return offer
  /* One place is kept for what is on screen: past the limit it takes the last row's place, and when it is not connected, an option of its own. */
  const viewed = o.rows.find((one) => one.id === o.viewing)
  const first = o.rows.slice(0, OPTIONS - 1)
  const shown = viewed && !first.includes(viewed) ? [...first.slice(0, -1), viewed] : first
  const on = o.viewing !== null && shown.some((one) => one.id === o.viewing)
  const options = shown.map((row) => ({ id: row.id, label: optionLabel(row, o.own === row.id, o.now, row.id === o.viewing && o.how ? [o.how] : []) }))
  /* A switch's value is one of its options. What is on screen and not connected — a new one, a moment before it is — says so. */
  if (!on) options.push({ id: o.viewing ?? NOT_CONNECTED, label: cut(`Not connected: ${o.viewingLabel || 'a new conversation'}`, LABEL) })
  items.push({ kind: 'switch', id: VIEW, label: VIEW_LABEL, icon: 'list', options, value: on ? o.viewing! : (o.viewing ?? NOT_CONNECTED) })
  if (on) {
    if (o.own !== undefined && o.own !== o.viewing) items.push({ kind: 'run', id: MAKE_OWN, label: MAKE_OWN_LABEL, icon: 'check' })
    /* In the View menu, where the conversations are: unchecking disconnects it. And as a run, in Run. Neither is
       confirmed, since it is kept and can be connected again; neither is for agents. */
    items.push({ kind: 'toggle', id: CONNECTED, label: CONNECTED_LABEL, icon: 'check', checked: true })
    items.push({ kind: 'run', id: DISCONNECT, label: DISCONNECT_LABEL, icon: 'x' })
  }
  return [...items, ...offer]
}

/**
 * What to do with `context.show` (protocol 2.28.0): another module asked for one agent session to be
 * shown on this kehikko, and the host told this module because it says `shows: ['agent-session']`.
 *
 * - `wait`: this place's list is not read yet; decide when it is.
 * - `switch`: the session is one of this place's connected conversations: put it on screen.
 * - `not-here`: it is not this place's (another place's, another module's, or gone): nothing is
 *   switched. Not an error to draw: Claude may hold it, and a container that does not is not asked.
 * - `none`: nothing new to act on.
 */
export type ShowStep = { do: 'none' } | { do: 'wait' } | { do: 'switch'; session: string } | { do: 'not-here' }

export function showStep(
  show: { subject: string; id: string; at?: string } | null | undefined,
  actedOn: { subject?: string | null; id?: string | null; at?: string | null } | null,
  listing: Pick<Listing, 'sessions' | 'own'> | null,
  isNews: (show: { subject: string; id: string; at?: string }, actedOn: { subject?: string | null; id?: string | null; at?: string | null } | null) => boolean,
): ShowStep {
  if (!show || !isNews(show, actedOn)) return { do: 'none' }
  if (show.subject !== 'agent-session') return { do: 'not-here' }
  if (!listing) return { do: 'wait' }
  return connected(listing).some((one) => one.id === show.id) ? { do: 'switch', session: show.id } : { do: 'not-here' }
}
