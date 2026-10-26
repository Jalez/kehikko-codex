import { describe, expect, test } from 'bun:test'
import { DOOR_NAME, MODULE_ID, PACKAGE_VERSION, isModuleIcon, known, loadsSkills, manifestSchema, moduleFolder, partsDeclaration } from 'kehikot-module-protocol'

import { ID, MANIFEST, NOTICES, PREFERRED_PORT } from '../manifest.ts'

describe('the manifest', () => {
  test('is one a host accepts', () => {
    expect(manifestSchema.safeParse(MANIFEST).success).toBe(true)
  })

  test('names this module by an id the protocol accepts, keeping its data under its own folder', () => {
    expect(MODULE_ID.test(ID)).toBe(true)
    expect(MANIFEST.id).toBe(ID)
    expect(moduleFolder(ID)).toBe('codex')
  })

  test('declares storage, because this module takes writes on its own origin', () => {
    expect(MANIFEST.declares.storage).toBe(true)
  })

  test('points at doors this module answers', () => {
    expect(MANIFEST.entry).toBe('/app')
    expect(MANIFEST.health).toBe('/healthz')
    expect(MANIFEST.mcp?.url).toBe('/mcp')
  })

  test('prefers a port on the ten-apart grid, clear of the modules that came before it', () => {
    expect(Number.isInteger(PREFERRED_PORT)).toBe(true)
    expect(PREFERRED_PORT % 10).toBe(0)
    /* 7820 to 8000 are taken on this machine. */
    expect(PREFERRED_PORT).toBeGreaterThan(8000)
  })

  test('says how it relates to the parts of an epic: a place is partly the parts picked', () => {
    expect(MANIFEST.reacts).toContain('parts')
    expect(MANIFEST.partless).toBeUndefined()
    expect(partsDeclaration(MANIFEST)).toEqual([])
  })

  test('asks the host to carry a notice and to mark what its sessions are doing, and takes no prompt', () => {
    expect(MANIFEST.declares.uses).toEqual(['events:emit', 'activity:report'])
    expect(MANIFEST.declares.prompt).toBe(false)
    /* In the protocol's own format, by its name: no module is named, and whatever shows these hears. */
    expect(MANIFEST.extensions.emits).toEqual([NOTICES])
    expect(known(NOTICES)).toBe(true)
    expect(MANIFEST.extensions.consumes).toEqual([])
  })

  test('says it runs agent sessions and loads the kehikko-bound skills into them (protocol 2.21.0)', () => {
    /* Built with 2.21.0 or later, a manifest that does not say so is not routed the skills. */
    expect(MANIFEST.declares.agentSessions).toEqual({ loadsSkills: true })
    expect(loadsSkills(manifestSchema.parse(MANIFEST))).toBe(true)
    const [major, minor] = PACKAGE_VERSION.split('.').map(Number)
    expect(major! > 2 || (major === 2 && minor! >= 21)).toBe(true)
  })

  test('declares no skills: a host would install them for Claude Code, and its own is for Codex', () => {
    expect(MANIFEST.declares.skills ?? []).toEqual([])
  })

  test('has an icon a host draws, and no other module’s', () => {
    expect(isModuleIcon(MANIFEST.icon)).toBe(true)
    expect(MANIFEST.icon).toBe('lucide:bot')
  })

  test('says what its MCP door is to be registered as, in a shape the protocol takes', () => {
    expect(MANIFEST.mcp?.as).toBe('kehikko-codex')
    expect(DOOR_NAME.test(MANIFEST.mcp?.as ?? '')).toBe(true)
  })
})
