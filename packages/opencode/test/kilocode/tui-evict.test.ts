import { describe, expect, test } from "bun:test"
import path from "node:path"

const file = path.resolve(import.meta.dir, "../../src/cli/cmd/tui/context/sync.tsx")

describe("tui session eviction", () => {
  test("clears prompt state when evicting a session", async () => {
    const src = await Bun.file(file).text()
    const block = src.match(/function evict\(sessionID: string\) \{[\s\S]*?fullSyncedSessions\.delete\(sessionID\)/)?.[0]

    expect(block).toContain("delete draft.permission[sessionID]")
    expect(block).toContain("delete draft.question[sessionID]")
  })
})
