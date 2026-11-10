import { describe, expect, test } from 'bun:test'
import { resolve } from 'node:path'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { build, type Rollup } from 'vite'

/**
 * The page compiles for a browser: what `bun run build` makes, from `src/main.tsx`, written nowhere.
 *
 * Why this is a test. From 0.21.0 the page reached `node:fs`, `node:os` and `node:path` through
 * `manifest.ts` → `settings.ts` → `folders.ts`. The build refused it ("sep" is not exported by
 * "__vite-browser-external"), so an installed copy was never stamped and `run.sh` served the page
 * through Vite — where `node:path` is a module that throws on first use, so `folders.ts` threw while
 * the page's imports were evaluated, `main.tsx` never ran, and the host's greeting went unanswered
 * with every script served. Every other test runs under Bun, where `node:path` is the real one.
 */

const ROOT = resolve(import.meta.dirname, '..')

describe('the page', () => {
  test('builds for a browser, and nothing it imports is a node built-in', async () => {
    const out = (await build({
      root: ROOT,
      configFile: false,
      logLevel: 'silent',
      mode: 'production',
      plugins: [react(), tailwindcss()],
      resolve: { alias: { '@': resolve(ROOT, 'src') } },
      build: { write: false, rollupOptions: { input: resolve(ROOT, 'src/main.tsx') } },
    })) as Rollup.RollupOutput | Rollup.RollupOutput[]
    const outputs = Array.isArray(out) ? out : [out]
    const modules = outputs.flatMap((one) => one.output.flatMap((chunk) => (chunk.type === 'chunk' ? Object.keys(chunk.modules) : [])))
    expect(modules.length).toBeGreaterThan(0)
    const nodeOnes = modules.filter((id) => id.includes('__vite-browser-external') || /^node:/.test(id))
    expect(nodeOnes).toEqual([])
    /* The server's files are the server's: the page takes types from them, and names from ids.ts. */
    const server = modules.filter((id) => /\/(folders|settings|manifest|live|doors|program|record)\.ts$/.test(id) && !id.includes('node_modules'))
    expect(server).toEqual([])
  }, 60_000)
})
