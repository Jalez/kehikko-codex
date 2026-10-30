import { Button } from '@/components/ui/button'

import type { Told } from '../api.ts'

/**
 * "What this conversation was told" (`TOLD` in conversations.ts): the notes the conversation's hooks
 * last gave it (its place, the modules on its kehikko and the installed ones absent from it), and
 * each change told at a prompt since, exactly as the model got them. Plain text: every line is a
 * text node in a <pre>, never markup or a link, whatever a module's words say.
 */

/** When a note was told, as a person reads it beside it: `14:05`. */
const clock = (at: number): string => new Date(at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

/** The whole of it as one text: the full notes, then each change under the time it was told. */
export function toldText(told: Told): string {
  const parts = [`Told at its start (${clock(told.start.at)}):`, told.start.text]
  for (const change of told.changes) parts.push('', `Told at a prompt (${clock(change.at)}):`, change.text)
  return parts.join('\n')
}

export const TOLD_NOTHING = 'Nothing was kept of what this conversation was told: it was started outside this kehikko, or before this module kept it. It is told again at its next start.'

/** The panel over the terminal: the text, and a way to close it. `told` undefined: still being read. */
export function ToldPanel({ told, error, onClose }: { told: Told | null | undefined; error?: string | null; onClose(): void }) {
  const body = error ? error : told === undefined ? 'Reading…' : told === null ? TOLD_NOTHING : toldText(told)
  return (
    <div className="bg-background absolute inset-0 z-20 flex min-h-0 flex-col" role="dialog" aria-label="What this conversation was told" data-told>
      <div className="flex items-center gap-2 border-b px-2 py-1 text-xs">
        <span className="min-w-0 flex-1 font-medium">What this conversation was told</span>
        <Button size="sm" variant="outline" className="h-6 shrink-0 px-2 text-xs" data-told-close onClick={onClose}>
          Close
        </Button>
      </div>
      <pre className="min-h-0 flex-1 overflow-auto p-2 text-[11px] leading-snug whitespace-pre-wrap break-words" data-told-text>
        {body}
      </pre>
    </div>
  )
}
