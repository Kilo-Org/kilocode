import fs from "node:fs/promises"
import path from "node:path"

const active = new Set<string>()

export interface CheckpointRewindInput {
  sessionID: string
  overlap: boolean
  confirm: () => Promise<boolean>
  abort: () => Promise<void>
  revert: () => Promise<void>
}

export async function rewindCheckpoint(input: CheckpointRewindInput) {
  if (active.has(input.sessionID)) return false
  active.add(input.sessionID)
  try {
    if (input.overlap && !(await input.confirm())) return false
    await input.abort()
    await input.revert()
    return true
  } finally {
    active.delete(input.sessionID)
  }
}

export async function canonicalDirectory(dir: string) {
  const real = await fs.realpath(dir).catch(() => path.resolve(dir))
  if (process.platform === "win32" || process.platform === "darwin") return real.toLocaleLowerCase()
  return real
}

export async function hasActiveOverlap(input: {
  sessionID: string
  directory: string
  statuses: Map<string, string>
  directoryFor: (sessionID: string) => string
}) {
  const target = await canonicalDirectory(input.directory)
  for (const [sessionID, status] of input.statuses) {
    if (sessionID === input.sessionID || status === "idle") continue
    const dir = await canonicalDirectory(input.directoryFor(sessionID))
    if (dir === target) return true
  }
  return false
}
