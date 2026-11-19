import { expect, test } from "bun:test"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { createReview } from "../src/hosted/review"

const target = {
  scope: "account+repository",
  providerID: "kilo-cloud",
  workspaceID: "workspace",
  sessionID: "chat",
} as const
const signal = new AbortController().signal
const selection = { path: "src/a b.ts", scope: "against-base-branch", revision: 4 } as const
const entry = {
  ...selection,
  binary: false,
  countsComplete: true,
  status: "modified",
  additions: 1,
  deletions: 1,
} as const
const snapshot = { files: [entry], revision: 9, truncated: false, capturedAt: "2026-11-02T11:00:00.000Z" }
const record = {
  ...selection,
  diff: { status: "available", patch: "@@ -1 +1 @@\n-before\n+after\n" },
  content: { status: "available", source: "current", text: "after\n" },
} as const
const envelope = (data: unknown) => Response.json({ result: { data } })

test("reads the saved summary and selected file revision passively; an explicit offline refresh preserves the capture", async () => {
  const calls: string[] = []
  const authorize = async (t: KiloHostedRpc.Target, s: AbortSignal) => {
    expect(t).toEqual(target)
    expect(s).toBe(signal)
    return "private-control"
  }
  const review = createReview(authorize, async (route, init) => {
    const url = new URL(route, "https://fixture.invalid")
    calls.push(`${init.method} ${url.pathname}`)
    const input = JSON.parse(init.method === "GET" ? url.searchParams.get("input")! : String(init.body))
    if (url.pathname.endsWith("/getWorktreeFile")) {
      expect(input).toEqual({
        cloudAgentSessionId: "private-control",
        path: selection.path,
        scope: selection.scope,
        expectedRevision: selection.revision,
      })
      return envelope({
        status: "available",
        file: { ...record, internal: "private" },
        comparison: { hidden: "private" },
      })
    }
    expect(input).toEqual({ cloudAgentSessionId: "private-control" })
    return envelope({
      ...(init.method === "POST" && { status: "offline" }),
      snapshot: { ...snapshot, internal: "private" },
    })
  })
  expect(await review.changes({ target }, signal)).toEqual({ snapshot })
  expect(await review.file({ target, selection }, signal)).toEqual({
    status: "available",
    file: { ...record, patchHash: "bd7083b1ee52dc6d600de3326b08986fd3c5cd430fe37d5a19b6593d4ed10fef" },
  })
  expect(await review.changes({ target, refresh: true }, signal)).toEqual({ refresh: "offline", snapshot })
  expect(calls).toEqual([
    "GET /trpc/getWorktreeChanges",
    "GET /trpc/getWorktreeFile",
    "POST /trpc/refreshWorktreeChanges",
  ])
})

test("never uses the file grant of a different path, scope, or revision; preserves stale and omission states", async () => {
  let response: unknown
  const review = createReview(
    async () => "control",
    async () => envelope(response),
  )
  for (const wrong of [{ path: "another" }, { scope: "uncommitted" }, { revision: 5 }]) {
    response = { status: "available", file: { ...record, ...wrong } }
    await expect(review.file({ target, selection }, signal)).rejects.toThrow("invalid response")
  }
  for (const valid of [
    { status: "stale", currentRevision: 5 },
    { status: "no_longer_listed", currentRevision: 7 },
    { status: "not_captured" },
    {
      status: "omitted",
      file: {
        ...record,
        diff: { status: "omitted", reason: "binary" },
        content: { status: "unavailable", reason: "binary" },
      },
    },
  ] as const) {
    response = valid
    expect(await review.file({ target, selection }, signal)).toEqual(valid)
  }
})

test("a refused workspace does not reach any review endpoint", async () => {
  let called = false
  const review = createReview(
    async () => {
      throw new Error("workspace mismatch")
    },
    async () => {
      called = true
      return envelope({ snapshot: null })
    },
  )
  await expect(review.changes({ target, refresh: true }, signal)).rejects.toThrow("workspace mismatch")
  await expect(review.file({ target, selection }, signal)).rejects.toThrow("workspace mismatch")
  expect(called).toBe(false)
})
