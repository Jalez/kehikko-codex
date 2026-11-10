/**
 * The names the page needs from the manifest, kept where the page can import them.
 *
 * The page imports this, never `manifest.ts`: the manifest reads `settings.ts`, which checks the
 * person's folders on disk (`folders.ts`, `node:fs`), and a page whose imports reach `node:*` is
 * neither built (`bun run build` refuses it, so `run.sh` falls back to Vite) nor run (Vite answers
 * `node:path` in a browser with a module that throws on first use, so the page never greets its
 * host). Nothing here imports anything. `test/page-builds.test.ts` holds the page to it.
 */

export const ID = 'kehikot.codex'

/**
 * The format a notice is sent in: the protocol's own, by its name. Whatever
 * on the canvas says it shows these is who hears — this module does not know
 * what that is, and names no module.
 */
export const NOTICES = 'kehikot.notifications@1'
