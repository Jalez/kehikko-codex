/**
 * Letting go of a socket without the browser calling it a failure.
 *
 * `close()` on a socket that is still CONNECTING is logged by the browser as an
 * error — "WebSocket is closed before the connection is established" — and that
 * was on this page's console on every load. Nothing had failed: a view opened
 * its socket and was unmounted before the handshake finished, which is what
 * React's StrictMode does to every effect on mount in development, and what a
 * container taken off the canvas a moment after it appeared does anywhere.
 *
 * So a socket that has not opened is not closed yet. It is forgotten — every
 * handler the view gave it is taken off, so nothing is written into an emulator
 * that is gone and nothing is said about a connection nobody is watching — and
 * it closes itself the moment it opens. The server spawns nothing until a first
 * frame proves itself (`shell.ts`), and this one never sends a frame.
 *
 * Returns whether the socket was still connecting, so the caller can count it
 * out: its `close` event will reach nobody.
 */

/** As much of a `WebSocket` as this reads. */
export interface Letting {
  readyState: number
  onopen: ((event: Event) => void) | null
  onmessage: ((event: MessageEvent) => void) | null
  onclose: ((event: CloseEvent) => void) | null
  onerror: ((event: Event) => void) | null
  close(): void
}

/** `WebSocket.CONNECTING`, spelled out so this file runs where there is no `WebSocket`. */
const CONNECTING = 0

export function letGo(socket: Letting): boolean {
  if (socket.readyState !== CONNECTING) {
    socket.close()
    return false
  }
  socket.onmessage = null
  socket.onclose = null
  /* One that never opens has nothing to close and nobody to tell. */
  socket.onerror = null
  socket.onopen = () => socket.close()
  return true
}
