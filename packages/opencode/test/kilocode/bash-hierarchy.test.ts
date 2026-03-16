import { test, expect, describe } from "bun:test"
import { BashHierarchy } from "../../src/kilocode/bash-hierarchy"

function collect(command: string[], text: string): string[] {
  const set = new Set<string>()
  BashHierarchy.addAll(set, command, text)
  return [...set]
}

describe("BashHierarchy.addAll", () => {
  test("arity-1 command produces base wildcard + exact", () => {
    const result = collect(["ls", "-la"], "ls -la")
    expect(result).toContain("ls *")
    expect(result).toContain("ls -la")
  })

  test("arity-2 command produces base, prefix, and exact", () => {
    const result = collect(["git", "status"], "git status")
    expect(result).toEqual(["git *", "git status *", "git status"])
  })

  test("arity-2 command with args", () => {
    const result = collect(["npm", "install", "lodash"], "npm install lodash")
    expect(result).toEqual(["npm *", "npm install *", "npm install lodash"])
  })

  test("arity-3 command produces three wildcard levels + exact", () => {
    const result = collect(["npm", "run", "dev"], "npm run dev")
    expect(result).toEqual(["npm *", "npm run *", "npm run dev *", "npm run dev"])
  })

  test("arity-3 command with extra args", () => {
    const result = collect(["docker", "compose", "up", "-d"], "docker compose up -d")
    expect(result).toEqual(["docker *", "docker compose *", "docker compose up *", "docker compose up -d"])
  })

  test("single token command", () => {
    const result = collect(["pwd"], "pwd")
    expect(result).toEqual(["pwd *", "pwd"])
  })

  test("empty command returns only text", () => {
    const result = collect([], "")
    expect(result).toEqual([""])
  })

  test("unknown command defaults to arity-1", () => {
    const result = collect(["mycustomtool", "arg1", "arg2"], "mycustomtool arg1 arg2")
    expect(result).toEqual(["mycustomtool *", "mycustomtool arg1 arg2"])
  })

  test("duplicates are deduplicated by Set", () => {
    const set = new Set<string>()
    BashHierarchy.addAll(set, ["git", "status"], "git status")
    BashHierarchy.addAll(set, ["git", "diff"], "git diff")
    // "git *" appears in both but Set deduplicates
    expect([...set].filter((p) => p === "git *")).toHaveLength(1)
  })
})
