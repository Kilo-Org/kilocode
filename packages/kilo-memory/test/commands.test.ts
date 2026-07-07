import { describe, expect, test } from "bun:test"
import { parseMemoryCommand, type MemoryOperation, type ParsedMemoryCommand } from "../src/commands"

type Case = {
  name: string
  input: string
  result: "none" | "help" | "show" | "operation" | "usage"
  operation?: MemoryOperation
  mode?: "on" | "off"
  confirm?: boolean
  text?: string
  query?: string
  reason?: string
}

const cases = (await Bun.file(new URL("./command-cases.json", import.meta.url)).json()) as Case[]

function expected(item: Case): ParsedMemoryCommand | undefined {
  if (item.result === "none") return
  if (item.result === "help") return { kind: "help" }
  if (item.result === "show") return { kind: "show" }
  if (item.result === "usage") return { kind: "usage", reason: item.reason ?? "" }
  if (!item.operation) throw new Error(`Missing operation for fixture: ${item.name}`)
  if (item.operation === "remember" || item.operation === "correct") {
    if (!item.text) throw new Error(`Missing text for fixture: ${item.name}`)
    return { kind: "operation", operation: item.operation, text: item.text }
  }
  if (item.operation === "forget") {
    if (!item.query) throw new Error(`Missing query for fixture: ${item.name}`)
    return { kind: "operation", operation: item.operation, query: item.query }
  }
  if (item.operation === "auto") {
    if (!item.mode) throw new Error(`Missing mode for fixture: ${item.name}`)
    return { kind: "operation", operation: item.operation, mode: item.mode }
  }
  if (item.operation === "purge") {
    if (item.confirm !== true) throw new Error(`Missing confirmation for fixture: ${item.name}`)
    return { kind: "operation", operation: item.operation, confirm: true }
  }
  return { kind: "operation", operation: item.operation }
}

describe("memory commands", () => {
  test("parse shared fixtures", () => {
    for (const item of cases) {
      const parsed = parseMemoryCommand(item.input)
      if (item.result === "usage") {
        expect(parsed?.kind, item.name).toBe("usage")
        expect(parsed && "reason" in parsed ? parsed.reason : "", item.name).toContain(item.reason ?? "")
        continue
      }
      expect(parsed, item.name).toEqual(expected(item))
    }
  })
})
