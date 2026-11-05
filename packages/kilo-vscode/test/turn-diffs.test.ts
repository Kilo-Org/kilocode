import { describe, expect, test } from "bun:test"
import type { FileDiffInfo } from "@opencode/client"
import { createTurnDiffs, type TurnDiffFetch, type TurnDiffQuery } from "../webview-ui/src/v2/turn-diffs"

function changed(file: string): FileDiffInfo {
  return { file, patch: "", additions: 1, deletions: 1, status: "modified" }
}

function record() {
  const calls: TurnDiffQuery[] = []
  const fetch: TurnDiffFetch = (query) => {
    calls.push(query)
    return Promise.resolve([changed(`${query.from}.ts`)])
  }
  return { calls, fetch }
}

describe("createTurnDiffs", () => {
  test("reads a turn once and reuses the cache", async () => {
    const cache = createTurnDiffs()
    const run = record()

    const first = await cache.request("ses_1", "msg_1", run.fetch)
    const second = await cache.request("ses_1", "msg_1", run.fetch)

    expect(run.calls).toEqual([{ sessionID: "ses_1", from: "msg_1", context: 0 }])
    expect(second).toBe(first)
    expect(cache.read("ses_1", "msg_1")).toBe(first)
  })

  test("keeps turns and sessions apart", async () => {
    const cache = createTurnDiffs()
    const run = record()

    await cache.request("ses_1", "msg_1", run.fetch)
    await cache.request("ses_1", "msg_2", run.fetch)
    await cache.request("ses_2", "msg_1", run.fetch)

    expect(run.calls).toHaveLength(3)
    expect(cache.read("ses_1", "msg_2")?.[0]?.file).toBe("msg_2.ts")
    expect(cache.read("ses_2", "msg_1")?.[0]?.file).toBe("msg_1.ts")
    expect(cache.read("ses_2", "msg_2")).toBeUndefined()
  })

  test("joins a request that is still running", async () => {
    const cache = createTurnDiffs()
    let finish: (files: FileDiffInfo[]) => void = () => {}
    let calls = 0
    const fetch: TurnDiffFetch = () => {
      calls++
      return new Promise((resolve) => {
        finish = resolve
      })
    }

    const first = cache.request("ses_1", "msg_1", fetch)
    const second = cache.request("ses_1", "msg_1", fetch)
    finish([changed("late.ts")])

    expect(await second).toBe(await first)
    expect(calls).toBe(1)
  })
})
