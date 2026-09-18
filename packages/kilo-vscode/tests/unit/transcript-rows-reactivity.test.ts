import { describe, expect, it } from "bun:test"
import path from "node:path"

const WEBVIEW = path.resolve(import.meta.dir, "../../webview-ui")
const PASS = "TRANSCRIPT_ROWS_REACTIVITY_PASS"
const FAIL = "TRANSCRIPT_ROWS_REACTIVITY_FAIL:"

const SCRIPT = `
  const { createMemo } = await import("solid-js")
  const { createStore } = await import("solid-js/store")
  const { PartStash } = await import("./src/context/part-stash.ts")
  const { messageTurns } = await import("./src/context/session-queue.ts")
  const { transcriptRows } = await import("./src/context/transcript-rows.ts")

  const fail = (reason) => {
    console.log("${FAIL}" + reason)
    process.exit(2)
  }
  const user = { id: "u1", sessionID: "session", role: "user", createdAt: "2026-01-01T00:00:00.000Z" }
  const turns = messageTurns([user])
  const stash = new PartStash()
  stash.put("u1", [{ id: "context", messageID: "u1", type: "text", text: "Attachment context", synthetic: true }])
  const [store, setStore] = createStore({ parts: {} })
  const get = (id) => stash.read(id, store.parts)
  const rows = createMemo(() => transcriptRows(turns, get, { queued: new Set(["u1"]) }))

  if (rows().length !== 0) fail("synthetic context created a queued row")
  stash.remove("u1")
  setStore("parts", "u1", [{ id: "prompt", messageID: "u1", type: "text", text: "Visible prompt" }])
  if (rows().length !== 1 || rows()[0]?.type !== "user") fail("canonical part did not invalidate rows")
  console.log("${PASS}")
`

describe("transcript rows reactivity", () => {
  it("invalidates a memo when a stashed synthetic prefix is promoted", () => {
    const result = Bun.spawnSync([process.execPath, "--conditions=browser", "-e", SCRIPT], {
      cwd: WEBVIEW,
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = result.stdout.toString() + result.stderr.toString()

    if (result.exitCode === 0 && output.includes(PASS)) return
    const index = output.indexOf(FAIL)
    if (index !== -1) {
      expect.unreachable(
        output
          .slice(index + FAIL.length)
          .split("\n")[0]
          ?.trim(),
      )
    }
    expect.unreachable(`transcript rows reactivity test exited ${result.exitCode}: ${output.trim()}`)
  })
})
