import { describe, expect, it } from "bun:test"
import { createdTab } from "../webview-ui/agent-manager/session-created"

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
