import { readFile } from "node:fs/promises"
import { describe, expect, it, beforeEach, afterEach, afterAll, spyOn } from "bun:test"
import * as actions from "../../src/agent-manager/pr/PRActions"
import * as gh from "../../src/agent-manager/gh"

const resolveComment = spyOn(actions, "resolveComment").mockResolvedValue(undefined)
const unresolveComment = spyOn(actions, "unresolveComment").mockResolvedValue(undefined)
const addCommentReaction = spyOn(actions, "addCommentReaction").mockResolvedValue(undefined)
const removeCommentReaction = spyOn(actions, "removeCommentReaction").mockResolvedValue(undefined)
const execute = spyOn(gh, "execGhRead")

async function readInput(args: string[]) {
  const index = args.indexOf("--input")
  const file = args.at(index + 1)
  if (index < 0 || !file) throw new Error("Missing gh input file")
  return JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>
}

afterAll(() => {
  resolveComment.mockRestore()
  unresolveComment.mockRestore()
  addCommentReaction.mockRestore()
  removeCommentReaction.mockRestore()
  execute.mockRestore()
})

import { PRStatusBridge } from "../../src/agent-manager/pr-status-bridge"
import { PRStatusPoller } from "../../src/agent-manager/PRStatusPoller"
import type { AgentManagerOutMessage, PRStatus } from "../../src/agent-manager/types"

const pr: PRStatus = {
  number: 1,
  title: "my PR",
  url: "https://github.com/x/y/pull/1",
  state: "open",
  review: null,
  checks: { status: "none", total: 0, passed: 0, failed: 0, pending: 0, checks: [] },
  reviewers: [],
  additions: 0,
  deletions: 0,
  files: 0,
}

const refs = { baseRefOid: "a".repeat(40), headRefOid: "b".repeat(40) }

function page(nodes: unknown[], total = nodes.length, cursor?: string, revision = refs) {
  return {
    data: {
      repository: {
        pullRequest: {
          ...revision,
          reviewThreads: {
            nodes,
            totalCount: total,
            pageInfo: { hasNextPage: cursor !== undefined, endCursor: cursor ?? null },
          },
        },
      },
    },
  }
}

function harness(opts: { hasPersisted?: boolean; projectId?: string } = {}) {
  const sent: AgentManagerOutMessage[] = []
  const opened: string[] = []
  const reads: (string | undefined)[] = []
  const done = Promise.withResolvers<void>()
  const worktrees: { id: string; path: string; branch: string; prUrl?: string }[] = [
    { id: "wt1", path: "/repo/wt1", branch: "feature" },
  ]
  const bridge = PRStatusBridge.create({
    getWorktrees: () => worktrees as never,
    getWorkspaceRoot: () => "/repo",
    postToWebview: (msg) => {
      sent.push(msg)
      if (typeof msg.type === "string" && msg.type.endsWith("Result")) done.resolve()
    },
    updateWorktreePR: () => {},
    hasPersistedPR: () => opts.hasPersisted ?? false,
    openExternal: (url) => opened.push(url),
    log: () => {},
    projectId: () => {
      reads.push(opts.projectId)
      return opts.projectId
    },
  })
  const onStatus = (bridge.poller as unknown as { options: { onStatus: (...a: unknown[]) => void } }).options.onStatus
  return { bridge, sent, opened, onStatus, worktrees, reads, done: done.promise }
}

describe("PRStatusPoller batched GitHub queries", () => {
  it.each([
    { lookup: "sha", state: "MERGED", exact: true, expected: null },
    { lookup: "sha", state: "CLOSED", exact: true, expected: null },
    { lookup: "sha", state: "OPEN", exact: true, expected: "open" },
    { lookup: "sha", state: "OPEN", exact: false, expected: null },
    { lookup: "tracking", state: "MERGED", exact: true, expected: "merged" },
    { lookup: "tracking", state: "CLOSED", exact: true, expected: "closed" },
    { lookup: "branch", state: "MERGED", exact: true, expected: "merged" },
    { lookup: "branch", state: "CLOSED", exact: true, expected: "closed" },
  ])("resolves $lookup PRs in state $state (exact SHA: $exact)", async ({ lookup, state, exact, expected }) => {
    const poller = new PRStatusPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => "/repo",
      onStatus: () => undefined,
      log: () => undefined,
    })
    const calls: string[][] = []
    const internal = poller as unknown as {
      fetchPRForBranch: (branch: string, cwd: string) => Promise<{ state: string } | null>
      gh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
      shell: (command: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
    }
    internal.shell = async (command, args) => {
      expect(command).toBe("git")
      expect(args).toEqual(["rev-parse", "HEAD"])
      return { stdout: refs.headRefOid, stderr: "" }
    }
    internal.gh = async (args) => {
      calls.push(args)
      const data = {
        number: 1,
        title: "Example change",
        url: "https://github.com/example/project/pull/1",
        state,
        headRefName: lookup === "sha" ? "contributor-change" : "feature",
        headRefOid: exact ? refs.headRefOid : refs.baseRefOid,
      }
      if (args.at(1) === "view") {
        if (lookup === "tracking" || (lookup === "branch" && args.at(2) === "feature"))
          return { stdout: JSON.stringify(data), stderr: "" }
        throw new Error("no pull requests found for branch")
      }
      const filter = args.at(args.indexOf("--state") + 1)
      return { stdout: JSON.stringify(filter === "all" || filter === state.toLowerCase() ? [data] : []), stderr: "" }
    }

    const result = await internal.fetchPRForBranch("feature", "/repo")
    expect(result?.state ?? null).toBe(expected)
    expect(calls.map((args) => args.slice(0, 3))).toEqual(
      lookup === "tracking"
        ? [["pr", "view", "--json"]]
        : lookup === "branch"
          ? [
              ["pr", "view", "--json"],
              ["pr", "view", "feature"],
            ]
          : [
              ["pr", "view", "--json"],
              ["pr", "view", "feature"],
              ["pr", "list", "--state"],
            ],
    )
    if (lookup === "sha") {
      expect(calls.at(-1)?.slice(0, 8)).toEqual([
        "pr",
        "list",
        "--state",
        "open",
        "--search",
        `${refs.headRefOid} is:pr`,
        "--limit",
        "5",
      ])
    }
    poller.stop()
  })

  it("merges reviewer avatars from the GraphQL query and caches them per login", async () => {
    const poller = new PRStatusPoller({
      getWorktrees: () => [],
      getWorkspaceRoot: () => "/repo",
      onStatus: () => undefined,
      log: () => undefined,
    })
    const internal = poller as unknown as {
      reviewers: (
        pr: { number: number; reviewers?: Array<{ login: string; state: string; avatar?: string }> },
        cwd: string,
      ) => Promise<Array<{ login: string; state: string; avatar?: string }>>
      fetchReviewers: (
        number: number,
        cwd: string,
      ) => Promise<{
        items: Array<{ login: string; state: string; avatar?: string }>
        ok: boolean
      }>
    }
    const fetches: number[] = []
    internal.fetchReviewers = async (number) => {
      fetches.push(number)
      return {
        items: [{ login: "eshurakov", state: "commented", avatar: "https://avatar/eshurakov" }],
        ok: true,
      }
    }
    const result = [{ login: "eshurakov", state: "approved", avatar: "https://avatar/eshurakov" }]

    expect(
      await internal.reviewers({ number: 7, reviewers: [{ login: "eshurakov", state: "approved" }] }, "/repo"),
    ).toEqual(result)
    expect(
      await internal.reviewers({ number: 7, reviewers: [{ login: "eshurakov", state: "approved" }] }, "/repo"),
    ).toEqual(result)
    expect(fetches).toEqual([7])
    poller.stop()
  })

  it("forwards the actual branch for null PR results", async () => {
    const values: Array<{ pr: PRStatus | null; branch?: string }> = []
    const branches: string[] = []
    const poller = new PRStatusPoller({
      getWorktrees: () => [{ id: "wt1", path: "/repo", branch: "HEAD" }] as never,
      getWorkspaceRoot: () => "/repo",
      onStatus: (_id, status, _error, branch) => values.push({ pr: status, branch }),
      getBranch: async () => "feature/real",
      log: () => undefined,
    })
    const internal = poller as unknown as {
      target: (id: string) => { id: string; path: string; branch: string }
      cachedFetchPR: (branch: string) => Promise<null>
      fetchOne: (id: string) => Promise<void>
    }
    internal.target = () => ({ id: "wt1", path: "/repo", branch: "HEAD" })
    internal.cachedFetchPR = async (branch) => {
      branches.push(branch)
      return null
    }

    await internal.fetchOne("wt1")

    expect(values).toEqual([{ pr: null, branch: "feature/real" }])
    expect(branches).toEqual(["feature/real"])
    poller.stop()
  })

  it("reports resolved and unverified error branches without suppressing branch changes", async () => {
    const values: Array<{ error?: string; branch?: string }> = []
    const tree = { id: "wt1", path: process.cwd(), branch: "HEAD", parentBranch: "", createdAt: "" }
    let branch: string | Error | undefined
    const poller = new PRStatusPoller({
      getWorktrees: () => [tree],
      getWorkspaceRoot: () => tree.path,
      getBranch: async () => {
        if (branch instanceof Error) throw branch
        return branch
      },
      onStatus: (_id, _pr, error, branch) => values.push({ error, branch }),
      log: () => undefined,
    })
    const internal = poller as unknown as {
      fetchOne: (id: string) => Promise<void>
      gh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
    }
    internal.gh = async () => {
      throw new Error("offline")
    }

    for (const name of ["feature/a", "feature/a", "feature/b", undefined, "feature/c", new Error("offline")]) {
      branch = name
      await expect(internal.fetchOne("wt1")).rejects.toThrow("offline")
    }

    expect(values).toEqual([
      { error: "fetch_failed", branch: "feature/a" },
      { error: "fetch_failed", branch: "feature/b" },
      { error: "fetch_failed", branch: undefined },
      { error: "fetch_failed", branch: "feature/c" },
      { error: "fetch_failed", branch: undefined },
    ])
    poller.stop()
  })

  it("invalidates lookup and dedup caches and refreshes all comment metadata", () => {
    const { bridge } = harness()
    const internal = bridge.poller as unknown as {
      active: boolean
      generation: number
      prCache: Map<string, unknown>
      lastHash: Map<string, string>
      fetchOne: (id: string, generation: number, full: boolean) => Promise<void>
    }
    const fetch = spyOn(internal, "fetchOne").mockResolvedValue(undefined)
    internal.prCache.set("/repo\0feature", { result: pr, expires: Infinity })
    internal.lastHash.set("wt1", "stale")
    bridge.poller.refresh("wt1")
    expect(internal.prCache.size).toBe(0)
    expect(internal.lastHash.size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
    internal.active = true
    bridge.poller.refresh("wt1")
    expect(fetch).toHaveBeenCalledWith("wt1", internal.generation, true)
  })
  it("loads checks and reviewers with one request and isolates projects and detached worktrees", async () => {
    let root = "/alpha"
    const tree = { id: "wt1", path: "/alpha/feature", branch: "feature" }
    const calls: string[][] = []
    const values: PRStatus[] = []
    const poller = new PRStatusPoller({
      getWorktrees: () => [tree] as never,
      getWorkspaceRoot: () => root,
      onStatus: (_id, status) => {
        if (status) values.push(status)
      },
      log: () => undefined,
    })
    const internal = poller as unknown as {
      fetchOne: (id: string) => Promise<void>
      target: (id: string) => typeof tree
      gh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
    }
    internal.target = () => tree
    internal.gh = async (args) => {
      calls.push(args)
      if (args[0] === "repo") {
        return { stdout: JSON.stringify({ owner: { login: "example" }, name: root.slice(1) }), stderr: "" }
      }
      if (args[0] === "api") return { stdout: JSON.stringify(page([])), stderr: "" }
      return {
        stdout: JSON.stringify({
          number: root === "/alpha" ? 1 : tree.branch === "HEAD" ? (tree.path.endsWith("one") ? 3 : 4) : 2,
          url: `https://github.com/example/${root.slice(1)}/pull/1`,
          statusCheckRollup: [{ name: "build", conclusion: "SUCCESS" }],
          reviewRequests: [{ login: "reviewer" }],
          reviews: [],
        }),
        stderr: "",
      }
    }

    await internal.fetchOne("wt1")
    root = "/beta"
    tree.path = "/beta/feature"
    await internal.fetchOne("wt1")
    tree.branch = "HEAD"
    tree.path = "/beta/one"
    await internal.fetchOne("wt1")
    tree.path = "/beta/two"
    await internal.fetchOne("wt1")

    const lookups = calls.filter((args) => args[0] === "pr")
    expect(lookups).toHaveLength(4)
    expect(lookups.every((args) => args[1] === "view")).toBe(true)
    expect(lookups.at(0)?.at(-1)).toContain("statusCheckRollup,reviewRequests,reviews")
    expect(values.map((item) => item.number)).toEqual([1, 2, 3, 4])
    expect(values[0]?.checks.passed).toBe(1)
    expect(values[0]?.reviewers).toEqual([{ login: "reviewer", avatar: undefined, state: "pending" }])
  })

  it.each([['Unknown JSON field: "statusCheckRollup"'], ["GraphQL: Resource not accessible by integration"]])(
    "retries basic pull request fields after %s",
    async (message) => {
      const poller = new PRStatusPoller({
        getWorktrees: () => [],
        getWorkspaceRoot: () => "/repo",
        onStatus: () => undefined,
        log: () => undefined,
      })
      const calls: string[][] = []
      const internal = poller as unknown as {
        query: (args: string[], cwd: string) => Promise<string>
        gh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
      }
      internal.gh = async (args) => {
        calls.push(args)
        if (args.at(-1)?.includes("statusCheckRollup")) throw new Error(message)
        return { stdout: '{"number":1}', stderr: "" }
      }

      expect(await internal.query(["pr", "view"], "/repo")).toBe('{"number":1}')
      expect(await internal.query(["pr", "view"], "/repo")).toBe('{"number":1}')
      expect(calls).toHaveLength(3)
      expect(calls[1]?.at(-1)).not.toContain("statusCheckRollup")
      expect(calls[2]?.at(-1)).not.toContain("statusCheckRollup")

      poller.stop()
      expect(await internal.query(["pr", "view"], "/repo")).toBe('{"number":1}')
      expect(calls).toHaveLength(5)
      expect(calls[3]?.at(-1)).toContain("statusCheckRollup")
    },
  )
})

describe("PRStatusPoller unresolved threads", () => {
  it.each([false, true])("paginates and refreshes counts with optional comments (active: %s)", async (active) => {
    const { bridge, sent, worktrees } = harness()
    worktrees.at(0)!.path = process.cwd()
    const internal = bridge.poller as unknown as {
      fetchOne: (id: string) => Promise<void>
      gh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
    }
    const calls: string[][] = []
    const nodes = Array.from({ length: 102 }, (_, index) => ({
      id: `thread${index}`,
      isResolved: index < 100,
      isOutdated: index === 100,
      comments: { nodes: index === 101 ? [] : [{ id: `comment${index}`, body: "Reviewed" }] },
    }))
    nodes.at(100)?.comments.nodes.push({ id: "reply", body: "Agreed" })
    internal.gh = async (args) => {
      if (args[0] === "repo") return { stdout: JSON.stringify({ owner: { login: "x" }, name: "y" }), stderr: "" }
      if (args[0] === "api" && args[1] !== "graphql")
        return { stdout: JSON.stringify({ allow_auto_merge: true }), stderr: "" }
      if (args[0] === "pr") {
        return { stdout: JSON.stringify({ ...pr, statusCheckRollup: [], reviewRequests: [], reviews: [] }), stderr: "" }
      }
      calls.push(args)
      const after = args.includes("cursor=next")
      const batch = nodes.slice(after ? 100 : 0, after ? undefined : 100)
      const data = page(
        active ? batch : batch.map((node) => ({ isResolved: node.isResolved })),
        102,
        after ? undefined : "next",
      )
      if (active && !after)
        Object.assign(data.data.repository.pullRequest, {
          timelineItems: {
            pageInfo: { hasPreviousPage: true },
            nodes: [
              {
                __typename: "IssueComment",
                id: "conversation",
                author: { login: "alice" },
                body: "General comment",
                createdAt: "2026-09-01T10:00:00Z",
              },
              {
                __typename: "PullRequestReview",
                id: "review",
                author: { login: "bob" },
                body: "Review summary",
                state: "CHANGES_REQUESTED",
                submittedAt: "2026-09-01T11:00:00Z",
              },
            ],
          },
        })
      return { stdout: JSON.stringify(data), stderr: "" }
    }
    if (active) bridge.poller.setActiveWorktreeId("wt1")
    await internal.fetchOne("wt1")
    const status = bridge.snapshot().get("wt1")
    expect(status).toMatchObject(refs)
    expect(status?.unresolvedThreads).toBe(2)
    expect(calls).toHaveLength(2)
    expect(calls.at(1)).toContain("cursor=next")
    for (const args of calls) {
      const query = args.find((arg) => arg.startsWith("query=")) ?? ""
      expect(query).toContain("baseRefOid")
      expect(query).toContain("headRefOid")
      expect(query.includes("comments(first: 10)")).toBe(active)
      expect(query.includes("latest: comments(last: 10)")).toBe(active)
      expect(query.includes("body")).toBe(active)
      expect(query.includes("timelineItems(last: 100")).toBe(active && !args.includes("cursor=next"))
      expect(query.includes("PULL_REQUEST_COMMIT")).toBe(active && !args.includes("cursor=next"))
      expect(query.includes("pageInfo { hasPreviousPage }")).toBe(active && !args.includes("cursor=next"))
      expect(query.includes("viewerDidAuthor viewerCanUpdate viewerCanDelete")).toBe(active)
    }
    if (active) {
      expect(status?.comments).toMatchObject({ total: 102, unresolved: 2 })
      expect(status?.comments?.comments).toHaveLength(101)
      expect(status?.comments?.comments.at(-1)).toMatchObject({ body: "Reviewed", replies: [{ body: "Agreed" }] })
      expect(status?.conversation).toMatchObject([
        { id: "conversation", body: "General comment" },
        { id: "review", body: "Review summary", state: "changes_requested" },
      ])
      expect(status?.conversationHasEarlier).toBe(true)
    }
    if (!active) {
      expect(status?.comments).toBeUndefined()
      expect(status?.conversation).toBeUndefined()
    }
    sent.length = 0
    for (const node of nodes) node.isResolved = true
    await internal.fetchOne("wt1")
    expect(sent).toEqual([expect.objectContaining({ pr: expect.objectContaining({ unresolvedThreads: 0 }) })])
  })

  it.each(["baseRefOid", "headRefOid"] as const)(
    "rejects mixed %s pages without carrying cached comments",
    async (field) => {
      const { bridge, onStatus, worktrees } = harness()
      worktrees.at(0)!.path = process.cwd()
      onStatus("wt1", {
        ...pr,
        ...refs,
        comments: {
          total: 1,
          unresolved: 1,
          comments: [
            {
              id: "old",
              threadId: "old",
              author: "reviewer",
              body: "Cached body",
              resolved: false,
              outdated: false,
            },
          ],
        },
      })
      const revision = { ...refs, [field]: "c".repeat(40) }
      const internal = bridge.poller as unknown as {
        fetchOne: (id: string) => Promise<void>
        gh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
        shell: () => Promise<never>
      }
      let reads = 0
      internal.shell = async () => {
        reads++
        throw new Error("Preview must wait for all thread pages")
      }
      internal.gh = async (args) => {
        if (args[0] === "repo") return { stdout: JSON.stringify({ owner: { login: "x" }, name: "y" }), stderr: "" }
        if (args[0] === "pr")
          return {
            stdout: JSON.stringify({ ...pr, ...refs, statusCheckRollup: [], reviewRequests: [], reviews: [] }),
            stderr: "",
          }
        const after = args.includes("cursor=next")
        return {
          stdout: JSON.stringify(
            page(
              [
                {
                  id: after ? "second" : "first",
                  isResolved: false,
                  isOutdated: false,
                  path: "file.ts",
                  diffSide: "RIGHT",
                  line: 1,
                  comments: { nodes: [{ id: after ? "second-comment" : "first-comment", body: "Current body" }] },
                },
              ],
              2,
              after ? undefined : "next",
              after ? revision : refs,
            ),
          ),
          stderr: "",
        }
      }
      bridge.poller.setActiveWorktreeId("wt1")
      await internal.fetchOne("wt1")
      const status = bridge.snapshot().get("wt1")
      expect(status).toMatchObject(revision)
      expect(status?.comments).toBeUndefined()
      expect(status?.unresolvedThreads).toBeUndefined()
      expect(reads).toBe(0)
      bridge.poller.stop()
    },
  )

  it("leaves the count unknown when a later page fails", async () => {
    const { bridge, sent, worktrees } = harness()
    worktrees.at(0)!.path = process.cwd()
    const internal = bridge.poller as unknown as {
      fetchOne: (id: string) => Promise<void>
      gh: (args: string[]) => Promise<{ stdout: string; stderr: string }>
    }
    internal.gh = async (args) => {
      if (args[0] === "repo") return { stdout: JSON.stringify({ owner: { login: "x" }, name: "y" }), stderr: "" }
      if (args[0] === "pr") {
        return { stdout: JSON.stringify({ ...pr, statusCheckRollup: [], reviewRequests: [], reviews: [] }), stderr: "" }
      }
      if (args.includes("cursor=next")) throw new Error("Rate limited")
      return { stdout: JSON.stringify(page([{ isResolved: false }], 2, "next")), stderr: "" }
    }
    await internal.fetchOne("wt1")
    expect(sent).toHaveLength(1)
    const status = bridge.snapshot().get("wt1")
    expect(status?.number).toBe(pr.number)
    expect(status?.unresolvedThreads).toBeUndefined()
  })
})

function cached(status: PRStatus, projectId?: string) {
  const h = harness({ projectId })
  h.onStatus("wt1", status)
  h.sent.length = 0
  const refresh = spyOn(h.bridge.poller, "refresh").mockImplementation(() => {})
  return { ...h, refresh }
}

describe("PRStatusBridge replies", () => {
  const request = {
    type: "agentManager.replyComment",
    worktreeId: "wt1",
    threadId: "PRT_1",
    body: "@.env\n@alice PTAL\n'quoted' $(touch nope) `command` \\ true\n\n```suggestion\n  const value = \"$HOME\"\n  return value\n```\n",
    requestId: "request-1",
  }
  const status: PRStatus = {
    ...pr,
    comments: {
      total: 1,
      unresolved: 1,
      comments: [{ id: "comment", threadId: "PRT_1", author: "reviewer", body: "Review", resolved: false }],
    },
  }
  const response = { data: { addPullRequestReviewThreadReply: { comment: { id: "reply" } } } }
  const inputs: Record<string, unknown>[] = []
  beforeEach(() => {
    inputs.length = 0
    execute.mockImplementation(async (args) => {
      if (args.includes("--input")) inputs.push(await readInput(args))
      return { stdout: JSON.stringify(response), stderr: "" }
    })
  })
  afterEach(() => execute.mockClear())

  it.each([undefined, "alpha"])(
    "replies with raw variables and refreshes the owning project (%s)",
    async (projectId) => {
      const { bridge, sent, refresh, done } = cached(status, projectId)
      expect(bridge.handleMessage({ ...request, projectId })).toBe(true)
      await done
      expect(execute).toHaveBeenCalledTimes(1)
      const [args, opts] = execute.mock.calls.at(0)!
      expect(args).toEqual(["api", "graphql", "--method", "POST", "--input", expect.any(String)])
      expect(args.some((arg) => arg.startsWith("body=") || arg.includes(".env"))).toBe(false)
      expect(inputs).toHaveLength(1)
      expect(inputs[0]).toEqual(
        expect.objectContaining({
          query: expect.stringContaining("addPullRequestReviewThreadReply"),
          variables: { id: "PRT_1", body: request.body },
        }),
      )
      expect(opts?.cwd).toBe("/repo/wt1")
      expect(sent).toEqual([
        {
          type: "agentManager.replyCommentResult",
          worktreeId: "wt1",
          threadId: "PRT_1",
          requestId: "request-1",
          success: true,
          ...(projectId ? { projectId } : {}),
        },
      ])
      expect(refresh).toHaveBeenCalledWith("wt1")
    },
  )

  it.each(["blank", "missing worktree", "missing thread", "missing cache", "changed branch", "other project"])(
    "rejects %s without a GitHub mutation",
    (kind) => {
      const { bridge, sent, onStatus, worktrees } = harness({ projectId: "alpha" })
      if (kind !== "missing cache") onStatus("wt1", status)
      sent.length = 0
      if (kind === "missing worktree") worktrees.length = 0
      if (kind === "changed branch") worktrees.at(0)!.branch = "other"
      bridge.handleMessage({
        ...request,
        projectId: kind === "other project" ? "beta" : "alpha",
        body: kind === "blank" ? " \n\t" : request.body,
        threadId: kind === "missing thread" ? "other" : request.threadId,
      })
      expect(execute).not.toHaveBeenCalled()
      if (kind === "other project")
        expect(sent).toEqual([
          expect.objectContaining({
            type: "agentManager.replyCommentResult",
            projectId: "beta",
            worktreeId: "wt1",
            threadId: "PRT_1",
            requestId: "request-1",
            success: false,
          }),
        ])
      else
        expect(sent).toEqual([
          expect.objectContaining({ success: false, requestId: "request-1", error: expect.any(String) }),
        ])
    },
  )

  it.each(["GraphQL", "missing data", "process"])("reports %s failure without refreshing", async (kind) => {
    const { bridge, sent, refresh, done } = cached(status)
    if (kind === "process") execute.mockRejectedValueOnce(new Error("gh: Not Found"))
    else
      execute.mockResolvedValueOnce({
        stdout: JSON.stringify(kind === "GraphQL" ? { ...response, errors: [{ message: "Forbidden" }] } : {}),
        stderr: "",
      })
    bridge.handleMessage(request)
    await done
    expect(sent).toEqual([
      expect.objectContaining({ success: false, requestId: "request-1", error: expect.any(String) }),
    ])
    expect(refresh).not.toHaveBeenCalled()
  })

  it("retains the root and newest replies without duplicates in a long thread", async () => {
    const { parseComments } = await import("../../src/agent-manager/pr/am-pr-utils")
    const comments = Array.from({ length: 25 }, (_, index) => ({ id: String(index), body: `Comment ${index}` }))
    for (const count of [1, 11, 25]) {
      const nodes = comments.slice(0, count)
      const parsed = parseComments([
        {
          id: "PRT_1",
          comments: { nodes: nodes.slice(0, 10).map((node) => ({ ...node, path: "file.ts" })) },
          latest: { nodes: nodes.slice(-10) },
        },
      ])
      expect(parsed.at(0)?.body).toBe("Comment 0")
      expect(parsed.at(0)?.file).toBe("file.ts")
      if (count > 1) expect(parsed.at(0)?.replies?.at(-1)?.body).toBe(`Comment ${count - 1}`)
      expect(new Set(parsed.at(0)?.replies?.map((reply) => reply.body)).size).toBe(parsed.at(0)?.replies?.length ?? 0)
    }
  })
})

describe("PRStatusBridge comment mutations", () => {
  afterEach(() => execute.mockClear())
  const status: PRStatus = {
    ...pr,
    id: "PR_1",
    conversation: [
      { id: "issue", kind: "issue", author: "me", body: "Mine", canEdit: true, canDelete: true },
      { id: "other", kind: "issue", author: "other", body: "Not mine", canEdit: false, canDelete: false },
      { id: "summary", kind: "review", author: "me", body: "Review", canEdit: true, canDelete: true },
    ],
    comments: {
      total: 1,
      unresolved: 1,
      comments: [
        {
          id: "root",
          threadId: "thread",
          author: "me",
          body: "Root",
          resolved: false,
          canEdit: true,
          canDelete: true,
          replies: [{ id: "reply", author: "me", body: "Reply", canEdit: true, canDelete: true }],
        },
      ],
    },
  }
  const request = {
    type: "agentManager.mutateComment",
    worktreeId: "wt1",
    requestId: "request",
    prNumber: 1,
    prUrl: pr.url,
    body: "@.env\n@alice PTAL\n'quoted' $(touch nope) `command` \\ true\n\n```suggestion\n  const value = \"$HOME\"\n  return value\n```\n",
  }
  it.each([
    ["create", "ignored", "addComment", "subjectId", "PR_1", { commentEdge: { node: { id: "new" } } }],
    ["edit", "issue", "updateIssueComment", "id", "issue", { issueComment: { id: "issue" } }],
    ["delete", "issue", "deleteIssueComment", "id", "issue", { clientMutationId: null }],
    [
      "edit",
      "root",
      "updatePullRequestReviewComment",
      "pullRequestReviewCommentId",
      "root",
      { pullRequestReviewComment: { id: "root" } },
    ],
    [
      "edit",
      "reply",
      "updatePullRequestReviewComment",
      "pullRequestReviewCommentId",
      "reply",
      { pullRequestReviewComment: { id: "reply" } },
    ],
    ["delete", "reply", "deletePullRequestReviewComment", "id", "reply", { clientMutationId: null }],
  ] as const)("routes %s %s from cached metadata", async (action, commentId, operation, field, id, payload) => {
    const { bridge, sent, refresh, done } = cached(status, "alpha")
    const inputs: Record<string, unknown>[] = []
    execute.mockImplementation(async (args) => {
      inputs.push(await readInput(args))
      return { stdout: JSON.stringify({ data: { [operation]: payload } }), stderr: "" }
    })
    expect(bridge.handleMessage({ ...request, projectId: "alpha", action, commentId, kind: "bogus" })).toBe(true)
    await done
    expect(execute).toHaveBeenCalledTimes(1)
    const [args, opts] = execute.mock.calls.at(0)!
    expect(args).toEqual(["api", "graphql", "--method", "POST", "--input", expect.any(String)])
    expect(
      args.some(
        (arg) => arg.startsWith("body=") || arg.startsWith("id=") || arg.startsWith("query=") || arg.includes(".env"),
      ),
    ).toBe(false)
    expect(inputs).toEqual([
      expect.objectContaining({
        query: expect.stringContaining(`${operation}(input: { ${field}: $id`),
        variables: {
          id,
          ...(action === "delete" ? {} : { body: request.body }),
        },
      }),
    ])
    expect(opts?.cwd).toBe("/repo/wt1")
    expect(sent).toEqual([
      {
        type: "agentManager.mutateCommentResult",
        projectId: "alpha",
        worktreeId: "wt1",
        requestId: "request",
        success: true,
      },
    ])
    expect(refresh).toHaveBeenCalledWith("wt1")
  })

  it.each([
    "blank",
    "missing worktree",
    "missing cache",
    "changed branch",
    "number",
    "url",
    "unknown",
    "other",
    "summary",
    "permission",
    "node",
    "action",
    "project",
  ])("rejects %s without mutation", async (kind) => {
    const { bridge, sent, onStatus, worktrees } = harness({ projectId: "alpha" })
    const cached = structuredClone(status)
    if (kind === "node") delete cached.id
    if (kind === "permission") cached.conversation!.at(0)!.canDelete = false
    if (kind !== "missing cache") onStatus("wt1", cached)
    sent.length = 0
    if (kind === "missing worktree") worktrees.length = 0
    if (kind === "changed branch") worktrees.at(0)!.branch = "other"
    const refresh = spyOn(bridge.poller, "refresh").mockImplementation(() => {})
    bridge.handleMessage({
      ...request,
      projectId: kind === "project" ? "beta" : "alpha",
      prNumber: kind === "number" ? 2 : 1,
      prUrl: kind === "url" ? "https://github.com/other/repo/pull/1" : pr.url,
      action: kind === "action" ? "bogus" : kind === "permission" ? "delete" : kind === "node" ? "create" : "edit",
      commentId: ["unknown", "other", "summary"].includes(kind) ? kind : "issue",
      body: kind === "blank" ? " \n\t" : request.body,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(execute).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    if (kind === "project")
      expect(sent).toEqual([
        expect.objectContaining({
          type: "agentManager.mutateCommentResult",
          projectId: "beta",
          worktreeId: "wt1",
          requestId: "request",
          success: false,
        }),
      ])
    else
      expect(sent).toEqual([
        expect.objectContaining({ success: false, requestId: "request", error: expect.any(String) }),
      ])
  })

  it.each([
    [
      "GraphQL",
      { data: { updateIssueComment: { issueComment: { id: "issue" } } }, errors: [{ message: "Forbidden" }] },
    ],
    ["missing data", {}],
    ["wrong id", { data: { updateIssueComment: { issueComment: { id: "other" } } } }],
    ["empty delete", { data: { deleteIssueComment: {} } }],
    ["process", new Error("gh: Forbidden")],
    ["invalid JSON", "not JSON"],
  ])("reports %s and retains cached UI", async (kind, response) => {
    const { bridge, sent, refresh, done } = cached(status)
    if (response instanceof Error) execute.mockRejectedValueOnce(response)
    else
      execute.mockResolvedValueOnce({
        stdout: typeof response === "string" ? response : JSON.stringify(response),
        stderr: "",
      })
    bridge.handleMessage({ ...request, action: kind === "empty delete" ? "delete" : "edit", commentId: "issue" })
    await done
    expect(sent).toEqual([expect.objectContaining({ success: false, requestId: "request", error: expect.any(String) })])
    expect(refresh).not.toHaveBeenCalled()
    expect(bridge.snapshot().get("wt1")).toEqual(status)
  })
})

describe("PRStatusBridge project routing", () => {
  it.each([
    ["agentManager.loadPRFiles", {}],
    [
      "agentManager.createReviewComment",
      { snapshotId: "snapshot", path: "file.ts", side: "RIGHT", startLine: 1, endLine: 1, body: "body" },
    ],
    ["agentManager.submitPRReview", { snapshotId: "snapshot", head: "head", event: "COMMENT", body: "body" }],
    ["agentManager.previewPRSuggestion", { commentId: "comment", suggestion: 0 }],
    ["agentManager.applyPRSuggestion", { token: "token" }],
  ] as const)("acknowledges a %s mismatch on its original route", async (type, fields) => {
    execute.mockClear()
    const { bridge, sent } = harness({ projectId: "active" })
    const refresh = spyOn(bridge.poller, "refresh").mockImplementation(() => {})
    const requestId = `${type}-request`
    expect(
      bridge.handleMessage({
        type,
        projectId: "background",
        worktreeId: "wt1",
        requestId,
        prNumber: 1,
        prUrl: pr.url,
        ...fields,
      }),
    ).toBe(true)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(execute).not.toHaveBeenCalled()
    expect(refresh).not.toHaveBeenCalled()
    expect(sent).toEqual([
      expect.objectContaining({
        type: `${type}Result`,
        projectId: "background",
        worktreeId: "wt1",
        requestId,
        prNumber: 1,
        prUrl: pr.url,
        success: false,
      }),
    ])
    expect(JSON.stringify(sent)).not.toContain("active")
  })
})

it.each(["resolveComment", "unresolveComment"])("settles %s without refreshing a different project", async (action) => {
  const opts = { projectId: "original" }
  const { bridge, sent } = harness(opts)
  const pending = Promise.withResolvers<void>()
  const operation = action === "resolveComment" ? resolveComment : unresolveComment
  operation.mockReturnValueOnce(pending.promise)
  const refresh = spyOn(bridge.poller, "refresh").mockImplementation(() => {})
  bridge.handleMessage({
    type: `agentManager.${action}`,
    projectId: opts.projectId,
    worktreeId: "wt1",
    threadId: "thread",
  })
  opts.projectId = "other"
  pending.resolve()
  await Promise.resolve()
  expect(sent).toEqual([
    expect.objectContaining({ type: `agentManager.${action}Result`, projectId: "original", success: true }),
  ])
  expect(refresh).not.toHaveBeenCalled()
})

describe("PRStatusBridge.handleMessage openPR", () => {
  it("opens an explicit URL from a background project", () => {
    const { bridge, opened } = harness({ projectId: "active" })

    bridge.handleMessage({
      type: "agentManager.openPR",
      projectId: "background",
      worktreeId: "wt1",
      url: "https://github.com/x/y/pull/2",
    })

    expect(opened).toEqual(["https://github.com/x/y/pull/2"])
  })

  it("does not look up a background worktree without an explicit URL", () => {
    const { bridge, opened, worktrees } = harness({ projectId: "active" })
    worktrees[0]!.prUrl = "https://github.com/x/y/pull/1"

    bridge.handleMessage({ type: "agentManager.openPR", projectId: "background", worktreeId: "wt1" })

    expect(opened).toEqual([])
  })
})

// --- error deduplication ---

describe("PRStatusBridge.notifyError", () => {
  it("sends the first error notification", () => {
    const { bridge, sent } = harness()
    bridge.notifyError("gh_missing")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ type: "agentManager.prError", error: "gh_missing" }))
  })

  it("tags errors with their owning project", () => {
    const { bridge, sent, reads } = harness({ projectId: "project-a" })
    bridge.notifyError("gh_missing")
    expect(sent).toEqual([{ type: "agentManager.prError", projectId: "project-a", error: "gh_missing" }])
    expect(reads).toEqual(["project-a"])
  })

  it("deduplicates the same error type", () => {
    const { bridge, sent } = harness()
    bridge.notifyError("gh_auth")
    bridge.notifyError("gh_auth")
    expect(sent).toHaveLength(1)
  })

  it("sends again when error type changes", () => {
    const { bridge, sent } = harness()
    bridge.notifyError("gh_missing")
    bridge.notifyError("gh_auth")
    expect(sent).toHaveLength(2)
  })
})

// --- onStatus cache suppression ---

describe("PRStatusBridge onStatus", () => {
  it("forwards a successful status to the webview", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", pr)
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ type: "agentManager.prStatus", worktreeId: "wt1", pr }))
  })

  it("forwards pr:null error when no cache entry and no persisted PR", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", null, "fetch_failed")
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ type: "agentManager.prStatus", worktreeId: "wt1", pr: null }))
  })

  it("suppresses pr:null error when cache entry exists", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    onStatus("wt1", null, "fetch_failed")
    expect(sent).toHaveLength(0)
  })

  it("suppresses pr:null error when persisted PR exists", () => {
    const { sent, onStatus } = harness({ hasPersisted: true })
    onStatus("wt1", null, "fetch_failed")
    expect(sent).toHaveLength(0)
  })

  it("forwards gh_auth error even when cache entry exists", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    onStatus("wt1", null, "gh_auth")
    const errorMsg = sent.find((m) => m.type === "agentManager.prError")
    expect(errorMsg).toEqual(expect.objectContaining({ error: "gh_auth" }))
  })

  it("forwards gh_missing error even when cache entry exists", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    onStatus("wt1", null, "gh_missing")
    const errorMsg = sent.find((m) => m.type === "agentManager.prError")
    expect(errorMsg).toEqual(expect.objectContaining({ error: "gh_missing" }))
  })

  // A rate limit, a network blip, or an unresolvable fork ref all look like "no
  // pull request". Forwarding that unmounts the panel and discards what the user
  // has open, so a PR already found on this branch stays.
  it("keeps a known PR when a poll finds no pull request on the same branch", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    onStatus("wt1", null)
    expect(sent).toHaveLength(0)
    expect(bridge.snapshot().get("wt1")).toEqual(pr)
  })

  it("drops the PR once the worktree is on another branch", () => {
    const { bridge, sent, onStatus, worktrees } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    worktrees[0]!.branch = "other"
    onStatus("wt1", null)
    expect(sent).toEqual([expect.objectContaining({ type: "agentManager.prStatus", worktreeId: "wt1", pr: null })])
    expect(bridge.snapshot().has("wt1")).toBe(false)
  })

  it("forwards no pull request for a worktree that never had one", () => {
    const { sent, onStatus } = harness()
    onStatus("wt1", null)
    expect(sent).toEqual([expect.objectContaining({ type: "agentManager.prStatus", worktreeId: "wt1", pr: null })])
  })

  it("reports the PR again after a branch switch back", () => {
    const { bridge, onStatus, worktrees } = harness()
    onStatus("wt1", pr)
    worktrees[0]!.branch = "other"
    onStatus("wt1", null)
    worktrees[0]!.branch = "feature"
    onStatus("wt1", pr)
    expect(bridge.snapshot().get("wt1")).toEqual(pr)
  })
})

// --- replay ---

describe("PRStatusBridge.replay", () => {
  it("replays cached status messages", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", pr)
    sent.length = 0
    bridge.replay()
    expect(sent).toHaveLength(1)
    expect(sent[0]).toEqual(expect.objectContaining({ type: "agentManager.prStatus", worktreeId: "wt1" }))
  })

  it("replays the last auth error on reconnect", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", null, "gh_auth")
    sent.length = 0
    bridge.replay()
    expect(
      sent.some((m) => m.type === "agentManager.prError" && (m as never as { error: string }).error === "gh_auth"),
    ).toBe(true)
  })

  it("preserves project ownership when replaying an error", () => {
    const { bridge, sent, onStatus, reads } = harness({ projectId: "project-a" })
    onStatus("wt1", null, "gh_missing")
    sent.length = 0
    reads.length = 0
    bridge.replay()
    expect(sent).toEqual([{ type: "agentManager.prError", projectId: "project-a", error: "gh_missing" }])
    expect(reads).toEqual(["project-a"])
  })

  it("does not replay fetch_failed errors", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", null, "fetch_failed")
    sent.length = 0
    bridge.replay()
    expect(sent).toHaveLength(0)
  })
})

// --- snapshot ---

describe("PRStatusBridge.snapshot", () => {
  it("returns only entries with a non-null pr", () => {
    const { bridge, onStatus } = harness()
    onStatus("wt1", pr)
    onStatus("wt2", pr)
    expect(bridge.snapshot().size).toBe(2)
  })

  it("excludes entries where pr was null", () => {
    const { bridge, onStatus } = harness({ hasPersisted: true })
    onStatus("wt1", null, "fetch_failed")
    expect(bridge.snapshot().size).toBe(0)
  })
})

// --- remove / reset ---

describe("PRStatusBridge.remove", () => {
  it("removes a cached entry so it is no longer replayed", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", pr)
    bridge.remove("wt1")
    sent.length = 0
    bridge.replay()
    expect(sent).toHaveLength(0)
  })
})

describe("PRStatusBridge.reset", () => {
  it("clears cache and error state so replay sends nothing", () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", pr)
    bridge.notifyError("gh_auth")
    bridge.reset()
    sent.length = 0
    bridge.replay()
    expect(sent).toHaveLength(0)
  })

  it("allows the same error to be sent again after reset", () => {
    const { bridge, sent } = harness()
    bridge.notifyError("gh_auth")
    bridge.reset()
    sent.length = 0
    bridge.notifyError("gh_auth")
    expect(sent).toHaveLength(1)
  })

  it("disposes suggestions, drops review snapshots, and allows future actions", async () => {
    const { bridge, sent } = harness()
    const current = bridge as unknown as {
      reviews: { snapshots: Map<string, unknown> }
      suggestions: { tokens: Map<string, unknown>; disposed: boolean }
    }
    const reviews = current.reviews
    const suggestions = current.suggestions
    reviews.snapshots.set("snapshot", { data: "x" })
    suggestions.tokens.set("token", { snapshot: "x" })

    bridge.reset()

    const next = bridge as unknown as {
      reviews: { snapshots: Map<string, unknown> }
      suggestions: { tokens: Map<string, unknown>; disposed: boolean }
    }
    expect(suggestions.disposed).toBe(true)
    expect(suggestions.tokens.size).toBe(0)
    expect(next.reviews).not.toBe(reviews)
    expect(next.reviews.snapshots.size).toBe(0)
    expect(next.suggestions).not.toBe(suggestions)
    expect(next.suggestions.disposed).toBe(false)

    bridge.handleMessage({
      type: "agentManager.previewPRSuggestion",
      worktreeId: "wt1",
      requestId: "future",
      prNumber: 1,
      prUrl: pr.url,
      commentId: "comment",
      suggestion: 0,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(sent.at(-1)).toEqual(
      expect.objectContaining({
        type: "agentManager.previewPRSuggestionResult",
        requestId: "future",
        success: false,
      }),
    )
    expect((sent.at(-1) as { error?: string }).error).not.toContain("disposed")
  })
})

// --- resolveComment / unresolveComment message handling ---

describe("PRStatusBridge.handleMessage resolveComment", () => {
  beforeEach(() => {
    resolveComment.mockReset()
    unresolveComment.mockReset()
  })

  it("returns true for agentManager.resolveComment", () => {
    const { bridge } = harness()
    resolveComment.mockResolvedValueOnce(undefined)
    expect(bridge.handleMessage({ type: "agentManager.resolveComment", worktreeId: "wt1", threadId: "PRT_1" })).toBe(
      true,
    )
  })

  it("returns true for agentManager.unresolveComment", () => {
    const { bridge } = harness()
    unresolveComment.mockResolvedValueOnce(undefined)
    expect(bridge.handleMessage({ type: "agentManager.unresolveComment", worktreeId: "wt1", threadId: "PRT_1" })).toBe(
      true,
    )
  })

  it("posts resolveCommentResult with success:true on resolve success", async () => {
    const { bridge, sent } = harness()
    resolveComment.mockResolvedValueOnce(undefined)
    bridge.handleMessage({ type: "agentManager.resolveComment", worktreeId: "wt1", threadId: "PRT_1" })
    await Promise.resolve()
    const result = sent.find((m) => m.type === "agentManager.resolveCommentResult")
    expect(result).toEqual(
      expect.objectContaining({
        type: "agentManager.resolveCommentResult",
        worktreeId: "wt1",
        threadId: "PRT_1",
        success: true,
      }),
    )
  })

  it("posts unresolveCommentResult with success:true on unresolve success", async () => {
    const { bridge, sent } = harness()
    unresolveComment.mockResolvedValueOnce(undefined)
    bridge.handleMessage({ type: "agentManager.unresolveComment", worktreeId: "wt1", threadId: "PRT_1" })
    await Promise.resolve()
    const result = sent.find((m) => m.type === "agentManager.unresolveCommentResult")
    expect(result).toEqual(expect.objectContaining({ success: true }))
  })

  it("posts resolveCommentResult with success:false on failure", async () => {
    const { bridge, sent } = harness()
    resolveComment.mockRejectedValueOnce(new Error("gh: Not Found"))
    bridge.handleMessage({ type: "agentManager.resolveComment", worktreeId: "wt1", threadId: "PRT_1" })
    await Promise.resolve()
    const result = sent.find((m) => m.type === "agentManager.resolveCommentResult")
    expect(result).toEqual(expect.objectContaining({ success: false }))
  })

  it("logs and returns early when no cwd found", () => {
    const logged: unknown[] = []
    const bridge = PRStatusBridge.create({
      getWorktrees: () => [] as never,
      getWorkspaceRoot: () => undefined,
      postToWebview: () => {},
      updateWorktreePR: () => {},
      hasPersistedPR: () => false,
      openExternal: () => {},
      log: (...args) => logged.push(args),
    })
    bridge.handleMessage({ type: "agentManager.resolveComment", worktreeId: "wt-missing", threadId: "PRT_1" })
    expect(resolveComment).not.toHaveBeenCalled()
    expect(logged.length).toBeGreaterThan(0)
  })
})

describe("PRStatusBridge.handleMessage commentReaction", () => {
  beforeEach(() => {
    addCommentReaction.mockReset()
    removeCommentReaction.mockReset()
  })

  it("adds a reaction to a cached review comment and reports success", async () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", {
      ...pr,
      comments: {
        total: 1,
        unresolved: 1,
        comments: [
          { id: "PRRC_1", threadId: "PRRT_1", author: "alice", body: "note", resolved: false, outdated: false },
        ],
      },
    })
    addCommentReaction.mockResolvedValueOnce(undefined)

    expect(
      bridge.handleMessage({
        type: "agentManager.commentReaction",
        worktreeId: "wt1",
        commentId: "PRRC_1",
        reaction: "HEART",
        add: true,
      }),
    ).toBe(true)
    await Promise.resolve()

    expect(addCommentReaction).toHaveBeenCalledWith("PRRC_1", "HEART", "/repo/wt1")
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "agentManager.commentReactionResult",
        worktreeId: "wt1",
        commentId: "PRRC_1",
        reaction: "HEART",
        add: true,
        success: true,
      }),
    )
  })

  it("adds a reaction to a cached thread reply and reports success", async () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", {
      ...pr,
      comments: {
        total: 1,
        unresolved: 1,
        comments: [
          {
            id: "PRRC_1",
            threadId: "PRRT_1",
            author: "alice",
            body: "note",
            resolved: false,
            outdated: false,
            replies: [{ id: "PRRC_2", author: "bob", body: "reply" }],
          },
        ],
      },
    })
    addCommentReaction.mockResolvedValueOnce(undefined)

    expect(
      bridge.handleMessage({
        type: "agentManager.commentReaction",
        worktreeId: "wt1",
        commentId: "PRRC_2",
        reaction: "HEART",
        add: true,
      }),
    ).toBe(true)
    await Promise.resolve()

    expect(addCommentReaction).toHaveBeenCalledWith("PRRC_2", "HEART", "/repo/wt1")
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "agentManager.commentReactionResult",
        worktreeId: "wt1",
        commentId: "PRRC_2",
        reaction: "HEART",
        add: true,
        success: true,
      }),
    )
  })

  it("removes a reaction and reports a failure", async () => {
    const { bridge, sent, onStatus } = harness()
    onStatus("wt1", {
      ...pr,
      conversation: [{ id: "IC_1", author: "alice", body: "note" }],
    })
    removeCommentReaction.mockRejectedValueOnce(new Error("gh: forbidden"))

    bridge.handleMessage({
      type: "agentManager.commentReaction",
      worktreeId: "wt1",
      commentId: "IC_1",
      reaction: "HEART",
      add: false,
    })
    await Promise.resolve()

    expect(removeCommentReaction).toHaveBeenCalledWith("IC_1", "HEART", "/repo/wt1")
    expect(sent).toContainEqual(
      expect.objectContaining({
        type: "agentManager.commentReactionResult",
        commentId: "IC_1",
        add: false,
        success: false,
      }),
    )
  })
})
