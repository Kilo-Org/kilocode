import { describe, expect, it } from "bun:test"
import { createLocalTabPlacement } from "../webview-ui/agent-manager/app-tabs"
import { LOCAL } from "../webview-ui/agent-manager/navigate"

function scene(input: { ids: string[]; remembered?: string; restore?: string }) {
  const state = {
    ids: [...input.ids],
    order: [...input.ids],
    remembered: input.remembered,
    restore: input.restore,
  }
  const placement = createLocalTabPlacement({
    ids: () => state.ids,
    setIds: (next) => {
      state.ids = typeof next === "function" ? next(state.ids) : next
    },
    appendOrder: (_key, id) => state.order.push(id),
    replaceOrder: (_key, oldId, id) => {
      state.order = state.order.map((item) => (item === oldId ? id : item))
    },
    replaceRemembered: (from, to) => {
      if (state.remembered === from) state.remembered = to
      if (state.restore === from) state.restore = to
    },
    activePending: () => undefined,
    setActivePending: () => undefined,
    setActiveTerminal: () => undefined,
    clearSession: () => undefined,
    selectSession: () => undefined,
    setSelection: () => undefined,
    setReviewActive: () => undefined,
    focus: () => undefined,
    resume: () => undefined,
  })
  return { state, placement }
}

describe("Local draft promotion", () => {
  it("keeps the remembered tab when a draft is promoted while the user is away", () => {
    // The user sent from the second draft and switched to a worktree before the session was created. Returning
    // must select the new session, not fall back to the first tab.
    const test = scene({ ids: ["ses_a", "pending:b", "ses_c"], remembered: "pending:b", restore: "pending:b" })

    test.placement.place("ses_new", "pending:b", undefined)

    expect(test.state.ids).toEqual(["ses_a", "ses_new", "ses_c"])
    expect(test.state.order).toEqual(["ses_a", "ses_new", "ses_c"])
    expect(test.state.remembered).toBe("ses_new")
    expect(test.state.restore).toBe("ses_new")
  })

  it("leaves the remembered tab alone when the session opens without a draft", () => {
    const test = scene({ ids: ["ses_a", "ses_b"], remembered: "ses_b", restore: "ses_b" })

    test.placement.place("ses_new", undefined, undefined)

    expect(test.state.ids).toEqual(["ses_a", "ses_b", "ses_new"])
    expect(test.state.remembered).toBe("ses_b")
    expect(test.state.restore).toBe("ses_b")
  })

  it("does not move a remembered tab that points somewhere else", () => {
    const test = scene({ ids: ["ses_a", "pending:b", "ses_c"], remembered: "ses_c", restore: "ses_a" })

    test.placement.place("ses_new", "pending:b", undefined)

    expect(test.state.remembered).toBe("ses_c")
    expect(test.state.restore).toBe("ses_a")
  })

  it("stores the new tab under the Local key", () => {
    const keys: string[] = []
    const placement = createLocalTabPlacement({
      ids: () => ["pending:b"],
      setIds: () => undefined,
      appendOrder: (key) => keys.push(`append:${key}`),
      replaceOrder: (key) => keys.push(`replace:${key}`),
      replaceRemembered: () => undefined,
      activePending: () => undefined,
      setActivePending: () => undefined,
      setActiveTerminal: () => undefined,
      clearSession: () => undefined,
      selectSession: () => undefined,
      setSelection: () => undefined,
      setReviewActive: () => undefined,
      focus: () => undefined,
      resume: () => undefined,
    })

    placement.place("ses_new", undefined, undefined)

    expect(keys).toEqual([`append:${LOCAL}`])
  })
})
