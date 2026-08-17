import { isRecord } from "@/util/record"

export type McpHeaderWarning = {
  path: string
  message: string
}

const reference = /\{(?:env|file):[^}]+\}/

/** Drop variable-bearing project MCP headers before substitution can resolve them. */
export function sanitizeProjectMcpHeaders<T>(data: T, source: string): { config: T; warnings: McpHeaderWarning[] } {
  if (!isRecord(data) || !isRecord(data.mcp)) return { config: data, warnings: [] }

  const warnings: McpHeaderWarning[] = []
  const next = { ...data.mcp }

  for (const [name, mcp] of Object.entries(data.mcp)) {
    if (!isRecord(mcp) || !isRecord(mcp.headers)) continue
    const token = Object.entries(mcp.headers)
      .flatMap(([key, value]) => [key, value])
      .find((value): value is string => typeof value === "string" && reference.test(value))
      ?.match(reference)?.[0]
    if (!token) continue

    delete next[name]
    warnings.push({
      path: source,
      message: `Skipped MCP "${name}": variable references are not allowed in project MCP headers ("${token}")`,
    })
  }

  return { config: { ...data, mcp: next } as T, warnings }
}
