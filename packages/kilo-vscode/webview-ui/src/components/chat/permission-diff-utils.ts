import type { PermissionFileDiff, PermissionRequest } from "../../types/messages"

type File = {
  filePath?: unknown
  relativePath?: unknown
  type?: unknown
  patch?: unknown
  additions?: unknown
  deletions?: unknown
}

function num(value: unknown) {
  return typeof value === "number" ? value : 0
}

function text(value: unknown) {
  return typeof value === "string" ? value : undefined
}

function clean(diff: unknown): PermissionFileDiff | undefined {
  if (!diff || typeof diff !== "object") return
  const item = diff as Record<string, unknown>
  const file = text(item.file)
  if (!file) return
  return {
    file,
    ...(text(item.patch) !== undefined ? { patch: text(item.patch) } : {}),
    ...(text(item.before) !== undefined ? { before: text(item.before) } : {}),
    ...(text(item.after) !== undefined ? { after: text(item.after) } : {}),
    additions: num(item.additions),
    deletions: num(item.deletions),
  }
}

function file(item: File): PermissionFileDiff | undefined {
  const name = text(item.relativePath) ?? text(item.filePath)
  if (!name) return
  return {
    file: name,
    ...(text(item.patch) !== undefined ? { patch: text(item.patch) } : {}),
    additions: num(item.additions),
    deletions: num(item.deletions),
  }
}

export function permissionDiffs(request: PermissionRequest): PermissionFileDiff[] {
  const direct = clean(request.args?.filediff)
  if (direct) return [direct]

  const files = request.args?.files
  if (Array.isArray(files)) {
    return files.flatMap((item) => {
      const diff = file(item as File)
      return diff ? [diff] : []
    })
  }

  const patch = text(request.args?.diff)
  if (!patch) return []
  const name = text(request.args?.filepath) ?? "patch"
  return [{ file: name, patch, additions: 0, deletions: 0 }]
}
