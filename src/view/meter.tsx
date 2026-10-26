import { useEffect, useId, useRef, useState } from 'react'

import { contextWords, costSaid, percentOf, tokensSaid, type Context } from '../../meter.ts'
import { Button } from '@/components/ui/button'

/**
 * The context meter: one thin line under the session on screen, saying how full its context window
 * is, its model and whether it was compacted — read from its transcript by the server
 * (`meter.ts`), with nothing typed into the conversation. Pressing it opens a breakdown like
 * Codex's own `/status`, as far as the figures go. Beside it, Compact and Clear: the
 * person's to press and nobody else's, typed at the prompt only while the session waits there.
 *
 * ## Why a line in the page and not the header
 *
 * The protocol's header (`kehikot.header`, 2.17/2.18) holds switches, toggles, jumps and runs —
 * acts. It has no passive status item, and a run's `result` is "what the last one came to", not a
 * gauge. So the figure is drawn here, in the module's own page, and the header is left as it was.
 *
 * ## Never colour alone
 *
 * The meter's fill has a colour, and the same thing is always said in words: the percentage beside
 * it, and "compacts soon" ten points before where Codex compacts by itself. Not ready is said in words too — on
 * the buttons' titles, in the breakdown, and in the line itself when one is pressed.
 */

export type Command = 'compact' | 'clear'

/** How long Clear stays armed for its second press. */
export const ARMED_MS = 6_000
/** How long a sentence the line said in place of the figure stays. */
const SAID_MS = 6_000

/** What the line says while Clear is armed: that the session starts over, and that the old one is kept. */
export const CLEAR_ARMED = 'Clear starts this session over as a new conversation. This one is kept: reopen it from the View menu or with /resume. Press Clear again to clear.'
const COMPACT_MEANS = 'Compact: Codex’s own /compact, typed at the prompt — the conversation so far is summarised, and the window holds the summary.'
const CLEAR_MEANS = 'Clear: Codex’s own /clear, typed at the prompt — a new conversation starts here. This one is kept and can be reopened.'
/** What cannot be known from here, said in the breakdown rather than guessed. */
export const NO_SPLIT = 'How the window splits into instructions, tools and messages is not written anywhere Codex keeps: its transcript carries totals.'

function Bar({ context, wide = false }: { context: Context; wide?: boolean }) {
  const pct = context.percent ?? 0
  const at = percentOf(context.compactAt, context.window)
  return (
    <span
      aria-hidden
      className={`bg-muted relative inline-block shrink-0 overflow-hidden rounded-full align-middle ${wide ? 'h-2 w-full' : 'h-1.5 w-12'}`}
      data-meter-bar={pct}
    >
      <span className={`absolute inset-y-0 left-0 rounded-full ${context.soon ? 'bg-[var(--needs-you)]' : 'bg-foreground/60'}`} style={{ width: `${pct}%` }} />
      {/* Where Codex compacts by itself: a tick, named in words wherever it matters. */}
      <span className="bg-foreground/50 absolute inset-y-0 w-px" style={{ left: `${at}%` }} />
    </span>
  )
}

const number = (value: number) => value.toLocaleString('en-US')
const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The breakdown: what the figures are, and what they cannot say. */
function Breakdown({ context, ready, id }: { context: Context | null; ready: string | null; id: string }) {
  if (!context) {
    return (
      <div id={id} role="dialog" aria-label="Context window" className="space-y-1.5" data-breakdown>
        <p className="text-foreground font-medium">Context window</p>
        <p>Nothing has been sent in this conversation yet: Codex counts the window from its first request.</p>
        {ready ? <p>Compact and Clear: {ready}</p> : null}
      </div>
    )
  }
  const words = contextWords(context)
  const rows: [string, string][] = [
    ['In use', context.tokens === null ? 'nothing sent yet' : `${context.afterCompact ? 'about ' : ''}${number(context.tokens)} of ${number(context.window)} tokens (${words.percent})`],
    ['Window', `${number(context.window)} tokens — ${context.windowSure ? 'as Codex itself said: the model’s window less the room Codex keeps' : 'not said yet'}`],
    ['Compacts', `by itself at about ${number(context.compactAt)} (${percentOf(context.compactAt, context.window)}%): Codex compacts at 90% of the model’s whole window, unless your config says less. This line says “compacts soon” from about ${number(context.warnAt)}`],
  ]
  if (context.model) rows.push(['Model', `${context.model.name} (${context.model.id})`])
  if (context.split) {
    rows.push(['Last request', `new input ${number(context.split.input)} · read from the cache ${number(context.split.cacheRead)} · written to the cache ${number(context.split.cacheWrite)} · output ${number(context.split.output)}`])
  } else if (context.afterCompact) {
    rows.push(['Last request', 'none since the last compaction: the figure is what it compacted to'])
  }
  rows.push(['Cost', context.cost ? costSaid(context.cost.usd) : 'not reported: Codex writes tokens, not money'])
  rows.push([
    'Compacted',
    context.compacted
      ? `${context.compacted.times === 1 ? 'once' : `${context.compacted.times} times`} — last ${context.compacted.last.trigger === 'manual' ? 'by /compact' : 'by itself'}${context.compacted.last.at ? ` at ${clock(context.compacted.last.at)}` : ''}${context.compacted.last.before !== null && context.compacted.last.after !== null ? `, ${tokensSaid(context.compacted.last.before)} → ${tokensSaid(context.compacted.last.after)}` : ''}`
      : 'no compaction in what was read',
  ])
  return (
    <div id={id} role="dialog" aria-label="Context window" className="space-y-1.5" data-breakdown>
      <p className="text-foreground font-medium">Context window</p>
      <Bar context={context} wide />
      <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5">
        {rows.map(([term, said]) => (
          <div key={term} className="contents">
            <dt className="text-foreground">{term}</dt>
            <dd className="min-w-0">{said}</dd>
          </div>
        ))}
      </dl>
      <p>{NO_SPLIT}</p>
      {ready ? <p>Compact and Clear: {ready}</p> : <p>{COMPACT_MEANS} {CLEAR_MEANS}</p>}
    </div>
  )
}

/**
 * The line. `ready` is null when Compact and Clear can be pressed, else why not, in words.
 * `onCommand` sends one through the session's own socket and says whether it went; the server
 * answers whether it was typed (`answer`).
 */
export function ContextLine({
  context,
  ready,
  onCommand,
  answer = null,
  armedMs = ARMED_MS,
}: {
  context: Context | null
  ready: string | null
  onCommand: (which: Command) => boolean
  /** The server's answer to the last press, when it did not type it. */
  answer?: { which: Command; ok: boolean; why?: string; at: number } | null
  armedMs?: number
}) {
  const [open, setOpen] = useState(false)
  const [armed, setArmed] = useState(false)
  const [said, setSaid] = useState<{ text: string; at: number } | null>(null)
  const panel = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const box = useRef<HTMLDivElement>(null)

  /* Armed for a while, and no longer: a second press long after the first is not an answer to it. */
  useEffect(() => {
    if (!armed) return
    const off = setTimeout(() => setArmed(false), armedMs)
    return () => clearTimeout(off)
  }, [armed, armedMs])
  /* Not ready any more: nothing stays armed. */
  useEffect(() => {
    if (ready) setArmed(false)
  }, [ready])
  useEffect(() => {
    if (!said) return
    const off = setTimeout(() => setSaid(null), SAID_MS)
    return () => clearTimeout(off)
  }, [said])
  useEffect(() => {
    if (answer && !answer.ok && answer.why) setSaid({ text: answer.why, at: answer.at })
  }, [answer?.at])
  /* The breakdown closes on Escape and on a press outside it; focus goes back to what opened it. */
  useEffect(() => {
    if (!open && !armed) return
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (open) {
        setOpen(false)
        trigger.current?.focus()
      }
      setArmed(false)
    }
    const press = (event: PointerEvent) => {
      if (box.current && !box.current.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', press)
    return () => {
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', press)
    }
  }, [open, armed])

  const words = context ? contextWords(context) : null
  const press = (which: Command) => {
    if (ready) {
      setArmed(false)
      setSaid({ text: `${which === 'compact' ? 'Compact' : 'Clear'} waits: ${ready}`, at: Date.now() })
      return
    }
    if (which === 'clear' && !armed) {
      setArmed(true)
      return
    }
    setArmed(false)
    const went = onCommand(which)
    setSaid({ text: went ? (which === 'compact' ? 'Compact sent: Codex is compacting the conversation.' : 'Clear sent: a new conversation starts here.') : 'The session’s connection is not open; nothing was sent.', at: Date.now() })
  }

  const message = armed ? CLEAR_ARMED : said?.text ?? null
  return (
    <div ref={box} className="@container relative border-t text-[11px]" data-context-line data-ready={ready ? 'no' : 'yes'}>
      {open ? (
        <div className="bg-popover text-popover-foreground text-muted-foreground absolute right-2 bottom-full left-2 z-10 mb-1 max-h-[70vh] overflow-auto rounded-md border p-2 text-[11px] shadow-md @[420px]:left-auto @[420px]:w-[400px]">
          <Breakdown context={context} ready={ready} id={panel} />
        </div>
      ) : null}
      <div className="flex h-6 items-center gap-1.5 px-2">
        {message ? (
          <span className="text-foreground min-w-0 flex-1 truncate" role="status" title={message} data-context-said>
            {message}
          </span>
        ) : (
          <button
            ref={trigger}
            type="button"
            className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex min-w-0 flex-1 items-center gap-1.5 rounded-sm text-left outline-none focus-visible:ring-2"
            aria-expanded={open}
            aria-controls={panel}
            title={words ? `${words.title}. Press for the breakdown.` : 'Context: nothing sent yet. Press for the breakdown.'}
            onClick={() => setOpen((was) => !was)}
            data-context-trigger
          >
            <span className="text-foreground shrink-0">Context</span>
            {context && context.tokens !== null ? <Bar context={context} /> : null}
            <span className="shrink-0 tabular-nums" data-context-percent>
              {words?.warning ?? (context?.tokens != null ? words!.percent : 'nothing sent yet')}
            </span>
            {context && context.tokens !== null ? (
              <span className="hidden min-w-0 truncate tabular-nums @[300px]:inline">{`${context.afterCompact ? '≈' : ''}${tokensSaid(context.tokens)} / ${tokensSaid(context.window)}`}</span>
            ) : null}
            {context?.model ? <span className="hidden truncate @[420px]:inline">· {context.model.name}</span> : null}
            {context?.cost ? <span className="hidden shrink-0 tabular-nums @[480px]:inline">· {costSaid(context.cost.usd)}{context.cost.live ? '' : ' (last stop)'}</span> : null}
            {context?.compacted ? (
              <span className="hidden shrink-0 @[540px]:inline" data-compacted>
                · compacted{context.compacted.times > 1 ? ` ${context.compacted.times}×` : ''}
              </span>
            ) : null}
          </button>
        )}
        <span className="flex shrink-0 gap-1" title={ready ?? undefined}>
          <Button
            size="sm"
            variant="outline"
            className="h-5 px-1.5 text-[11px] aria-disabled:opacity-50"
            aria-disabled={ready ? true : undefined}
            title={ready ? `Compact waits: ${ready}` : COMPACT_MEANS}
            onClick={() => press('compact')}
            data-command="compact"
          >
            Compact
          </Button>
          <Button
            size="sm"
            variant={armed ? 'destructive' : 'outline'}
            className="h-5 px-1.5 text-[11px] aria-disabled:opacity-50"
            aria-disabled={ready ? true : undefined}
            aria-pressed={armed || undefined}
            title={ready ? `Clear waits: ${ready}` : armed ? CLEAR_ARMED : CLEAR_MEANS}
            onClick={() => press('clear')}
            onBlur={() => setArmed(false)}
            data-command="clear"
          >
            {armed ? 'Clear: sure?' : 'Clear'}
          </Button>
        </span>
      </div>
    </div>
  )
}
