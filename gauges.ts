import { open, stat } from 'node:fs/promises'

import { emptyGauge, readLines, type Gauge } from './meter.ts'

/* ------------------------------------------------------------------------ *
 * Reading a transcript as it grows: only what is new, never the whole file
 * ------------------------------------------------------------------------ */

/** How much of the end of a transcript is read the first time, and after it was replaced. */
export const TAIL = 1024 * 1024
/** Past this much growth between two reads, only the last `TAIL` of it is read. */
const LEAP = 4 * TAIL
/** How many transcripts are remembered. */
const KEPT = 256

interface Reading {
  ino: number
  size: number
  mtimeMs: number
  /** Where the next read starts: just past the last whole line read. */
  offset: number
  gauge: Gauge
}

/**
 * Transcripts read incrementally: the first look reads the last megabyte, every later one reads
 * only what was appended since (one `stat` when nothing was). Only whole lines are read; a line
 * still being written is read once it ends. A file that shrank or was replaced is read afresh.
 * Never throws: a file that cannot be read is null.
 */
export class Gauges {
  private readonly files = new Map<string, Reading>()

  async read(file: string | null): Promise<Gauge | null> {
    if (!file) return null
    let info: { ino: number; size: number; mtimeMs: number }
    try {
      info = await stat(file)
    } catch {
      this.files.delete(file)
      return null
    }
    let was = this.files.get(file)
    if (was && was.ino === info.ino && was.size === info.size && was.mtimeMs === info.mtimeMs) return was.gauge
    if (!was || was.ino !== info.ino || info.size < was.offset) was = { ino: info.ino, size: 0, mtimeMs: 0, offset: Math.max(0, info.size - TAIL), gauge: emptyGauge() }
    else if (info.size - was.offset > LEAP) was = { ...was, offset: info.size - TAIL }
    const from = was.offset
    try {
      const handle = await open(file, 'r')
      try {
        const buffer = Buffer.alloc(info.size - from)
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, from)
        const end = bytesRead > 0 ? buffer.lastIndexOf(0x0a, bytesRead - 1) : -1
        if (end >= 0) {
          was.gauge = readLines(buffer.subarray(0, end).toString('utf8'), was.gauge)
          was.offset = from + end + 1
        }
      } finally {
        await handle.close()
      }
    } catch {
      return was.gauge
    }
    was.ino = info.ino
    was.size = info.size
    was.mtimeMs = info.mtimeMs
    this.files.delete(file)
    this.files.set(file, was)
    while (this.files.size > KEPT) this.files.delete(this.files.keys().next().value!)
    return was.gauge
  }
}
