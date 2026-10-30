import { afterAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { NOTES_VERSION } from 'kehikot-module-protocol'

import { readTold } from '../context.ts'

const dir = mkdtempSync(join(tmpdir(), 'told-version-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
const kept = (name: string, record: unknown): string => {
  const file = join(dir, name)
  writeFileSync(file, JSON.stringify(record))
  return file
}

describe('readTold and the notes version', () => {
  test('a record missing the version reads as an old one, not as an error', () => {
    const told = readTold(kept('old.json', { key: 'k', modules: ['kehikot.notes'], names: { 'kehikot.notes': 'Notes' } }))
    expect(told).not.toBeNull()
    expect(told?.version).toBeUndefined()
    expect(told?.modules).toEqual(['kehikot.notes'])
  })

  test('a numeric version is kept; anything else is dropped as missing', () => {
    expect(readTold(kept('new.json', { key: null, version: NOTES_VERSION, modules: null }))?.version).toBe(NOTES_VERSION)
    for (const bad of ['2', null, {}, [2]]) expect(readTold(kept('bad.json', { key: null, version: bad, modules: null }))?.version).toBeUndefined()
  })
})
