import * as path from "path"

const tools = new Set(["apply_patch", "edit", "generate_image", "multiedit", "write"])

function record(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") return
  return value as Record<string, unknown>
}

function value(input: unknown): string | undefined {
  return typeof input === "string" && input.length > 0 ? input : undefined
}

function files(part: Record<string, unknown>): string[] {
  const state = record(part.state)
  if (part.type !== "tool" || state?.status !== "completed") return []
  if (typeof part.tool !== "string" || !tools.has(part.tool)) return []

  const meta = record(state.metadata)
  if (part.tool === "apply_patch" && Array.isArray(meta?.files)) {
    return meta.files.flatMap((item) => {
      const file = record(item)
      return value(file?.movePath) ?? value(file?.filePath) ?? value(file?.relativePath) ?? []
    })
  }

  if (part.tool === "multiedit" && Array.isArray(meta?.results)) {
    return meta.results.flatMap((item) => {
      const result = record(item)
      const diff = record(result?.filediff)
      return value(diff?.file) ?? []
    })
  }

  const diff = record(meta?.filediff)
  const input = record(state.input)
  return [value(diff?.file) ?? value(meta?.filepath) ?? value(input?.filePath)].filter((file): file is string => !!file)
}

/** Absolute paths written by completed file-mutating tool parts. */
export function editPaths(parts: unknown[], base: string): string[] {
  return parts.flatMap((part) => {
    const item = record(part)
    if (!item) return []
    return files(item).map((file) => (path.isAbsolute(file) ? path.normalize(file) : path.resolve(base, file)))
  })
}
