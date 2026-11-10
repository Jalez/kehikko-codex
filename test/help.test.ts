import { describe, expect, test } from 'bun:test'
import { HELP_LIMITS, helpOf } from 'kehikot-module-protocol'

import { HELP, MANIFEST } from '../manifest.ts'

describe('How to use (protocol 2.52.0)', () => {
  test('is declared, within the protocol’s bounds, and read back whole as plain one-line text', () => {
    const help = helpOf(MANIFEST)
    expect(help).toEqual(HELP)
    expect(HELP.summary.length).toBeLessThanOrEqual(HELP_LIMITS.SUMMARY)
    expect(HELP.sections.length).toBeLessThanOrEqual(HELP_LIMITS.SECTIONS)
    for (const section of HELP.sections) {
      expect(section.title.length).toBeLessThanOrEqual(HELP_LIMITS.TITLE)
      expect(section.points.length).toBeLessThanOrEqual(HELP_LIMITS.POINTS)
      for (const point of section.points) {
        expect(point.length).toBeLessThanOrEqual(HELP_LIMITS.POINT)
        expect(point).not.toMatch(/[<>]|https?:|\]\(/)
      }
    }
  })

  test('says what it shows, how to use it and what agents can do', () => {
    expect(HELP.sections.map((section) => section.title)).toEqual(expect.arrayContaining(['What it shows', 'How to use it', 'What agents can do']))
  })
})
