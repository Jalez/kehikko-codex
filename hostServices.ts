import {
  CONVERSATION_MATCHES,
  LIMITS,
  agentTaskStartParams,
  conversationsBringParams,
  conversationsFindParams,
  type AgentTaskStartResult,
  type ConversationCandidate,
  type ConversationMatch,
  type ConversationPlace,
  type ConversationsBringResult,
  type ConversationsFindParams,
  type ConversationsFindResult,
} from 'kehikot-module-protocol'
import { acceptTask, readJsonBody, readJsonRequest, vouchHost, type BodySource, type Reply } from 'kehikot-module-protocol/serve'

import { freshToken } from './doorConfig.ts'
import { ID } from './manifest.ts'
import type { Refusal, Run } from './live.ts'
import { placeKey, readPlaceKey, type Place } from './place.ts'
import type { Program, Running } from './program.ts'
import { assign, disconnect, homeOf, projectRoot, readPlaces, recordedIds, tokenFor, type NamedPlace, type Places } from './record.ts'

/**
 * The two services the HOST asks of this module (protocol 2.88.0), when a person adopts a tracker
 * item that belongs to no epic: `conversations.finder` (which of its Codex conversations worked on
 * that change, and filing one under a place) and `agent.tasks` (a new conversation fed a brief).
 *
 * ## Only the host
 *
 * Every route here is held to `vouchHost`: the request says it is from Kehikot (`x-kehikot-caller:
 * kehikko`) and carries a pass, and the host — asked at the origins it started this module with,
 * never at an address a request names — says it minted that pass. Anything else is 403. The doors'
 * `answer` is not handed a request's headers, so these routes are answered BEFORE it: `hostDoor`
 * for the built server (`run`'s `before`) and `hostMiddleware` for Vite.
 *
 * ## What `find` reads
 *
 * Only what this module already reads of Codex's conversations: its session listing (`sessions` in
 * program.ts — each record's meta row, with its folder and the git branch Codex wrote there, and
 * the first and last prompt lines it reads for a label) and this module's own record. Nothing new,
 * and no transcript content goes out beyond a title. So it can say:
 *
 * - `branch`: the conversation was started on the change's branch (`git.branch` in its meta row);
 * - `mentioned`: its title, first or last prompt names one of the change's refs or its address;
 * - `folder`: it ran in this project's folder.
 *
 * It never says `created` or `pushed`: that would take reading the commands a transcript ran,
 * which this module does not read.
 *
 * ## What `bring` and `start` do
 *
 * `bring` is what `$kehikot-here` writes (here.ts): `assign`, then the conversation's token and the
 * pages told; with `to: null`, `disconnect` (`$kehikot-here off`). Only when the conversation is
 * filed under `from` now. `start` is the container's way of starting a conversation (`startTask`
 * in live.ts, over `start`), with the brief as its first prompt.
 */

export const FIND_PATH = '/api/conversations/find'
export const BRING_PATH = '/api/conversations/bring'
export const START_PATH = '/api/tasks/start'
const PATHS = new Set([FIND_PATH, BRING_PATH, START_PATH])

/** A brief is up to 32 000 characters, and JSON may spell each in six bytes. */
const MOST = 256 * 1024
const MOST_FOUND = 20

/** What these routes need of the module, so a test can stand each in. */
export interface HostNeeds {
  program: Pick<Program, 'isId' | 'sessions'> & Partial<Pick<Program, 'find' | 'newId' | 'name'>>
  /** The conversations this module runs now, and what the program says runs anywhere. */
  runs: {
    sessions(): Run[]
    running(): Promise<Running>
    find(id: string): Run | null
    told(projectPath: string, assigned?: { key: string; session: string }): void
    startTask(projectPath: string, place: NamedPlace, brief: string, wait?: { ms: number; every: number }, id?: string): Promise<{ session: string } | Refusal>
  }
  /** Where `tasks.report` goes, for a test (the host this module was started by, otherwise). */
  report?: { env?: Record<string, string | undefined>; fetch?: typeof fetch; log?: (line: string) => void }
  /** Whether the host minted the pass on these headers (`vouchHost`). */
  vouch?: (headers: Headers | Record<string, string | string[] | undefined>) => Promise<{ ok: true } | { ok: false; why: string }>
}

const json = (status: number, body: unknown): Reply => ({ status, body })

/** The protocol's place as this module's: a kehikko by its key. Null is the project itself, with no epic. */
export function placeFrom(place: ConversationPlace | null): NamedPlace {
  if (!place) return { epic: null, parts: [], kehikko: null }
  return { epic: place.epic, parts: [...place.parts], kehikko: place.kehikko ? { key: place.kehikko } : null }
}

/**
 * This module's place as the protocol says one, or null. A place filed under a kehikko's row number
 * (an older host) has no key to say: its kehikko is said as none, and it never equals a `from`.
 */
export function placeTo(key: string | null): ConversationPlace | null {
  const place = key ? readPlaceKey(key) : null
  if (!place) return null
  return { epic: place.epic, parts: [...place.parts], kehikko: place.kehikko && 'key' in place.kehikko ? place.kehikko.key : null }
}

/** The key a protocol place is filed under here, or null for no place. */
const keyOf = (place: ConversationPlace | null): string | null => (place ? placeKey(placeFrom(place) as Place) : null)

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Whether `text` names `ref` as a whole word: `!47` is not in `!4721`. */
export function names(text: string, ref: string): boolean {
  const said = ref.trim()
  if (!said || !text) return false
  /* Bounded only where the ref itself starts or ends with a letter or digit: `o/r#12` names `#12`. */
  const before = /^[A-Za-z0-9]/.test(said) ? '(?<![A-Za-z0-9])' : ''
  const after = /[A-Za-z0-9]$/.test(said) ? '(?![A-Za-z0-9])' : ''
  return new RegExp(`${before}${escape(said)}${after}`, 'i').test(text)
}

const cut = (text: string, most: number) => (text.length > most ? `${text.slice(0, most - 1)}…` : text)

/**
 * Which of this project's Codex conversations worked on the change: strongest match first, then the
 * most recently active, at most 20. Titles and reasons only.
 */
export async function findConversations(asked: ConversationsFindParams, needs: Pick<HostNeeds, 'program' | 'runs'>): Promise<ConversationsFindResult> {
  const root = projectRoot(asked.project)
  if (!root.ok) return { conversations: [] }
  const read = readPlaces(root.value)
  const places: Places = read.ok ? read.value : { version: 1, places: {}, sessions: {} }
  const recorded = await needs.program.sessions(root.value, recordedIds(places))
  const mine = new Set(needs.runs.sessions().filter((run) => !run.ended).flatMap((run) => [run.id, ...(run.settled ? [run.settled] : [])]))
  const running = await needs.runs.running().catch(() => ({ known: false as const, why: 'failed' as const }))
  const elsewhere = new Set(running.known ? running.active.map((one) => one.session) : [])
  const refs = [...new Set([...asked.refs, ...(asked.url ? [asked.url] : [])].map((one) => one.trim()).filter(Boolean))]
  const branch = asked.branch?.trim() || null

  const found: ConversationCandidate[] = []
  for (const one of recorded) {
    const kept = Object.hasOwn(places.sessions, one.id) ? places.sessions[one.id] : undefined
    /* A person said this is no Kehikot conversation (`ignore`): it is not offered for one. */
    if (kept?.ignored) continue
    const title = one.label || kept?.label || ''
    const said = [title, one.firstPrompt ?? '', one.lastPrompt ?? '']
    let match: ConversationMatch = 'folder'
    let reason = 'worked in this repository'
    if (branch && one.branch === branch) {
      match = 'branch'
      reason = `worked on branch ${branch}`
    } else {
      const ref = refs.find((each) => said.some((text) => names(text, each)))
      if (ref) {
        match = 'mentioned'
        reason = `mentioned ${ref}`
      }
    }
    found.push({
      session: one.id,
      title: cut(title, LIMITS.TITLE),
      folder: cut(one.cwd ?? root.value, 1024),
      lastActive: Math.max(0, Math.trunc(one.lastActive || 0)),
      match,
      reason: cut(reason, LIMITS.REASON),
      place: placeTo(homeOf(places, one.id)),
      running: mine.has(one.id) || elsewhere.has(one.id),
    })
  }
  const rank = (match: ConversationMatch) => CONVERSATION_MATCHES.indexOf(match)
  found.sort((a, b) => rank(a.match) - rank(b.match) || b.lastActive - a.lastActive)
  return { conversations: found.slice(0, MOST_FOUND) }
}

/**
 * File one conversation under `to` (none, for null) only if it is filed under `from` now — the
 * record writes `$kehikot-here` makes (here.ts). Never moves one somebody filed elsewhere. A running
 * conversation is not restarted: its hooks read the record at its next prompt, and its doors find
 * its place by its token.
 */
export async function bringConversation(asked: { project: string; session: string; to: ConversationPlace | null; from: ConversationPlace | null }, needs: Pick<HostNeeds, 'program' | 'runs'>): Promise<ConversationsBringResult> {
  const root = projectRoot(asked.project)
  if (!root.ok) return { outcome: 'declined', place: null, resumed: false, why: cut(root.error, LIMITS.REASON) }
  const id = asked.session
  if (!needs.program.isId(id)) return { outcome: 'no-such-session', place: null, resumed: false, why: 'That is not a Codex conversation’s id.' }
  const read = readPlaces(root.value)
  if (!read.ok) return { outcome: 'declined', place: null, resumed: false, why: cut(read.error, LIMITS.REASON) }
  const places = read.value
  const known =
    Object.hasOwn(places.sessions, id)
    || Object.values(places.places).some((entry) => entry.sessions.includes(id))
    /* Codex's own record of it, in this project's folder (not by id alone: that lists one from anywhere). */
    || (await needs.program.sessions(root.value)).some((one) => one.id === id)
  if (!known) return { outcome: 'no-such-session', place: null, resumed: false, why: 'Codex has no conversation by that id in this project.' }

  const now = homeOf(places, id)
  if (now !== keyOf(asked.from)) return { outcome: 'elsewhere', place: placeTo(now), resumed: false, why: '' }
  const resumed = Boolean(needs.runs.find(id))
  const to = keyOf(asked.to)
  if (to === now) return { outcome: 'brought', place: placeTo(now), resumed, why: '' }

  if (asked.to) {
    const written = assign(root.value, placeFrom(asked.to), id)
    if (!written.ok) return { outcome: 'declined', place: placeTo(now), resumed: false, why: cut(written.error, LIMITS.REASON) }
    /* Its token, so the doors of a session this module gives them to know its place now (as `$kehikot-here`). */
    tokenFor(root.value, id, freshToken)
    needs.runs.told(root.value, { key: to!, session: id })
  } else {
    const written = disconnect(root.value, id)
    if (!written.ok) return { outcome: 'declined', place: placeTo(now), resumed: false, why: cut(written.error, LIMITS.REASON) }
    needs.runs.told(root.value)
  }
  return { outcome: 'brought', place: asked.to ?? null, resumed, why: '' }
}

/**
 * A new conversation fed the brief, filed under the place: its id, which `find` and `bring` know too.
 * Answered at once (protocol 2.99.0): declined when the folder is no project or Codex is not installed,
 * else ACCEPTED under the id the conversation's run will have, and Codex is started after the answer —
 * it boots, and is waited for until it names the conversation (up to 20 s), which was longer than the
 * host waits: the person was told Codex did not answer while the conversation started anyway. What it
 * came to goes to the host as `tasks.report`, which says a failure in the person's Inbox.
 */
export async function startConversation(asked: { project: string; brief: string; place: ConversationPlace | null }, needs: Pick<HostNeeds, 'runs' | 'program' | 'report'>): Promise<AgentTaskStartResult> {
  const root = projectRoot(asked.project)
  if (!root.ok) return { outcome: 'declined', session: null, why: cut(root.error, LIMITS.REASON), pending: false }
  if (needs.program.find && !needs.program.find().file) return { outcome: 'declined', session: null, why: `${needs.program.name ?? 'Codex'} is not installed on this computer.`, pending: false }
  const id = needs.program.newId?.() ?? crypto.randomUUID()
  return acceptTask(
    id,
    async () => {
      const started = await needs.runs.startTask(root.value, placeFrom(asked.place), asked.brief, undefined, id)
      return 'code' in started ? { ok: false, why: cut(started.why, LIMITS.REASON) } : { ok: true, conversation: started.session }
    },
    { module: ID, ...needs.report, log: needs.report?.log ?? ((line) => console.log(`codex: ${line}`)) },
  )
}

/** One of these routes, answered; null when the path is none of them. */
export async function answerHost(
  method: string,
  path: string,
  headers: Headers | Record<string, string | string[] | undefined>,
  body: Record<string, unknown> | null,
  needs: HostNeeds,
): Promise<Reply | null> {
  if (!PATHS.has(path)) return null
  if (method !== 'POST') return json(405, { ok: false, error: 'this door takes POST' })
  const vouched = await (needs.vouch ?? ((said) => vouchHost(said)))(headers)
  if (!vouched.ok) return json(403, { ok: false, error: vouched.why })
  if (path === FIND_PATH) {
    const asked = conversationsFindParams.safeParse(body ?? {})
    if (!asked.success) return json(400, { ok: false, error: 'That is not what find takes: { project, refs, url?, branch?, repo? }.' })
    return json(200, await findConversations(asked.data, needs))
  }
  if (path === BRING_PATH) {
    const asked = conversationsBringParams.safeParse(body ?? {})
    if (!asked.success) return json(400, { ok: false, error: 'That is not what bring takes: { project, session, to, from }.' })
    return json(200, await bringConversation(asked.data, needs))
  }
  const asked = agentTaskStartParams.safeParse(body ?? {})
  if (!asked.success) return json(400, { ok: false, error: 'That is not what start takes: { project, brief, place, title }.' })
  return json(200, await startConversation(asked.data, needs))
}

const respond = (reply: Reply): Response => new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } })

/** These routes on the built server: `run`'s `before`, which is handed the request whole. */
export function hostDoor(needs: () => HostNeeds): (request: Request) => Promise<Response | null> {
  return async (request) => {
    const path = new URL(request.url).pathname
    if (!PATHS.has(path)) return null
    const read = await readJsonRequest(request, { maxBytes: MOST })
    if (!read.ok) return respond(json(read.status, { ok: false, error: read.error }))
    return respond((await answerHost(request.method.toUpperCase(), path, request.headers, read.body, needs()))!)
  }
}

/** The part of node's request and response the Vite middleware uses. */
interface NodeRequest extends BodySource {
  url?: string
  headers: Record<string, string | string[] | undefined>
}
interface NodeResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(chunk?: string): unknown
}

/** These routes under Vite, ahead of `doors()`. */
export function hostMiddleware(needs: () => HostNeeds): (request: NodeRequest, response: NodeResponse, next: () => void) => void {
  return (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
    if (!PATHS.has(path)) return next()
    void (async () => {
      const read = await readJsonBody(request, { maxBytes: MOST })
      const reply = read.ok ? (await answerHost((request.method ?? 'GET').toUpperCase(), path, request.headers, read.body, needs()))! : json(read.status, { ok: false, error: read.error })
      response.statusCode = reply.status
      response.setHeader('content-type', 'application/json; charset=utf-8')
      response.setHeader('cache-control', 'no-store')
      response.end(JSON.stringify(reply.body))
    })().catch(() => {
      response.statusCode = 500
      response.end()
    })
  }
}
