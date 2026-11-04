import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import {
  worktreeDropReference,
  worktreeReferences,
  createWorktreeMentionReferences,
} from "../webview-ui/agent-manager/worktree-references"
import { createProjectStore } from "../webview-ui/agent-manager/project/store"
import { buildWorktreeMentionFiles } from "../webview-ui/agent-manager/worktree-mention"
import type { WorktreeReference } from "../webview-ui/src/utils/prompt-mention-drop"
import type { WorktreeState } from "../webview-ui/src/types/messages/agent-manager"

function tree(id: string, values: Partial<WorktreeState> = {}): WorktreeState {
  return {
    id,
    branch: `feature/${id}`,
    path: `/repo/.kilo/worktrees/${id}`,
    parentBranch: "main",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...values,
  }
}

function reference(values: Partial<WorktreeReference> = {}): WorktreeReference {
  return {
    id: "wt-reference",
    name: "Authentication",
    branch: "feature/auth",
    path: "/repo/.kilo/worktrees/reference",
    base: "main",
    sessions: [{ id: "ses_auth", title: "Fix login" }],
    disabled: false,
    ...values,
  }
}

function content(url: string) {
  return decodeURIComponent(url.slice(url.indexOf(",") + 1))
}

describe("Agent Manager worktree references", () => {
  it("drops a worktree card as the same reference shape the picker builds", () => {
    const ref = worktreeDropReference(
      tree("drop", {
        label: "Feature",
        branch: "feature/drop",
        path: "/repo/.kilo/worktrees/drop",
        parentBranch: "develop",
      }),
      "Feature",
      [{ id: "ses_drop", title: "Fix login" }],
      true,
    )

    expect(ref).toEqual({
      id: "drop",
      name: "Feature",
      branch: "feature/drop",
      path: "/repo/.kilo/worktrees/drop",
      base: "develop",
      sessions: [{ id: "ses_drop", title: "Fix login" }],
      disabled: true,
    })
  })

  it("uses sidebar names and includes all sessions in tab order", () => {
    const state = createProjectStore("project")
    state.setWorktrees([tree("named", { label: "Custom name" }), tree("ordered"), tree("empty")])
    state.setManagedSessions([
      { id: "ses_first", worktreeId: "ordered", createdAt: "" },
      { id: "ses_second", worktreeId: "ordered", createdAt: "" },
      { id: "ses_local", worktreeId: null, createdAt: "" },
    ])
    state.setTabOrder({ ordered: ["ses_second", "ses_first"] })
    const refs = worktreeReferences(
      state,
      [
        { id: "ses_first", title: "First task" },
        { id: "ses_second", title: "Second task" },
        { id: "ses_local", title: "Local task" },
      ],
      "local",
    )
    expect(refs.map((ref) => ref.name)).toEqual(["Custom name", "Second task", "empty"])
    expect(refs[1]!.sessions).toEqual([
      { id: "ses_first", title: "First task" },
      { id: "ses_second", title: "Second task" },
    ])
    expect(refs[2]!.sessions).toEqual([])
  })

  it("keeps current, stale, and busy worktrees in the data but disabled", () => {
    const state = createProjectStore("project")
    state.setWorktrees([tree("current"), tree("stale"), tree("deleting"), tree("other")])
    state.setStaleWorktreeIds(new Set(["stale"]))
    state.setBusy(new Map([["deleting", { reason: "deleting" }]]))
    const refs = worktreeReferences(state, [], "current")
    expect(refs).toHaveLength(4)
    expect(refs.filter((ref) => ref.disabled).map((ref) => ref.id)).toEqual(["current", "stale", "deleting"])
  })

  it("re-enables only the selected worktree in the dialog list", () => {
    const state = createProjectStore("project")
    state.setWorktrees([tree("current"), tree("stale"), tree("busy"), tree("other")])
    state.setStaleWorktreeIds(new Set(["stale"]))
    state.setBusy(new Map([["busy", { reason: "deleting" }]]))
    let stored: Record<string, unknown> | undefined
    createRoot((dispose) => {
      const { dialogRefs } = createWorktreeMentionReferences(
        { getState: () => stored, setState: (value: Record<string, unknown> | undefined) => (stored = value) } as never,
        () => state,
        () => [],
        () => "current",
      )
      const dialog = dialogRefs()
      expect(dialog.find((ref) => ref.id === "current")?.disabled).toBe(false)
      expect(dialog.find((ref) => ref.id === "stale")?.disabled).toBe(true)
      expect(dialog.find((ref) => ref.id === "busy")?.disabled).toBe(true)
      dispose()
    })
  })

  it("keeps project inventories separate even when worktree IDs match", () => {
    const first = createProjectStore("first")
    const second = createProjectStore("second")
    first.setWorktrees([tree("same", { path: "/first/reference" })])
    second.setWorktrees([tree("same", { path: "/second/reference" })])
    expect(worktreeReferences(first, [], "local").map((ref) => ref.path)).toEqual(["/first/reference"])
    expect(worktreeReferences(second, [], "local").map((ref) => ref.path)).toEqual(["/second/reference"])
  })

  it("keeps multi-version siblings distinct and supports Windows paths", () => {
    const state = createProjectStore("project")
    state.setWorktrees([
      tree("one", { groupId: "group", label: "Compare", path: "C:\\repo\\one\\" }),
      tree("two", { groupId: "group", label: "Compare", path: "C:\\repo\\two" }),
      tree("empty", { path: "C:\\repo\\empty\\" }),
    ])
    const refs = worktreeReferences(state, [], "one")
    expect(refs.map((ref) => ref.name)).toEqual(["Compare", "Compare", "empty"])
    expect(refs.map((ref) => ref.disabled)).toEqual([true, false, false])
    expect(refs[0]!.path).not.toBe(refs[1]!.path)
  })

  it("ranks recent visits ahead of activity, then newest activity and sidebar order", () => {
    const state = createProjectStore("project")
    state.setWorktrees([tree("old"), tree("active"), tree("new", { createdAt: "2026-08-25T00:00:00.000Z" })])
    state.setManagedSessions([{ id: "ses_active", worktreeId: "active", createdAt: "" }])
    const sessions = [{ id: "ses_active", title: "Recent task", time: { created: 0, updated: Date.parse("2026-08-26T00:00:00.000Z") } }]
    expect(worktreeReferences(state, sessions, "local").map((ref) => ref.id)).toEqual(["active", "new", "old"])
    expect(worktreeReferences(state, sessions, "local", [tree("old").path]).map((ref) => ref.id)).toEqual([
      "old",
      "active",
      "new",
    ])
    expect(
      worktreeReferences(state, sessions, "local", [tree("new").path, tree("old").path]).map((ref) => ref.id),
    ).toEqual(["new", "old", "active"])
    state.setWorktrees([tree("first"), tree("second")])
    state.setWorktreeOrder(["second", "first"])
    expect(worktreeReferences(state, [], "local").map((ref) => ref.id)).toEqual(["second", "first"])
  })

  it("does not let a visit in another project boost a colliding worktree ID", () => {
    const state = createProjectStore("first")
    state.setWorktrees([tree("same", { path: "/first/same" }), tree("other", { path: "/first/other" })])
    const refs = worktreeReferences(state, [], "local", ["/second/same", "/first/other"])
    expect(refs.map((ref) => ref.path)).toEqual(["/first/other", "/first/same"])
  })

  it("attaches only metadata and preserves exact Unicode and spaced paths", () => {
    const ref = reference({ name: 'Fix "登录"\nnow', path: "/repo/.kilo/worktrees/登录 100%" })
    const text = `Compare with @${ref.path} and report differences.`
    const files = buildWorktreeMentionFiles(text, new Map(), [ref])
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      mime: "text/plain",
      source: {
        type: "file",
        path: ref.path,
        text: { value: `@${ref.path}`, start: 13, end: 14 + ref.path.length },
      },
    })
    expect(files[0]!.url.startsWith("data:text/plain;charset=utf-8,")).toBe(true)
    const textfile = content(files[0]!.url)
    expect(JSON.parse(textfile.slice(textfile.indexOf("{")))).toEqual({
      worktreeID: ref.id,
      name: ref.name,
      directory: ref.path,
      branch: ref.branch,
      baseBranch: ref.base,
      sessions: ref.sessions,
    })
    expect(textfile).toContain("metadata only")
    expect(textfile).toContain("recall")
    expect(files.some((file) => file.url.startsWith("file:") || file.url.startsWith("session:"))).toBe(false)
  })

  it("matches whole references and deduplicates repeated mentions", () => {
    const ref = reference()
    expect(buildWorktreeMentionFiles(`email@${ref.path}`, new Map(), [ref])).toEqual([])
    expect(buildWorktreeMentionFiles(`@${ref.path}-other`, new Map(), [ref])).toEqual([])
    expect(buildWorktreeMentionFiles(`@${ref.path} @${ref.path}`, new Map(), [ref])).toHaveLength(1)
    expect(buildWorktreeMentionFiles("Compare the changes", new Map(), [ref])).toEqual([])
    const longer = reference({ id: "longer", path: `${ref.path} backup` })
    expect(
      buildWorktreeMentionFiles(`@${longer.path}`, new Map(), [ref, longer]).map((file) => file.source.path),
    ).toEqual([longer.path])
  })
})
