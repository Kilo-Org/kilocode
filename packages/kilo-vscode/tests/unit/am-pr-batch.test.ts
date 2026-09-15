import { describe, expect, it } from "bun:test"
import { CHUNK, own, query, reshape, parse, pick, unknown } from "../../src/agent-manager/pr/am-pr-batch"
import { parsePRResult } from "../../src/agent-manager/pr/am-pr-utils"

const base = "a".repeat(40)
const head = "b".repeat(40)

describe("am-pr-batch query", () => {
  it("builds one alias per branch and head and skips b for detached HEAD", () => {
    const doc = query([{ branch: "feature", head: "abc" }, { branch: "HEAD", head: "def" }, { branch: "other" }], true)
    expect(doc).toContain(
      `b0: pullRequests(headRefName: "feature", states: [OPEN, CLOSED, MERGED], first: 5, orderBy: { field: CREATED_AT, direction: DESC })`,
    )
    expect(doc).toContain("defaultBranchRef { name }")
    expect(doc).toContain('c0: object(oid: "abc")')
    expect(doc).not.toContain("b1:")
    expect(doc).toContain('c1: object(oid: "def")')
    expect(doc).toContain(`b2: pullRequests(headRefName: "other", states: [OPEN, CLOSED, MERGED]`)
    expect(doc).not.toContain("c2:")
    expect(doc).toContain("rateLimit { cost }")
  })

  it("escapes branch names as GraphQL strings", () => {
    const doc = query([{ branch: 'feat"ure\\x' }], false)
    expect(doc).toContain(`headRefName: ${JSON.stringify('feat"ure\\x')}`)
  })

  it("switches the selection between rich and base fields", () => {
    expect(query([{ branch: "feature" }], true)).toContain("statusCheckRollup")
    expect(query([{ branch: "feature" }], true)).toContain("mergeStateStatus")
    expect(query([{ branch: "feature" }], false)).not.toContain("statusCheckRollup")
    expect(query([{ branch: "feature" }], false)).not.toContain("mergeStateStatus")
  })

  it("mirrors the gh pr view limits so full-sync and active-tick results hash identically", () => {
    const doc = query([{ branch: "feature" }], true)
    expect(doc).toContain("reviewRequests(first: 100)")
    expect(doc).toContain("reviews(first: 100) {")
    expect(doc).not.toContain("states: [APPROVED")
    expect(doc).not.toContain("event")
  })

  it("returns an empty document when nothing can be resolved", () => {
    expect(query([{ branch: "HEAD" }], true)).toBe("")
    expect(query([], false)).toBe("")
  })

  it("exports the chunk size used by the poller", () => {
    expect(CHUNK).toBe(10)
  })
})

describe("am-pr-batch reshape", () => {
  const graph = {
    id: "PR_1",
    number: 42,
    title: "Add batching",
    body: "Body",
    url: "https://github.com/o/r/pull/42",
    state: "OPEN",
    isDraft: false,
    reviewDecision: "APPROVED",
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    headRefName: "feature",
    baseRefOid: base,
    headRefOid: head,
    isCrossRepository: false,
    createdAt: "2026-09-01T00:00:00Z",
    author: { login: "alice" },
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    autoMergeRequest: { mergeMethod: "SQUASH" },
    reviewRequests: { nodes: [{ requestedReviewer: { login: "bob", avatarUrl: "https://avatar/bob" } }] },
    reviews: { nodes: [{ author: { login: "carol", avatarUrl: "https://avatar/carol" }, state: "APPROVED" }] },
    commits: {
      nodes: [
        {
          commit: {
            statusCheckRollup: {
              contexts: {
                totalCount: 2,
                nodes: [
                  {
                    __typename: "CheckRun",
                    name: "build",
                    status: "COMPLETED",
                    conclusion: "SUCCESS",
                    detailsUrl: "https://checks/build",
                    startedAt: "2026-09-01T00:00:00Z",
                    completedAt: "2026-09-01T00:01:00Z",
                    checkSuite: { workflowRun: { event: "push", workflow: { name: "CI" } } },
                  },
                  {
                    __typename: "StatusContext",
                    context: "ci/legacy",
                    state: "SUCCESS",
                    targetUrl: "https://status/legacy",
                    createdAt: "2026-09-01T00:00:00Z",
                  },
                ],
              },
            },
          },
        },
      ],
    },
  }

  const gh = {
    id: "PR_1",
    number: 42,
    title: "Add batching",
    body: "Body",
    url: "https://github.com/o/r/pull/42",
    state: "OPEN",
    isDraft: false,
    reviewDecision: "APPROVED",
    additions: 10,
    deletions: 2,
    changedFiles: 3,
    headRefName: "feature",
    baseRefOid: base,
    headRefOid: head,
    isCrossRepository: false,
    createdAt: "2026-09-01T00:00:00Z",
    author: { login: "alice" },
    mergeable: "MERGEABLE",
    mergeStateStatus: "CLEAN",
    autoMergeRequest: { mergeMethod: "SQUASH" },
    reviewRequests: [{ requestedReviewer: { login: "bob", avatarUrl: "https://avatar/bob" } }],
    reviews: [{ author: { login: "carol", avatarUrl: "https://avatar/carol" }, state: "APPROVED" }],
    statusCheckRollup: [
      {
        __typename: "CheckRun",
        name: "build",
        status: "COMPLETED",
        conclusion: "SUCCESS",
        detailsUrl: "https://checks/build",
        startedAt: "2026-09-01T00:00:00Z",
        completedAt: "2026-09-01T00:01:00Z",
        workflowName: "CI",
      },
      {
        __typename: "StatusContext",
        context: "ci/legacy",
        state: "SUCCESS",
        targetUrl: "https://status/legacy",
        createdAt: "2026-09-01T00:00:00Z",
      },
    ],
  }

  it("produces the same parsed PR as the equivalent gh JSON", () => {
    const parsed = parsePRResult(JSON.stringify(reshape(graph)))
    expect(parsed).toEqual(parsePRResult(JSON.stringify(gh)))
    expect(parsed?.reviewers).toEqual([
      { login: "bob", avatar: "https://avatar/bob", state: "pending" },
      { login: "carol", avatar: "https://avatar/carol", state: "approved" },
    ])
    expect(parsed?.merge).toEqual({ mergeable: "mergeable", state: "clean", auto: "squash" })
    expect(parsed?.review).toBe("approved")
    expect(parsed?.checks?.passed).toBe(2)
  })

  it("omits rich-only fields for base selections", () => {
    const data = reshape({ number: 1, state: "OPEN", commits: { nodes: [] } })
    expect(data.mergeable).toBeUndefined()
    expect(data.reviewRequests).toBeUndefined()
    expect(data.statusCheckRollup).toBeUndefined()
  })

  it("flattens the newest status check rollup with the workflow name", () => {
    const data = reshape(graph)
    const checks = data.statusCheckRollup as Array<{ name?: string; workflowName?: string }>
    expect(checks).toHaveLength(2)
    expect(checks.at(0)).toMatchObject({ name: "build", workflowName: "CI" })
  })

  it("emits exactly the gh statusCheckRollup shape with no extra keys", () => {
    // The check dedupe key in parsePRResult includes workflowName and event, so any
    // extra key here would make batch results hash differently from `gh pr view`.
    expect(reshape(graph).statusCheckRollup).toEqual(gh.statusCheckRollup)
  })
})

describe("am-pr-batch pick", () => {
  const node = (number: number, ref: string, cross: boolean) => ({
    number,
    state: "OPEN",
    headRefOid: ref,
    isCrossRepository: cross,
  })

  it("prefers the node whose head matches the worktree HEAD", () => {
    expect(pick([node(1, "aaa", true), node(2, "bbb", true)], "bbb")?.number).toBe(2)
  })

  it("returns the only same-repo node when the head does not match (local commits)", () => {
    expect(pick([node(1, "aaa", false)], "zzz")?.number).toBe(1)
  })

  it("never attributes a fork PR that only shares the branch name, like gh's owner:branch label check", () => {
    // `pullRequests(headRefName: "main")` on the base repo matches dozens of fork PRs.
    expect(pick([node(1, "aaa", true)], "zzz")).toBeUndefined()
    expect(pick([node(1, "aaa", true)], undefined)).toBeUndefined()
    expect(own([node(1, "aaa", true), node(2, "bbb", false)], "zzz").map((n) => n.number)).toEqual([2])
  })

  it("accepts a fork PR only when the local HEAD SHA proves the checkout is that branch", () => {
    expect(pick([node(1, "aaa", true), node(2, "bbb", true)], "bbb")?.number).toBe(2)
  })

  it("prefers the same-repo PR when a fork shares the name and the head matches neither", () => {
    expect(pick([node(1, "aaa", true), node(2, "bbb", false)], "zzz")?.number).toBe(2)
  })

  it("falls back to the newest merged or closed PR when nothing is open, like gh", () => {
    const merged = { number: 9, state: "MERGED", headRefOid: "bbb", isCrossRepository: false }
    const older = { number: 3, state: "CLOSED", headRefOid: "ccc", isCrossRepository: false }
    expect(pick([merged, older], "zzz")?.number).toBe(9)
    expect(pick([merged, older], "ccc")?.number).toBe(3)
  })

  it("prefers an open PR over a newer merged one", () => {
    expect(
      pick([{ number: 9, state: "MERGED", headRefOid: "bbb", isCrossRepository: false }, node(1, "aaa", false)], "zzz")
        ?.number,
    ).toBe(1)
  })

  it("hides merged and closed PRs for the default branch", () => {
    expect(
      pick([{ number: 9, state: "MERGED", headRefOid: "bbb", isCrossRepository: false }], "bbb", false),
    ).toBeUndefined()
    expect(pick([node(1, "aaa", false)], "aaa", false)?.number).toBe(1)
  })
})

describe("am-pr-batch parse", () => {
  it("merges b and c aliases and dedupes by number", () => {
    const items = [{ branch: "one", head: "h1" }, { branch: "two" }]
    const json = JSON.stringify({
      data: {
        repository: {
          b0: {
            nodes: [
              { number: 1, state: "OPEN" },
              { number: 2, state: "OPEN" },
            ],
          },
          c0: {
            __typename: "Commit",
            associatedPullRequests: {
              nodes: [
                { number: 2, state: "OPEN", headRefOid: "h1" },
                { number: 3, state: "CLOSED", headRefOid: "h1" },
                { number: 4, state: "OPEN", headRefOid: "other" },
              ],
            },
          },
          b1: { nodes: [] },
        },
      },
    })
    expect(parse(json, items)).toEqual([
      {
        nodes: [
          { number: 1, state: "OPEN" },
          { number: 2, state: "OPEN" },
        ],
      },
      { nodes: [] },
    ])
  })

  it("ignores SHA-associated PRs unless open with the exact local HEAD, like the legacy sha search", () => {
    // A fresh branch off main sits on the squash-merge commit of the last merged PR.
    const json = JSON.stringify({
      data: {
        repository: {
          b0: { nodes: [] },
          c0: {
            __typename: "Commit",
            associatedPullRequests: {
              nodes: [{ number: 14113, state: "MERGED", headRefOid: "prhead", isCrossRepository: false }],
            },
          },
        },
      },
    })
    expect(parse(json, [{ branch: "fresh-branch", head: "mergecommit" }])).toEqual([{ nodes: [] }])
  })

  it("reports the default branch so the poller can hide stale merged PRs for it", () => {
    const json = JSON.stringify({ data: { repository: { defaultBranchRef: { name: "main" }, b0: { nodes: [] } } } })
    expect(parse(json, [{ branch: "main" }])).toEqual([{ nodes: [], home: "main" }])
  })

  it("maps an aliased error to its item only", () => {
    const json = JSON.stringify({
      data: { repository: { b0: { nodes: [] } } },
      errors: [{ message: "bad field", path: ["repository", "b0", "pullRequests"] }],
    })
    expect(parse(json, [{ branch: "one" }, { branch: "two" }])).toEqual([{ error: "bad field" }, { nodes: [] }])
  })

  it("fails the whole chunk for an error without an alias path", () => {
    const json = JSON.stringify({ errors: [{ message: "auth" }] })
    expect(parse(json, [{ branch: "one" }, { branch: "two" }])).toEqual([{ error: "auth" }, { error: "auth" }])
  })

  it("fails the chunk when the repository payload is missing instead of reporting no PRs", () => {
    const items = [{ branch: "one" }, { branch: "two" }]
    for (const json of [
      JSON.stringify({}),
      JSON.stringify({ data: {} }),
      JSON.stringify({ data: { repository: null } }),
    ]) {
      const results = parse(json, items)
      expect(results).toHaveLength(2)
      for (const result of results) expect("error" in result).toBe(true)
    }
  })

  it("matches no nodes for a detached branch", () => {
    const json = JSON.stringify({
      data: {
        repository: {
          c0: {
            __typename: "Commit",
            associatedPullRequests: { nodes: [{ number: 1, state: "OPEN", headRefOid: "h1" }] },
          },
        },
      },
    })
    expect(parse(json, [{ branch: "HEAD", head: "h1" }])).toEqual([
      { nodes: [{ number: 1, state: "OPEN", headRefOid: "h1" }] },
    ])
  })
})

describe("am-pr-batch unknown", () => {
  it("matches the degradation messages used by the poller", () => {
    expect(unknown('Unknown JSON field: "statusCheckRollup"')).toBe(true)
    expect(unknown("GraphQL: Resource not accessible by integration")).toBe(true)
    expect(unknown("insufficient permissions")).toBe(true)
    expect(unknown("forbidden")).toBe(true)
    expect(unknown("network timeout")).toBe(false)
  })
})
