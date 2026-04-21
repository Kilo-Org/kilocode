// packages/opencode/test/devilcode/workflow-tui/team-io.prompt.test.ts
// Phase 6 — structural regression test: asserts command-input.tsx wires /team export|import branches.
import { test, expect, describe } from "bun:test"
import * as fs from "fs"
import * as path from "path"

const COMMAND_INPUT_PATH = path.resolve("src/devilcode/workflow-tui/command-input.tsx")

describe("team-io command-input.tsx structural assertions", () => {
  let source = ""

  test("command-input.tsx exists and is readable", () => {
    source = fs.readFileSync(COMMAND_INPUT_PATH, "utf-8")
    expect(source.length).toBeGreaterThan(0)
  })

  test("team export branch exists", () => {
    if (!source) source = fs.readFileSync(COMMAND_INPUT_PATH, "utf-8")
    expect(source).toContain('startsWith("team export ")')
  })

  test("team import branch exists", () => {
    if (!source) source = fs.readFileSync(COMMAND_INPUT_PATH, "utf-8")
    expect(source).toContain('startsWith("team import ")')
  })

  test("imports from ./commands/team-io", () => {
    if (!source) source = fs.readFileSync(COMMAND_INPUT_PATH, "utf-8")
    expect(source).toContain("./commands/team-io")
  })

  test("exportCommand and importCommand referenced", () => {
    if (!source) source = fs.readFileSync(COMMAND_INPUT_PATH, "utf-8")
    expect(source).toContain("exportCommand")
    expect(source).toContain("importCommand")
  })

  test("teamIOHandlers closure present with Config.update", () => {
    if (!source) source = fs.readFileSync(COMMAND_INPUT_PATH, "utf-8")
    expect(source).toContain("teamIOHandlers")
    expect(source).toContain("Config.update")
  })
})
