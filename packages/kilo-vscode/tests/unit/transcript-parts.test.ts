import { describe, expect, it } from "bun:test"
import path from "node:path"

const WEBVIEW = path.resolve(import.meta.dir, "../../webview-ui")
const PASS = "TRANSCRIPT_PARTS_PASS"
const FAIL = "TRANSCRIPT_PARTS_FAIL:"

const SCRIPT = `
  import { Window } from "happy-dom"

  const window = new Window()
  globalThis.window = window
  globalThis.document = window.document
  globalThis.Node = window.Node
  globalThis.CustomEvent = window.CustomEvent

  const { isRenderable } = await import("./src/utils/transcript-parts.ts")
  const message = { id: "message-1", role: "assistant", time: { created: 1, completed: 2 } }
  const parts = [
    { id: "step-finish", type: "step-finish", reason: "stop" },
    { id: "empty-text", type: "text", text: "   " },
    { id: "synthetic-text", type: "text", text: "Synthetic", synthetic: true },
    { id: "visible-text", type: "text", text: "Visible transcript text" },
    { id: "redacted-reasoning", type: "reasoning", text: "[REDACTED]" },
    { id: "visible-reasoning", type: "reasoning", text: "Inspect the implementation" },
    { id: "todo-pending", type: "tool", tool: "todowrite", state: { status: "pending", input: {} } },
    {
      id: "todo-completed",
      type: "tool",
      tool: "todowrite",
      state: { status: "completed", input: {}, output: "done", title: "Updated todos" },
    },
    { id: "read-running", type: "tool", tool: "read", state: { status: "running", input: {} } },
    { id: "memory-running", type: "tool", tool: "kilo_memory_recall", state: { status: "running", input: {} } },
    {
      id: "memory-completed",
      type: "tool",
      tool: "kilo_memory_recall",
      state: { status: "completed", input: {}, output: "memory", title: "Memory recalled" },
    },
  ]
  const visible = parts.filter((part) => isRenderable(part, message)).map((part) => part.id)

  const fail = (reason) => {
    console.log("${FAIL}" + reason)
    process.exit(2)
  }
  const expected = [
    "visible-text",
    "visible-reasoning",
    "todo-completed",
    "read-running",
    "memory-running",
    "memory-completed",
  ]
  if (visible.length !== expected.length || visible.some((id, index) => id !== expected[index])) {
    fail("did not exclude transcript-invisible parts")
  }
  console.log("${PASS}")
`

describe("transcript parts", () => {
  it("keeps timeline candidates aligned with visible transcript parts", () => {
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
    expect.unreachable(`transcript parts test exited ${result.exitCode}: ${output.trim()}`)
  })
})
