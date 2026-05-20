import type { PermissionFileDiff, PermissionFileStatus, PermissionRequest } from "../../types/messages"

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

function status(value: unknown): PermissionFileStatus | undefined {
  if (value === "added" || value === "modified" || value === "deleted") return value
  if (value === "add") return "added"
  if (value === "delete") return "deleted"
  if (value === "update" || value === "move") return "modified"
  return undefined
}

function clean(diff: unknown): PermissionFileDiff | undefined {
  if (!diff || typeof diff !== "object") return
  const item = diff as Record<string, unknown>
  const file = text(item.file)
  if (!file) return
  const fileStatus = status(item.status)
  return {
    file,
    ...(text(item.patch) !== undefined ? { patch: text(item.patch) } : {}),
    additions: num(item.additions),
    deletions: num(item.deletions),
    ...(fileStatus !== undefined ? { status: fileStatus } : {}),
  }
}

function file(item: File): PermissionFileDiff | undefined {
  const name = text(item.relativePath) ?? text(item.filePath)
  if (!name) return
  const fileStatus = status(item.type)
  return {
    file: name,
    ...(text(item.patch) !== undefined ? { patch: text(item.patch) } : {}),
    additions: num(item.additions),
    deletions: num(item.deletions),
    ...(fileStatus !== undefined ? { status: fileStatus } : {}),
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
