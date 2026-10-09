import { isRecord } from "@/util/record"

export type McpHeaderWarning = {
  path: string
  message: string
}

const reference = /\{(?:env|file):[^}]+\}/

function referencedHeader(mcp: unknown) {
  if (!isRecord(mcp) || !isRecord(mcp.headers)) return undefined
  return Object.entries(mcp.headers)
    .flatMap(([key, value]) => [key, value])
    .find((value): value is string => typeof value === "string" && reference.test(value))
    ?.match(reference)?.[0]
}

/** Drop variable-bearing project MCP headers before substitution can resolve them. */
export function sanitizeProjectMcpHeaders<T>(data: T, source: string): { config: T; warnings: McpHeaderWarning[] } {
  if (!isRecord(data) || !isRecord(data.mcp)) return { config: data, warnings: [] }

  const warnings: McpHeaderWarning[] = []
  const next: Record<string, unknown> = { ...data.mcp }

  for (const [name, mcp] of Object.entries(next)) {
    const token = referencedHeader(mcp)
    if (!token) continue

    delete next[name]
    warnings.push({
      path: source,
      message: `Skipped MCP "${name}": variable references are not allowed in project MCP headers ("${token}")`,
    })
  }

  // kilocode_change - V2 nests servers under mcp.servers; sanitize those headers too
  if (isRecord(next.servers)) {
    const servers: Record<string, unknown> = { ...next.servers }
    for (const [name, server] of Object.entries(servers)) {
      const token = referencedHeader(server)
      if (!token) continue

      delete servers[name]
      warnings.push({
        path: source,
        message: `Skipped MCP "${name}": variable references are not allowed in project MCP headers ("${token}")`,
      })
    }
    next.servers = servers
  }
  // kilocode_change end

  return { config: { ...data, mcp: next } as T, warnings }
}
