export const MEMORY_USAGE =
  "/memory [project] enable|status|show|inspect|auto status|auto on|auto off|remember <text>|correct <text>|forget <query>|purge confirm|rebuild|disable"

export const MEMORY_OPERATIONS = ["enable", "disable", "rebuild", "remember", "correct", "forget", "purge", "auto"] as const
export const MEMORY_PROMPT_OPERATIONS = ["remember", "forget"] as const

export type MemoryOperation = (typeof MEMORY_OPERATIONS)[number]
export type MemoryPromptOperation = (typeof MEMORY_PROMPT_OPERATIONS)[number]

export function isMemoryOperation(input: unknown): input is MemoryOperation {
  return typeof input === "string" && (MEMORY_OPERATIONS as readonly string[]).includes(input)
}

export function isMemoryPromptOperation(input: unknown): input is MemoryPromptOperation {
  return typeof input === "string" && (MEMORY_PROMPT_OPERATIONS as readonly string[]).includes(input)
}

type Inspect = {
  kind: "inspect"
}

type Operation =
  | {
      kind: "operation"
      operation: "remember" | "correct"
      text: string
    }
  | {
      kind: "operation"
      operation: "forget"
      query: string
    }
  | {
      kind: "operation"
      operation: "auto"
      mode: "status" | "on" | "off"
    }
  | {
      kind: "operation"
      operation: "purge"
      confirm: true
    }
  | {
      kind: "operation"
      operation: Exclude<MemoryOperation, "remember" | "correct" | "forget" | "purge" | "auto">
    }

type Usage = {
  kind: "usage"
  reason: string
}

export type ParsedMemoryCommand = Inspect | Operation | Usage

function split(input: string) {
  const match = input.trim().match(/^(\S+)(?:\s+([\s\S]*))?$/)
  return {
    head: match?.[1]?.toLowerCase(),
    tail: (match?.[2] ?? "").trim(),
  }
}

function target(input: string) {
  const parts = split(input)
  if (parts.head === "project") return { rest: parts.tail }
  if (parts.head === "personal") return { rest: parts.tail, error: "Personal memory is not supported." }
  return { rest: input.trim() }
}

function usage(reason: string): ParsedMemoryCommand {
  return { kind: "usage", reason }
}

function operation(verb: string, text: string): ParsedMemoryCommand | undefined {
  if (verb === "enable" || verb === "disable" || verb === "rebuild") {
    return { kind: "operation", operation: verb }
  }
  if (verb === "purge") {
    if (text.toLowerCase() === "confirm") return { kind: "operation", operation: "purge", confirm: true }
    return usage("Purge requires confirmation. Run /memory purge confirm.")
  }
  if (verb === "auto" || verb === "auto-consolidate") {
    const mode = text.toLowerCase()
    if (mode === "status" || mode === "on" || mode === "off") return { kind: "operation", operation: "auto", mode }
    return usage("Missing auto mode.")
  }
  if (verb === "remember") {
    if (text) return { kind: "operation", operation: "remember", text }
    return usage("Missing text.")
  }
  if (verb === "correct") {
    if (text) return { kind: "operation", operation: "correct", text }
    return usage("Missing correction.")
  }
  if (verb === "forget") {
    if (text) return { kind: "operation", operation: "forget", query: text }
    return usage("Missing query.")
  }
}

function blocked(verb: string): ParsedMemoryCommand | undefined {
  if (verb === "use-personal" || verb === "personal-context" || verb === "personal-in-project") {
    return usage("Personal memory is not supported.")
  }
}

export function parseMemoryCommand(input: string): ParsedMemoryCommand | undefined {
  const match = input.trim().match(/^\/(?:memory|mem)(?:\s+([\s\S]*))?$/i)
  if (!match) return
  const body = (match[1] ?? "").trim()
  if (!body) return { kind: "inspect" }

  const picked = target(body)
  if (picked.error) return usage(picked.error)
  const parts = split(picked.rest)
  const verb = parts.head
  if (!verb) return { kind: "inspect" }
  if (verb === "status" || verb === "show" || verb === "inspect") return { kind: "inspect" }

  const op = operation(verb, parts.tail)
  if (op) return op
  const denied = blocked(verb)
  if (denied) return denied
  return usage(`Unknown memory action: ${verb}.`)
}
