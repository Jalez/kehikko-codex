import { useEffect, useRef, useState } from 'react'

import type { Elsewhere } from '../../live.ts'
import { COPY, LEAVE, elsewhereSaid } from './places.ts'

/**
 * The question, when the session a place would open is already open in
 * another Codex process (it holds the conversation's lock file).
 *
 * Nothing has been started and nothing will be until a person says. It is
 * drawn where the terminal would be — which is empty, since nothing was
 * started — and it is two rows:
 *
 *  - **Leave it.** First, and where the keyboard starts: Enter on a question
 *    somebody did not expect should start nothing.
 *  - **Open it here anyway.** With what that means said beside it, BEFORE it
 *    is chosen: Codex itself then says the conversation is open in another
 *    app, and offers to retry once it is closed there, or to fork it.
 *
 * Neither does anything to the other process. There is no third row that
 * would: it may be in the middle of something.
 *
 * It says where the conversation is running and for how long from what
 * the lock file says: the process, and the folder its record names.
 */
export function ElsewhereQuestion({
  program,
  label,
  there,
  now = Date.now(),
  onLeave,
  onCopy,
}: {
  /** What the program is called. */
  program: string
  /** The session's first prompt, cut short; `''` when it has none. */
  label: string
  /** Who has it, as the server said; null when it only said that somebody does. */
  there: Elsewhere | null
  now?: number
  onLeave: () => void
  onCopy: () => void
}) {
  const [at, setAt] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  useEffect(() => {
    list.current?.focus()
  }, [])

  const rows = [
    { id: 'leave', ...LEAVE, act: onLeave },
    { id: 'copy', ...COPY, act: onCopy },
  ]
  const said = elsewhereSaid(program, label, there, now)

  const key = (event: React.KeyboardEvent) => {
    if (event.target !== event.currentTarget && (event.key === 'Enter' || event.key === ' ')) return
    if (event.key === 'ArrowDown' || event.key === 'j') setAt(Math.min(rows.length - 1, at + 1))
    else if (event.key === 'ArrowUp' || event.key === 'k') setAt(Math.max(0, at - 1))
    else if (event.key === 'Enter' || event.key === ' ') rows[at]?.act()
    else if (event.key === 'Escape') onLeave()
    else if (event.key === '1' || event.key === '2') rows[Number(event.key) - 1]?.act()
    else return
    event.preventDefault()
  }

  return (
    <div
      ref={list}
      tabIndex={0}
      role="listbox"
      aria-label={said}
      data-elsewhere-question={there?.kind ?? 'unknown'}
      onKeyDown={key}
      className="flex h-full min-h-0 flex-col gap-0.5 overflow-auto p-2 font-mono text-xs outline-none"
    >
      <p className="text-muted-foreground px-2 pb-1">{said}</p>
      {rows.map((row, index) => (
        <button
          key={row.id}
          type="button"
          role="option"
          aria-selected={index === at}
          data-row={row.id}
          className={`flex w-full min-w-0 items-baseline gap-2 rounded px-2 py-1 text-left ${index === at ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/60'}`}
          onClick={row.act}
          onMouseMove={() => setAt(index)}
        >
          <span className="text-muted-foreground w-3 shrink-0 text-right">{index + 1}</span>
          <span className="shrink-0">{row.word}</span>
          <span className="text-muted-foreground min-w-0 flex-1">{row.means}</span>
        </button>
      ))}
    </div>
  )
}
