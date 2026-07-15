import { describe, expect, test } from "bun:test"
import { Cause, Effect, Exit } from "effect"
import { RepositoryCache } from "@opencode-ai/core/repository-cache"
import * as Reference from "../../src/kilocode/reference"

function remote() {
  const item = Reference.resolveAll({
    references: { docs: "Kilo-Org/kilocode" },
    directory: "/workspace",
    worktree: "/workspace",
  })[0]
  if (!item || item.kind !== "git") throw new Error("expected Git reference")
  return item
}

describe("configured references", () => {
  test("preserves interruption while materializing a repository", async () => {
    const cache = RepositoryCache.Service.of({ ensure: () => Effect.interrupt })
    const exit = await Effect.runPromiseExit(Reference.ensure(cache, remote()))

    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(Cause.hasInterruptsOnly(exit.cause)).toBe(true)
  })
})
