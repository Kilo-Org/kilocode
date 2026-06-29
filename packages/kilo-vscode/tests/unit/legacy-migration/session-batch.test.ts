import { describe, expect, it } from "bun:test"
import { runSessionBatch } from "../../../src/legacy-migration/session-batch"

const sessions = [
  { id: "one", title: "One", directory: "/repo", time: 2 },
  { id: "two", title: "Two", directory: "/repo", time: 1 },
]

describe("migration session batch", () => {
  it("uses consistent progress, skipped, error, and summary semantics", async () => {
    const progress: unknown[] = []
    const phases: unknown[] = []
    const results = await runSessionBatch({
      selections: [{ id: "one" }, { id: "two" }],
      sessions,
      resolve: (id) => ({ id, dir: "/tasks" }),
      migrate: async (selection) =>
        selection.id === "one" ? { ok: true, skipped: true } : { ok: false, message: "broken" },
      onProgress: (...args) => progress.push(args),
      onSessionProgress: (value) => phases.push(value),
      delay: async () => undefined,
    })

    expect(results).toEqual([
      { item: "One", category: "session", status: "warning", message: "Already imported." },
      { item: "Two", category: "session", status: "error", message: "broken" },
    ])
    expect(progress).toEqual([
      ["one", "migrating"],
      ["one", "warning", "Already imported."],
      ["two", "migrating"],
      ["two", "error", "broken"],
    ])
    expect(phases.at(-1)).toMatchObject({ session: sessions[1], index: 2, total: 2, phase: "summary" })
  })
})
