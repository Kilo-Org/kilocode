import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { SnapshotPin } from "@/kilocode/snapshot/pin"

describe("SnapshotPin", () => {
  test("extends the durable snapshot ref", async () => {
    const calls: string[][] = []
    const ok = await Effect.runPromise(
      SnapshotPin.pin("tree-next", (cmd) => {
        calls.push(cmd)
        if (cmd[0] === "rev-parse") return Effect.succeed({ code: 0, text: "commit-prev\n", stderr: "" })
        if (cmd[0] === "show") return Effect.succeed({ code: 0, text: "tree-prev\n", stderr: "" })
        if (cmd[0] === "commit-tree") return Effect.succeed({ code: 0, text: "commit-next\n", stderr: "" })
        return Effect.succeed({ code: 0, text: "", stderr: "" })
      }),
    )

    expect(ok).toBe(true)
    expect(calls).toContainEqual(["commit-tree", "tree-next", "-p", "commit-prev", "-m", "tree-next"])
    expect(calls.at(-1)).toEqual(["update-ref", "refs/kilo/snapshots", "commit-next", "commit-prev"])
  })

  test("creates the durable ref with an all-zero expected value", async () => {
    const calls: string[][] = []
    const ok = await Effect.runPromise(
      SnapshotPin.pin("tree", (cmd) => {
        calls.push(cmd)
        if (cmd[0] === "rev-parse") return Effect.succeed({ code: 1, text: "", stderr: "" })
        if (cmd[0] === "commit-tree") return Effect.succeed({ code: 0, text: "commit\n", stderr: "" })
        return Effect.succeed({ code: 0, text: "", stderr: "" })
      }),
    )

    expect(ok).toBe(true)
    expect(calls.at(-1)).toEqual([
      "update-ref",
      "refs/kilo/snapshots",
      "commit",
      "0000000000000000000000000000000000000000",
    ])
  })

  test("fails closed when the snapshot ref cannot be read", async () => {
    const ok = await Effect.runPromise(
      SnapshotPin.pin("tree", () => Effect.succeed({ code: 128, text: "", stderr: "corrupt" })),
    )

    expect(ok).toBe(false)
  })

  test("fails closed when the snapshot cannot be pinned", async () => {
    const ok = await Effect.runPromise(
      SnapshotPin.pin("tree", (cmd) =>
        Effect.succeed({ code: cmd[0] === "commit-tree" ? 1 : 0, text: "", stderr: "failed" }),
      ),
    )

    expect(ok).toBe(false)
  })
})
