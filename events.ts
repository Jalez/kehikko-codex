/**
 * The Inbox events this module declares (protocol 2.31.0, `events` in the manifest): kept apart
 * from research.ts, which reads files, because the page imports the manifest.
 */
export const RESEARCH_EVENT = 'research-complete'
export const EVENTS = [{ id: RESEARCH_EVENT, says: 'Research complete', state: 'done' as const }]
export const EVENT_IDS: readonly string[] = EVENTS.map((one) => one.id)
