// kilocode_change - new file
import { postUsage } from "./platform"

const WRITE = new Set(["write", "edit", "patch", "multiedit", "apply_patch"])

type Edit = {
  chars: number
}

type Sess = {
  edits: Map<string, Edit>
  reverted: Set<string>
}

const store = new Map<string, Sess>()

function sess(id: string): Sess {
  const existing = store.get(id)
  if (existing) return existing
  const next = { edits: new Map<string, Edit>(), reverted: new Set<string>() }
  store.set(id, next)
  return next
}

export function patchChars(old: string, next: string): number {
  if (!old) return next.length
  const min = Math.min(old.length, next.length)
  let replaced = 0
  for (let i = 0; i < min; i++) {
    if (old[i] !== next[i]) replaced++
  }
  const grown = Math.max(0, next.length - old.length)
  return replaced + grown
}

export function recordEdit(input: {
  sessionID: string
  tool: string
  path: string
  old: string
  next: string
  chars?: number
}) {
  const tool = input.tool.toLowerCase()
  if (!WRITE.has(tool)) return
  const path = input.path.trim()
  if (!path) return
  const chars = input.chars ?? patchChars(input.old, input.next)
  const s = sess(input.sessionID)
  const prev = s.edits.get(path)
  s.edits.set(path, { chars: (prev?.chars ?? 0) + chars })
  postUsage("agent.file.edited", { path })
}

export function markReverted(sessionID: string, paths: string[]) {
  const s = store.get(sessionID)
  if (!s) return
  for (const raw of paths) {
    const path = raw.trim()
    if (path) s.reverted.add(path)
  }
}

export function flush(sessionID: string) {
  const s = store.get(sessionID)
  if (!s) return
  for (const [path, edit] of s.edits) {
    if (s.reverted.has(path)) continue
    postUsage("agent.file.edit_accepted", { path, chars: edit.chars })
  }
  store.delete(sessionID)
}

export function reset(sessionID?: string) {
  if (sessionID) {
    store.delete(sessionID)
    return
  }
  store.clear()
}

export const KiloAgentUsage = {
  patchChars,
  recordEdit,
  markReverted,
  flush,
  reset,
}
