import { describe, expect, test } from 'bun:test'
import { footerItemsSchema, footerLayout, type FooterItem } from 'kehikot-module-protocol'

import { contextOf, readLines } from '../meter.ts'
import { FOOT, clip, contextLevel, footerItems, type FooterState } from '../src/view/footer.ts'

/** The footer the host draws: the items declared for each state the page's own rows show. */

const count = (total: number) => JSON.stringify({ timestamp: '2026-10-24T11:55:51.076Z', type: 'event_msg', payload: { type: 'token_count', info: { last_token_usage: { input_tokens: total - 20, cached_input_tokens: total - 60, output_tokens: 20, total_tokens: total }, model_context_window: 258_400 } } })
const at = (tokens: number) => contextOf(readLines([JSON.stringify({ type: 'turn_context', payload: { model: 'gpt-5.5' } }), count(tokens)].join('\n')))!
const calm = at(100_000)
const soon = at(225_000)
const compacting = at(250_000)

const none: FooterState = { line: null, moved: null, doors: null, ended: null, installFailed: null }
const line = (more: Partial<NonNullable<FooterState['line']>> = {}): FooterState => ({ ...none, line: { context: calm, ready: null, said: null, ...more } })

/** Declared, then read as the host reads it. */
const parsed = (state: FooterState): FooterItem[] => footerItemsSchema.parse(footerItems(state))
const byId = (items: FooterItem[], id: string) => items.find((one) => one.id === id)

describe('the footer declared', () => {
  test('nothing to show is an empty footer', () => {
    expect(footerItems(none)).toEqual([])
    expect(parsed(none)).toEqual([])
  })

  test('the line: the context meter, the model, Compact and Clear — Clear asks first, and nobody but the person presses', () => {
    const items = parsed(line())
    expect(items.map((one) => `${one.kind}:${one.id}:${one.align}`)).toEqual(['meter:context:start', 'text:model:start', 'run:compact:end', 'run:clear:end'])
    const context = byId(items, 'context') as Extract<FooterItem, { kind: 'meter' }>
    expect(context.value).toBeCloseTo(0.39)
    expect(context.text).toBe('100k / 258k')
    expect(context.level).toBe('normal')
    expect(context.tooltip).toContain('compacts by itself at about')
    expect(byId(items, 'model')).toMatchObject({ kind: 'text', optional: true })
    const compact = byId(items, FOOT.COMPACT) as Extract<FooterItem, { kind: 'run' }>
    const clear = byId(items, FOOT.CLEAR) as Extract<FooterItem, { kind: 'run' }>
    expect(compact.confirm).toBe(false)
    expect(clear.confirm).toBe(true)
    expect(compact.agents).toBe(false)
    expect(clear.agents).toBe(false)
    expect(compact.disabled).toBeNull()
    expect(compact.icon).toBe('refresh')
  })

  test('the context meter warns where Claude Code warns, and is critical where it compacts by itself, in words too', () => {
    expect(contextLevel(calm)).toBe('normal')
    expect(contextLevel(soon)).toBe('warn')
    expect(contextLevel(compacting)).toBe('critical')
    expect(byId(parsed(line({ context: soon })), 'context')).toMatchObject({ level: 'warn', text: '87% — compacts soon' })
    expect(byId(parsed(line({ context: compacting })), 'context')).toMatchObject({ level: 'critical', text: '97% — compacting' })
  })

  test('nothing sent yet is said, not drawn as an empty meter', () => {
    const items = parsed(line({ context: null }))
    expect(byId(items, 'context')).toMatchObject({ kind: 'text', text: 'Context: nothing sent yet' })
    expect(byId(items, 'model')).toBeUndefined()
  })

  test('not ready: Compact and Clear are there, and say why they wait', () => {
    const why = 'Claude is working: it waits until Claude is back at its prompt.'
    const items = parsed(line({ ready: why }))
    expect(byId(items, FOOT.COMPACT)).toMatchObject({ disabled: `Compact waits: ${why}` })
    expect(byId(items, FOOT.CLEAR)).toMatchObject({ disabled: `Clear waits: ${why}` })
  })

  test('what the last press came to stands first', () => {
    expect(parsed(line({ said: 'Compact sent: Claude Code is compacting the conversation.' }))[0]).toMatchObject({ kind: 'text', id: 'said' })
  })

  test('the rows along the bottom are a sentence each, with a run where they had a button', () => {
    const long = `/Users/someone/Projects/${'a-very-long-folder-name/'.repeat(8)}thesis`
    const items = parsed({
      ...none,
      moved: { to: long, notMoved: null, working: true, canRestart: true },
      doors: { added: ['Paper'], removed: [], working: false },
      installFailed: { failed: 'Codex could not be installed: npm exited with 1.', log: false },
    })
    expect(byId(items, 'moved')).toMatchObject({ kind: 'text', level: 'warn' })
    expect((byId(items, 'moved') as { text: string }).text.endsWith('…')).toBe(true)
    expect(byId(items, FOOT.RESTART_MOVED)).toMatchObject({ kind: 'run', label: 'Restart in the new folder', disabled: 'It is working. Restart it when it is idle.' })
    expect(byId(items, FOOT.DISMISS_MOVED)).toMatchObject({ kind: 'run', optional: true })
    expect(byId(items, 'doors')).toMatchObject({ text: 'Restart to load Paper’s tools.' })
    expect(byId(items, FOOT.RESTART_DOORS)).toMatchObject({ disabled: null })
    expect(byId(items, 'install-failed')).toMatchObject({ level: 'critical', text: 'Codex could not be installed: npm exited with 1.' })
    expect(byId(items, FOOT.INSTALL_LOG)).toMatchObject({ kind: 'toggle', label: 'See the log', checked: false, optional: true })
    expect(byId(items, FOOT.TRY_AGAIN)).toMatchObject({ kind: 'run', label: 'Try again' })
    expect(byId(parsed({ ...none, ended: { why: 'the session ended (0)' } }), FOOT.RESUME)).toMatchObject({ kind: 'run', label: 'Resume', icon: 'play' })
  })

  test('the fullest footer fits the protocol’s limits, and narrow it keeps the context and folds the rest', () => {
    const items = parsed({
      line: { context: compacting, ready: null, said: 'Clear sent: a new conversation starts here.' },
      moved: { to: '/x', notMoved: 'It could not be restarted.', working: false, canRestart: true },
      doors: { added: ['Paper'], removed: ['Flows'], working: false },
      ended: null,
      installFailed: null,
    })
    expect(items.length).toBeLessThanOrEqual(16)
    const narrow = footerLayout(items, 200)
    expect(narrow.start.map((one) => one.id)).toContain('context')
    expect(narrow.overflow.map((one) => one.id)).toContain(FOOT.CLEAR)
  })

  test('clip keeps one line, and cuts it with an ellipsis', () => {
    expect(clip('one\ntwo', 20)).toBe('one two')
    expect(clip('abcdef', 4)).toBe('abc…')
  })
})
