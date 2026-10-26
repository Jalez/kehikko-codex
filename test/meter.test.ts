import { afterAll, describe, expect, test } from 'bun:test'
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Gauges } from '../gauges.ts'
import { contextOf, contextWords, emptyGauge, modelName, readLines, thresholds, tokensSaid } from '../meter.ts'

/**
 * The context meter, from a Codex transcript's own rows (shapes measured on 0.164.0): the last
 * request's `token_count`, the model from `turn_context`, and compactions.
 */

const made: string[] = []
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true })
})

const count = (at: string, total: number, more: Record<string, unknown> = {}) =>
  JSON.stringify({ timestamp: at, type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { total_tokens: total * 3 }, last_token_usage: { input_tokens: total - 12, cached_input_tokens: 3922, cache_write_input_tokens: 0, output_tokens: 12, reasoning_output_tokens: 0, total_tokens: total }, model_context_window: 258_400, ...more } } })
const model = (id: string) => JSON.stringify({ timestamp: '2026-10-26T00:51:57.654Z', type: 'turn_context', payload: { model: id } })

describe('what a transcript says', () => {
  test('the window holds the last request’s total, of the window Codex says, with the split of that request', () => {
    const gauge = readLines([model('gpt-5.5'), count('2026-10-26T00:51:57.669Z', 7856), count('2026-10-26T00:52:57.669Z', 9000)].join('\n'))
    const context = contextOf(gauge)!
    expect(context).toMatchObject({ tokens: 9000, window: 258_400, windowSure: true, percent: 3, soon: false, model: { id: 'gpt-5.5', name: 'GPT-5.5' }, cost: null, compacted: null, from: 'transcript' })
    expect(context.split).toEqual({ input: 8988 - 3922, cacheRead: 3922, cacheWrite: 0, output: 12 })
    expect(context.at).toBe(Date.parse('2026-10-26T00:52:57.669Z'))
  })

  test('a compaction is counted, said as /compact or by itself, and the figure after it is what it compacted to', () => {
    const manual = readLines(
      [
        model('gpt-5.5'),
        JSON.stringify({ timestamp: '2026-10-26T01:22:36.741Z', type: 'event_msg', payload: { type: 'task_started', turn_attribution: { turn_trigger: 'user' } } }),
        count('2026-10-26T01:22:39.766Z', 169_800),
        /* /compact is a turn of its own, with no attribution to a prompt. */
        JSON.stringify({ timestamp: '2026-10-26T01:22:43.845Z', type: 'event_msg', payload: { type: 'task_started' } }),
        JSON.stringify({ timestamp: '2026-10-26T01:22:43.861Z', type: 'compacted', payload: { message: 'Another language model started…' } }),
        count('2026-10-26T01:22:43.862Z', 8208),
      ].join('\n'),
    )
    const context = contextOf(manual)!
    expect(context.tokens).toBe(8208)
    expect(context.afterCompact).toBe(true)
    expect(context.compacted).toEqual({ times: 1, last: { at: Date.parse('2026-10-26T01:22:43.861Z'), trigger: 'manual', before: 169_800, after: 8208 } })
    const auto = readLines([JSON.stringify({ type: 'event_msg', payload: { type: 'task_started', turn_attribution: { turn_trigger: 'user' } } }), count('2026-10-26T01:00:00.000Z', 240_000), JSON.stringify({ type: 'compacted', payload: {} })].join('\n'))
    expect(auto.last?.trigger).toBe('auto')
  })

  test('nothing anybody wrote is read: other rows, and lines that are not JSON, are passed over', () => {
    const gauge = readLines(['{"type":"response_item","payload":{"type":"message","role":"user","content":[{"type":"input_text","text":"\\"type\\":\\"token_count\\""}]}}', 'not json', count('2026-10-26T00:00:00.000Z', 100)].join('\n'))
    expect(gauge.tokens).toBe(100)
    expect(contextOf(emptyGauge())).toBeNull()
  })
})

describe('where it compacts, and the words', () => {
  test('about 90 % of the model’s whole window, of which the usable one is 95 %', () => {
    expect(thresholds(258_400)).toEqual({ compactAt: 244_800, warnAt: 244_800 - 25_840, effective: 258_400 })
  })

  test('the share, the figure, and the warning in words', () => {
    const soon = contextOf(readLines(count('2026-10-26T00:00:00.000Z', 225_000)))!
    expect(contextWords(soon)).toMatchObject({ percent: '87%', line: '225k of 258k · 87%', warning: '87% — compacts soon' })
    const past = contextOf(readLines(count('2026-10-26T00:00:00.000Z', 250_000)))!
    expect(contextWords(past).warning).toBe('97% — compacting')
    expect(contextWords(soon).title).toContain('compacts by itself at about 95%')
  })

  test('model names as a person reads them, and token counts', () => {
    expect(modelName('gpt-5.5')).toBe('GPT-5.5')
    expect(modelName('gpt-6-sol')).toBe('GPT-6 Sol')
    expect(modelName('o3')).toBe('o3')
    expect(tokensSaid(823)).toBe('823')
    expect(tokensSaid(258_400)).toBe('258k')
    expect(tokensSaid(1_000_000)).toBe('1.0M')
  })
})

describe('reading a transcript as it grows', () => {
  test('only what was appended is read, and a line still being written waits for its end', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'kehikko-codex-meter-'))
    made.push(dir)
    const file = join(dir, 'rollout.jsonl')
    writeFileSync(file, `${count('2026-10-26T00:00:00.000Z', 1000)}\n`)
    const gauges = new Gauges()
    expect((await gauges.read(file))?.tokens).toBe(1000)
    const next = count('2026-10-26T00:01:00.000Z', 2000)
    appendFileSync(file, next.slice(0, 40))
    expect((await gauges.read(file))?.tokens).toBe(1000)
    appendFileSync(file, `${next.slice(40)}\n`)
    expect((await gauges.read(file))?.tokens).toBe(2000)
    expect(await gauges.read(join(dir, 'gone.jsonl'))).toBeNull()
  })
})
