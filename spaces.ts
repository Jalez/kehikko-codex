import { spaceWords } from 'kehikot-module-protocol'

/**
 * A place in words, as a space (protocol 2.92.0): `space Auth › Login`, `space Auth (sub-spaces Login +
 * Errors)`, `no space`. From the space the host said (`context.space`, its path of steps) when there is
 * one, else from the older `epic` and `parts` — a host before spaces, or a place recorded before them.
 * Shared by the page and the server. Pure.
 */

/** One step of a space's path: an id, and what a person calls it when the host said. */
export interface SpaceStep {
  id: string
  name?: string
}

export interface SpacePlace {
  epic: string | null
  parts: readonly string[]
  /** What a person calls each of `parts`, in the same order; an empty string where unknown. */
  partNames?: readonly string[]
  /** The space the host said, root first. Absent from an older host. */
  space?: readonly SpaceStep[]
}

export function placeSpace(place: SpacePlace, options: { ids?: boolean } = {}): string {
  return spaceWords(
    {
      epic: place.epic,
      parts: place.parts.map((id, i) => ({ id, ...(place.partNames?.[i] ? { name: place.partNames[i] } : {}) })),
      space: place.space?.length ? place.space : null,
    },
    { ids: options.ids === true },
  )
}

/** A space off the wire, or undefined: a short list of `{ id, name? }`, bounded. */
export function readSpace(raw: unknown): SpaceStep[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > 16) return undefined
  const steps: SpaceStep[] = []
  for (const one of raw) {
    if (typeof one !== 'object' || one === null || Array.isArray(one)) return undefined
    const { id, name } = one as { id?: unknown; name?: unknown }
    if (typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(id)) return undefined
    steps.push({ id, ...(typeof name === 'string' && name.trim() ? { name: name.slice(0, 120) } : {}) })
  }
  return steps
}
