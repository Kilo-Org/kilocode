import { describe, expect, it } from "bun:test"
import { backgroundCreated, createdTab, fileInOrigin } from "../webview-ui/agent-manager/session-created"

const pending = (id: string) => id.startsWith("pending:")

const base = {
  id: "ses_new",
  worktree: null,
  worktreeTabs: [],
  selection: "local",
  local: ["pending:a", "ses_old"],
  activePending: "pending:a",
  shown: undefined,
  pending,
}

describe("createdTab", () => {
  it("fills the draft tab the send was pressed in and shows it while that draft is active", () => {
    expect(createdTab({ ...base, sent: { key: "pending:a" } })).toEqual({
      kind: "local",
      replace: "pending:a",
      show: true,
    })
  })

  it("fills the originating draft without taking the view after the user opened another draft", () => {
    const tab = createdTab({
      ...base,
      sent: { key: "pending:a" },
      local: ["pending:a", "ses_old", "pending:b"],
      activePending: "pending:b",
    })
    expect(tab).toEqual({ kind: "local", replace: "pending:a", show: false })
  })

  it("does not pull the user back from another session or a worktree", () => {
    expect(createdTab({ ...base, sent: { key: "pending:a" }, activePending: undefined, shown: "ses_old" })).toEqual({
      kind: "local",
      replace: "pending:a",
      show: false,
    })
    expect(createdTab({ ...base, sent: { key: "pending:a" }, selection: "wt-1" })).toEqual({
      kind: "local",
      replace: "pending:a",
      show: false,
    })
  })

  it("leaves a session alone whose draft tab was closed during the send", () => {
    expect(createdTab({ ...base, sent: { key: "pending:a" }, local: ["ses_old"] })).toEqual({ kind: "keep" })
  })

  it("leaves the view alone for a prompt to a session that already has a tab", () => {
    expect(createdTab({ ...base, id: "ses_old", sent: { key: "ses_old" }, activePending: "pending:a" })).toEqual({
      kind: "keep",
    })
  })

  it("shows a session the server asks for, such as the plan handoff", () => {
    expect(createdTab({ ...base, activePending: undefined, shown: "ses_old" })).toEqual({ kind: "local", show: true })
    expect(createdTab({ ...base, worktree: "wt-1", selection: "wt-1", shown: "ses_plan" })).toEqual({
      kind: "worktree",
      worktree: "wt-1",
      show: true,
      append: true,
    })
  })

  it("files a prompt to an existing worktree session without moving the view", () => {
    const sent = { ...base, id: "ses_wt", sent: { key: "ses_wt" }, worktree: "wt-1", selection: "wt-1", shown: "x" }
    expect(createdTab({ ...sent, worktreeTabs: ["ses_wt", "ses_b"] })).toEqual({
      kind: "worktree",
      worktree: "wt-1",
      show: false,
      append: false,
    })
    // A session the worktree does not show yet joins its tabs.
    expect(createdTab(sent)).toEqual({ kind: "worktree", worktree: "wt-1", show: false, append: true })
  })

  it("shows a first worktree send only while the user still looks at that worktree's empty composer", () => {
    const first = { ...base, sent: { key: undefined }, worktree: "wt-1", activePending: undefined }
    expect(createdTab({ ...first, selection: "wt-1" })).toEqual({
      kind: "worktree",
      worktree: "wt-1",
      show: true,
      append: true,
    })
    expect(createdTab({ ...first, selection: "wt-1", shown: "ses_other" })).toMatchObject({ show: false })
    expect(createdTab({ ...first, selection: "local" })).toMatchObject({ show: false })
  })
})

describe("backgroundCreated", () => {
  const store = (ids: string[], order: string[]) => {
    const state = { ids, order: { local: order } as Record<string, string[]> }
    return {
      state,
      tabs: { ids: () => state.ids, set: (next: string[]) => (state.ids = next) },
      tabOrder: () => state.order,
      setTabOrder: (update: (prev: Record<string, string[]>) => Record<string, string[]>) =>
        (state.order = update(state.order)),
    }
  }

  it("fills the draft tab of the project the user left during the send", () => {
    const test = store(["pending:a", "ses_old"], ["pending:a", "ses_old"])
    backgroundCreated(test, "ses_new", "pending:a")
    expect(test.state.ids).toEqual(["ses_new", "ses_old"])
    expect(test.state.order.local).toEqual(["ses_new", "ses_old"])
  })

  it("adds a session without a draft tab and leaves an existing tab alone", () => {
    const test = store(["ses_old"], ["ses_old"])
    backgroundCreated(test, "ses_new", undefined)
    expect(test.state.ids).toEqual(["ses_old", "ses_new"])
    backgroundCreated(test, "ses_old", "ses_old")
    expect(test.state.ids).toEqual(["ses_old", "ses_new"])
    expect(test.state.order.local).toEqual(["ses_old", "ses_new"])
  })
})

describe("fileInOrigin", () => {
  const run = (input: { id: string; key: string | undefined; worktree: string | null }) => {
    const calls: string[] = []
    const state = { ids: ["pending:a"], order: { local: ["pending:a"] } as Record<string, string[]> }
    fileInOrigin({
      id: input.id,
      origin: { project: "prj-a", worktree: input.worktree },
      key: input.key,
      store: (project) => {
        calls.push(`store:${project}`)
        return {
          tabs: { ids: () => state.ids, set: (next: string[]) => (state.ids = next) },
          tabOrder: () => state.order,
          setTabOrder: (update: (prev: Record<string, string[]>) => Record<string, string[]>) =>
            (state.order = update(state.order)),
        }
      },
      add: (worktree) => calls.push(`add:${worktree}`),
      persist: () => calls.push("persist"),
    })
    return { calls, state }
  }

  it("fills the Local draft of the project the send started in and files it there", () => {
    const result = run({ id: "ses_new", key: "pending:a", worktree: null })
    expect(result.calls).toEqual(["store:prj-a", "persist"])
    expect(result.state.ids).toEqual(["ses_new"])
  })

  it("files a new worktree session in its worktree", () => {
    expect(run({ id: "ses_new", key: undefined, worktree: "wt-1" }).calls).toEqual(["add:wt-1"])
  })

  it("leaves a prompt to an existing session alone", () => {
    expect(run({ id: "ses_old", key: "ses_old", worktree: "wt-1" }).calls).toEqual([])
  })
})
