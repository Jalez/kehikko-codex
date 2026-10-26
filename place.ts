/**
 * A place: where a person is standing when they open this module.
 *
 * The exact combination of the epic, the SET of parts picked out of it, and
 * the kehikko — inside one project. The project is not in the key because the
 * record that holds the keys is kept inside the project
 * (`<project>/.kehikot/codex/places.json`): a key read out of that file is
 * already about that folder.
 *
 * ## What makes two places the same place
 *
 * - The parts are a set. Methods then Results and Results then Methods are
 *   one place, so the ids are sorted before they are spelled.
 * - Methods alone and Methods with Results are different places, and nothing
 *   picked is a place too: the whole epic.
 * - A part is named by its id and a kehikko by its key. Both can be renamed —
 *   a heading is prose, a kehikko's name is a label — and a rename must not
 *   move anybody's session. The names are kept BESIDE the key in the record
 *   so the file can be read by a person; they are never compared.
 *
 * ## The kehikko: a key, or — from a host that sends none — a row number
 *
 * `context.kehikko` carries two things that look like identities and only one
 * is. Its `key` (protocol 1.1.0, `KEHIKKO_KEY`) is written in the project's
 * own `.kehikot/host/kehikot.json` (`.kehikot/kehikko/` before protocol 2.2.0) and is the same after a rename, after
 * the project is removed from the host and added again, and on another
 * machine. Its `id` is a row number in one host's database: one kehikko was
 * 2, then 9, then 28, without anybody touching it.
 *
 * So a place holds its kehikko as a TAGGED value, `{ key }` or `{ id }`, told
 * apart by which field of the context it came from and never by how it looks
 * — a key may be all digits (`12345678` is a plausible eight hex characters).
 * The key is used whenever the host sends one. The id is the fallback for a
 * host older than 1.1.0, kept knowing what it costs.
 *
 * ## The spelling
 *
 *     epic=thesis;parts=methods+results;kehikko=key:4072c9e5
 *     epic=thesis;parts=-;kehikko=key:4072c9e5
 *     epic=thesis;parts=-;kehikko=3            (a row number: an older host)
 *     epic=-;parts=-;kehikko=-
 *
 * Readable in the file, and unambiguous: an epic slug and a part id are
 * lowercase letters, digits and dashes (`EPIC_SLUG`, `PART_ID`) and so is a
 * kehikko's key, so none can hold `;`, `=`, `+` or `:`, and a lone `-` —
 * which no slug derivation produces, since dashes at the ends are trimmed,
 * and which is too short to be a key — stands for "none".
 *
 * A key is ALWAYS written behind `key:`. A bare `kehikko=12345678` is a row
 * number and nothing else, which is also exactly what files written before
 * keys existed say — so they still read, as what they were.
 *
 * Shared by the page and the server, so it imports nothing.
 */

/** Which kehikko: by its stable key, or — only when the host sent no key — by the host's row number. */
export type Kehikko = { key: string } | { id: number }

export interface Place {
  /** The open epic's slug, or null when none is open. */
  epic: string | null
  /** The ids of the parts picked out. Empty is the whole epic. */
  parts: string[]
  /** The kehikko, or null when the host has no canvases. */
  kehikko: Kehikko | null
}

const NONE = '-'
const SLUG = /^[a-z0-9-]{1,80}$/
const KEYED = 'key:'
/**
 * A kehikko's key, as the protocol spells it (`KEHIKKO_KEY`): 2–32 lowercase
 * letters, digits and dashes, not starting or ending with a dash. Written out
 * again here because this file imports nothing; a test holds the two equal.
 */
export const KEHIKKO_KEY = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/

/** Is this a kehikko's key? What arrives from a host or over the wire is checked with it. */
export const isKehikkoKey = (key: unknown): key is string => typeof key === 'string' && KEHIKKO_KEY.test(key)

/**
 * The kehikko a host named, as a place holds it: by `key` when there is one,
 * by `id` when there is not, and null when the host has no canvases. A key
 * that is not spelled like one is treated as absent rather than stored.
 */
export function kehikkoOf(said: { id?: number; key?: string } | null | undefined): Kehikko | null {
  if (!said) return null
  if (isKehikkoKey(said.key)) return { key: said.key }
  return typeof said.id === 'number' && Number.isSafeInteger(said.id) ? { id: said.id } : null
}

function spellKehikko(kehikko: Kehikko | null): string {
  if (kehikko === null) return NONE
  return 'key' in kehikko ? `${KEYED}${kehikko.key}` : String(kehikko.id)
}

/** The parts as a set: no duplicates, sorted, so picking order never matters. */
export function sortedParts(parts: readonly string[]): string[] {
  return [...new Set(parts)].sort()
}

/** The one spelling of a place. Stable: these strings are written in people's files. */
export function placeKey(place: Place): string {
  const parts = sortedParts(place.parts)
  return [
    `epic=${place.epic ?? NONE}`,
    `parts=${parts.length ? parts.join('+') : NONE}`,
    `kehikko=${spellKehikko(place.kehikko)}`,
  ].join(';')
}

/**
 * A key read back into a place, or null for anything `placeKey` did not write.
 *
 * Strict on purpose. A key arrives over the wire as well as out of the file,
 * and it is used as a property name: one that does not round-trip is refused
 * rather than stored under a spelling nothing will ever ask for again.
 */
export function readPlaceKey(key: string): Place | null {
  const found = /^epic=([^;]+);parts=([^;]+);kehikko=([^;]+)$/.exec(key)
  if (!found) return null
  const [, epic = '', parts = '', kehikko = ''] = found
  if (epic !== NONE && !SLUG.test(epic)) return null
  const ids = parts === NONE ? [] : parts.split('+')
  if (ids.some((id) => !SLUG.test(id))) return null
  let which: Kehikko | null = null
  if (kehikko.startsWith(KEYED)) {
    const key = kehikko.slice(KEYED.length)
    if (!KEHIKKO_KEY.test(key)) return null
    which = { key }
  } else if (kehikko !== NONE) {
    /* Bare digits are a row number, whatever else they could be read as. */
    if (!/^-?\d{1,15}$/.test(kehikko)) return null
    which = { id: Number(kehikko) }
  }
  const place: Place = { epic: epic === NONE ? null : epic, parts: ids, kehikko: which }
  /* Sorted, deduplicated and spelled the one way, or it is not a key. */
  return placeKey(place) === key ? place : null
}
