// A new worktree takes the selection from the context the user is in. That context remembers its tab first, so a
// terminal main tab of Local comes back on return.
import { describe, expect, it } from "bun:test"
import { applySetupMessage } from "../webview-ui/agent-manager/app-messages"
import type { SetupState } from "../webview-ui/agent-manager/project/progress"
import type { ProjectStore } from "../webview-ui/agent-manager/project/store"

function scene(selection: string | null) {
  const calls: string[] = []
  let current = selection
  let setup: SetupState = { active: false, message: "" }
  const store = { setBusy: () => undefined } as unknown as ProjectStore
  const deps = {
    setup: () => setup,
    setSetup: (next: SetupState | ((prev: SetupState) => SetupState)) => {
      setup = typeof next === "function" ? next(setup) : next
    },
    creation: { setup: () => undefined },
    ensure: () => store,
    active: () => store,
    currentProjectId: () => "p",
    selection: () => current,
    isActivePayload: () => true,
    setSelection: (id: string) => {
      calls.push(`select:${id}`)
      current = id
    },
    setReviewActive: () => undefined,
    selectSession: (id: string) => calls.push(`session:${id}`),
    managedSessions: () => [],
    evictLocal: () => undefined,
    requestChatFocus: () => calls.push("focus"),
    saveTabMemory: () => calls.push(`save:${current}`),
  }
  return { calls, deps }
}

describe("worktree setup selection", () => {
  it("saves the tab of the context it leaves before selecting the new worktree", () => {
    const test = scene("local")

    applySetupMessage(
      { type: "agentManager.worktreeSetup", status: "creating", message: "", worktreeId: "wt-1" },
      test.deps,
    )
    applySetupMessage(
      { type: "agentManager.worktreeSetup", status: "starting", message: "", worktreeId: "wt-1" },
      test.deps,
    )

    expect(test.calls).toEqual(["save:local", "select:wt-1", "select:wt-1"])
  })

  it("saves the tab of the context it leaves before selecting the ready session", () => {
    const test = scene("local")

    applySetupMessage(
      { type: "agentManager.worktreeSetup", status: "ready", message: "", worktreeId: "wt-1", sessionId: "ses_1" },
      test.deps,
    )

    expect(test.calls).toEqual(["save:local", "session:ses_1", "select:wt-1", "focus"])
  })

  it("does not overwrite the memory of the new worktree on a later ready message", () => {
    const test = scene("wt-1")

    applySetupMessage(
      { type: "agentManager.worktreeSetup", status: "ready", message: "", worktreeId: "wt-1", sessionId: "ses_1" },
      test.deps,
    )

    expect(test.calls).toEqual(["session:ses_1", "select:wt-1", "focus"])
  })
})
