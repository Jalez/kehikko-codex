import { afterAll, describe, expect, test } from 'bun:test'
import { WELL_KNOWN, skillPath } from 'kehikot-module-protocol'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, get, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import type { SessionDoor } from '../doorConfig.ts'
import { disabledArgs, readLocal } from '../agentSkills.ts'
import { SKILLS_HEADING, forCodex, kitSkills, removeKit, sessionKit, skillDeclarations, skillText, skillsText } from '../skills.ts'

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
/** What is installed where Codex reads skills: the folders, by name. */
const installed = (agents: string) => (existsSync(agents) ? readdirSync(agents).filter((name) => !name.startsWith('.')).sort() : [])
const options = (extra: { log?: string[]; agents?: string; personal?: string[]; everywhere?: NonNullable<Parameters<typeof sessionKit>[1]>['everywhere'] } = {}) => ({
  base: dir(),
  agentsDir: extra.agents ?? join(dir(), 'agents'),
  personal: extra.personal ?? [dir()],
  log: (line: string) => extra.log?.push(line),
  fetch: plain,
  ...(extra.everywhere !== undefined ? { everywhere: extra.everywhere } : {}),
})

describe('the skills a session is given, installed where Codex reads them', () => {
  test('every module on the kehikko and this module’s own, in Codex’s format, in ~/.agents/skills with Kehikot’s marker', async () => {
    const one = module({ browse: { text: text('browse') }, 'read-page': { text: text('read-page') } })
    const two = module({ journey: { text: text('journey') } })
    const agents = join(dir(), 'agents')
    const kit = await sessionKit([door('kehikot.browser', one), door('kehikot.journeys', two), door('kehikot.browser', one)], options({ agents }))
    expect(installed(agents)).toEqual(['browse', 'journey', 'kehikot-here', 'read-page'])
    expect(readFileSync(join(agents, 'browse', 'SKILL.md'), 'utf8')).toBe('---\nname: browse\ndescription: "browse skill"\n---\nDo the thing.\n')
    /* This module's own is the person's to run: Codex is told so in its own way. */
    expect(readFileSync(join(agents, 'kehikot-here', 'agents', 'openai.yaml'), 'utf8')).toContain('allow_implicit_invocation: false')
    expect(readFileSync(join(agents, 'kehikot-here', 'SKILL.md'), 'utf8')).toContain('$CODEX_THREAD_ID')
    expect(readLocal(agents, 'journey').kind).toBe('ours')
    expect(statSync(kit.dir).mode & 0o777).toBe(0o700)
    expect(existsSync(join(kit.dir, 'skills'))).toBe(false)
    expect(kitSkills(kit.dir).map((one) => `${one.name} ${one.state}`).sort()).toEqual(['browse callable', 'journey callable', 'kehikot-here callable', 'read-page callable'])
    expect(kit.disabled).toEqual([])
    /* The session ends: nothing holds them, and the host keeps none for every conversation. */
    removeKit(kit.dir, agents)
    expect(existsSync(kit.dir)).toBe(false)
    expect(installed(agents)).toEqual([])
  })

  test('a module that does not answer, or gives a text the protocol refuses, is left out with one line', async () => {
    const log: string[] = []
    const bad = module({ broken: { text: 'no front matter' } })
    const agents = join(dir(), 'agents')
    await sessionKit([door('kehikot.gone', 'http://127.0.0.1:9'), door('kehikot.bad', bad)], options({ log, agents }))
    expect(installed(agents)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('kehikot.gone did not answer'))).toBe(true)
    expect(log.some((line) => line.includes('skill broken from kehikot.bad refused'))).toBe(true)
  })

  test('a kehikko-bound skill only when what it needs is on the kehikko — by id, or by what a module there provides', async () => {
    const log: string[] = []
    const factory = module({ 'review-factory': { text: text('review-factory'), needs: ['kehikot.review'] }, 'flow-roadmap': { text: text('flow-roadmap'), needs: [{ provides: 'steps' }] } }, { id: 'kehikot.factory', name: 'Factory' })
    const lone = join(dir(), 'agents')
    const alone = await sessionKit([door('kehikot.factory', factory)], options({ log, agents: lone }))
    expect(installed(lone)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('review-factory') && line.includes('left out'))).toBe(true)
    /* Switched off by path in this session, should another conversation install them. */
    expect(alone.disabled).toEqual([join(lone, 'flow-roadmap', 'SKILL.md'), join(lone, 'review-factory', 'SKILL.md')])
    const review = module({}, { id: 'kehikot.review', name: 'Review' })
    const journeys = module({}, { id: 'kehikot.journeys', name: 'Journeys', declares: { provides: ['steps'] } })
    const agents = join(dir(), 'agents')
    await sessionKit([door('kehikot.factory', factory), door('kehikot.review', review), door('kehikot.journeys', journeys)], options({ agents }))
    expect(installed(agents)).toEqual(['flow-roadmap', 'kehikot-here', 'review-factory'])
    /* Where every Codex conversation can see it, it checks its place first. */
    const said = readFileSync(join(agents, 'review-factory', 'SKILL.md'), 'utf8')
    expect(said.startsWith('---\nname: review-factory\n')).toBe(true)
    expect(said).toContain(`works only in a Codex conversation Kehikot started on a kehikko that also has Review and Factory`)
    expect(said).toContain(SKILLS_HEADING)
    expect(readFileSync(join(agents, 'flow-roadmap', 'SKILL.md'), 'utf8')).toContain('also has a module that')
    expect(readLocal(agents, 'review-factory').kind === 'ours' && readLocal(agents, 'review-factory')).toMatchObject({ marker: { bound: true } })
  })

  test('gated by place: a kehikko-bound skill one conversation holds is off in a conversation on another kehikko, and goes when its holder ends', async () => {
    const factory = module({ factory: { text: text('factory') }, 'review-factory': { text: text('review-factory'), needs: ['kehikot.review'] } }, { id: 'kehikot.factory', name: 'Factory' })
    const review = module({}, { id: 'kehikot.review', name: 'Review' })
    const agents = join(dir(), 'agents')
    const both = await sessionKit([door('kehikot.factory', factory), door('kehikot.review', review)], options({ agents }))
    expect(installed(agents)).toEqual(['factory', 'kehikot-here', 'review-factory'])
    /* Another kehikko: Factory alone, and one with nothing on it. */
    const alone = await sessionKit([door('kehikot.factory', factory)], options({ agents }))
    expect(alone.disabled).toEqual([join(agents, 'review-factory', 'SKILL.md')])
    expect(kitSkills(alone.dir).map((one) => one.name).sort()).toEqual(['factory', 'kehikot-here'])
    const bare = await sessionKit([], options({ agents }))
    expect(bare.disabled).toEqual([join(agents, 'factory', 'SKILL.md'), join(agents, 'review-factory', 'SKILL.md')])
    expect(disabledArgs(bare.disabled)).toEqual(['-c', `skills.config=[{path=${JSON.stringify(join(agents, 'factory', 'SKILL.md'))},enabled=false},{path=${JSON.stringify(join(agents, 'review-factory', 'SKILL.md'))},enabled=false}]`])
    /* The conversation that needed it ends; Factory's own is still held by the other. */
    removeKit(both.dir, agents)
    expect(installed(agents)).toEqual(['factory', 'kehikot-here'])
    removeKit(alone.dir, agents)
    removeKit(bare.dir, agents)
    expect(installed(agents)).toEqual([])
  })

  test('a skill of the person’s own by that name is never written over, and the session is told why', async () => {
    const agents = join(dir(), 'agents')
    mkdirSync(join(agents, 'journey'), { recursive: true })
    writeFileSync(join(agents, 'journey', 'SKILL.md'), text('journey', 'Mine.'))
    const codexSkills = dir()
    mkdirSync(join(codexSkills, 'browse'))
    const log: string[] = []
    const kit = await sessionKit([door('kehikot.journeys', module({ journey: { text: text('journey') }, browse: { text: text('browse') } }, { name: 'Journeys' }))], options({ agents, personal: [codexSkills], log }))
    expect(readFileSync(join(agents, 'journey', 'SKILL.md'), 'utf8')).toBe(text('journey', 'Mine.'))
    expect(existsSync(join(agents, 'browse'))).toBe(false)
    expect(kitSkills(kit.dir).filter((one) => one.state === 'taken').map((one) => one.name).sort()).toEqual(['browse', 'journey'])
    expect(log.some((line) => line.includes('skill journey not installed'))).toBe(true)
    /* Not Kehikot's, so never switched off either. */
    expect(kit.disabled).toEqual([])
    removeKit(kit.dir, agents)
    expect(readFileSync(join(agents, 'journey', 'SKILL.md'), 'utf8')).toBe(text('journey', 'Mine.'))
  })

  test('the skills the host keeps for every conversation are kept after the session, and go when the host stops keeping them', async () => {
    const host = module({ 'kehikot-module': { text: text('kehikot-module') } }, { id: 'kehikko' })
    const agents = join(dir(), 'agents')
    const everywhere = [{ module: 'kehikko', name: 'kehikot-module', version: '1', origin: host }, { module: 'kehikot.codex', name: 'kehikot-here', version: skillDeclarations()[0]!.version, origin: 'http://127.0.0.1:9' }]
    const kit = await sessionKit([], options({ agents, everywhere }))
    expect(kitSkills(kit.dir).map((one) => `${one.name} ${one.by}`).sort()).toEqual(['kehikot-here Codex', 'kehikot-module Kehikot'])
    removeKit(kit.dir, agents)
    expect(installed(agents)).toEqual(['kehikot-here', 'kehikot-module'])
    /* A host too old to say changes nothing kept. */
    removeKit((await sessionKit([], options({ agents, everywhere: null }))).dir, agents)
    expect(installed(agents)).toEqual(['kehikot-here', 'kehikot-module'])
    /* The person turned it off: the next session's answer keeps none. */
    removeKit((await sessionKit([], options({ agents, everywhere: [] }))).dir, agents)
    expect(installed(agents)).toEqual([])
  })

  test('an everywhere entry from somewhere that is not this computer is not fetched', async () => {
    const log: string[] = []
    const agents = join(dir(), 'agents')
    await sessionKit([], options({ agents, log, everywhere: [{ module: 'kehikot.x', name: 'far', version: '1', origin: 'https://example.com' }] }))
    expect(installed(agents)).toEqual(['kehikot-here'])
    expect(log.some((line) => line.includes('not on this computer'))).toBe(true)
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

  test('the session is told its skills as $name entries it can call, and what was not installed', async () => {
    const kit = await sessionKit([], options())
    const said = skillsText([...kitSkills(kit.dir), { name: 'journey', description: 'Mine.', implicit: true, module: 'kehikot.journeys', by: 'Journeys', state: 'taken' }])!
    expect(said.startsWith(SKILLS_HEADING)).toBe(true)
    expect(said).toContain("Codex's `$` menu")
    expect(said).toContain('- `$kehikot-here` (Codex): ')
    expect(said).toContain('Only when the person types it.')
    expect(said).toContain("a skill of the person's own already has the name (`$name` runs theirs): `$journey` (Journeys).")
    expect(said).not.toContain('<skills_instructions>')
    expect(skillsText([])).toBeNull()
    expect(skillText('kehikot-here')).toContain('/api/here')
  })
})
