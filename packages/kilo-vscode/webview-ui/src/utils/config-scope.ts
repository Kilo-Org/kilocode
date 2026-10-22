import type { Config } from "../types/messages"

// Top-level config keys that persist to the project's kilo.json rather than the
// global one. Settings that are inherently per-repository (e.g. commit message
// conventions) belong here so they don't leak across workspaces.
const PROJECT_SCOPED_KEYS: ReadonlySet<string> = new Set(["commit_message"])
export function splitConfigByScope(draft: Partial<Config>) {
  const global: Record<string, unknown> = {}
  const project: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(draft)) {
    if (PROJECT_SCOPED_KEYS.has(key)) project[key] = value
    else global[key] = value
  }
  return { global: global as Partial<Config>, project: project as Partial<Config> }
}
