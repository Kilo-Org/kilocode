import { afterEach, describe, expect, it, jest } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { createRoot, createSignal } from "solid-js"
import { Window } from "happy-dom"
import { bindAppKeys, type AppActionHandlers } from "../webview-ui/agent-manager/app-keys"
import { createWorktreeDelete } from "../webview-ui/agent-manager/worktree-delete"
import { createProjectStore } from "../webview-ui/agent-manager/project/store"

function setupDelete(overrides: { busy?: boolean; blocked?: boolean; run?: "running" | "stopping" } = {}) {
  const store = createProjectStore("p")
  store.applyState({
    type: "agentManager.state",
    projectId: "p",
    worktrees: [
      { id: "wt-a", branch: "a", path: "/wt-a", parentBranch: "main", createdAt: "2026-01-01T00:00:00Z" },
      { id: "wt-b", branch: "b", path: "/wt-b", parentBranch: "main", createdAt: "2026-01-01T00:00:00Z" },
    ],
    sessions: [],
    worktreeOrder: ["wt-a", "wt-b"],
    runStatuses: overrides.run ? [{ worktreeId: "wt-a", state: overrides.run }] : [],
  })
  const [project] = createSignal<string | undefined>("p")
  const [selection] = createSignal<string | undefined>("wt-a")
  const calls: string[] = []
  const [deletion, dispose] = createRoot((dispose) => {
    const deletion = createWorktreeDelete({
      store: (id) => (id === "p" ? store : undefined),
      project,
      selection,
      busy: () => overrides.busy ?? false,
      blocked: () => overrides.blocked ?? false,
      select: (target) => {
        if (target.kind === "local") return calls.push(`select:${target.projectId}:local`)
        if (target.kind === "worktree")
          return calls.push(`select:${target.projectId}:${target.worktreeId}`)
        return calls.push(`select:${target.projectId}:session:${target.sessionId}`)
      },
      remove: (projectId, worktreeId) => calls.push(`remove:${projectId}:${worktreeId}`),
      reveal: (projectId, worktreeId) => calls.push(`reveal:${projectId}:${worktreeId}`),
    })
    return [deletion, dispose] as const
  })
  return { deletion, calls, dispose }
}

describe("worktree delete confirmation", () => {
  it("arms the selected worktree without deleting it", () => {
    const test = setupDelete()

    test.deletion.confirm("p", "wt-a")

    expect(test.deletion.pending()).toEqual({ projectId: "p", worktreeId: "wt-a" })
    expect(test.calls).toEqual(["reveal:p:wt-a"])
    test.dispose()
  })

  it("keeps the confirmation armed across repeated arm commands", () => {
    const test = setupDelete()

    test.deletion.arm("p", "wt-a")
    test.deletion.arm("p", "wt-a")

    expect(test.deletion.pending()).toEqual({ projectId: "p", worktreeId: "wt-a" })
    expect(test.calls).toEqual(["reveal:p:wt-a"])
    test.dispose()
  })

  it("refreshes the confirmation window without confirming a repeated arm", () => {
    jest.useFakeTimers()
    const test = setupDelete()
    try {
      test.deletion.arm("p", "wt-a")
      jest.advanceTimersByTime(2400)
      test.deletion.arm("p", "wt-a")
      jest.advanceTimersByTime(2499)

      expect(test.deletion.pending()).toEqual({ projectId: "p", worktreeId: "wt-a" })
      expect(test.calls).toEqual(["reveal:p:wt-a"])

      jest.advanceTimersByTime(1)
      expect(test.deletion.pending()).toBeUndefined()
    } finally {
      test.dispose()
      jest.useRealTimers()
    }
  })

  it("deletes when a confirmation follows an arm", () => {
    const test = setupDelete()

    test.deletion.arm("p", "wt-a")
    test.deletion.confirm("p", "wt-a")

    expect(test.calls).toEqual(["reveal:p:wt-a", "remove:p:wt-a", "select:p:local"])
    expect(test.deletion.pending()).toBeUndefined()
    test.dispose()
  })

  it("moves the confirmation to the worktree that was armed last", () => {
    const test = setupDelete()

    test.deletion.arm("p", "wt-a")
    test.deletion.arm("p", "wt-b")

    expect(test.deletion.pending()).toEqual({ projectId: "p", worktreeId: "wt-b" })
    expect(test.calls).toEqual(["reveal:p:wt-a", "reveal:p:wt-b"])
    test.dispose()
  })

  it("expires the confirmation after the existing timeout", () => {
    jest.useFakeTimers()
    try {
      const test = setupDelete()

      test.deletion.arm("p", "wt-a")
      expect(test.deletion.pending()).toEqual({ projectId: "p", worktreeId: "wt-a" })

      jest.advanceTimersByTime(2499)
      expect(test.deletion.pending()).toEqual({ projectId: "p", worktreeId: "wt-a" })

      jest.advanceTimersByTime(1)
      expect(test.deletion.pending()).toBeUndefined()
      test.dispose()
    } finally {
      jest.useRealTimers()
    }
  })

  it("does not arm a worktree that is busy, blocked, or running", () => {
    for (const overrides of [{ busy: true }, { blocked: true }, { run: "running" as const }]) {
      const test = setupDelete(overrides)

      test.deletion.arm("p", "wt-a")

      expect(test.deletion.pending()).toBeUndefined()
      expect(test.calls).toEqual([])
      test.dispose()
    }
  })
})

const original = {
  document: globalThis.document,
  window: globalThis.window,
}

function setupWindow() {
  const view = new Window()
  globalThis.document = view.document as unknown as typeof globalThis.document
  globalThis.window = view as unknown as typeof globalThis.window
  return view
}

afterEach(() => {
  globalThis.document = original.document
  globalThis.window = original.window
})

function bind(view: Window, opts: { arm: () => void; confirm: () => void; selection?: () => string | null }) {
  const handlers = { closeWorktree: opts.arm } as Partial<AppActionHandlers> as AppActionHandlers
  const dispose = bindAppKeys({
    handlers,
    openHistory: () => {},
    press: () => false,
    isDiffFocusTarget: () => false,
    selection: opts.selection ?? (() => "wt-a"),
    confirmWorktree: opts.confirm,
    setHeld: () => true,
    focusReport: () => {},
    restoreFocus: () => {},
    terminalFocused: () => false,
    createDraft: () => ({ id: "draft" }),
    setActiveTerminal: () => {},
    postToWorktree: () => {},
    cleanupDrafts: () => {},
  })
  return () => {
    dispose()
    view.close()
  }
}

function key(view: Window, init: { key: string; repeat?: boolean }) {
  const event = new view.KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init })
  view.document.body.dispatchEvent(event)
  return event
}

function hostAction(view: Window, action: string) {
  view.dispatchEvent(new view.MessageEvent("message", { data: { type: "action", action } }))
}

describe("Agent Manager delete keys", () => {
  it("confirms a delete on a distinct Delete press", () => {
    const view = setupWindow()
    let confirmed = 0
    const dispose = bind(view, { arm: () => {}, confirm: () => confirmed++ })

    const event = key(view, { key: "Delete" })

    expect(event.defaultPrevented).toBe(true)
    expect(confirmed).toBe(1)
    dispose()
  })

  it("confirms a delete on a distinct Backspace press", () => {
    const view = setupWindow()
    let confirmed = 0
    const dispose = bind(view, { arm: () => {}, confirm: () => confirmed++ })

    const event = key(view, { key: "Backspace" })

    expect(event.defaultPrevented).toBe(true)
    expect(confirmed).toBe(1)
    dispose()
  })

  it("prevents the browser default but does not confirm a repeated Delete or Backspace", () => {
    const view = setupWindow()
    let confirmed = 0
    const dispose = bind(view, { arm: () => {}, confirm: () => confirmed++ })

    const del = key(view, { key: "Delete", repeat: true })
    const backspace = key(view, { key: "Backspace", repeat: true })

    expect(del.defaultPrevented).toBe(true)
    expect(backspace.defaultPrevented).toBe(true)
    expect(confirmed).toBe(0)
    dispose()
  })

  it("leaves Delete alone in a text field", () => {
    const view = setupWindow()
    let confirmed = 0
    const input = view.document.createElement("input")
    view.document.body.append(input)
    const dispose = bind(view, { arm: () => {}, confirm: () => confirmed++ })

    const event = new view.KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true })
    input.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(false)
    expect(confirmed).toBe(0)
    dispose()
  })

  it("leaves Delete alone when a project-local item is selected", () => {
    const view = setupWindow()
    let confirmed = 0
    const dispose = bind(view, {
      arm: () => {},
      confirm: () => confirmed++,
      selection: () => "local",
    })

    const event = key(view, { key: "Delete" })

    expect(event.defaultPrevented).toBe(false)
    expect(confirmed).toBe(0)
    dispose()
  })

  it("only arms the confirmation for repeated host closeWorktree commands", () => {
    const view = setupWindow()
    let armed = 0
    let confirmed = 0
    const dispose = bind(view, { arm: () => armed++, confirm: () => confirmed++ })

    hostAction(view, "closeWorktree")
    hostAction(view, "closeWorktree")

    expect(armed).toBe(2)
    expect(confirmed).toBe(0)
    dispose()
  })
})

describe("Agent Manager delete wiring", () => {
  it("routes host commands to arm and direct keys to confirm", () => {
    const app = readFileSync(
      resolve(import.meta.dir, "../webview-ui/agent-manager/AgentManagerApp.tsx"),
      "utf8",
    ).replace(/\r\n/g, "\n")

    expect(app).toContain('closeWorktree: () => closeSelectedWorktree("arm")')
    expect(app).toContain('confirmWorktree: () => closeSelectedWorktree("confirm")')
    expect(app).toContain('if (list.length === 0) {\n      closeSelectedWorktree("arm")')
  })
})
