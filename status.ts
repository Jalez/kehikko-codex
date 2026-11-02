/**
 * Where a Codex session says it is, read off its own terminal.
 *
 * ## Codex's terminal program status reports (OSC 7501)
 *
 * Codex's TUI (codex-rs `tui/src/terminal_program_status.rs` and `chatwidget/status_surfaces.rs`
 * at rust-v0.166.0) writes, on every draw where its state changed, when its output is a terminal
 * (and the terminal is not an old VTE):
 *
 *     ESC ] 7501 ; state=<s> : app=codex [: kind=<k>] ESC \
 *
 * where `<s>` is `idle`, `working`, `blocked` (`kind` permission, question or auth), `done` or
 * `error`, and `ESC ] 7501 ; state=clear ESC \` when it lets the terminal go. `idle` is written on
 * its first draw, before any turn: the one thing that says a session resumed and left at its prompt
 * is there, which no hook does (Codex's `SessionStart` runs at the first prompt). It asks the terminal
 * nothing first. The page's own terminal ignores the sequence, as xterm.js does any OSC it does not
 * know.
 */

export type Where = 'idle' | 'busy' | 'waiting'

const START = '\u001b]7501;'
/** The most of a sequence kept across chunks. */
const MOST = 1024

/** Where one report's payload (`state=…:app=codex:…`) says the session is, or null for one this module does not read. */
export function readReport(payload: string): Where | null {
  const fields = payload.split(':')
  if (!fields.includes('app=codex')) return null
  switch (fields[0]) {
    case 'state=idle':
    case 'state=done':
    case 'state=error':
      return 'idle'
    case 'state=working':
      return 'busy'
    case 'state=blocked':
      return 'waiting'
    default:
      return null
  }
}

/** Reads a pty's output as it comes, in chunks of any size; a sequence split across chunks is kept until it ends. */
export class StatusReader {
  private carry = ''

  feed(chunk: string): Where[] {
    const text = this.carry + chunk
    this.carry = ''
    const out: Where[] = []
    let from = 0
    for (;;) {
      const at = text.indexOf(START, from)
      if (at < 0) {
        const tail = text.slice(Math.max(from, text.length - START.length + 1))
        const cut = [...Array(tail.length).keys()].map((i) => tail.slice(i)).find((one) => START.startsWith(one))
        if (cut) this.carry = cut
        break
      }
      const bodyAt = at + START.length
      const st = text.indexOf('\u001b\\', bodyAt)
      const bel = text.indexOf('\u0007', bodyAt)
      const end = st < 0 ? bel : bel < 0 ? st : Math.min(st, bel)
      if (end < 0) {
        if (text.length - at <= MOST) this.carry = text.slice(at)
        break
      }
      const where = readReport(text.slice(bodyAt, end))
      if (where) out.push(where)
      from = end + (end === st ? 2 : 1)
    }
    return out
  }
}
