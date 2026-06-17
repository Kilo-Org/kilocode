import { MEMORY_USAGE, parseMemoryCommand as parse } from "@kilocode/kilo-memory/commands"
import type { ParsedMemoryCommand as SharedMemoryCommand } from "@kilocode/kilo-memory/commands"

export type ParsedMemoryCommand = SharedMemoryCommand

export function parseMemoryCommand(input: string): ParsedMemoryCommand | undefined {
  const parsed = parse(input)
  if (parsed?.kind !== "usage") return parsed
  return { ...parsed, reason: `${parsed.reason}\n${MEMORY_USAGE}` }
}
