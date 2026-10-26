/**
 * How full a conversation's context window is, and the rest of what Codex's own `/status` says
 * about a session — read without anybody typing anything into it.
 *
 * ## Where the figures come from, and it is the whole list
 *
 * **The transcript** (`$CODEX_HOME/sessions/…/rollout-…-<id>.jsonl`), which this module already
 * finds for every session. Measured on 0.164.0 with a stand-in for the model API:
 *
 *     { "type": "event_msg", "payload": { "type": "token_count", "info": {
 *         "last_token_usage":  { "input_tokens", "cached_input_tokens", "cache_write_input_tokens",
 *                                "output_tokens", "reasoning_output_tokens", "total_tokens" },
 *         "total_token_usage": { …the same, summed over the conversation },
 *         "model_context_window": 258400 } } }
 *     { "type": "turn_context", "payload": { "model": "gpt-5.5", … } }
 *     { "type": "compacted", "payload": { "message": …, … } }
 *     { "type": "event_msg", "payload": { "type": "task_started", "turn_attribution"?: … } }
 *
 * What is in the window is the last request's `total_tokens` — exactly what Codex itself calls
 * `tokens_in_context_window` — of `model_context_window`, the window Codex says it may use (the
 * model's, less the headroom it keeps; 95 % of 272 000 for gpt-5.5). Codex writes a `token_count`
 * after every request and again right after a compaction, so the figure follows both.
 *
 * Only these rows are parsed (`ROWS`), and of them only numbers, a model id, a row's kind and
 * times are kept. Nothing anybody wrote is read out of a transcript for this, stored or shown.
 *
 * ## What cannot be known from here, and it is said rather than guessed
 *
 *  - **How the window splits** into instructions, tools and messages: the transcript carries
 *    totals only. The breakdown shows the last request's own numbers.
 *  - **The cost.** Codex writes tokens, never money: a session on a ChatGPT plan has no price per
 *    request. `cost` is always null.
 *  - **Exactly where it compacts.** Codex compacts by itself at 90 % of the model's whole window
 *    unless `model_auto_compact_token_limit` says less (`auto_compact_token_limit` in
 *    codex-rs/protocol). The transcript has the usable window, not the whole one, so the point is
 *    said as "about".
 */

/** The share of the whole window Codex compacts at, and the share of it the usable window is (gpt-5.x's `effective_context_window_percent`). */
const COMPACT_SHARE = 0.9
const USABLE_SHARE = 0.95

/** The window a session runs with: what Codex said, else what it said last; never a guess from the model. */
export function windowFor(said: number | null): { window: number; sure: boolean } {
  if (said !== null && Number.isFinite(said) && said > 0) return { window: said, sure: true }
  return { window: 0, sure: false }
}

/**
 * About where Codex compacts by itself, in tokens of the usable window, and where this module
 * starts saying "compacts soon": ten points of the window before it.
 */
export function thresholds(window: number): { compactAt: number; warnAt: number; effective: number } {
  const compactAt = Math.min(window, Math.round((window * COMPACT_SHARE) / USABLE_SHARE))
  return { compactAt, warnAt: Math.max(0, compactAt - Math.round(window * 0.1)), effective: window }
}

export const percentOf = (tokens: number, window: number): number => (window > 0 ? Math.min(100, Math.max(0, Math.round((tokens / window) * 100))) : 0)

/** One request's own numbers. `input` is what was sent new, `cacheRead` and `cacheWrite` what the prompt cache read and wrote. */
export interface Usage {
  input: number
  cacheRead: number
  cacheWrite: number
  output: number
}

export interface Compaction {
  at: number | null
  /** `manual` (`/compact`, a turn of its own) or `auto` (inside a turn the person started). */
  trigger: string
  before: number | null
  after: number | null
}

/** What the rows read so far say. Kept as it is between reads of a growing transcript. */
export interface Gauge {
  model: string | null
  usage: Usage | null
  /** The last request's tokens in the window. */
  tokens: number | null
  window: number | null
  usageAt: number | null
  compactions: number
  last: Compaction | null
  /** A compaction was read and no `token_count` after it yet. */
  compactedSince: boolean
  /** Whether the turn under way was started by the person (`turn_attribution`): what tells `/compact` from compacting by itself. */
  personTurn: boolean
  cost: number | null
  costSince: boolean
}

export const emptyGauge = (): Gauge => ({ model: null, usage: null, tokens: null, window: null, usageAt: null, compactions: 0, last: null, compactedSince: false, personTurn: false, cost: null, costSince: false })

const ROWS = /"type":"token_count"|"type":"turn_context"|"type":"compacted"|"type":"task_started"/

const count = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0)
const timeOf = (value: unknown): number | null => {
  const at = typeof value === 'string' ? Date.parse(value) : NaN
  return Number.isFinite(at) ? at : null
}

/** A `token_count`'s last request, or null for one with nothing in it. */
export function usageOf(info: Record<string, unknown>): { usage: Usage; tokens: number; window: number | null } | null {
  const last = info.last_token_usage as Record<string, unknown> | undefined
  if (!last || typeof last !== 'object') return null
  const input = count(last.input_tokens)
  const cached = Math.min(input, count(last.cached_input_tokens))
  const tokens = count(last.total_tokens) || input + count(last.output_tokens)
  if (tokens === 0) return null
  const window = typeof info.model_context_window === 'number' && info.model_context_window > 0 ? Math.floor(info.model_context_window) : null
  return { usage: { input: input - cached, cacheRead: cached, cacheWrite: count(last.cache_write_input_tokens), output: count(last.output_tokens) }, tokens, window }
}

/** The gauge after one more row. Rows of other kinds leave it as it was. */
export function readRow(gauge: Gauge, row: Record<string, unknown>): Gauge {
  const payload = (row.payload && typeof row.payload === 'object' ? row.payload : {}) as Record<string, unknown>
  if (row.type === 'event_msg' && payload.type === 'token_count' && payload.info && typeof payload.info === 'object') {
    const used = usageOf(payload.info as Record<string, unknown>)
    if (!used) return gauge
    const last = gauge.compactedSince && gauge.last ? { ...gauge.last, after: used.tokens } : gauge.last
    return { ...gauge, usage: used.usage, tokens: used.tokens, window: used.window ?? gauge.window, usageAt: timeOf(row.timestamp), last, compactedSince: false }
  }
  if (row.type === 'event_msg' && payload.type === 'task_started') {
    return { ...gauge, personTurn: Boolean(payload.turn_attribution) }
  }
  if (row.type === 'turn_context' && typeof payload.model === 'string' && payload.model.trim()) {
    return { ...gauge, model: payload.model.slice(0, 80) }
  }
  if (row.type === 'compacted') {
    return { ...gauge, compactions: gauge.compactions + 1, last: { at: timeOf(row.timestamp), trigger: gauge.personTurn ? 'auto' : 'manual', before: gauge.tokens, after: null }, compactedSince: true }
  }
  return gauge
}

/** The gauge after some whole lines of a transcript. A line that is not one of `ROWS`, or is not JSON, is passed over. */
export function readLines(text: string, gauge: Gauge = emptyGauge()): Gauge {
  let now = gauge
  for (const line of text.split('\n')) {
    if (!ROWS.test(line)) continue
    let row: unknown
    try {
      row = JSON.parse(line.trim())
    } catch {
      continue
    }
    if (row && typeof row === 'object' && !Array.isArray(row)) now = readRow(now, row as Record<string, unknown>)
  }
  return now
}

/** A model's name as a person reads it: `gpt-5.5` is "GPT-5.5", `gpt-6-sol` "GPT-6 Sol", `o3` "o3". */
export function modelName(id: string): string {
  const said = /^gpt-([0-9.]+)((?:-[a-z0-9]+)*)$/i.exec(id.trim())
  if (!said) return id.slice(0, 40)
  const rest = said[2]!.split('-').filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1))
  return [`GPT-${said[1]}`, ...rest].join(' ').slice(0, 40)
}

/** A session's context, whole: what the page draws, the list's rows carry and the MCP tool says. */
export interface Context {
  /** The tokens in the window now, or null when nothing has been sent yet. */
  tokens: number | null
  window: number
  /** Whether Codex itself said the window. Always, once it has made one request. */
  windowSure: boolean
  percent: number | null
  compactAt: number
  warnAt: number
  effective: number
  soon: boolean
  model: { id: string; name: string } | null
  /** Always null: Codex says no cost. Kept in the shape the page and the door share. */
  cost: { usd: number; live: boolean } | null
  compacted: { times: number; last: Compaction } | null
  /** A compaction is the last thing read: the figure is the one Codex counted for what it compacted to. */
  afterCompact: boolean
  split: Usage | null
  from: 'transcript'
  at: number | null
}

/** What is shown for a session, from its transcript. Null when it says nothing yet. */
export function contextOf(gauge: Gauge | null): Context | null {
  if (!gauge) return null
  const { window, sure } = windowFor(gauge.window)
  if (gauge.tokens === null && !gauge.model && !gauge.compactions) return null
  const { compactAt, warnAt, effective } = thresholds(window)
  const tokens = gauge.tokens
  return {
    tokens,
    window,
    windowSure: sure,
    percent: tokens === null || window === 0 ? null : percentOf(tokens, window),
    compactAt,
    warnAt,
    effective,
    soon: tokens !== null && window > 0 && tokens >= warnAt,
    model: gauge.model ? { id: gauge.model, name: modelName(gauge.model) } : null,
    cost: null,
    compacted: gauge.compactions && gauge.last ? { times: gauge.compactions, last: gauge.last } : null,
    afterCompact: Boolean(gauge.last && gauge.last.after !== null && gauge.usageAt !== null && gauge.last.at !== null && gauge.usageAt - gauge.last.at < 1_000),
    split: gauge.usage,
    from: 'transcript',
    at: gauge.usageAt,
  }
}

/** A number of tokens as a person reads it: 823, 12k, 182k, 1.0M. */
export function tokensSaid(tokens: number): string {
  if (tokens < 1_000) return String(tokens)
  if (tokens < 999_500) return `${Math.round(tokens / 1_000)}k`
  return `${(tokens / 1_000_000).toFixed(1)}M`
}

/** Dollars as a person reads them. Codex says none; kept for the page's shared code. */
export function costSaid(usd: number): string {
  return usd >= 100 ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`
}

/**
 * A context in words: the share (`41%`), the line beside a meter (`82k of 258k · 41%`), and the
 * warning, in words and never by colour alone (`82% — compacts soon`).
 */
export function contextWords(context: Context): { percent: string; line: string; warning: string | null; title: string } {
  const pct = context.percent === null ? '—' : `${context.percent}%`
  const about = context.afterCompact ? 'about ' : ''
  const line = context.tokens === null ? 'nothing sent yet' : context.window ? `${about}${tokensSaid(context.tokens)} of ${tokensSaid(context.window)} · ${pct}` : `${about}${tokensSaid(context.tokens)}`
  const warning = context.soon ? (context.tokens !== null && context.tokens >= context.compactAt ? `${pct} — compacting` : `${pct} — compacts soon`) : null
  const parts = [
    context.tokens === null ? 'Context: nothing sent yet in this conversation' : `Context: ${about}${context.tokens.toLocaleString('en-US')} of ${context.window.toLocaleString('en-US')} tokens (${pct})`,
    context.window ? `compacts by itself at about ${percentOf(context.compactAt, context.window)}%` : '',
    context.model ? context.model.name : '',
    context.compacted ? `compacted ${context.compacted.times === 1 ? 'once' : `${context.compacted.times} times`}` : '',
  ]
  return { percent: pct, line, warning, title: parts.filter(Boolean).join(' · ') }
}
