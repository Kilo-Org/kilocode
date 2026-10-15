import { beforeEach, describe, expect, it } from "bun:test"
import {
  readToolOpen,
  resetToolOpenState,
  toolOpenKey,
  writeToolOpen,
} from "../../../kilo-ui/src/components/tool-open-state"
import {
  taskAutoOpen,
  taskBackground,
  taskResult,
  taskRunning,
  taskStoredOpen,
  taskVisible,
} from "../../webview-ui/src/components/chat/task-tool-state"

describe("completed task hydration", () => {
  beforeEach(() => resetToolOpenState())

  it("opens running tasks and collapses completed tasks by default", () => {
    expect(taskRunning("pending")).toBe(true)
    expect(taskRunning("running")).toBe(true)
    expect(taskRunning("completed")).toBe(false)
    expect(readToolOpen(toolOpenKey({ tool: "task", partID: "part-new" }), taskRunning("completed"))).toBe(false)
  })

  it("keeps a pending or running background task collapsed", () => {
    expect(taskAutoOpen("pending", true)).toBe(false)
    expect(taskAutoOpen("running", true)).toBe(false)
    expect(taskAutoOpen("running", false)).toBe(true)
    expect(taskAutoOpen("pending", false)).toBe(false)
    expect(taskAutoOpen("completed", false)).toBe(false)
  })

  it("reads the background flag from the streamed input before metadata lands", () => {
    expect(taskBackground({ background: true }, undefined, undefined)).toBe(true)
    expect(taskBackground({ background: true }, { background: false }, { background: false })).toBe(true)
    expect(taskBackground({}, { background: true }, undefined)).toBe(true)
    expect(taskBackground({}, undefined, { background: true })).toBe(true)
    // partMetadata false shadows later state metadata, matching the original lookup
    expect(taskBackground({}, { background: false }, { background: true })).toBe(false)
    expect(taskBackground({}, { background: true }, { background: false })).toBe(true)
    expect(taskBackground({}, undefined, undefined)).toBe(false)
    expect(taskBackground(undefined, undefined, undefined)).toBe(false)
    expect(taskBackground({}, {}, {})).toBe(false)
    expect(taskBackground({ background: "yes" }, {}, {})).toBe(false)
  })

  it("keeps expansion state isolated by copied part ID", () => {
    const source = { tool: "task", partID: "part-source", defaultOpen: false }
    const fork = { tool: "task", partID: "part-fork", defaultOpen: false }
    writeToolOpen(toolOpenKey(source), true)

    expect(readToolOpen(toolOpenKey(source), source.defaultOpen)).toBe(true)
    expect(readToolOpen(toolOpenKey(fork), fork.defaultOpen)).toBe(false)
  })

  it("keeps an auto-opened card open when it remounts after completion", () => {
    // The running card auto-opens and persists that decision.
    expect(taskAutoOpen("running", false)).toBe(true)
    const next = taskStoredOpen(taskAutoOpen("running", false), false, false)
    expect(next).toBe(true)
    const key = toolOpenKey({ tool: "task", partID: "part-live" })
    if (next !== undefined) writeToolOpen(key, next)
    // Handed to the virtualizer once completed: the remount must not collapse it.
    expect(readToolOpen(key, taskAutoOpen("completed", false))).toBe(true)
  })

  it("stays collapsed when a promoted background card remounts", () => {
    // A foreground card auto-opens, then is promoted to background and collapses.
    writeToolOpen(toolOpenKey({ tool: "task", partID: "part-promoted" }), true)
    const next = taskStoredOpen(false, true, false)
    expect(next).toBe(false)
    const key = toolOpenKey({ tool: "task", partID: "part-promoted" })
    if (next !== undefined) writeToolOpen(key, next)
    // The stored false wins over an open fallback, so the remount stays shut.
    expect(readToolOpen(key, true)).toBe(false)
  })

  it("leaves a user-controlled or settled card alone", () => {
    // A manual toggle or search match owns the state.
    expect(taskStoredOpen(true, false, true)).toBeUndefined()
    expect(taskStoredOpen(false, true, true)).toBeUndefined()
    // A settled foreground card has nothing to store, so its state stands.
    expect(taskStoredOpen(false, false, false)).toBeUndefined()
  })

  it("hydrates and streams a child only while expanded", () => {
    expect(taskVisible(false, "ses_child")).toBeUndefined()
    expect(taskVisible(true, "ses_child")).toBe("ses_child")
    expect(taskVisible(true, undefined)).toBeUndefined()
  })

  it("renders the retained result when a fork has no child session", () => {
    const output = "task_id: stale\n\n<task_result>\nchild outcome\n</task_result>"
    expect(taskResult(output, undefined)).toBe("child outcome")
    expect(taskResult(output, "ses_child")).toBeUndefined()
    expect(taskResult("plain output", undefined)).toBe("plain output")
  })
})
