import { describe, expect } from "bun:test"
import { Effect, Fiber } from "effect"
import * as TestClock from "effect/testing/TestClock"
import { codebaseSearchTimeoutMessage, isWorkspaceRoot, runWarpGrep } from "../../src/tool/warpgrep"
import { it } from "../lib/effect"

describe("tool.codebase_search", () => {
  it.effect("rejects a workspace root without waiting on search", () =>
    Effect.gen(function* () {
      expect(isWorkspaceRoot("/")).toBe(true)
      expect(codebaseSearchTimeoutMessage("/")).toContain("Open the concrete project folder or rebuild the index")

      const result = yield* runWarpGrep("needle", "/", () => {
        throw new Error("should not execute for a root workspace")
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain("Codebase search stopped after 5 minutes")
      expect(result.contexts).toEqual([])
    }),
  )

  it.effect("returns a timeout result when the search callback never settles", () =>
    Effect.gen(function* () {
      const fiber = yield* runWarpGrep("needle", "/workspace", () => new Promise(() => {})).pipe(Effect.forkChild)

      yield* TestClock.adjust("5 minutes")
      const result = yield* Fiber.join(fiber)

      expect(result.success).toBe(false)
      expect(result.error).toContain("Codebase search stopped after 5 minutes")
      expect(result.error).toContain("/workspace")
    }),
  )
})
