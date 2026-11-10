import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { rowsAdvice } from 'kehikot-module-protocol'

import { rows } from '../dev/rows.ts'

/* `kehikot.rows.json` is what `kehikot-check-rows` reads (protocol 2.70.0); it is written from the real
   header and footer functions by `bun dev/rows.ts`, and must not fall behind them. */
describe('the rows this module declares', () => {
  test('kehikot.rows.json is what the functions declare now (bun dev/rows.ts writes it)', () => {
    expect(JSON.parse(readFileSync(new URL('../kehikot.rows.json', import.meta.url), 'utf8'))).toEqual(JSON.parse(JSON.stringify(rows)))
  })
  test('the rule has no advice about any of them', () => {
    expect(rows.flatMap((one) => rowsAdvice(one.header, one.footer, { state: one.state }).map((line) => `${one.name}: ${line}`))).toEqual([])
  })
})
