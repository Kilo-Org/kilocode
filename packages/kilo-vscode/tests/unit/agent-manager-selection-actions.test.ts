import { describe, expect, it } from "bun:test"
import {
  rememberSelectionTab,
  selectLocalAction,
  selectWorktreeAction,
  type SelectionActionDeps,
} from "../../webview-ui/agent-manager/selection-actions"

function deps() {
  const calls: string[] = []
  const value: SelectionActionDeps<{ id: string }> = {
    saveTabMemory: () => {},
    setReviewActive: () => {},
    setSelection: () => {},
    post: () => {},
    tabMemory: () => ({}),
    terms: { hasRemembered: () => false, setActiveId: () => {} },
    nsKey: (id) => id,
    activateTerminal: () => {},
    setActivePendingId: () => {},
    focusLocal: (id) => calls.push(`local:${id}`),
    selectSession: (id) => calls.push(`select:${id}`),
    clearSession: () => {},
    resetSession: () => calls.push("reset"),
    isPending: () => false,
    isReviewTab: () => false,
  }
  return { calls, value }
}

describe("selectWorktreeAction", () => {
  it("selects a managed session before its metadata reaches the live store", () => {
    const result = deps()

    selectWorktreeAction(result.value, "wt-b", [], ["ses-b"])

    expect(result.calls).toEqual(["select:ses-b"])
  })

  it("restores a remembered managed session before choosing the first session", () => {
    const result = deps()
    result.value.tabMemory = () => ({ "wt-b": "ses-b2" })

    selectWorktreeAction(result.value, "wt-b", [{ id: "ses-b1" }], ["ses-b1", "ses-b2"])

    expect(result.calls).toEqual(["select:ses-b2"])
  })

  it("resets only when the project has no known session", () => {
    const result = deps()

    selectWorktreeAction(result.value, "wt-b", [])

    expect(result.calls).toEqual(["reset"])
  })
})

describe("selectLocalAction", () => {
  it("restores the remembered second local tab", () => {
    const result = deps()
    result.value.tabMemory = () => ({ local: "ses-a2" })

    selectLocalAction(result.value, [{ id: "ses-a1" }, { id: "ses-a2" }])

    expect(result.calls).toContain("local:ses-a2")
  })

  it("focuses a project session when shared session metadata is stale", () => {
    const result = deps()

    selectLocalAction(result.value, [], ["ses-b"])

    expect(result.calls).toContain("local:ses-b")
  })
})

describe("rememberSelectionTab", () => {
  it("stores the active tab under the sidebar context", () => {
    const calls: string[][] = []

    rememberSelectionTab((selection, tab) => calls.push([selection, tab]), "local", "ses-a2")

    expect(calls).toEqual([["local", "ses-a2"]])
  })
})
