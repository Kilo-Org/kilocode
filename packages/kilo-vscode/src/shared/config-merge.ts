function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function mergedConfig<T extends Record<string, unknown>>(global: T, project: Partial<T>): T {
  const result: Record<string, unknown> = { ...global }
  for (const [key, value] of Object.entries(project)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = mergedConfig(result[key] as T, value as Partial<T>)
    } else {
      result[key] = value
    }
  }
  return result as T
}
