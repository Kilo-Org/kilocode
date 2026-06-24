const sandbox = new Set(["sandbox", "sandbox_restrict_network"])

interface ConfigUpdate {
  config: object
  globalUnset?: readonly (readonly string[])[]
  projectConfig?: object
  projectUnset?: readonly (readonly string[])[]
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function hot(key: string, value: unknown) {
  if (key === "console") return true
  if (key !== "experimental" || !record(value)) return false
  return Object.keys(value).every((name) => sandbox.has(name))
}

function unset(path: readonly string[]) {
  if (path[0] === "console") return true
  return path.length === 2 && path[0] === "experimental" && sandbox.has(path[1])
}

export function disposesInstances(input: ConfigUpdate) {
  if (Object.keys(input.projectConfig ?? {}).length > 0 || (input.projectUnset?.length ?? 0) > 0) return true
  const set = Object.entries(input.config)
  const removed = input.globalUnset ?? []
  if (set.length === 0 && removed.length === 0) return false
  return !set.every(([key, value]) => hot(key, value)) || !removed.every(unset)
}
