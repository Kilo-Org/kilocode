export const MEMORY_COMMAND_CATALOG = [
  { usage: "on", description: "Enable project memory" },
  { usage: "off", description: "Disable project memory without deleting local files" },
  { usage: "status", description: "Show local memory state and index size" },
  { usage: "show", description: "Show stored project memory" },
  { usage: "remember <text>", description: "Save an explicit project memory note" },
  { usage: "correct <text>", description: "Save an explicit correction" },
  { usage: "forget <query>", description: "Remove matching project memory" },
  { usage: "auto on|off", description: "Turn auxiliary memory consolidation on or off" },
  { usage: "inspect", description: "Show the local project memory folder" },
  { usage: "rebuild", description: "Rebuild the local memory index" },
  { usage: "purge confirm", description: "Delete all local project memory files" },
] as const

export const MEMORY_USAGE = `/memory [project] ${MEMORY_COMMAND_CATALOG.map((item) => item.usage).join("|")}`
export const MEMORY_HELP = `${MEMORY_USAGE}\n\n${MEMORY_COMMAND_CATALOG.map((item) => `${item.usage} — ${item.description}`).join("\n")}`

export const MEMORY_OPERATIONS = [
  "enable",
  "status",
  "inspect",
  "disable",
  "rebuild",
  "remember",
  "correct",
  "forget",
  "purge",
  "auto",
] as const
export type MemoryOperation = (typeof MEMORY_OPERATIONS)[number]

export type ParsedMemoryCommand =
  | { kind: "help" }
  | { kind: "show"; rest?: string }
  | { kind: "usage"; reason: string }
  | { kind: "operation"; operation: "remember" | "correct"; text: string }
  | { kind: "operation"; operation: "forget"; query: string }
  | { kind: "operation"; operation: "auto"; mode: "on" | "off" }
  | { kind: "operation"; operation: "purge"; confirm: true }
  | {
      kind: "operation"
      operation: Exclude<MemoryOperation, "remember" | "correct" | "forget" | "purge" | "auto">
      rest?: string
    }

/** Parse the same complete `/memory ...` form used by the proven v1 command surface. */
export function parseMemoryCommand(input: string): ParsedMemoryCommand | undefined {
  const value = input.trim()
  const match = value.match(/^\/(?:memory|mem)(?:\s+([\s\S]*))?$/i)
  if (!match) return undefined
  const body = (match[1] ?? "").trim()
  if (!body) return { kind: "help" }

  const target = split(body)
  if (target.head === "personal") return usage("Personal memory is not supported.")
  const rest = target.head === "project" ? target.tail : body
  const parts = split(rest)
  const verb = parts.head
  if (!verb) return { kind: "help" }
  if (verb === "help") return { kind: "help" }
  if (verb === "show") return { kind: "show", rest: parts.tail }
  if (verb === "on" || verb === "enable") return { kind: "operation", operation: "enable", rest: parts.tail }
  if (verb === "off" || verb === "disable") return { kind: "operation", operation: "disable", rest: parts.tail }
  if (verb === "status" || verb === "inspect" || verb === "rebuild") {
    return { kind: "operation", operation: verb, rest: parts.tail }
  }
  if (verb === "remember") {
    return parts.tail ? { kind: "operation", operation: "remember", text: parts.tail } : usage("Missing text.")
  }
  if (verb === "correct") {
    return parts.tail ? { kind: "operation", operation: "correct", text: parts.tail } : usage("Missing correction.")
  }
  if (verb === "forget") {
    return parts.tail ? { kind: "operation", operation: "forget", query: parts.tail } : usage("Missing query.")
  }
  if (verb === "purge") {
    return parts.tail.toLowerCase() === "confirm"
      ? { kind: "operation", operation: "purge", confirm: true }
      : usage("Purge requires confirmation. Run /memory purge confirm.")
  }
  if (verb === "auto" || verb === "auto-consolidate") {
    const mode = parts.tail.toLowerCase()
    return mode === "on" || mode === "off"
      ? { kind: "operation", operation: "auto", mode }
      : usage("Missing auto mode. Run /memory auto on or /memory auto off.")
  }
  if (verb === "use-personal" || verb === "personal-context" || verb === "personal-in-project") {
    return usage("Personal memory is not supported.")
  }
  return usage(`Unknown memory action: ${verb}.`)
}

function split(input: string) {
  const match = input.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/)
  return { head: match?.[1]?.toLowerCase(), tail: (match?.[2] ?? "").trim() }
}

function usage(reason: string): ParsedMemoryCommand {
  return { kind: "usage", reason }
}
