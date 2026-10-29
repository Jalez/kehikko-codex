/**
 * The Inbox events this module declares (protocol 2.31.0, `events` in the manifest): kept apart
 * from research.ts, which reads files, because the page imports the manifest.
 */
export const RESEARCH_EVENT = 'research-complete'
/* `sound` (protocol 2.33.0): the host's built-in "Answer" plays for it until the person chooses another;
   an older host strips it and plays its own default. */
export const EVENTS = [{ id: RESEARCH_EVENT, says: 'Research complete', state: 'done' as const, sound: 'answer' }]
export const EVENT_IDS: readonly string[] = EVENTS.map((one) => one.id)
