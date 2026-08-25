import { describe, expect, test } from "bun:test"
import { KiloCli } from "../../../src/kilocode/cli/setup"

describe("CLI bootstrap runtime selection", () => {
  test("uses the narrow runtime for worker-backed TUI launches", () => {
    expect(KiloCli.workerTui({ _: [] })).toBe(true)
    expect(KiloCli.workerTui({ _: ["./project"] })).toBe(true)
  })

  test("keeps full bootstrap for explicit, mini, and worktree commands", () => {
    expect(KiloCli.workerTui({ _: [], mini: true })).toBe(false)
    expect(KiloCli.workerTui({ _: [], worktree: "feature" })).toBe(false)
  })
})
