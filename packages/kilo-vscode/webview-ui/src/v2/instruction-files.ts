import type { SessionMessageInfo } from "@opencode/client"
import { readInstructionPaths } from "@opencode/schema/session-instruction-paths"
import { containsDirectory, getDirectory } from "@opencode/util/path"

/**
 * The instruction files each read loaded, keyed by the read tool part ID.
 * The read tool publishes instruction paths on a synthetic message, not on the
 * tool part, so the two are matched by their directory, position and timing in
 * the transcript.
 */
export function instructionFilesByRead(messages: readonly SessionMessageInfo[], directory?: string) {
  const files = new Map<string, readonly string[]>()
  let reads: Read[] = []
  for (const message of messages) {
    if (message.type === "assistant") {
      reads = message.content.flatMap((part) => {
        if (part.type !== "tool" || part.name !== "read") return []
        if (part.state.status === "streaming" || part.state.status === "error") return []
        const path = part.state.input.path
        return [
          {
            id: part.id,
            ran: part.time.ran,
            completed: part.time.completed,
            path: typeof path === "string" ? path : undefined,
          },
        ]
      })
      continue
    }
    // A steer row can arrive before the instruction message of the running step,
    // so only the next assistant step replaces the read candidates.
    if (message.type !== "synthetic") continue
    const paths = readInstructionPaths(message.metadata)
    if (paths.length === 0) continue
    const read = matchingRead(reads, paths, directory, message.time.created)
    if (!read) continue
    const loaded = files.get(read.id) ?? []
    files.set(read.id, [...loaded, ...paths.filter((path) => !loaded.includes(path))])
  }
  return files
}

type Read = { id: string; ran?: number; completed?: number; path?: string }
type StartedRead = Read & { ran: number }
type CompletedRead = StartedRead & { completed: number }

/**
 * An instruction file is loaded from a directory above the file the read opened,
 * so only a read inside the instruction path's directory can have produced it.
 * When several reads share that directory they can all be candidates, so a match
 * needs either one candidate or one read that completed just after the message.
 */
function matchingRead(reads: readonly Read[], paths: readonly string[], directory: string | undefined, created: number) {
  const near = reads.filter((read) => {
    if (!read.path) return false
    const resolved = resolveReadPath(read.path, directory)
    return resolved !== undefined && paths.some((file) => containsDirectory(getDirectory(file), resolved))
  })
  if (near.length === 0) return undefined
  const started = near.filter(isStarted).filter((read) => read.ran <= created)
  if (started.length === 0) return undefined
  if (started.length === 1) return started[0]
  const completed = started.filter(isCompleted).filter((read) => read.completed >= created)
  return completed.reduce<CompletedRead | undefined>(
    (best, read) => (!best || read.completed < best.completed ? read : best),
    undefined,
  )
}

function isStarted(read: Read): read is StartedRead {
  return read.ran !== undefined
}

function isCompleted(read: StartedRead): read is CompletedRead {
  return read.completed !== undefined
}

function resolveReadPath(path: string, directory: string | undefined) {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")) return normalizeReadPath(path)
  if (!directory) return undefined
  return normalizeReadPath(`${directory.replace(/[/\\]+$/, "")}/${path}`)
}

/** Matches the server's path resolution so `src/../lib/math.ts` keeps its directory. */
function normalizeReadPath(path: string) {
  const unc = path.startsWith("\\\\")
  const rooted = path.startsWith("/") || unc || /^[A-Za-z]:/.test(path)
  const out: string[] = []
  for (const part of path.split(/[/\\]+/)) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (out.length > 0 && out[out.length - 1] !== ".." && !/^[A-Za-z]:$/.test(out[out.length - 1] ?? "")) out.pop()
      else if (!rooted) out.push("..")
      continue
    }
    out.push(part)
  }
  if (unc) return `//${out.join("/")}`
  if (path.startsWith("/")) return `/${out.join("/")}`
  return out.join("/")
}
