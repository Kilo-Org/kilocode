export type ExecuteCall = {
  /** The tool path exactly as the script called it, such as `read` or `github.search_issues`. */
  tool: string
  /** `running`, `completed` or `error` today; any other value is kept, so a newer server never hides a call. */
  status: string
  input: Record<string, unknown>
}

// Code Mode streams the calls a script makes through metadata rather than child tool parts.
export function executeCalls(metadata: Record<string, unknown>): ExecuteCall[] {
  const value = metadata.toolCalls
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!record(item) || typeof item.tool !== "string" || typeof item.status !== "string") return []
    return [{ tool: item.tool, status: item.status, input: record(item.input) ? item.input : {} }]
  })
}

/** The plain input values in the order the script passed them, as the TUI prints them: `key=value, key=value`. */
export function executeArgs(input: Record<string, unknown>) {
  return Object.entries(input)
    .flatMap(([key, value]) =>
      typeof value === "string" || typeof value === "number" || typeof value === "boolean"
        ? [`${key}=${String(value).replace(/\s+/g, " ")}`]
        : [],
    )
    .join(", ")
}

/** The raw result for reading: JSON, even when the script returned it as a string, is indented. */
export function executeRaw(output: string) {
  const value = decode(output.trim())
  if (value === undefined || typeof value !== "object" || value === null) return { text: output, json: false }
  return { text: JSON.stringify(value, null, 2), json: true }
}

// A script often returns JSON.stringify(...), which arrives as JSON text inside the result.
function decode(text: string): unknown {
  const value = json(text)
  if (typeof value !== "string") return value
  return json(value) ?? value
}

function json(text: string): unknown {
  if (!/^\s*[[{"]/.test(text)) return
  try {
    return JSON.parse(text)
  } catch {
    return
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}
