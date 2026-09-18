import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { KiloCli } from "../../../src/kilocode/cli/setup"
import { createHelpCommand } from "../../../src/kilocode/help-command"
import { resetLazyCommandSelection } from "../../../src/kilocode/cli/lazy-commands"
import yargs from "yargs"

describe("CLI bootstrap runtime selection", () => {
  beforeEach(resetLazyCommandSelection)
  afterEach(resetLazyCommandSelection)

  test("uses the narrow runtime for worker-backed TUI launches", () => {
    expect(KiloCli.workerTui({ _: [] })).toBe(true)
    expect(KiloCli.workerTui({ _: ["./project"] })).toBe(true)
  })

  test("keeps full bootstrap for explicit, mini, and worktree commands", () => {
    expect(KiloCli.workerTui({ _: [], mini: true })).toBe(false)
    expect(KiloCli.workerTui({ _: [], worktree: "feature" })).toBe(false)
  })

  test("keeps full bootstrap when the eager help command is selected", () => {
    const command = createHelpCommand()
    if (typeof command.builder !== "function") throw new Error("help builder is not a function")
    command.builder(yargs([]))
    expect(KiloCli.workerTui({ _: [] })).toBe(false)
  })
})
