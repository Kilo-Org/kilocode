import { describe, expect, it } from "bun:test"
import { createRoot } from "solid-js"
import { worktreeReferences } from "../../webview-ui/agent-manager/worktree-references"
import { createProjectStore } from "../../webview-ui/agent-manager/project/store"
import {
  buildMentionResults,
  buildWorktreeAttachments,
  filterMentionResults,
  type WorktreeReference,
} from "../../webview-ui/src/hooks/file-mention-utils"
import { useFileMention } from "../../webview-ui/src/hooks/useFileMention"
import type { ExtensionMessage, WebviewMessage, WorktreeState } from "../../webview-ui/src/types/messages"

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

function harness(worktrees: () => WorktreeReference[]) {
  const posted: WebviewMessage[] = []
  const handlers = new Set<(message: ExtensionMessage) => void>()
  return createRoot((dispose) => ({
    dispose,
    posted,
    receive: (message: ExtensionMessage) => handlers.forEach((handler) => handler(message)),
    mention: useFileMention(
      {
        postMessage: (message) => posted.push(message),
        onMessage: (handler) => {
          handlers.add(handler)
          return () => handlers.delete(handler)
        },
      },
      undefined,
      () => true,
      worktrees,
    ),
  }))
}

function reply(scope: ReturnType<typeof harness>, paths: string[] = []) {
  const request = scope.posted.findLast((message) => message.type === "requestFileSearch")
  if (request?.type !== "requestFileSearch") throw new Error("Missing file search request")
  scope.receive({ type: "fileSearchResult", requestId: request.requestId, dir: "/repo", paths })
}

describe("Agent Manager worktree references", () => {
  it("uses sidebar names and includes all sessions without selecting a transcript", () => {
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
    expect(refs[1].sessions).toEqual([
      { id: "ses_first", title: "First task" },
      { id: "ses_second", title: "Second task" },
    ])
    expect(refs[2].sessions).toEqual([])
  })

  it("omits current, stale, and busy worktrees from suggestions but retains their reference data", () => {
    const state = createProjectStore("project")
    state.setWorktrees([tree("current"), tree("stale"), tree("deleting"), tree("other")])
    state.setStaleWorktreeIds(new Set(["stale"]))
    state.setBusy(new Map([["deleting", { reason: "deleting" }]]))
    const refs = worktreeReferences(state, [], "current")
    expect(refs).toHaveLength(4)
    const scope = harness(() => refs)
    expect(scope.mention.worktreeCandidates().map((item) => item.path)).toEqual(["/repo/.kilo/worktrees/other"])
    scope.dispose()
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
    expect(refs[0].path).not.toBe(refs[1].path)
  })

  it("shows one Worktrees entry instead of individual worktrees in the main menu", () => {
    for (const query of ["", "w", "worktree", "WORKTREES", "branch"]) {
      const results = buildMentionResults(query, [], true, true)
      expect(results.filter((item) => item.type === "worktrees")).toEqual([{ type: "worktrees", value: "worktrees" }])
      expect(filterMentionResults(query, results).filter((item) => item.type === "worktrees")).toHaveLength(1)
    }
    expect(buildMentionResults("unrelated", [], true, true).some((item) => item.type === "worktrees")).toBe(false)
    expect(buildMentionResults("", []).some((item) => item.type === "worktrees")).toBe(false)
  })

  it("ranks recent visits ahead of activity, then uses newest activity and sidebar order", () => {
    const state = createProjectStore("project")
    state.setWorktrees([tree("old"), tree("active"), tree("new", { createdAt: "2026-08-25T00:00:00.000Z" })])
    state.setManagedSessions([{ id: "ses_active", worktreeId: "active", createdAt: "" }])
    const sessions = [{ id: "ses_active", title: "Recent task", updatedAt: "2026-08-26T00:00:00.000Z" }]
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
    const files = buildWorktreeAttachments(text, [ref])
    expect(files).toHaveLength(1)
    expect(files[0]).toMatchObject({
      mime: "text/plain",
      source: {
        type: "file",
        path: ref.path,
        text: { value: `@${ref.path}`, start: 13, end: 14 + ref.path.length },
      },
    })
    expect(files[0].url.startsWith("data:text/plain;charset=utf-8,")).toBe(true)
    const textfile = content(files[0].url)
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

  it("matches whole references, removes deleted references, and deduplicates repeated mentions", () => {
    const ref = reference()
    expect(buildWorktreeAttachments(`email@${ref.path}`, [ref])).toEqual([])
    expect(buildWorktreeAttachments(`@${ref.path}-other`, [ref])).toEqual([])
    expect(buildWorktreeAttachments(`@${ref.path} @${ref.path}`, [ref])).toHaveLength(1)
    expect(buildWorktreeAttachments("Compare the changes", [ref])).toEqual([])
    const longer = reference({ id: "longer", path: `${ref.path} backup` })
    expect(buildWorktreeAttachments(`@${longer.path}`, [ref, longer]).map((file) => file.source?.path)).toEqual([
      longer.path,
    ])
  })

  it("does not auto-read worktree directories inside the local workspace", () => {
    const ref = reference({ path: "/repo/.kilo/worktrees/reference branch" })
    const scope = harness(() => [ref])
    scope.mention.onInput("@", 1)
    reply(scope, ["src/a.ts"])
    const text = `Compare @${ref.path} with @src/a.ts`
    scope.mention.seedFromText(text)
    expect(scope.mention.mentionedPaths()).toEqual(new Set([ref.path, "src/a.ts"]))
    const files = scope.mention.parseFileAttachments(text)
    expect(files).toHaveLength(2)
    expect(files.filter((file) => file.url.startsWith("file:"))).toMatchObject([{ source: { path: "src/a.ts" } }])
    expect(files.filter((file) => file.source?.path === ref.path)[0].url.startsWith("data:")).toBe(true)
    scope.dispose()
  })

  it("does not attach a truncated path when worktree data arrives after draft restoration", () => {
    const ref = reference({ path: "/repo/.kilo/worktrees/reference branch" })
    const state = { refs: [] as WorktreeReference[] }
    const scope = harness(() => state.refs)
    scope.mention.onInput("@", 1)
    reply(scope)
    const text = `Compare @${ref.path}`
    scope.mention.seedFromText(text)
    state.refs = [ref]
    const files = scope.mention.parseFileAttachments(text)
    expect(files).toHaveLength(1)
    expect(files[0].source?.path).toBe(ref.path)
    expect(files[0].url.startsWith("data:")).toBe(true)
    scope.dispose()
  })

  it("restores references without a prior picker selection and refreshes their metadata", () => {
    const state = { refs: [reference()] }
    const scope = harness(() => state.refs)
    const text = `Compare @${state.refs[0].path}`
    scope.mention.seedFromText(text)
    expect(scope.mention.parseFileAttachments(text)).toHaveLength(1)
    state.refs = [reference({ branch: "renamed", sessions: [{ id: "ses_new" }] })]
    const files = scope.mention.parseFileAttachments(text)
    expect(content(files[0].url)).toContain('"branch": "renamed"')
    expect(content(files[0].url)).toContain("ses_new")
    state.refs = []
    expect(content(scope.mention.parseFileAttachments(text)[0].url)).toContain(reference().path)
    expect(scope.mention.parseFileAttachments("Removed reference")).toEqual([])
    scope.dispose()
  })

  it("retains reference metadata when a worktree disappears after search results arrive", () => {
    const ref = reference()
    const state = { refs: [] as WorktreeReference[] }
    const scope = harness(() => state.refs)
    scope.mention.onInput("@", 1)
    state.refs = [ref]
    reply(scope)
    expect(scope.mention.worktreeCandidates().map((item) => item.path)).toEqual([ref.path])
    state.refs = []
    const text = `Compare @${ref.path}`
    scope.mention.seedFromText(text)
    const files = scope.mention.parseFileAttachments(text)
    expect(files).toHaveLength(1)
    expect(files[0].url.startsWith("data:")).toBe(true)
    scope.dispose()
  })

  it("opens the local worktree picker without changing the prompt or requesting past chats", () => {
    const state = { refs: [reference(), reference({ id: "tests", name: "Testing", path: "/repo/tests" })] }
    const scope = harness(() => state.refs)
    scope.mention.onInput("@", 1)
    const count = scope.posted.length
    const input = { value: "@", selectionStart: 1 } as HTMLTextAreaElement
    scope.mention.selectMention({ type: "worktrees", value: "worktrees" }, input, () => {})
    expect(scope.mention.worktreePicker()).toBe(true)
    expect(scope.mention.sessionPicker()).toBe(false)
    expect(scope.mention.worktreeCandidates().map((item) => item.name)).toEqual(["Authentication", "Testing"])
    expect(scope.posted).toHaveLength(count)
    expect(input.value).toBe("@")
    state.refs = [reference({ name: "Renamed" })]
    expect(scope.mention.worktreeCandidates().map((item) => item.name)).toEqual(["Renamed"])
    expect(scope.mention.parseFileAttachments("@worktrees")).toEqual([])
    scope.mention.closeMention()
    expect(scope.mention.worktreePicker()).toBe(false)
    expect(scope.mention.showMention()).toBe(false)
    expect(scope.posted.some((message) => message.type === "requestSessionSearch")).toBe(false)
    scope.dispose()
  })

  it("keeps the Worktrees entry available when there are no other worktrees", () => {
    const scope = harness(() => [reference({ disabled: true })])
    scope.mention.onInput("@", 1)
    expect(scope.mention.mentionResults().filter((item) => item.type === "worktrees")).toHaveLength(1)
    expect(scope.mention.worktreeCandidates()).toEqual([])
    scope.dispose()
  })
})
