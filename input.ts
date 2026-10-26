/**
 * Whether what an emulator sent holds anything a person typed.
 *
 * ## Why this is asked at all
 *
 * A session nobody has typed into holds nothing, and is ended a moment after
 * its last viewer leaves (`UNTOUCHED_GRACE` in live.ts). "Typed into" used to
 * mean "any frame arrived from the page" — and the page forwards everything
 * its emulator emits, which is not only keys. A program asks its terminal
 * questions, and the emulator ANSWERS them on the same channel the keyboard
 * uses. Codex 2.1.296 asks four at start (`CSI c`, `CSI > 0 q`,
 * `CSI ? u`, `OSC 7501 ; ?`) and xterm answers the first with `CSI ? 1 ; 2 c`
 * about a third of a second in, before anybody has touched a key; it turns
 * on focus reporting, so the page giving its terminal the keyboard sends
 * `CSI I`; and at its prompt it turns on any-motion mouse tracking, so the
 * pointer crossing the terminal sends a report per cell. Every session was
 * therefore "typed into" at once, none was ever ended, and one was left
 * running at every place a person had so much as looked at.
 *
 * ## Why it is decided from the bytes, and here
 *
 * xterm's public API has one event for all of it (`onData`) and does not say
 * which bytes came from a person. Its `onKey` does, but only for key presses:
 * a paste, an input method's composition and a dictation all arrive without
 * one, so a page that marked frames by `onKey` would call a pasted paragraph
 * untouched and let the session holding it be ended. That is the wrong way to
 * be wrong. Read from the bytes, the mistake can only go the other way: what
 * is recognised below is a closed list of replies and pointer reports, and
 * ANYTHING else — every key a full-screen program is sent (`CSI A`,
 * `CSI 97 ; 5 u`, `ESC O P`), a bracketed paste, plain text — counts as a
 * person. A reply this list has not heard of keeps a session it could have
 * let go, which is what happened before and loses nothing.
 *
 * And it is one pure function, so the server decides with it for every page
 * there is — including one loaded before this existed — and the page uses
 * the same one for its own idea of whether a view holds anything.
 *
 * ## The one overlap
 *
 * A cursor position report is `CSI row ; col R`, and xterm sends a MODIFIED
 * F3 as `CSI 1 ; modifier R`. They are the same bytes. It is read as the
 * report: a session whose only input ever was Shift+F3 is the price, and it
 * holds nothing.
 */

const ESC = '\\x1b'
/** How a string sequence ends: BEL, or ESC backslash. */
const END = `(?:\\x07|${ESC}\\\\)`

const NOT_A_PERSON = new RegExp(
  [
    /* Device attributes, all three: `CSI ? … c`, `CSI > … c`, `CSI = … c`. */
    `${ESC}\\[[?>=][0-9;]*c`,
    /* Status and cursor position: `CSI 0 n`, `CSI ? … n` (the colour scheme, mode 2031, answers this way too), `CSI r ; c R`. */
    `${ESC}\\[\\??[0-9;]*n`,
    `${ESC}\\[\\??[0-9]+;[0-9]+(?:;[0-9]+)?R`,
    /* A mode's state (DECRPM), and the keyboard protocol's flags. */
    `${ESC}\\[\\??[0-9;]*\\$y`,
    `${ESC}\\[\\?[0-9;]*u`,
    /* The window's size and state, and the in-band resize. */
    `${ESC}\\[[0-9;]+t`,
    /* Focus arriving and leaving. */
    `${ESC}\\[[IO]`,
    /* The pointer: SGR, urxvt, and the old three-byte form. Moving a mouse over a terminal is not typing into it. */
    `${ESC}\\[<[0-9;]+[Mm]`,
    `${ESC}\\[[0-9]+;[0-9]+;[0-9]+M`,
    `${ESC}\\[M[\\s\\S]{3}`,
    /* String replies: colours and the like (OSC), terminal name and settings (DCS), and APC. */
    `${ESC}\\][\\s\\S]*?${END}`,
    `${ESC}[P_][\\s\\S]*?${ESC}\\\\`,
  ].join('|'),
  'g',
)

/** True when anything is left once the emulator's own replies and the pointer's reports are taken out. */
export function typedByPerson(data: string): boolean {
  return data.replace(NOT_A_PERSON, '') !== ''
}

/**
 * What is typed at the program's prompt and not sent, as far as the bytes say: how many
 * characters, and when a line was last sent (Enter). Compact and Clear are typed at the prompt
 * the person's keys go to, so they wait while anything is there — it would be sent with them —
 * and until the program has been seen at its prompt after the last line was sent.
 *
 * Counted, not read: printable characters add, Backspace takes one away, Enter sends (and the
 * count is nothing), Ctrl+C and Ctrl+U empty the line, and every escape sequence (an arrow, a
 * function key) and every reply of the emulator's is passed over. A bracketed paste adds its
 * length. It is a count and not a copy of the line: no character of it is kept. What it cannot
 * see — a word deleted with Ctrl+W, a line emptied by Esc Esc — leaves it counting more than is
 * there, which keeps Compact and Clear waiting, never the other way.
 */
export interface Prompt {
  chars: number
  /** When a line was last sent; 0 for never. */
  sentAt: number
}

export const emptyPrompt = (): Prompt => ({ chars: 0, sentAt: 0 })

const PASTE = /\x1b\[200~([\s\S]*?)\x1b\[201~/g
const SEQUENCE = /\x1b(?:\[[0-9;?<>=]*[ -/]*[@-~]|O.|[^[O])/g

export function promptAfter(prompt: Prompt, data: string, now: number): Prompt {
  let chars = prompt.chars
  let sentAt = prompt.sentAt
  const said = data.replace(NOT_A_PERSON, '').replace(PASTE, (_all, pasted: string) => '\u0000'.repeat(Math.min(pasted.length, 100_000))).replace(SEQUENCE, '')
  for (const one of said) {
    if (one === '\r' || one === '\n') {
      chars = 0
      sentAt = now
    } else if (one === '\x03' || one === '\x15') chars = 0
    else if (one === '\x7f' || one === '\b') chars = Math.max(0, chars - 1)
    else if (one === '\u0000' || one >= ' ') chars += 1
  }
  return { chars, sentAt }
}
