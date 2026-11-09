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
    // An instruction message always follows the assistant step whose read published it.
    if (message.type === "user") reads = []
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

/**
 * An instruction file is loaded from a directory above the file the read opened,
 * so only a read inside the instruction path's directory can have produced it.
 * Reads can run beside each other in one step, so the most recently started read
 * that is still running wins.
 */
function matchingRead(reads: readonly Read[], paths: readonly string[], directory: string | undefined, created: number) {
  const near = reads.filter((read) => {
    if (!read.path) return false
    const resolved = resolveReadPath(read.path, directory)
    return resolved !== undefined && paths.some((file) => containsDirectory(getDirectory(file), resolved))
  })
  if (near.length === 0) return undefined
  const started = near.filter(isStarted).filter((read) => read.ran <= created)
  const running = started.filter((read) => (read.completed ?? Number.POSITIVE_INFINITY) >= created)
  return pickLatest(running) ?? pickLatest(started)
}

function isStarted(read: Read): read is StartedRead {
  return read.ran !== undefined
}

function pickLatest(reads: readonly StartedRead[]) {
  return reads.reduce<StartedRead | undefined>((best, read) => (!best || read.ran >= best.ran ? read : best), undefined)
}

function resolveReadPath(path: string, directory: string | undefined) {
  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\")) return path
  if (!directory) return undefined
  return `${directory.replace(/[/\\]+$/, "")}/${path.replace(/^\.\//, "")}`
}
