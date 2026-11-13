import { MEMORY_USAGE, parseMemoryCommand as parse } from "@kilocode/kilo-memory/commands"
import type { ParsedMemoryCommand as SharedMemoryCommand } from "@kilocode/kilo-memory/commands"

export type ParsedMemoryCommand = SharedMemoryCommand
export { MEMORY_USAGE }

export function parseMemoryCommand(input: string): ParsedMemoryCommand | undefined {
  const parsed = parse(input)
  if (parsed?.kind !== "usage") return parsed
  return { ...parsed, reason: `${parsed.reason}\n${MEMORY_USAGE}` }
}

/**
 * The text that should remain in the prompt input after a memory command is
 * submitted. No-argument memory operations (e.g. rebuild, on, status, inspect)
 * typed with trailing free text (e.g. "/memory rebuild hello") keep that text in
 * the input instead of discarding it; the parser reports the unconsumed
 * remainder as `rest`. Argument-taking operations (remember, correct, forget,
 * auto, purge) consume their text, so nothing remains.
 */
export function memoryRest(cmd: ParsedMemoryCommand): string {
  return "rest" in cmd ? (cmd.rest ?? "") : ""
}
