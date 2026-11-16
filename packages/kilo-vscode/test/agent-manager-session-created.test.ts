import { describe, expect, it } from "bun:test"
import {
  backgroundCreated,
  createSessionCreated,
  createdTab,
  fileInOrigin,
} from "../webview-ui/agent-manager/session-created"

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

describe("createSessionCreated", () => {
  const setup = (input: {
    selection: string
    active?: string
    owner?: string | null
    local?: string[]
    now?: () => number
  }) => {
    const calls: string[] = []
    const created = createSessionCreated({
      project: () => "prj-a",
      selection: () => input.selection,
      filed: () => undefined,
      owner: () => input.owner,
      local: () => input.local ?? ["pending:a"],
      worktreeTabs: () => [],
      activePending: () => input.active,
      shown: () => undefined,
      pending,
      store: () => {
        throw new Error("not another project")
      },
      appendOrder: (key, id) => calls.push(`order:${key}:${id}`),
      post: (message) => calls.push(`post:${(message as { type: string }).type}`),
      clear: () => calls.push("clear"),
      select: (id) => calls.push(`select:${id}`),
      current: () => undefined,
      focusManaged: (worktree, id) => calls.push(`focus:${worktree}:${id}`),
      placeLocal: (id, replace) => calls.push(`place:${id}:${replace}`),
      setActivePending: () => calls.push("active"),
      setSelection: (id) => calls.push(`selection:${id}`),
      now: input.now,
    })
    return { calls, created }
  }
  const origin = { project: "prj-a", worktree: null }

  it("fills the draft it was sent from without taking the view after the user moved on", () => {
    const test = setup({ selection: "local", active: "pending:b", local: ["pending:a", "pending:b"] })
    test.created.handle("ses_new", origin, { key: "pending:a" })
    expect(test.calls).toEqual(["place:ses_new:pending:a", "post:agentManager.persistSession"])
  })

  it("shows the session when its draft is still the active tab", () => {
    const test = setup({ selection: "local", active: "pending:a" })
    test.created.handle("ses_new", origin, { key: "pending:a" })
    expect(test.calls).toEqual([
      "place:ses_new:pending:a",
      "post:agentManager.persistSession",
      "selection:local",
      "select:ses_new",
    ])
  })

  it("files a worktree send quietly after the user switched context, and its host reply stays quiet", () => {
    const test = setup({ selection: "local", owner: "wt-1" })
    test.created.handle("ses_new", { project: "prj-a", worktree: "wt-1" }, { key: undefined })
    expect(test.calls).toEqual(["order:wt-1:ses_new", "post:agentManager.addSessionToWorktree"])
    expect(test.created.quiet("ses_new")).toBe(true)
    expect(test.created.quiet("ses_new")).toBe(false)
  })

  it("lets a quiet mark expire when the host never answers the filing", () => {
    let now = 1_000
    const test = setup({ selection: "local", owner: "wt-1", now: () => now })
    test.created.handle("ses_new", { project: "prj-a", worktree: "wt-1" }, { key: undefined })
    now += 60_000
    expect(test.created.quiet("ses_new")).toBe(false)
  })
})
