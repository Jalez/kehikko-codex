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
 * conversation in the project's folder, started by this module, at any size
 * (behind the tile too) — and one slim line above it. While that new one is
 * on screen the line says it becomes this kehikko's own once spoken to, and
 * that the command is for one started elsewhere (`STARTED_HERE`): nobody types
 * it for a conversation this module started. With nothing of this module's on
 * screen it says nothing is connected and how to connect one
 * (`NONE_CONNECTED`). Both carry the command to copy. It is not an Inbox item:
 * it is about this container, and is gone the moment the record lists one.
 *
 * ## The conversation chooser
 *
 * One `switch` in the header's View menu (protocol 1.1.0, `kehikot.header`), labelled with the
 * conversation on screen — "Conversation: Fix login bug" — because choosing which conversation the
 * container shows is a choice of what the module shows, not a jump. Its options (protocol 2.68.0,
 * an option's `group` and `detail`):
 *
 *  - under "This kehikko’s conversation", the place's own;
 *  - under "Other conversations here", every other conversation connected to this place, the most
 *    recently active first;
 *  - each with its title as the label and, as its second line, what it is doing in words (working,
 *    needs you, finished, idle), when it was last active, and "(running elsewhere)" when another
 *    process has it;
 *  - then "New conversation" (a fresh one here; not while a new one is already on screen) and
 *    "Disconnect this conversation" (for one on screen that is connected here; unconfirmed: it is
 *    kept, and typing the command in it connects it again).
 *
 * Nothing from another place is ever listed, and nothing that belongs to no place: a conversation
 * started elsewhere is connected by typing the command in it. A host before 2.68.0 draws the label
 * alone: the titles, without headings or second lines. Beside the chooser, in Run: "Make this the
 * kehikko’s own" (when the one on screen is connected and not the own) and "What this conversation
 * was told". There is no Go menu: nothing here is a jump. No agent may press any of these. The host
 * draws them and lays them out at every width.
 */

/** The chooser: the View menu's switch. Its id is the one the View switch always had. */
export const VIEW = 'conversation'
/** A chooser option: start a new conversation here. */
export const NEW = 'new-conversation'
/** A chooser option: take the conversation on screen off this kehikko's list. Not confirmed: it is kept, and can be connected again. */
export const DISCONNECT = 'disconnect-conversation'
/** A Run: the conversation on screen becomes this kehikko's own. */
export const MAKE_OWN = 'make-own'
/** The switch's value while what is on screen is a new conversation that is not connected yet. */
export const NOT_CONNECTED = 'not-connected'

/** A Run for the one on screen: show what its hooks last told it (its place, the modules around it). */
export const TOLD = 'told'
export const TOLD_LABEL = 'What this conversation was told'
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

/** The bar while the new conversation this module started for the place is on screen, word for word. */
export const STARTED_HERE = `A new Codex conversation: it becomes this kehikko’s own once you say something in it. For one started elsewhere, type ${HERE_COMMAND} in it.`

/** The protocol's limits (`HEADER_LABEL`, `HEADER_OPTIONS`, `HEADER_OPTION_DETAIL`). */
const LABEL = 48
const OPTIONS = 64
const DETAIL = 64

export const OWN_GROUP = 'This kehikko’s conversation'
export const OTHERS_GROUP = 'Other conversations here'
export const NEW_LABEL = 'New conversation'
export const DISCONNECT_LABEL = 'Disconnect this conversation'
export const MAKE_OWN_LABEL = 'Make this the kehikko’s own'
/** What a conversation with no title yet is called. */
export const UNTITLED = 'No prompt yet'

/**
 * What the strip above the terminal says after a disconnect, in full: the protocol keeps a menu label
 * to 48 characters, so the sentence is here and the labels are short.
 */
export function disconnectedLine(title: string): string {
  return `Disconnected ${title ? `“${cut(title, 40)}” ` : 'the conversation '}from this kehikko — it is kept, and typing ${HERE_COMMAND} in it connects it here again.`
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, Math.max(1, most - 1)).trimEnd()}…` : text)

/** The conversations connected here that this computer can open: the own one first, then the most recently active. */
export function connected(listing: Pick<Listing, 'sessions' | 'own'> | null): Row[] {
  if (!listing) return []
  const here = listing.sessions.filter((one) => !one.missing)
  const own = here.find((one) => one.id === listing.own)
  const rest = here.filter((one) => one !== own).sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0))
  return own ? [own, ...rest] : rest
}

/** What a conversation is doing, in words: working, needs you, finished — or idle when it has not said. */
export function stateWord(state: Row['state'] | null | undefined): string {
  return state ? MARKS[state].word : 'idle'
}

/** The chooser's label: the conversation on screen, by its title, cut to the protocol's 48 characters. */
export function chooserLabel(title: string): string {
  return cut(`Conversation: ${title || UNTITLED}`, LABEL)
}

/**
 * One conversation's second line: what it is doing, when it was last active, and "(running
 * elsewhere)" when another process has it.
 */
export function optionDetail(row: Pick<Row, 'state' | 'lastActive' | 'running' | 'elsewhere' | 'as'>, now: number): string {
  const when = row.lastActive ? ago(row.lastActive, now) : ''
  /* Another process has it: one this module only looks at (a background session, a copy), or one it is not running at all. */
  const away = row.as || (row.elsewhere && !row.running) ? '(running elsewhere)' : ''
  return cut([stateWord(row.state), when, away].filter(Boolean).join(' · '), DETAIL)
}

/**
 * The header: the chooser over this place's conversations and, for the one on screen, the runs beside
 * it. Nothing at all while nothing is connected and a new conversation is on screen: the footer (or
 * the bar) says so.
 */
export function viewHeader(o: {
  rows: readonly Row[]
  /** The kehikko's own, null for none; undefined from a server that does not say, which then claims nothing. */
  own: string | null | undefined
  /** The conversation on screen: its id, or null for a new one nobody has spoken to yet. */
  viewing: string | null
  /** What the one on screen is called, when it is not one of `rows`. */
  viewingLabel?: string
  /** The one on screen is a view of a process that runs elsewhere (a background session, a copy), as its view said. */
  viewingElsewhere?: boolean
  now: number
}): HeaderItemInput[] {
  if (!o.rows.length && o.viewing === null) return []
  /* Two options are kept for New and Disconnect, and one for what is on screen: past the limit it
     takes the last row's place, and when it is not connected, an option of its own. */
  const room = OPTIONS - 3
  const viewed = o.rows.find((one) => one.id === o.viewing)
  const first = o.rows.slice(0, room)
  const shown = viewed && !first.includes(viewed) ? [...first.slice(0, -1), viewed] : first
  const on = o.viewing !== null && shown.some((one) => one.id === o.viewing)
  const isOwn = (row: Row) => o.own !== undefined && o.own !== null && o.own === row.id
  const detail = (row: Row) => optionDetail(row.id === o.viewing && o.viewingElsewhere && !row.as ? { ...row, as: 'background' } : row, o.now)
  const options: { id: string; label: string; group?: string; detail?: string }[] = [
    ...shown.filter(isOwn).map((row) => ({ id: row.id, label: cut(row.label || UNTITLED, LABEL), group: OWN_GROUP, detail: detail(row) })),
    ...shown.filter((row) => !isOwn(row)).map((row) => ({ id: row.id, label: cut(row.label || UNTITLED, LABEL), group: OTHERS_GROUP, detail: detail(row) })),
  ]
  /* A switch's value is one of its options. What is on screen and not connected — a new one, a moment
     before it is — is an option too, under the heading it will be filed under. */
  if (!on) {
    const hasOwn = shown.some(isOwn)
    options.push({
      id: o.viewing ?? NOT_CONNECTED,
      label: cut(o.viewing === null ? NEW_LABEL : o.viewingLabel || UNTITLED, LABEL),
      group: hasOwn ? OTHERS_GROUP : OWN_GROUP,
      detail: o.viewing === null ? 'new · joins this kehikko once you say something' : 'not connected to this kehikko',
    })
    options.sort((a, b) => Number(b.group === OWN_GROUP) - Number(a.group === OWN_GROUP))
  }
  if (o.viewing !== null) options.push({ id: NEW, label: NEW_LABEL })
  if (on) options.push({ id: DISCONNECT, label: DISCONNECT_LABEL })
  const title = on ? viewed!.label : o.viewing === null ? NEW_LABEL : o.viewingLabel || ''
  const items: HeaderItemInput[] = [{ kind: 'switch', id: VIEW, label: chooserLabel(title), icon: 'list', options, value: on ? o.viewing! : (o.viewing ?? NOT_CONNECTED) }]
  if (on) {
    if (o.own !== undefined && o.own !== o.viewing) items.push({ kind: 'run', id: MAKE_OWN, label: MAKE_OWN_LABEL, icon: 'check' })
    /* What its hooks told it, on screen as plain text. A person's look; not for agents. */
    items.push({ kind: 'run', id: TOLD, label: TOLD_LABEL, icon: 'scroll-text' })
  }
  return items
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

/**
 * The conversation an Inbox item of this module is about, from the item's id as `activityRows` and
 * `recordRows` in live.ts write it: the session itself, `cut-off:<session>`, `resumed:<session>` or
 * `<session>:agent:<agent>`. What `kehikot.opened` (protocol 2.35.0) is turned into: that
 * conversation put on screen, which is the person looking at it.
 */
export function itemSession(item: string): string | null {
  const bare = item.replace(/^(?:cut-off|resumed):/, '').replace(/:agent:.*$/, '')
  return bare.length > 0 && !bare.includes(':') ? bare : null
}
