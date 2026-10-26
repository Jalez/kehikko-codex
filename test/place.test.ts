import { describe, expect, test } from 'bun:test'

import { KEHIKKO_KEY as PROTOCOL_KEY } from 'kehikot-module-protocol'

import { KEHIKKO_KEY, kehikkoOf, placeKey, readPlaceKey, sortedParts } from '../place.ts'

/**
 * The key a session is filed under. These strings are written into people's
 * projects, so what this file pins is a contract: a change that makes any of
 * them spell differently is a change that loses somebody their sessions.
 */
describe('the key of a place', () => {
  test('is readable, and spells every part of the place', () => {
    expect(placeKey({ epic: 'thesis', parts: ['methods', 'results'], kehikko: { id: 3 } })).toBe('epic=thesis;parts=methods+results;kehikko=3')
  })

  test('the parts are a set: the order they were picked in does not matter', () => {
    const one = placeKey({ epic: 'thesis', parts: ['results', 'methods'], kehikko: { id: 3 } })
    const other = placeKey({ epic: 'thesis', parts: ['methods', 'results'], kehikko: { id: 3 } })
    expect(one).toBe(other)
    expect(sortedParts(['b', 'a', 'b'])).toEqual(['a', 'b'])
  })

  test('Methods alone and Methods with Results are different places, and nothing picked is a place too', () => {
    const keys = [
      placeKey({ epic: 'thesis', parts: [], kehikko: { id: 3 } }),
      placeKey({ epic: 'thesis', parts: ['methods'], kehikko: { id: 3 } }),
      placeKey({ epic: 'thesis', parts: ['methods', 'results'], kehikko: { id: 3 } }),
    ]
    expect(new Set(keys).size).toBe(3)
    expect(keys[0]).toBe('epic=thesis;parts=-;kehikko=3')
  })

  test('another epic and another kehikko are other places', () => {
    const here = placeKey({ epic: 'thesis', parts: ['methods'], kehikko: { id: 3 } })
    expect(placeKey({ epic: 'paper-two', parts: ['methods'], kehikko: { id: 3 } })).not.toBe(here)
    expect(placeKey({ epic: 'thesis', parts: ['methods'], kehikko: { id: 4 } })).not.toBe(here)
  })

  test('no epic and no kehikko are spelled, not left out', () => {
    expect(placeKey({ epic: null, parts: [], kehikko: null })).toBe('epic=-;parts=-;kehikko=-')
  })

  test('holds ids only, so renaming a part or a kehikko moves nothing', () => {
    /* A heading and a kehikko's name never reach the key: the same ids are the same place whatever they are called today. */
    const key = placeKey({ epic: 'thesis', parts: ['methods'], kehikko: { id: 3 } })
    expect(key).not.toContain('Methods')
    expect(key).not.toContain('writing')
  })

  test('reads back to the place it was made from', () => {
    for (const place of [
      { epic: 'thesis', parts: ['methods', 'results'], kehikko: { id: 3 } },
      { epic: null, parts: [], kehikko: null },
      { epic: 'a-b-c', parts: ['part-1'], kehikko: { id: 0 } },
    ]) {
      expect(readPlaceKey(placeKey(place))).toEqual(place)
    }
  })

  test('a kehikko is spelled by its stable key when it has one, behind `key:`', () => {
    expect(placeKey({ epic: 'thesis', parts: ['methods', 'results'], kehikko: { key: '4072c9e5' } })).toBe('epic=thesis;parts=methods+results;kehikko=key:4072c9e5')
    expect(placeKey({ epic: 'thesis', parts: [], kehikko: { key: 'writing' } })).toBe('epic=thesis;parts=-;kehikko=key:writing')
    expect(placeKey({ epic: null, parts: [], kehikko: { key: 'review-2' } })).toBe('epic=-;parts=-;kehikko=key:review-2')
  })

  test('a row number is spelled as it always was, so files written before keys still read', () => {
    expect(placeKey({ epic: 'thesis', parts: [], kehikko: { id: 3 } })).toBe('epic=thesis;parts=-;kehikko=3')
    expect(readPlaceKey('epic=thesis;parts=methods+results;kehikko=3')).toEqual({ epic: 'thesis', parts: ['methods', 'results'], kehikko: { id: 3 } })
  })

  test('a key that is all digits never collides with a row number: the two are spelled apart and read apart', () => {
    const keyed = placeKey({ epic: 'thesis', parts: [], kehikko: { key: '12345678' } })
    const numbered = placeKey({ epic: 'thesis', parts: [], kehikko: { id: 12345678 } })
    expect(keyed).toBe('epic=thesis;parts=-;kehikko=key:12345678')
    expect(numbered).toBe('epic=thesis;parts=-;kehikko=12345678')
    expect(keyed).not.toBe(numbered)
    expect(readPlaceKey(keyed)?.kehikko).toEqual({ key: '12345678' })
    expect(readPlaceKey(numbered)?.kehikko).toEqual({ id: 12345678 })
    /* No key is ever written bare, so nothing bare is ever read as one. */
    expect(readPlaceKey('epic=thesis;parts=-;kehikko=4072c9e5')).toBeNull()
  })

  test('keyed places read back to what they were made from', () => {
    for (const place of [
      { epic: 'thesis', parts: ['methods', 'results'], kehikko: { key: '4072c9e5' } },
      { epic: null, parts: [], kehikko: { key: 'ab' } },
      { epic: 'a-b-c', parts: ['part-1'], kehikko: { key: 'a'.repeat(32) } },
      { epic: 'thesis', parts: [], kehikko: { key: '00' } },
    ]) {
      expect(readPlaceKey(placeKey(place))).toEqual(place)
    }
  })

  test('what follows `key:` has to be a key', () => {
    for (const not of ['key:', 'key:a', 'key:-ab', 'key:ab-', 'key:AB', 'key:a b', 'key:a:b', 'key:a=b', `key:${'a'.repeat(33)}`, 'id:3', 'key:4072c9e5;x=1']) {
      expect(readPlaceKey(`epic=thesis;parts=-;kehikko=${not}`)).toBeNull()
    }
  })

  test('the pattern for a key is the protocol’s own, written out again', () => {
    expect(KEHIKKO_KEY.source).toBe(PROTOCOL_KEY.source)
    expect(KEHIKKO_KEY.flags).toBe(PROTOCOL_KEY.flags)
  })

  test('what a host named: by key when it sent one, by row number when it did not', () => {
    expect(kehikkoOf({ id: 3, key: '4072c9e5' })).toEqual({ key: '4072c9e5' })
    expect(kehikkoOf({ id: 3 })).toEqual({ id: 3 })
    expect(kehikkoOf({ id: 3, key: '12345678' })).toEqual({ key: '12345678' })
    expect(kehikkoOf(null)).toBeNull()
    /* A key that is not one is as good as none. */
    expect(kehikkoOf({ id: 3, key: 'No' })).toEqual({ id: 3 })
  })

  test('refuses anything it would not have written', () => {
    for (const not of [
      '',
      'constructor',
      '__proto__',
      'epic=thesis',
      'epic=thesis;parts=b+a;kehikko=3',
      'epic=thesis;parts=a+a;kehikko=3',
      'epic=Thesis;parts=-;kehikko=3',
      'epic=thesis;parts=-;kehikko=three',
      'epic=../x;parts=-;kehikko=3',
      'epic=thesis;parts=-;kehikko=3;extra=1',
    ]) {
      expect(readPlaceKey(not)).toBeNull()
    }
  })
})
