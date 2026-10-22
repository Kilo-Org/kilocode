import type * as NodeChildProcess from "node:child_process"
import { PassThrough, type Readable } from "node:stream"

// Bun's child_process drops buffered stdio data once the child emits "close", so
// stream readers that attach lazily (a tick or more after spawn) lose the output of
// fast-exiting processes entirely. To retain it, stdout/stderr are piped into
// PassThroughs synchronously at spawn time, before yielding to the event loop.
// PassThrough backpressure (default highWaterMark) keeps unconsumed output bounded.

const map = new WeakMap<NodeChildProcess.ChildProcess, { stdout: PassThrough | null; stderr: PassThrough | null }>()

const wrap = (src: Readable | null) => {
  if (!src) return null
  const out = new PassThrough()
  // A destroy(err) before the lazy consumer attaches would otherwise emit an
  // unhandled "error" event and crash the process (a hazard that also existed
  // when readers attached lazily to the raw stdio streams). Consumers attached
  // by then still get the error via their own listeners; in the rare pre-attach
  // window the error is dropped instead of crashing the CLI.
  out.on("error", () => {})
  src.on("error", (err) => out.destroy(err instanceof Error ? err : new Error(String(err))))
  src.pipe(out)
  return out
}

/** Tap a freshly spawned process. Must be called in the same tick as spawn. */
export function tap(proc: NodeChildProcess.ChildProcess) {
  map.set(proc, { stdout: wrap(proc.stdout), stderr: wrap(proc.stderr) })
}

/** The tapped stream for a process, falling back to the raw stdio stream. */
export function tapped(proc: NodeChildProcess.ChildProcess, fd: "stdout" | "stderr") {
  return map.get(proc)?.[fd] ?? proc[fd]!
}
