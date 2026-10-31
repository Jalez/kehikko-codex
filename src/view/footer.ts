import { LIMITS, type FooterItemInput, type FooterLevel } from 'kehikot-module-protocol'

import { contextWords, costSaid, tokensSaid, type Context } from '../../meter.ts'

/**
 * The footer the host draws for this module (`kehikot.footer`, protocol 2.38.0): the same things the
 * module's own bottom rows say — the context meter, the model, Compact and Clear, and the one-line
 * notes along the bottom (folder renamed, the kehikko's modules changed,
 * the session ended, the install did not finish) — as items, from the same state.
 *
 * Declared only when the host says it draws a footer (`drawsFooter === true`); with any other host
 * the page draws its own rows exactly as before (`ContextLine` in `meter.tsx`, the rows in `app.tsx`).
 * The module owns every bit of state: the host draws the latest list and reports a press, and the
 * page declares the footer again after it. Pure, so that what is declared is what is tested.
 */

/** The ids of what can be pressed in the footer. */
export const FOOT = {
  COMPACT: 'compact',
  CLEAR: 'clear',
  RESTART_MOVED: 'restart-moved',
  DISMISS_MOVED: 'dismiss-moved',
  RESTART_DOORS: 'restart-doors',
  RESUME: 'resume',
  TRY_AGAIN: 'try-again',
  INSTALL_LOG: 'install-log',
} as const

export const COMPACT_MEANS = 'Compact: Codex’s own /compact, typed at the prompt — the conversation so far is summarised, and the window holds the summary.'
export const CLEAR_MEANS = 'Clear: Codex’s own /clear, typed at the prompt — a new conversation starts here. This one is kept and can be reopened.'
/** How long a sentence about the last press stays in the footer. */
export const SAID_MS = 6_000
/** Why a restart waits, said on the button. */
export const WORKING = 'It is working. Restart it when it is idle.'

/** What the footer is drawn from: the state the page's own rows are drawn from. */
export interface FooterState {
  /** The session on screen is live, and its line is shown: the meters and Compact and Clear. */
  line: {
    context: Context | null
    /** Null when Compact and Clear can be pressed, else why not. */
    ready: string | null
    /** What the last press came to, or the server's answer when it did not type it. */
    said: string | null
  } | null
  /** The project's folder was renamed while the session ran. */
  moved: { to: string; notMoved: string | null; working: boolean; canRestart: boolean } | null
  /** The kehikko's modules changed while the session ran. */
  doors: { added: string[]; removed: string[]; working: boolean } | null
  /** The session on screen has ended, and why. */
  ended: { why: string } | null
  /** The install did not finish: why, and whether its log is on screen. */
  installFailed: { failed: string; log: boolean } | null
}

/** One line of text, cut to fit with an ellipsis. */
export function clip(text: string, most: number): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= most ? one : `${one.slice(0, most - 1)}…`
}
const tip = (text: string) => clip(text, LIMITS.FOOTER_TOOLTIP)
const said = (text: string) => clip(text, LIMITS.FOOTER_TEXT)

/** How worried the context meter is: amber from "compacts soon" (ten points before Codex compacts by itself), red where it does. */
export function contextLevel(context: Context): FooterLevel {
  if (context.tokens === null || !context.soon) return 'normal'
  return context.tokens >= context.compactAt ? 'critical' : 'warn'
}

/** The footer's items for a state; `[]` when there is nothing to show. */
export function footerItems(state: FooterState): FooterItemInput[] {
  const items: FooterItemInput[] = []
  const { line } = state
  if (line) {
    const { context } = line
    if (line.said) items.push({ kind: 'text', id: 'said', text: said(line.said), tooltip: tip(line.said) })
    if (context && context.tokens !== null) {
      const words = contextWords(context)
      items.push({
        kind: 'meter',
        id: 'context',
        label: 'Context',
        value: Math.min(1, Math.max(0, (context.percent ?? 0) / 100)),
        level: contextLevel(context),
        text: clip(words.warning ?? `${context.afterCompact ? '≈' : ''}${tokensSaid(context.tokens)} / ${tokensSaid(context.window)}`, LIMITS.FOOTER_METER_TEXT),
        tooltip: tip(words.title),
      })
    } else {
      items.push({ kind: 'text', id: 'context', text: 'Context: nothing sent yet', tooltip: tip('Nothing has been sent in this conversation yet: Codex counts the window from its first request.') })
    }
    const about = [
      context?.model?.name,
      context?.cost ? `${costSaid(context.cost.usd)}${context.cost.live ? '' : ' (last stop)'}` : null,
      context?.compacted ? `compacted${context.compacted.times > 1 ? ` ${context.compacted.times}×` : ''}` : null,
    ].filter(Boolean)
    if (about.length) items.push({ kind: 'text', id: 'model', text: said(about.join(' · ')), optional: true, ...(context ? { tooltip: tip(contextWords(context).title) } : {}) })
    const ready = line.ready
    items.push({ kind: 'run', id: FOOT.COMPACT, label: 'Compact', icon: 'refresh', align: 'end', tooltip: tip(COMPACT_MEANS), disabled: ready ? clip(`Compact waits: ${ready}`, LIMITS.REASON) : null })
    items.push({ kind: 'run', id: FOOT.CLEAR, label: 'Clear', icon: 'x', align: 'end', confirm: true, tooltip: tip(CLEAR_MEANS), disabled: ready ? clip(`Clear waits: ${ready}`, LIMITS.REASON) : null })
  }
  if (state.moved) {
    const { to, notMoved, working, canRestart } = state.moved
    const words = `This folder was renamed to ${to}. Codex still uses the old path; restart in the new folder when it's idle.${notMoved ? ` ${notMoved}` : ''}`
    items.push({ kind: 'text', id: 'moved', text: said(words), level: 'warn', tooltip: tip(words) })
    items.push({
      kind: 'run',
      id: FOOT.RESTART_MOVED,
      label: 'Restart in the new folder',
      icon: 'refresh',
      align: 'end',
      tooltip: 'Ends this session and resumes it in the new folder',
      disabled: working ? WORKING : canRestart ? null : 'There is no session here to restart.',
    })
    items.push({ kind: 'run', id: FOOT.DISMISS_MOVED, label: 'Dismiss', icon: 'x', align: 'end', optional: true })
  }
  if (state.doors) {
    const { added, removed, working } = state.doors
    const words = [added.length ? `Restart to load ${added.join(', ')}’s tools.` : '', removed.length ? `${removed.join(', ')} left this kehikko; its tools stay until a restart.` : ''].filter(Boolean).join(' ')
    if (words) {
      items.push({ kind: 'text', id: 'doors', text: said(words), tooltip: tip(words) })
      items.push({
        kind: 'run',
        id: FOOT.RESTART_DOORS,
        label: 'Restart',
        icon: 'refresh',
        align: 'end',
        tooltip: 'Ends this session and resumes it with the doors of this kehikko now',
        disabled: working ? WORKING : null,
      })
    }
  }
  if (state.ended) {
    const why = state.ended.why || 'The session ended.'
    items.push({ kind: 'text', id: 'ended', text: said(why), tooltip: tip(why) })
    items.push({ kind: 'run', id: FOOT.RESUME, label: 'Resume', icon: 'play', align: 'end' })
  }
  if (state.installFailed) {
    const words = state.installFailed.failed || 'The install did not finish.'
    items.push({ kind: 'text', id: 'install-failed', text: said(words), level: 'critical', tooltip: tip(words) })
    items.push({ kind: 'toggle', id: FOOT.INSTALL_LOG, label: 'See the log', checked: state.installFailed.log, align: 'end', optional: true, tooltip: 'Shows what the installer printed.' })
    items.push({ kind: 'run', id: FOOT.TRY_AGAIN, label: 'Try again', icon: 'refresh', align: 'end' })
  }
  return items
}
