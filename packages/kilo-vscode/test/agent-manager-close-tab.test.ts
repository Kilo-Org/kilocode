import { describe, expect, it } from "bun:test"
import { closeSessionTab } from "../webview-ui/agent-manager/app-tabs"
import { nextTabAfterClose } from "../webview-ui/src/utils/local-tabs"

function close(input: {
  sessionId: string
  order: string[]
  active?: string
  local?: string[]
  pending?: string[]
  notify?: boolean
}) {
  const calls: string[] = []
  closeSessionTab({
    sessionId: input.sessionId,
    notify: input.notify,
    order: input.order,
    isActive: (input.active ?? input.sessionId) === input.sessionId,
    next: nextTabAfterClose(input.order, input.sessionId),
    isPending: (id) => (input.pending ?? []).includes(id),
    setActivePending: (id) => calls.push(`pending:${id ?? "none"}`),
    clearSession: () => calls.push("clear"),
    selectSession: (id) => calls.push(`select:${id}`),
    forgetFocus: (id) => calls.push(`forget:${id}`),
    local: new Set(input.local ?? []),
    dismiss: (id) => calls.push(`dismiss:${id}`),
    removeLocal: (id) => calls.push(`remove:${id}`),
    postClose: (id) => calls.push(`post:${id}`),
    restoreFocus: () => calls.push("restore"),
  })
  return calls
}

describe("closeSessionTab", () => {
  it("dismisses the only worktree tab before clearing the shown session", () => {
    const calls = close({ sessionId: "ses-one", order: ["ses-one"] })

    expect(calls).toEqual(["dismiss:ses-one", "pending:none", "clear", "forget:ses-one", "post:ses-one", "restore"])
    expect(calls.indexOf("dismiss:ses-one")).toBeLessThan(calls.indexOf("clear"))
  })

  it("selects the next tab and dismisses the closed one", () => {
    const calls = close({ sessionId: "ses-one", order: ["ses-one", "ses-two"] })

    expect(calls).toEqual([
      "dismiss:ses-one",
      "pending:none",
      "select:ses-two",
      "forget:ses-one",
      "post:ses-one",
      "restore",
    ])
  })

  it("dismisses an inactive worktree tab without changing the shown session", () => {
    const calls = close({ sessionId: "ses-one", order: ["ses-one", "ses-two"], active: "ses-two" })

    expect(calls).toEqual(["dismiss:ses-one", "forget:ses-one", "post:ses-one", "restore"])
  })

  it("dismisses a closed local tab and removes it from the local list", () => {
    const calls = close({ sessionId: "ses-one", order: ["ses-one"], local: ["ses-one"] })

    expect(calls).toEqual([
      "dismiss:ses-one",
      "pending:none",
      "clear",
      "forget:ses-one",
      "remove:ses-one",
      "post:ses-one",
      "restore",
    ])
  })

  it("removes a pending draft without dismissing it", () => {
    const calls = close({ sessionId: "draft", order: ["draft"], pending: ["draft"] })

    expect(calls).toEqual(["pending:none", "clear", "forget:draft", "remove:draft", "post:draft", "restore"])
  })

  it("does not notify the host when a host close is replayed", () => {
    expect(close({ sessionId: "ses-one", order: ["ses-one"], notify: false })).not.toContain("post:ses-one")
  })
})
