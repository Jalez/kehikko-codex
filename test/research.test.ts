import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import { declaredEvent, inboxEventsSchema } from 'kehikot-module-protocol'

import { RESEARCH_LINE } from '../context.ts'
import { MANIFEST } from '../manifest.ts'
import { EVENTS, isResearch } from '../research.ts'

/** "Research complete" (protocol 2.31.0): the event this module declares, and when a subagent's finish is one. */

describe('the event', () => {
  test('is declared in the manifest, as the protocol takes it, as a case of done', () => {
    expect(MANIFEST.events).toEqual([{ id: 'research-complete', says: 'Research complete', state: 'done' }])
    expect(inboxEventsSchema.safeParse(EVENTS).success).toBe(true)
    expect(declaredEvent(MANIFEST.events, { state: 'done', event: 'research-complete' })?.says).toBe('Research complete')
  })

  test('a session is told how to say it, for itself and its subagents; so is $kehikot-here', async () => {
    expect(RESEARCH_LINE).toContain('tell_finished({ event: "research-complete", label })')
    expect(RESEARCH_LINE).toContain('subagent')
    const skill = await Bun.file(join(import.meta.dir, '..', 'plugin', 'skills', 'kehikot-here', 'SKILL.md')).text()
    expect(skill).toContain('tell_finished({ event: "research-complete", label })')
  })
})

describe('isResearch, the one rule', () => {
  test('an explorer is research; so is a task with a research word', () => {
    expect(isResearch({ agentType: 'explorer', task: 'Where is X?' })).toBe(true)
    expect(isResearch({ agentType: 'default', task: 'Compare the two parsers' })).toBe(true)
    expect(isResearch({ agentType: 'worker', task: 'Investigate the flaky test' })).toBe(true)
  })

  test('other work is not, and nothing said is not', () => {
    expect(isResearch({ agentType: 'worker', task: 'Rename the config keys' })).toBe(false)
    expect(isResearch({ agentType: 'default', task: null })).toBe(false)
    expect(isResearch({})).toBe(false)
  })
})
