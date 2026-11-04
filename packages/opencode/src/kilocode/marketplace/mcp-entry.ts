// Pure helpers that turn a catalog MCP installation method into an MCP config entry.
// Kept free of service imports so the MCP runtime can reuse them without a cycle.

function escapeJsonValue(raw: string) {
  return raw
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
}

export function substituteParams(template: string, params: Record<string, unknown>) {
  return Object.entries(params).reduce((text, [key, value]) => {
    const escaped = escapeJsonValue(String(value ?? ""))
    return text.replaceAll(`{{${key}}}`, escaped).replaceAll(`\${${key}}`, escaped)
  }, template)
}

export function normalizeMcpEntry(raw: Record<string, unknown>): Record<string, unknown> {
  if (raw.type === "local" || raw.type === "remote") return raw

  if (typeof raw.url === "string") {
    const { url, headers, ...rest } = raw
    const entry: Record<string, unknown> = { type: "remote", url }
    if (headers && typeof headers === "object") entry.headers = headers
    for (const key of ["enabled", "timeout", "oauth"] as const) {
      if (key in rest) entry[key] = rest[key]
    }
    return entry
  }

  if (typeof raw.command === "string") {
    const args = Array.isArray(raw.args) ? raw.args.filter((arg): arg is string => typeof arg === "string") : []
    const entry: Record<string, unknown> = { type: "local", command: [raw.command, ...args] }
    if (raw.env && typeof raw.env === "object" && Object.keys(raw.env).length > 0) entry.environment = raw.env
    for (const key of ["enabled", "timeout"] as const) {
      if (key in raw) entry[key] = raw[key]
    }
    return entry
  }

  return raw
}

export function buildMcpEntry(content: string, params?: Record<string, unknown>) {
  const filtered = Object.fromEntries(Object.entries(params ?? {}).filter(([key]) => key !== "__method"))
  const replaced = Object.keys(filtered).length > 0 ? substituteParams(content, filtered) : content
  const raw = JSON.parse(replaced) as Record<string, unknown>
  return normalizeMcpEntry(raw)
}
