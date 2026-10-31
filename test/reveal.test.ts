import { describe, expect, test } from 'bun:test'
import { manifestSchema, revealModeOf } from 'kehikot-module-protocol'

import { MANIFEST } from '../manifest.ts'

describe('the host\u2019s header and footer, revealed', () => {
  test('come over the terminal, never by resizing it (protocol 2.42.0)', () => {
    expect(revealModeOf(manifestSchema.parse(MANIFEST))).toBe('over')
  })
})
