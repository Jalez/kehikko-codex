// A stand-in module for the Codex e2e: a manifest with an MCP door and three skills written the
// way modules write them for Claude Code. Records every MCP request it gets.
import { appendFileSync } from 'node:fs'
import { MANIFEST_KIND, PROTOCOL, WELL_KNOWN, manifestSchema, skillPath } from 'kehikot-module-protocol'

const [port, log] = [Number(process.argv[2]), process.argv[3]]
const skills: Record<string, { text: string; needs?: unknown[] }> = {
  'notes-read': {
    text: '---\nname: notes-read\ndescription: Read the notes of this epic. Only a person runs it, by typing /notes-read.\ndisable-model-invocation: true\nallowed-tools: Bash(curl:*)\n---\n\nThe person typed `/notes-read $ARGUMENTS`. The notes:\n\n!`curl -s -G --data-urlencode "session=${CLAUDE_SESSION_ID}" http://127.0.0.1:' + port + '/notes`\n\nSay them back.\n',
  },
  'notes-with-alpha': { text: '---\nname: notes-with-alpha\ndescription: Compare notes with Alpha.\n---\nUse both.\n', needs: ['kehikot.alpha'] },
  'notes-with-nobody': { text: '---\nname: notes-with-nobody\ndescription: Needs a module that is not there.\n---\nNever loaded.\n', needs: ['kehikot.nowhere'] },
}
const manifest = manifestSchema.parse({
  kind: MANIFEST_KIND, protocol: PROTOCOL, id: 'kehikot.notes', name: 'Notes', version: '0.1.0', dataVersion: 1,
  summary: 'Notes beside the work.', tags: [], guidance: 'Notes, a stand-in.', entry: '/app',
  modes: [{ id: 'notes', label: 'Notes', scope: 'epic' }], extensions: { emits: [], consumes: [] }, reacts: [], partless: 'A stand-in.',
  mcp: { url: '/mcp', transport: 'http', as: 'notes', about: 'The notes of an epic.' },
  declares: { protocol: `>=${PROTOCOL} <${PROTOCOL + 1}`, uses: [], storage: true, prompt: false, skills: Object.entries(skills).map(([name, one]) => ({ name, summary: `${name}.`, version: '1.0.0', ...(one.needs ? { needs: one.needs } : {}) })) },
  health: '/healthz',
})
Bun.serve({ port, hostname: '127.0.0.1', async fetch(request) {
  const url = new URL(request.url)
  if (url.pathname === WELL_KNOWN) return Response.json(manifest)
  if (url.pathname === '/healthz') return new Response('ok')
  if (url.pathname === '/app') return new Response('<!doctype html><title>Notes</title><p>notes', { headers: { 'content-type': 'text/html' } })
  for (const [name, one] of Object.entries(skills)) if (url.pathname === skillPath(name)) return new Response(one.text, { headers: { 'content-type': 'text/markdown' } })
  if (url.pathname === '/mcp' && request.method === 'POST') {
    const msg = await request.json().catch(() => null) as { id?: unknown; method?: string } | null
    appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), url: url.pathname + url.search, method: msg?.method }) + '\n')
    if (!msg || msg.id === undefined) return new Response(null, { status: 202 })
    const r = (result: unknown) => Response.json({ jsonrpc: '2.0', id: msg.id, result })
    if (msg.method === 'initialize') return r({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'notes', version: '1' } })
    if (msg.method === 'tools/list') return r({ tools: [{ name: 'list_notes', description: 'The notes of this epic.', inputSchema: { type: 'object', properties: {} } }] })
    if (msg.method === 'tools/call') return r({ content: [{ type: 'text', text: 'note: the methods need tightening' }] })
    return r({})
  }
  return new Response('not here', { status: 404 })
}})
console.log('notes on', port)
