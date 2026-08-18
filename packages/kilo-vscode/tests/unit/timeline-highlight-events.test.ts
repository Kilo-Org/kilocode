import { describe, expect, it } from "bun:test"
import path from "node:path"

const WEBVIEW = path.resolve(import.meta.dir, "../../webview-ui")
const PASS = "TIMELINE_HIGHLIGHT_EVENTS_PASS"
const FAIL = "TIMELINE_HIGHLIGHT_EVENTS_FAIL:"

const SCRIPT = `
  import { Window } from "happy-dom"

  const window = new Window()
  globalThis.window = window
  globalThis.CustomEvent = window.CustomEvent

  const { dispatchTimelineHighlight, onTimelineHighlight, same } = await import("./src/utils/timeline/highlight.ts")
  const values = []
  const dispose = onTimelineHighlight((value) => values.push(value))
  const value = { msgId: "message-1", partId: "part-1" }
  dispatchTimelineHighlight(value)
  dispose()
  dispatchTimelineHighlight(undefined)

  const fail = (reason) => {
    console.log("${FAIL}" + reason)
    process.exit(2)
  }
  if (values.length !== 1) fail("listener was not cleaned up")
  if (values[0]?.msgId !== value.msgId || values[0]?.partId !== value.partId) {
    fail("listener received the wrong highlight")
  }
  if (!same(value, { ...value }) || same(value, { ...value, partId: "part-2" })) {
    fail("highlight identity comparison is incorrect")
  }
  console.log("${PASS}")
`

describe("timeline highlight events", () => {
  it("delivers a highlight once and removes its listener", () => {
    const result = Bun.spawnSync(["bun", "--conditions=browser", "-e", SCRIPT], {
      cwd: WEBVIEW,
      stdout: "pipe",
      stderr: "pipe",
    })
    const output = result.stdout.toString() + result.stderr.toString()

    if (output.includes(PASS)) return
    const index = output.indexOf(FAIL)
    if (index !== -1) {
      expect.unreachable(
        output
          .slice(index + FAIL.length)
          .split("\n")[0]
          ?.trim(),
      )
    }
    expect.unreachable(`timeline highlight events test exited ${result.exitCode}: ${output.trim()}`)
  })
})
