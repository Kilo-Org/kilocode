import { expect, test } from "bun:test"
import { Effect, Exit } from "effect"
import { KiloSessionRevert } from "@/kilocode/session/revert"
import { Snapshot } from "@/snapshot"

test("failed checkpoint restore compensates back to the pre-rewind state", async () => {
  let state = "after"
  const snapshot: Snapshot.Interface = {
    init: () => Effect.void,
    cleanup: () => Effect.void,
    track: () => Effect.succeed("current"),
    patch: (hash) => Effect.succeed({ hash, files: [] }),
    restore: () => Effect.sync(() => void (state = "after")),
    revert: () =>
      Effect.sync(() => void (state = "partially-restored")).pipe(
        Effect.andThen(Effect.die(new Error("checkout failed"))),
      ),
    diff: () => Effect.succeed(""),
    diffFull: () => Effect.succeed([]),
  }

  const exit = await Effect.runPromise(
    KiloSessionRevert.apply(snapshot, [{ hash: "tree", files: ["a", "b"] }], "baseline").pipe(Effect.exit),
  )

  expect(Exit.isFailure(exit)).toBe(true)
  expect(state).toBe("after")
})
