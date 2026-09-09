import { readFile } from "node:fs/promises"
import { afterAll, beforeEach, describe, expect, it, spyOn } from "bun:test"
import * as gh from "../../src/agent-manager/gh"
import { PRReviewActions } from "../../src/agent-manager/pr/review-actions"
import { PRMergeActions } from "../../src/agent-manager/pr/merge-actions"
import type { PRReviewContext } from "../../src/agent-manager/pr/review-context"
import type { PRMergeResult, PRReviewResult } from "../../src/shared/pr-comment-actions"
import { parsePatch } from "../../src/shared/pr-patch"

const execute = spyOn(gh, "execGhRead")
afterAll(() => execute.mockRestore())
const head = "a".repeat(40)
const base = "b".repeat(40)
const url = "https://github.com/owner/repo/pull/7"
const patch = "@@ -1,2 +1,3 @@\n context\n-old\n+new\n+last"
const file = { filename: "src/a.ts", status: "modified", patch, additions: 2, deletions: 1 }
const meta = {
  number: 7,
  html_url: url,
  head: { sha: head },
  base: { sha: base },
  changed_files: 1,
  state: "open",
  merged: false,
}

beforeEach(() => execute.mockReset())

async function readInput(args: string[]) {
  const index = args.indexOf("--input")
  const file = args.at(index + 1)
  if (index < 0 || !file) throw new Error("Missing gh input file")
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>
}

it.each([
  ["RIGHT", 1, 4, "context\n  new\n\nend"],
  ["LEFT", 1, 3, "context\nold\nend"],
  ["RIGHT", 3, 3, ""],
] as const)("preserves exact %s source for lines %i-%i", (side, start, end, source) => {
  const patch = "@@ -1,3 +1,4 @@\n context\n-old\n+  new\n+\n end"
  expect(parsePatch(patch, undefined, { side, start, end })?.source).toBe(source)
})

it("rejects selection across adjacent hunks even with no gap in line numbers", () => {
  const patch = "@@ -1 +1 @@\n-old\n+new\n@@ -2 +2 @@\n-old\n+next"
  expect(parsePatch(patch)?.ranges.filter((range) => range.side === "RIGHT")).toHaveLength(2)
  expect(parsePatch(patch, undefined, { side: "RIGHT", start: 1, end: 2 })).toBeUndefined()
})

function harness() {
  const context: PRReviewContext = {
    projectId: "project",
    worktreeId: "worktree",
    directory: "/repo/worktree",
    branch: "feature",
    pr: {
      number: 7,
      url,
      title: "Review",
      state: "open",
      review: null,
      baseRefOid: base,
      headRefOid: head,
      checks: { status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] },
      reviewers: [],
      additions: 2,
      deletions: 1,
      files: 1,
    },
  }
  const sent: PRReviewResult[] = []
  const refresh = spyOn({ run: (_context: PRReviewContext) => {} }, "run")
  let completion = Promise.withResolvers<PRReviewResult>()
  const host = {
    context: (_message: Record<string, unknown>) => context,
    post: (result: PRReviewResult) => {
      sent.push(result)
      completion.resolve(result)
    },
    refresh,
    dirtyFiles: () => [],
  }
  const actions = new PRReviewActions(host)
  let id = 0
  const send = (type: string, fields: Record<string, unknown> = {}) => {
    completion = Promise.withResolvers<PRReviewResult>()
    expect(
      actions.handle({
        type: `agentManager.${type}`,
        projectId: context.projectId,
        worktreeId: context.worktreeId,
        prNumber: 7,
        prUrl: url,
        requestId: String(++id),
        ...fields,
      }),
    ).toBe(true)
    return completion.promise
  }
  const load = async () => {
    const result = await send("loadPRFiles")
    expect(result.success).toBe(true)
    if (result.type !== "agentManager.loadPRFilesResult" || !result.snapshot) throw new Error("Missing snapshot")
    return result.snapshot
  }
  const comment = (snapshot: { id: string }, fields: Record<string, unknown> = {}) =>
    send("createReviewComment", {
      snapshotId: snapshot.id,
      path: file.filename,
      side: "RIGHT",
      startLine: 2,
      endLine: 3,
      body: "body",
      ...fields,
    })
  const review = (snapshot: { id: string }, fields: Record<string, unknown> = {}) =>
    send("submitPRReview", { snapshotId: snapshot.id, event: "APPROVE", head, body: "", ...fields })
  return { context, host, actions, sent, refresh, send, load, comment, review }
}

function transport(
  files: unknown[] = [file],
  capture?: (input: Record<string, unknown>) => void,
  reviewState = "APPROVED",
) {
  execute.mockImplementation(async (args) => {
    if (args.includes("POST")) {
      if (capture) capture(await readInput(args))
      if (args.some((arg) => arg.endsWith("/reviews")))
        return { stdout: JSON.stringify({ id: 12, commit_id: head, state: reviewState }), stderr: "" }
      return {
        stdout: JSON.stringify({
          id: 11,
          commit_id: head,
          path: file.filename,
          side: "RIGHT",
          line: 3,
          start_line: 2,
          start_side: "RIGHT",
        }),
        stderr: "",
      }
    }
    return { stdout: JSON.stringify(args.some((arg) => arg.includes("/files?")) ? files : meta), stderr: "" }
  })
}

describe("commit-bound PR review actions", () => {
  it("loads actual GitHub patches and posts exact raw body with a multiline range", async () => {
    let input: Record<string, unknown> | undefined
    transport([file], (value) => {
      input = value
    })
    const h = harness()
    expect(h.actions.handle({ type: "other" })).toBe(false)
    const snapshot = await h.load()
    expect(snapshot.files[0]?.patch).toBe(patch)
    expect(snapshot.head).toBe(head)
    const body = '@.env\n@alice PTAL\n\n```suggestion\n  const value = "$HOME"\n  return value\n```\n'
    expect((await h.comment(snapshot, { body })).success).toBe(true)
    expect(execute.mock.calls.at(-1)?.[0]).toEqual([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "POST",
      "repos/owner/repo/pulls/7/comments",
      "--input",
      expect.any(String),
    ])
    expect(input).toEqual({
      body,
      commit_id: head,
      path: file.filename,
      side: "RIGHT",
      line: 3,
      start_line: 2,
      start_side: "RIGHT",
    })
    expect(h.refresh).toHaveBeenCalledTimes(1)
  })

  it.each([
    { ...file, patch: undefined },
    { ...file, patch: "@@ -1,2 +1,3 @@\n context\n-old\n+new" },
    { ...file, patch: "@@ -1 +1 @@\n-old\n+new", additions: 2 },
    { ...file, patch: "Binary files differ" },
    { ...file, patch: "@@ -1 +1 @@\n-old\n+new\n..." },
  ])("does not expose unproven patches for line comments: %j", async (value) => {
    transport([value])
    const h = harness()
    const snapshot = await h.load()
    expect(snapshot.files[0]?.patch).toBeUndefined()
    const result = await h.comment(snapshot, { startLine: 1, endLine: 1 })
    expect(result.success).toBe(false)
    expect(execute.mock.calls.some(([args]) => args.includes("POST"))).toBe(false)
  })

  it.each([
    { startLine: 0 },
    { startLine: 1.5 },
    { startLine: 4 },
    { endLine: 4 },
    { endLine: 1 },
    { side: "BOTH" },
    { path: "other.ts" },
    { snapshotId: "forged" },
    { body: " \n " },
    { side: "LEFT", startLine: 1, endLine: 2, body: "```suggestion\nx\n```" },
    { side: "LEFT", startLine: 1, endLine: 2, body: "``` suggestion\nx\n```" },
  ])("rejects forged or unavailable selection %j", async (fields) => {
    transport()
    const h = harness()
    const snapshot = await h.load()
    expect((await h.comment(snapshot, fields)).success).toBe(false)
    expect(execute.mock.calls.some(([args]) => args.includes("POST"))).toBe(false)
  })

  it("rejects ranges crossing unshown lines between hunks", async () => {
    transport([{ ...file, patch: "@@ -1 +1 @@\n-a\n+b\n@@ -10 +10 @@\n-c\n+d", additions: 2, deletions: 2 }])
    const h = harness()
    const snapshot = await h.load()
    expect((await h.comment(snapshot, { startLine: 1, endLine: 10 })).success).toBe(false)
  })

  it("posts a single deleted line on LEFT without multiline fields", async () => {
    transport([
      {
        ...file,
        patch: "@@ -1 +0,0 @@\n-old\n\\ No newline at end of file",
        status: "removed",
        additions: 0,
        deletions: 1,
      },
    ])
    const h = harness()
    const snapshot = await h.load()
    execute.mockResolvedValueOnce({ stdout: JSON.stringify(meta), stderr: "" }).mockResolvedValueOnce({
      stdout: JSON.stringify({ id: 11, commit_id: head, path: file.filename, side: "LEFT", line: 1 }),
      stderr: "",
    })
    expect((await h.comment(snapshot, { side: "LEFT", startLine: 1, endLine: 1 })).success).toBe(true)
    expect(execute.mock.calls.at(-1)?.[0]).toContain("--input")
    expect(execute.mock.calls.at(-1)?.[0].some((arg) => arg.startsWith("start_"))).toBe(false)
  })

  it("rejects in-flight host mutation without posting", async () => {
    transport()
    const h = harness()
    const snapshot = await h.load()
    execute.mockImplementation(async () => {
      h.context.branch = "other"
      return { stdout: JSON.stringify(meta), stderr: "" }
    })
    expect((await h.review(snapshot)).success).toBe(false)
    expect(execute.mock.calls.some(([args]) => args.includes("POST"))).toBe(false)
  })

  it("rejects malformed metadata and unconfirmed comment writes", async () => {
    execute.mockResolvedValue({ stdout: "not JSON", stderr: "" })
    const h = harness()
    expect((await h.send("loadPRFiles")).success).toBe(false)
    transport()
    const snapshot = await h.load()
    execute.mockResolvedValueOnce({ stdout: JSON.stringify(meta), stderr: "" }).mockResolvedValueOnce({
      stdout: JSON.stringify({ id: 1, commit_id: head, path: "other", line: 3, side: "RIGHT" }),
      stderr: "",
    })
    expect((await h.comment(snapshot, { startLine: 3, body: "draft" })).error).toContain("Check the pull request")
    expect(h.refresh).not.toHaveBeenCalled()
    expect(execute.mock.calls.filter(([args]) => args.includes("POST"))).toHaveLength(1)
  })

  it("binds snapshots to the project and branch and evicts old snapshots", async () => {
    transport()
    const h = harness()
    const snapshot = await h.load()
    for (const field of ["projectId", "branch"] as const) {
      const original = h.context[field]
      h.context[field] = "other"
      expect((await h.comment(snapshot)).success).toBe(false)
      h.context[field] = original
    }
    for (let n = 0; n < 8; n++) await h.load()
    expect((await h.comment(snapshot)).success).toBe(false)
    expect(execute.mock.calls.some(([args]) => args.includes("POST"))).toBe(false)
  })

  it("refuses a head change during loading and before writing", async () => {
    transport()
    const h = harness()
    const snapshot = await h.load()
    execute.mockResolvedValue({ stdout: JSON.stringify({ ...meta, head: { sha: "c".repeat(40) } }), stderr: "" })
    expect((await h.comment(snapshot)).success).toBe(false)
    execute
      .mockResolvedValueOnce({ stdout: JSON.stringify(meta), stderr: "" })
      .mockResolvedValueOnce({ stdout: JSON.stringify([file]), stderr: "" })
    expect((await h.send("loadPRFiles")).success).toBe(false)
    expect(execute.mock.calls.some(([args]) => args.includes("POST"))).toBe(false)
  })

  it("paginates files and rejects the GitHub file limit", async () => {
    const files = Array.from({ length: 100 }, (_, i) => ({ ...file, filename: `file-${i}` }))
    execute
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ...meta, changed_files: 101 }), stderr: "" })
      .mockResolvedValueOnce({ stdout: JSON.stringify(files), stderr: "" })
      .mockResolvedValueOnce({ stdout: JSON.stringify([file]), stderr: "" })
      .mockResolvedValueOnce({ stdout: JSON.stringify({ ...meta, changed_files: 101 }), stderr: "" })
    const h = harness()
    expect((await h.load()).files).toHaveLength(101)
    expect(execute.mock.calls[2]?.[0]).toContain("repos/owner/repo/pulls/7/files?per_page=100&page=2")
    execute.mockResolvedValue({ stdout: JSON.stringify({ ...meta, changed_files: 3001 }), stderr: "" })
    expect((await h.send("loadPRFiles")).error).toContain("3000")
  })

  it.each(["head", "base"])("rejects a fresh %s change before submitting the reviewed snapshot", async (field) => {
    transport()
    const h = harness()
    const snapshot = await h.load()
    execute.mockResolvedValue({ stdout: JSON.stringify({ ...meta, [field]: { sha: "c".repeat(40) } }), stderr: "" })
    for (const event of ["APPROVE", "REQUEST_CHANGES", "COMMENT"]) {
      const result = await h.review(snapshot, { event, body: "review draft" })
      expect(result.success).toBe(false)
      expect(result.error).toContain("Reload the review")
    }
    expect(execute.mock.calls.some(([args]) => args.includes("POST"))).toBe(false)
    expect(h.refresh).not.toHaveBeenCalled()
  })

  it.each([undefined, "unknown"])("rejects a missing or unknown review snapshot: %s", async (snapshotId) => {
    transport()
    const result = await harness().send("submitPRReview", { snapshotId, event: "APPROVE", head, body: "" })
    expect(result.success).toBe(false)
    expect(result.error).toContain("Reload the review")
    expect(execute).not.toHaveBeenCalled()
  })

  it.each(["projectId", "worktreeId", "directory", "branch"] as const)(
    "rejects a review snapshot from another %s",
    async (field) => {
      transport()
      const h = harness()
      const snapshot = await h.load()
      h.context[field] = "other"
      execute.mockClear()
      const result = await h.review(snapshot)
      expect(result.success).toBe(false)
      expect(result.error).toContain("Reload the review")
      expect(execute).not.toHaveBeenCalled()
    },
  )

  it("rejects a snapshot from another PR or an evicted snapshot", async () => {
    transport()
    const h = harness()
    const snapshot = await h.load()
    h.context.pr.number = 8
    expect((await h.review(snapshot)).error).toContain("Reload the review")
    h.context.pr.number = 7
    h.context.pr.url = "https://github.com/other/repo/pull/7"
    expect((await h.review(snapshot)).error).toContain("Reload the review")
    h.context.pr.url = url
    for (let n = 0; n < 8; n++) await h.load()
    expect((await h.review(snapshot)).error).toContain("Reload the review")
    expect(execute.mock.calls.some(([args]) => args.includes("POST"))).toBe(false)
  })

  it.each(["REQUEST_CHANGES", "COMMENT"])("submits %s against the bound snapshot", async (event) => {
    const state = event === "COMMENT" ? "COMMENTED" : "CHANGES_REQUESTED"
    let input: Record<string, unknown> | undefined
    transport([file], (value) => (input = value), state)
    const h = harness()
    const snapshot = await h.load()
    expect((await h.review(snapshot, { event, body: "  review draft\n" })).success).toBe(true)
    expect(input?.event).toBe(event)
    expect(execute.mock.calls.at(-1)?.[0]).toContain("--input")
    expect(input?.body).toBe("  review draft\n")
  })

  it("submits an @.env-like review body without a field-file lookup", async () => {
    let input: Record<string, unknown> | undefined
    transport([file], (value) => (input = value), "COMMENTED")
    const h = harness()
    const snapshot = await h.load()
    const body = "@.env\n@alice PTAL\n\n```suggestion\n  keep this\n```\n"
    expect((await h.review(snapshot, { event: "COMMENT", body })).success).toBe(true)
    const args = execute.mock.calls.at(-1)?.[0] ?? []
    expect(args).toEqual([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "POST",
      "repos/owner/repo/pulls/7/reviews",
      "--input",
      expect.any(String),
    ])
    expect(args.some((arg) => arg.startsWith("body=") || arg.includes(".env"))).toBe(false)
    expect(input?.body).toBe(body)
  })

  it("submits an explicit commit and checks review response", async () => {
    transport()
    const h = harness()
    const snapshot = await h.load()
    expect((await h.review(snapshot)).success).toBe(true)
    expect(execute.mock.calls.at(-1)?.[0]).toEqual([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "POST",
      "repos/owner/repo/pulls/7/reviews",
      "--input",
      expect.any(String),
    ])
    execute
      .mockResolvedValueOnce({ stdout: JSON.stringify(meta), stderr: "" })
      .mockResolvedValueOnce({ stdout: "{}", stderr: "" })
    expect((await h.review(snapshot)).success).toBe(false)
  })

  it("does not report a confirmed write as failed when refresh throws", async () => {
    transport()
    const h = harness()
    const snapshot = await h.load()
    h.refresh.mockImplementation(() => {
      throw new Error("Refresh failed")
    })
    const log = spyOn(console, "error").mockImplementation(() => {})
    try {
      expect((await h.review(snapshot)).success).toBe(true)
      expect(h.sent).toHaveLength(2)
      expect(log).toHaveBeenCalledTimes(1)
    } finally {
      log.mockRestore()
    }
  })

  it.each(["REQUEST_CHANGES", "COMMENT", "INVALID"])("requires a valid event and body for %s", async (event) => {
    transport()
    const h = harness()
    const snapshot = await h.load()
    execute.mockClear()
    expect((await h.review(snapshot, { event, body: " " })).success).toBe(false)
    expect(execute).not.toHaveBeenCalled()
  })

  it("rejects closed PRs, stale review heads, and changed host context", async () => {
    transport()
    const h = harness()
    const snapshot = await h.load()
    expect((await h.review(snapshot, { head: "c".repeat(40) })).success).toBe(false)
    execute.mockResolvedValue({ stdout: JSON.stringify({ ...meta, state: "closed" }), stderr: "" })
    expect((await h.review(snapshot)).success).toBe(false)
    transport()
    spyOn(h.host, "context")
      .mockReturnValueOnce(h.context)
      .mockImplementation(() => {
        throw new Error("Worktree removed")
      })
    expect((await h.review(snapshot)).error).toContain("Worktree removed")
    expect(execute.mock.calls.some(([args]) => args.includes("POST"))).toBe(false)
  })

  it.each(["HTTP 403: permission denied", "HTTP 422: Can not approve your own pull request", "connection lost"])(
    "does not retry mutations after %s",
    async (error) => {
      transport()
      const h = harness()
      const snapshot = await h.load()
      execute.mockClear()
      execute
        .mockResolvedValueOnce({ stdout: JSON.stringify(meta), stderr: "" })
        .mockRejectedValueOnce(new Error(error))
      const result = await h.review(snapshot, { body: "kept draft" })
      expect(result.success).toBe(false)
      expect(result.error).toBe(error)
      expect(execute).toHaveBeenCalledTimes(2)
      expect(h.refresh).not.toHaveBeenCalled()
      expect(result.requestId).toBe("2")
    },
  )
})

describe("GitHub PR merge actions", () => {
  it("updates the remote branch with the expected head", async () => {
    execute.mockResolvedValue({ stdout: "{}", stderr: "" })
    const context = harness().context
    const sent: PRMergeResult[] = []
    const completion = Promise.withResolvers<PRMergeResult>()
    const host = {
      context: (_message: Record<string, unknown>) => context,
      post: (message: PRMergeResult) => {
        sent.push(message)
        completion.resolve(message)
      },
      refresh: spyOn({ run: (_value: PRReviewContext) => {} }, "run"),
      dirtyFiles: () => [],
    }
    const actions = new PRMergeActions(host)
    expect(
      actions.handle({
        type: "agentManager.updatePRBranch",
        projectId: context.projectId,
        worktreeId: context.worktreeId,
        requestId: "update",
        prNumber: context.pr.number,
        prUrl: context.pr.url,
        head,
      }),
    ).toBe(true)
    expect(await completion.promise).toMatchObject({ type: "agentManager.updatePRBranchResult", success: true })
    expect(execute.mock.calls.at(-1)?.[0]).toEqual([
      "api",
      "--hostname",
      "github.com",
      "--method",
      "PUT",
      "repos/owner/repo/pulls/7/update-branch",
      "-f",
      `expected_head_sha=${head}`,
    ])
  })

  it("merges with the selected method and persists it after GitHub succeeds", async () => {
    execute.mockResolvedValue({ stdout: "", stderr: "" })
    const context = harness().context
    const sent: Array<PRMergeResult> = []
    const completion = Promise.withResolvers<PRMergeResult>()
    const save = spyOn({ run: async (_repo: string, _method: "merge" | "squash" | "rebase") => {} }, "run")
    const refresh = spyOn({ run: (_value: PRReviewContext, _settle?: boolean) => {} }, "run")
    const host = {
      context: (_message: Record<string, unknown>) => context,
      post: (message: PRMergeResult) => {
        sent.push(message)
        completion.resolve(message)
      },
      refresh,
      dirtyFiles: () => [],
      savePRMergeMethod: save,
    }
    const actions = new PRMergeActions(host)
    actions.handle({
      type: "agentManager.mergePR",
      projectId: context.projectId,
      worktreeId: context.worktreeId,
      requestId: "merge",
      prNumber: context.pr.number,
      prUrl: context.pr.url,
      method: "squash",
      auto: true,
      head,
    })
    expect(await completion.promise).toMatchObject({ type: "agentManager.mergePRResult", success: true })
    expect(execute.mock.calls.at(-1)?.[0]).toEqual([
      "pr",
      "merge",
      url,
      "--squash",
      "--match-head-commit",
      head,
      "--auto",
    ])
    expect(save).toHaveBeenCalledWith("owner/repo", "squash")
    expect(refresh).toHaveBeenCalledWith(context, true)
  })

  it("loads conflicting files without refreshing the pull request", async () => {
    const context = harness().context
    const completion = Promise.withResolvers<PRMergeResult>()
    const conflicts = spyOn(
      { run: async (_context: PRReviewContext, _base: string, _head: string) => ["a.txt"] },
      "run",
    )
    const refresh = spyOn({ run: (_value: PRReviewContext) => {} }, "run")
    const host = {
      context: (_message: Record<string, unknown>) => context,
      post: (message: PRMergeResult) => completion.resolve(message),
      refresh,
      dirtyFiles: () => [],
      conflicts,
    }
    const actions = new PRMergeActions(host)
    expect(
      actions.handle({
        type: "agentManager.loadPRConflicts",
        projectId: context.projectId,
        worktreeId: context.worktreeId,
        requestId: "conflicts",
        prNumber: context.pr.number,
        prUrl: context.pr.url,
        base,
        head,
      }),
    ).toBe(true)
    expect(await completion.promise).toMatchObject({
      type: "agentManager.loadPRConflictsResult",
      success: true,
      files: ["a.txt"],
    })
    expect(conflicts).toHaveBeenCalledWith(context, base, head)
    expect(refresh).not.toHaveBeenCalled()
  })

  it("rejects stale or unsafe conflict revisions", async () => {
    const context = harness().context
    const completion = Promise.withResolvers<PRMergeResult>()
    const conflicts = spyOn(
      { run: async (_context: PRReviewContext, _base: string, _head: string) => ["a.txt"] },
      "run",
    )
    const host = {
      context: (_message: Record<string, unknown>) => context,
      post: (message: PRMergeResult) => completion.resolve(message),
      refresh: spyOn({ run: (_value: PRReviewContext) => {} }, "run"),
      dirtyFiles: () => [],
      conflicts,
    }
    const actions = new PRMergeActions(host)
    actions.handle({
      type: "agentManager.loadPRConflicts",
      projectId: context.projectId,
      worktreeId: context.worktreeId,
      requestId: "stale-conflicts",
      prNumber: context.pr.number,
      prUrl: context.pr.url,
      base: "c".repeat(40),
      head,
    })
    expect(await completion.promise).toMatchObject({
      type: "agentManager.loadPRConflictsResult",
      success: false,
    })
    expect(conflicts).not.toHaveBeenCalled()
  })
})
