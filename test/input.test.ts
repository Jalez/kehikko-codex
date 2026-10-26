import { describe, expect, test } from 'bun:test'

import { typedByPerson } from '../input.ts'

/**
 * What an emulator sends that a person did not type.
 *
 * The first group is not invented: it is what `@xterm/headless` and the page's
 * xterm sent Codex 2.1.296, started in a pty with no key pressed — the
 * answer to `CSI c`, the focus the page gives its terminal once the program
 * has asked to hear of it, and the pointer crossing a program that asked for
 * every motion.
 */

const ESC = '\x1b'

describe('what an emulator says by itself', () => {
  test('what Codex is answered before any key, and what follows the pointer', () => {
    for (const sent of [`${ESC}[?1;2c`, `${ESC}[I`, `${ESC}[O`, `${ESC}[<35;61;14M`, `${ESC}[<0;61;14M`, `${ESC}[<0;61;14m`, `${ESC}[<64;61;14M`]) {
      expect([sent, typedByPerson(sent)]).toEqual([sent, false])
    }
  })

  test('every other answer a program may ask a terminal for', () => {
    for (const sent of [
      /* Device attributes: primary, secondary, tertiary. */
      `${ESC}[?62;4;9;22c`,
      `${ESC}[>0;276;0c`,
      `${ESC}P!|00000000${ESC}\\`,
      /* Status, cursor position, the colour scheme. */
      `${ESC}[0n`,
      `${ESC}[24;80R`,
      `${ESC}[?24;80;1R`,
      `${ESC}[?997;1n`,
      /* A mode's state, the keyboard protocol's flags. */
      `${ESC}[?2026;2$y`,
      `${ESC}[4;1$y`,
      `${ESC}[?0u`,
      /* The window: its size in cells and in pixels, and the in-band resize. */
      `${ESC}[8;30;100t`,
      `${ESC}[4;600;800t`,
      `${ESC}[48;30;100;600;800t`,
      /* Colours, the terminal's name, a setting. */
      `${ESC}]10;rgb:e5e5/e5e5/e5e5${ESC}\\`,
      `${ESC}]11;rgb:0a0a/0a0a/0a0a\x07`,
      `${ESC}]4;1;rgb:ffff/0000/0000\x07`,
      `${ESC}P>|xterm.js(6.0.0)${ESC}\\`,
      `${ESC}P1$r0 q${ESC}\\`,
      `${ESC}_Gi=31;OK${ESC}\\`,
      /* The pointer in its older spellings. */
      `${ESC}[M !!`,
      `${ESC}[32;61;14M`,
      /* Several in one frame. */
      `${ESC}[?1;2c${ESC}[I${ESC}]11;rgb:0a0a/0a0a/0a0a\x07`,
      '',
    ]) {
      expect([sent, typedByPerson(sent)]).toEqual([sent, false])
    }
  })
})

describe('what a person types', () => {
  test('text, Enter, control keys', () => {
    for (const sent of ['h', 'hello', ' ', '\r', '\x7f', '\x03', '\x04', '\t', ESC, 'ä', '日本']) {
      expect([sent, typedByPerson(sent)]).toEqual([sent, true])
    }
  })

  test('the keys a full-screen program is sent as sequences: arrows, function keys, modified keys, either keyboard protocol', () => {
    for (const sent of [
      `${ESC}[A`,
      `${ESC}[B`,
      `${ESC}OA`,
      `${ESC}[H`,
      `${ESC}[F`,
      `${ESC}[Z`,
      `${ESC}OP`,
      `${ESC}[15~`,
      `${ESC}[3~`,
      `${ESC}[1;5C`,
      `${ESC}[1;2P`,
      `${ESC}\r`,
      `${ESC}b`,
      /* The kitty protocol and modifyOtherKeys. */
      `${ESC}[97u`,
      `${ESC}[97;5u`,
      `${ESC}[13;2u`,
      `${ESC}[27;5;97~`,
    ]) {
      expect([sent, typedByPerson(sent)]).toEqual([sent, true])
    }
  })

  test('a paste, bracketed or not, whatever is in it', () => {
    expect(typedByPerson(`${ESC}[200~a pasted paragraph${ESC}[201~`)).toBe(true)
    expect(typedByPerson('a pasted paragraph\rwith two lines')).toBe(true)
    /* Even one made only of something that looks like a reply: the brackets are a person's. */
    expect(typedByPerson(`${ESC}[200~${ESC}[?1;2c${ESC}[201~`)).toBe(true)
  })

  test('a key in the same frame as a reply is still a key', () => {
    expect(typedByPerson(`${ESC}[?1;2ch`)).toBe(true)
    expect(typedByPerson(`y${ESC}[I`)).toBe(true)
    expect(typedByPerson(`${ESC}[<0;61;14M${ESC}[A`)).toBe(true)
  })

  test('the one overlap: a modified F3 is spelled like a cursor position report, and is read as one', () => {
    expect(typedByPerson(`${ESC}[1;2R`)).toBe(false)
    /* Unmodified, it is not. */
    expect(typedByPerson(`${ESC}OR`)).toBe(true)
  })
})
