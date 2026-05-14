import type { Config } from "../types/messages"

// Top-level config keys that persist to the project's kilo.json rather than the
// global one. Settings that are inherently per-repository (e.g. commit message
// conventions) belong here so they don't leak across workspaces.
const PROJECT_SCOPED_KEYS: ReadonlySet<string> = new Set(["commit_message"])
const PROJECT_INDEXING_KEYS: ReadonlySet<string> = new Set(["enabled"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function splitIndexing(value: unknown) {
  if (!isRecord(value)) return { global: value, project: undefined }
  const global = Object.fromEntries(Object.entries(value).filter(([key]) => !PROJECT_INDEXING_KEYS.has(key)))
  const project = Object.fromEntries(Object.entries(value).filter(([key]) => PROJECT_INDEXING_KEYS.has(key)))
  return {
    global: Object.keys(global).length > 0 ? global : undefined,
    project: Object.keys(project).length > 0 ? project : undefined,
  }
}

export function splitConfigByScope(draft: Partial<Config>) {
  const global: Record<string, unknown> = {}
  const project: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(draft)) {
    if (key === "indexing") {
      const scoped = splitIndexing(value)
      if (scoped.global !== undefined) global[key] = scoped.global
      if (scoped.project !== undefined) project[key] = scoped.project
      continue
    }
    if (PROJECT_SCOPED_KEYS.has(key)) project[key] = value
    else global[key] = value
  }
  return { global: global as Partial<Config>, project: project as Partial<Config> }
}
