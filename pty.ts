/**
 * A pseudo-terminal, from whichever runtime is serving this module. The same
 * file as Terminal's `pty.ts`, kept in step with it.
 *
 * ## Why there are two
 *
 * The dev server is Vite, and Vite runs under Node (`bunx vite` follows
 * Vite's `#!/usr/bin/env node`). There `node-pty` is the pty, as it always was.
 *
 * The built server (`serve.ts`) runs under Bun, and `node-pty` does NOT work
 * under Bun. Measured with Bun 1.4.0 and node-pty 1.1.0 on macOS: `spawn`
 * returns a pid, and then no byte of output ever arrives, `resize` throws
 * `ioctl(2) failed, EBADF`, and the process can no longer exit on its own —
 * timers stop firing and only a SIGKILL ends it. node-pty reads the pty master
 * through Node's `tty.ReadStream` on a raw fd, which Bun does not give it.
 *
 * Bun has a pty of its own: `Bun.spawn(argv, { terminal })`. It was checked
 * for everything this module does with one — an interactive shell, typing,
 * resize (`stty size` follows), Unicode both ways, long output (300 000
 * lines), the exit code, and the shell leading its own process group so a
 * group SIGHUP reaches its jobs — and it does all of it. So under Bun that is
 * the pty, and nothing native has to be built or have its permission bits
 * fixed (`dev/fix-spawn-helper.sh` is for node-pty only).
 *
 * Both are behind `Pty` in `live.ts`, so a run is one run whatever spawned it.
 */

export interface PtyOptions {
  name: string
  cols: number
  rows: number
  cwd: string
  env: Record<string, string | undefined>
}

export interface Pty {
  readonly pid: number
  write(data: string): void
  resize(cols: number, rows: number): void
  /** Signal the process (default SIGHUP) and let the pty go. */
  kill(signal?: NodeJS.Signals): void
  onData(listener: (chunk: string) => void): void
  onExit(listener: (exit: { exitCode: number }) => void): void
}

/** Whether this process is Bun, which is what decides the pty. */
export const underBun = typeof (globalThis as { Bun?: unknown }).Bun !== 'undefined'

/** Bun's own pty. Output arrives as bytes and is decoded as a stream, so a character split across two reads is whole. */
function bunPty(file: string, args: string[], options: PtyOptions): Pty {
  const decoder = new TextDecoder('utf-8')
  const data: ((chunk: string) => void)[] = []
  const exits: ((exit: { exitCode: number }) => void)[] = []
  /* Output that arrives before anyone listens is held, not lost: the prompt is printed at once. */
  const early: string[] = []

  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(options.env)) if (value !== undefined) env[key] = value

  const proc = Bun.spawn([file, ...args], {
    cwd: options.cwd,
    env,
    terminal: {
      name: options.name,
      cols: options.cols,
      rows: options.rows,
      data: (_terminal, bytes) => {
        const chunk = decoder.decode(bytes, { stream: true })
        if (!chunk) return
        if (data.length === 0) early.push(chunk)
        else for (const listener of data) listener(chunk)
      },
    },
  })
  const terminal = proc.terminal
  if (!terminal) throw new Error('Bun.spawn returned no terminal')

  void proc.exited.then((code) => {
    const exitCode = typeof code === 'number' ? code : 1
    for (const listener of exits) listener({ exitCode })
    try {
      terminal.close()
    } catch {
      /* Closed already. */
    }
  })

  return {
    pid: proc.pid,
    write: (text) => {
      if (!terminal.closed) terminal.write(text)
    },
    resize: (cols, rows) => terminal.resize(cols, rows),
    kill: (signal = 'SIGHUP') => {
      try {
        proc.kill(signal)
      } catch {
        /* Gone. */
      }
      try {
        terminal.close()
      } catch {
        /* Closed. */
      }
    },
    onData: (listener) => {
      data.push(listener)
      for (const chunk of early.splice(0)) listener(chunk)
    },
    onExit: (listener) => {
      exits.push(listener)
    },
  }
}

/** node-pty, under Node: the dev server. Imported here, lazily, so nothing else drags a native module in. */
async function nodePty(file: string, args: string[], options: PtyOptions): Promise<Pty> {
  const nodePty = await import('node-pty')
  const pty = nodePty.spawn(file, args, options)
  return {
    pid: pty.pid,
    write: (text) => pty.write(text),
    resize: (cols, rows) => pty.resize(cols, rows),
    kill: (signal) => pty.kill(signal),
    onData: (listener) => {
      pty.onData(listener)
    },
    onExit: (listener) => {
      pty.onExit(({ exitCode }) => listener({ exitCode }))
    },
  }
}

/** A shell on a pty, from whichever runtime this is. */
export async function spawnPty(file: string, args: string[], options: PtyOptions): Promise<Pty> {
  return underBun ? bunPty(file, args, options) : await nodePty(file, args, options)
}
