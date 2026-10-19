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

  it("reports live task status and keeps completed cards collapsed by default", () => {
    expect(taskRunning("pending")).toBe(true)
    expect(taskRunning("running")).toBe(true)
    expect(taskRunning("completed")).toBe(false)
    expect(readToolOpen(toolOpenKey({ tool: "task", partID: "part-new" }), taskRunning("completed"))).toBe(false)
  })

  it("keeps every task card collapsed while it runs", () => {
    expect(taskAutoOpen("pending", true)).toBe(false)
    expect(taskAutoOpen("running", true)).toBe(false)
    expect(taskAutoOpen("completed", true)).toBe(false)
  })

  it("treats task cards as background by default", () => {
    expect(taskBackground(undefined, undefined, undefined)).toBe(true)
    expect(taskBackground({}, {}, {})).toBe(true)
    expect(taskBackground({ background: "yes" }, {}, {})).toBe(true)
    expect(taskBackground({ background: true }, undefined, undefined)).toBe(true)
    expect(taskBackground({}, { background: true }, undefined)).toBe(true)
    expect(taskBackground({}, undefined, { background: true })).toBe(true)
    // Only an explicit legacy false flag opts a task out.
    expect(taskBackground({ background: true }, { background: false }, { background: false })).toBe(false)
    expect(taskBackground({}, { background: false }, { background: true })).toBe(false)
    expect(taskBackground({}, { background: true }, { background: false })).toBe(false)
  })

  it("keeps expansion state isolated by copied part ID", () => {
    const source = { tool: "task", partID: "part-source", defaultOpen: false }
    const fork = { tool: "task", partID: "part-fork", defaultOpen: false }
    writeToolOpen(toolOpenKey(source), true)

    expect(readToolOpen(toolOpenKey(source), source.defaultOpen)).toBe(true)
    expect(readToolOpen(toolOpenKey(fork), fork.defaultOpen)).toBe(false)
  })

  it("keeps a background card collapsed when it remounts", () => {
    // An earlier open value must not reopen a background card.
    writeToolOpen(toolOpenKey({ tool: "task", partID: "part-background" }), true)
    const next = taskStoredOpen(false, true, false)
    expect(next).toBe(false)
    const key = toolOpenKey({ tool: "task", partID: "part-background" })
    if (next !== undefined) writeToolOpen(key, next)
    // The stored false wins over an open fallback, so the remount stays shut.
    expect(readToolOpen(key, true)).toBe(false)
  })

  it("leaves a user-controlled card alone", () => {
    // A manual toggle or search match owns the state.
    expect(taskStoredOpen(true, true, true)).toBeUndefined()
    expect(taskStoredOpen(false, true, true)).toBeUndefined()
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
