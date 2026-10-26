import { afterAll, describe, expect, test } from 'bun:test'
import { WELL_KNOWN, skillPath } from 'kehikot-module-protocol'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, get, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SessionDoor } from '../doorConfig.ts'
import { catalogText, forCodex, kitSkills, removeKit, sessionKit, skillDeclarations, skillText } from '../skills.ts'

const scratch: string[] = []
const dir = () => {
  const one = mkdtempSync(join(tmpdir(), 'kehikko-codex-skills-'))
  scratch.push(one)
  return one
}
const servers: Server[] = []
afterAll(() => {
  for (const one of servers) one.close()
  for (const one of scratch) rmSync(one, { recursive: true, force: true })
})

const text = (name: string, body = 'Do the thing.') => `---\nname: ${name}\ndescription: ${name} skill\n---\n${body}\n`

/** A stand-in module: a manifest declaring skills, and each one's text. */
function module(skills: Record<string, { text: string; version?: string; needs?: unknown[] }>, more: Record<string, unknown> = {}) {
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? '/', 'http://x').pathname
    if (path === WELL_KNOWN) {
      response.setHeader('content-type', 'application/json')
      return void response.end(JSON.stringify({ id: more.id ?? 'kehikot.x', ...more, declares: { ...((more.declares as object) ?? {}), skills: Object.entries(skills).map(([name, one]) => ({ name, summary: `${name}.`, version: one.version ?? '1', ...(one.needs ? { needs: one.needs } : {}) })) } }))
    }
    for (const [name, one] of Object.entries(skills)) if (path === skillPath(name)) return void response.end(one.text)
    response.statusCode = 404
    response.end('no')
  })
  server.listen(0, '127.0.0.1')
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/* The test document replaces `fetch` with one that applies a browser's origin rules; a module is asked from a server. */
const plain = ((url: string) =>
  new Promise((done, fail) => {
    get(url, (response) => {
      let body = ''
      response.on('data', (chunk) => (body += chunk))
      response.on('end', () => done({ status: response.statusCode, text: async () => body }))
    }).on('error', fail)
  })) as unknown as typeof fetch

const door = (module: string, origin: string): SessionDoor => ({ module, name: module.split('.').pop()!, url: `${origin}/mcp?kehikot-place=x`, transport: 'http' })
const names = (kit: string) => readdirSync(join(kit, 'skills')).sort()
const options = (extra: { log?: string[]; skillDirs?: string[] } = {}) => ({ base: dir(), skillDirs: extra.skillDirs ?? [dir()], log: (line: string) => extra.log?.push(line), fetch: plain })

describe('the skills a session is given', () => {
  test('one folder, assembled from every module on the kehikko, and this module’s own, in Codex’s format', async () => {
    const one = module({ browse: { text: text('browse') }, 'read-page': { text: text('read-page') } })
    const two = module({ journey: { text: text('journey') } })
    const kit = await sessionKit([door('kehikot.browser', one), door('kehikot.journeys', two), door('kehikot.browser', one)], options())
    expect(names(kit.dir)).toEqual(['browse', 'journey', 'kehikot-here', 'read-page'])
    expect(readFileSync(join(kit.dir, 'skills', 'browse', 'SKILL.md'), 'utf8')).toBe('---\nname: browse\ndescription: "browse skill"\n---\nDo the thing.\n')
    /* This module's own is the person's to run: Codex is told so in its own way. */
    expect(readFileSync(join(kit.dir, 'skills', 'kehikot-here', 'agents', 'openai.yaml'), 'utf8')).toContain('allow_implicit_invocation: false')
    expect(readFileSync(join(kit.dir, 'skills', 'kehikot-here', 'SKILL.md'), 'utf8')).toContain('$CODEX_THREAD_ID')
    expect(statSync(kit.dir).mode & 0o777).toBe(0o700)
    expect(kitSkills(kit.dir).map((one) => one.name).sort()).toEqual(['browse', 'journey', 'kehikot-here', 'read-page'])
    removeKit(kit.dir)
    expect(existsSync(kit.dir)).toBe(false)
  })

  test('a module that does not answer, or gives a text the protocol refuses, is left out with one line', async () => {
    const log: string[] = []
    const bad = module({ broken: { text: 'no front matter' } })
    const kit = await sessionKit([door('kehikot.gone', 'http://127.0.0.1:9'), door('kehikot.bad', bad)], options({ log }))
    expect(names(kit.dir)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('kehikot.gone did not answer'))).toBe(true)
    expect(log.some((line) => line.includes('skill broken from kehikot.bad refused'))).toBe(true)
  })

  test('a kehikko-bound skill only when what it needs is on the kehikko — by id, or by what a module there provides', async () => {
    const log: string[] = []
    const factory = module({ 'review-factory': { text: text('review-factory'), needs: ['kehikot.review'] }, 'flow-roadmap': { text: text('flow-roadmap'), needs: [{ provides: 'steps' }] } }, { id: 'kehikot.factory' })
    const alone = await sessionKit([door('kehikot.factory', factory)], options({ log }))
    expect(names(alone.dir)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('review-factory') && line.includes('left out'))).toBe(true)
    const review = module({}, { id: 'kehikot.review' })
    const journeys = module({}, { id: 'kehikot.journeys', declares: { provides: ['steps'] } })
    const both = await sessionKit([door('kehikot.factory', factory), door('kehikot.review', review), door('kehikot.journeys', journeys)], options())
    expect(names(both.dir)).toEqual(['flow-roadmap', 'kehikot-here', 'review-factory'])
  })

  test('one the person already has where Codex looks, installed through Kehikot at the same version, is not listed twice', async () => {
    const mine = dir()
    mkdirSync(join(mine, 'kehikot-here'), { recursive: true })
    writeFileSync(join(mine, 'kehikot-here', '.kehikot-skill.json'), JSON.stringify({ version: skillDeclarations()[0]!.version }))
    const kit = await sessionKit([], options({ skillDirs: [mine] }))
    expect(existsSync(join(kit.dir, 'skills'))).toBe(false)
    expect(kitSkills(kit.dir)).toEqual([])
  })
})

describe('a skill written for Claude Code, said for Codex', () => {
  const claude = [
    '---',
    'name: monitor',
    'description: Ask Monitor what repeats. Only a person runs it, by typing /monitor.',
    'disable-model-invocation: true',
    'allowed-tools: Bash(curl:*), mcp__monitor__traffic',
    '---',
    '',
    'The person typed `/monitor $ARGUMENTS`. Monitor answers at http://127.0.0.1:9010:',
    '',
    '!`curl -s -m 5 -G --data-urlencode "session=${CLAUDE_SESSION_ID}" http://127.0.0.1:9010/api/traffic`',
    '',
    'Then say what repeats.',
  ].join('\n')

  test('Claude Code’s front matter goes; a person-only skill stays one; its name is typed with $', () => {
    const said = forCodex(claude, 'monitor')
    expect(said.implicit).toBe(false)
    expect(said.description).toBe('Ask Monitor what repeats. Only a person runs it, by typing $monitor.')
    expect(said.text.startsWith('---\nname: monitor\ndescription: "Ask Monitor what repeats. Only a person runs it, by typing $monitor."\n---\n')).toBe(true)
    expect(said.text).not.toContain('allowed-tools')
    expect(said.text).not.toContain('disable-model-invocation')
    expect(said.text).toContain('The person typed `$monitor $ARGUMENTS`')
    expect(said.text).toContain('Only the person runs this skill, by typing `$monitor`')
  })

  test('a line Claude Code runs on load is a command to run first, outside the sandbox; the session id is Codex’s', () => {
    const said = forCodex(claude, 'monitor')
    expect(said.text).not.toContain('!`curl')
    expect(said.text).toContain('```sh\ncurl -s -m 5 -G --data-urlencode "session=$CODEX_THREAD_ID" http://127.0.0.1:9010/api/traffic\n```')
    expect(said.text).toContain('require_escalated')
    expect(said.text).toContain('`$ARGUMENTS` below is whatever the person wrote after `$monitor`')
    expect(said.text).not.toContain('CLAUDE_SESSION_ID')
  })

  test('a skill with none of that is the same text under Codex’s front matter', () => {
    expect(forCodex(text('journey', 'Read the steps.'), 'journey')).toEqual({ name: 'journey', description: 'journey skill', implicit: true, text: '---\nname: journey\ndescription: "journey skill"\n---\nRead the steps.\n' })
  })

  test('the session is told its skills the way Codex lists its own', async () => {
    const kit = await sessionKit([], options())
    const said = catalogText(kit.dir, kit.skills)!
    expect(said.startsWith('<skills_instructions>')).toBe(true)
    expect(said).toContain(`- \`k0\` = \`${join(kit.dir, 'skills')}\``)
    expect(said).toContain('- kehikot-here: ')
    expect(said).toContain('Only when the person types $kehikot-here. (file: k0/kehikot-here/SKILL.md)')
    expect(catalogText(kit.dir, [])).toBeNull()
    expect(skillText('kehikot-here')).toContain('{{origin}}'.length ? '/api/here' : '')
  })
})
