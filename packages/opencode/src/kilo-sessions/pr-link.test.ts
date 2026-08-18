import { beforeEach, describe, expect, mock, test } from "bun:test"

// Mock @/util/process before importing the module under test. Bun's
// mock.module is process-wide; spread the real exports and only override
// `Process.text` so nothing else that imports the process util breaks.
const realProcess = await import("@/util/process")

let outcome: { code: number; text: string } | { error: Error } = { code: 0, text: "" }

const ghText = mock(async (_cmd: string[]) => {
  if ("error" in outcome) throw outcome.error
  return { code: outcome.code, text: outcome.text, stdout: Buffer.from(outcome.text), stderr: Buffer.alloc(0) }
})

void mock.module("@/util/process", () => ({
  ...realProcess,
  Process: {
    ...realProcess.Process,
    text: ghText,
  },
}))

import { detectPrLink, overrideKey, parsePrUrl } from "@/kilo-sessions/pr-link"
import { Instance } from "@/kilocode/instance"
import type { InstanceContext } from "@/project/instance-context"

function restoreWorktree<T>(worktree: string, fn: () => T): T {
  const ctx = {} as InstanceContext
  ctx.worktree = worktree
  ctx.directory = worktree
  return Instance.restore(ctx, fn)
}

describe("parsePrUrl", () => {
  test("GitHub pull", () => {
    const link = parsePrUrl("https://github.com/owner/repo/pull/123")
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/123", prNumber: 123 })
  })

  test("GitHub pull with /files subpath", () => {
    const link = parsePrUrl("https://github.com/owner/repo/pull/123/files")
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/123/files", prNumber: 123 })
  })

  test("GitHub pull with /commits subpath", () => {
    const link = parsePrUrl("https://github.com/owner/repo/pull/123/commits")
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/123/commits", prNumber: 123 })
  })

  test("GitHub pull with query", () => {
    const link = parsePrUrl("https://github.com/owner/repo/pull/123?diff=split")
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/123", prNumber: 123 })
  })

  test("GitHub pull with hash", () => {
    const link = parsePrUrl("https://github.com/owner/repo/pull/123#discussion_r1")
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/123", prNumber: 123 })
  })

  test("GitHub pull on www host", () => {
    const link = parsePrUrl("https://www.github.com/owner/repo/pull/123")
    expect(link).toEqual({ platform: "github", prUrl: "https://www.github.com/owner/repo/pull/123", prNumber: 123 })
  })

  test("GitLab merge_requests", () => {
    const link = parsePrUrl("https://gitlab.com/group/proj/merge_requests/45")
    expect(link).toEqual({ platform: "gitlab", prUrl: "https://gitlab.com/group/proj/merge_requests/45", prNumber: 45 })
  })

  test("GitLab /-/merge_requests", () => {
    const link = parsePrUrl("https://gitlab.com/group/proj/-/merge_requests/45")
    expect(link).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.com/group/proj/-/merge_requests/45",
      prNumber: 45,
    })
  })

  test("generic /pull/N", () => {
    const link = parsePrUrl("https://example.com/pull/7")
    expect(link).toEqual({ platform: "example", prUrl: "https://example.com/pull/7", prNumber: 7 })
  })

  test("generic /pull-requests/N", () => {
    const link = parsePrUrl("https://bitbucket.org/team/repo/pull-requests/9")
    expect(link).toEqual({
      platform: "bitbucket",
      prUrl: "https://bitbucket.org/team/repo/pull-requests/9",
      prNumber: 9,
    })
  })

  test("invalid", () => {
    expect(parsePrUrl("not a url")).toBeUndefined()
    expect(parsePrUrl("https://github.com/owner/repo/issues/1")).toBeUndefined()
    expect(parsePrUrl("https://github.com/owner/repo/pull/abc")).toBeUndefined()
    expect(parsePrUrl("ftp://github.com/owner/repo/pull/1")).toBeUndefined()
  })

  test("rejects non-positive PR number", () => {
    expect(parsePrUrl("https://github.com/owner/repo/pull/0")).toBeUndefined()
    expect(parsePrUrl("https://gitlab.com/group/proj/merge_requests/0")).toBeUndefined()
  })
})

describe("overrideKey", () => {
  test("encodes a Windows worktree into a single path segment", () => {
    const key = overrideKey("C:\\Users\\igor\\Projects\\foo")
    expect(key).toEqual(["session_pr_link", "C%3A%5CUsers%5Cigor%5CProjects%5Cfoo"])
    expect(key[1]).not.toContain(":")
    expect(key[1]).not.toContain("\\")
    expect(key[1]).not.toContain("/")
  })

  test("encodes a POSIX worktree into a single path segment", () => {
    const key = overrideKey("/Users/igor/Projects/foo")
    expect(key).toEqual(["session_pr_link", "%2FUsers%2Figor%2FProjects%2Ffoo"])
    expect(key[1]).not.toContain(":")
    expect(key[1]).not.toContain("/")
  })
})

describe("detectPrLink", () => {
  let n = 0
  const nextWorktree = () => `/tmp/pr-link-${process.pid}-${n++}`

  beforeEach(() => {
    outcome = { code: 0, text: "" }
    ghText.mockClear()
  })

  test("detects a PR from gh", async () => {
    outcome = {
      code: 0,
      text: JSON.stringify({ url: "https://github.com/owner/repo/pull/123", number: 123 }),
    }
    const link = await restoreWorktree(nextWorktree(), () => detectPrLink())
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/123", prNumber: 123 })
    expect(ghText.mock.calls[0]?.[0]).toEqual(["gh", "pr", "view", "--json", "url"])
  })

  test("returns undefined when gh is missing", async () => {
    outcome = { error: new Error("spawn gh ENOENT") }
    const link = await restoreWorktree(nextWorktree(), () => detectPrLink())
    expect(link).toBeUndefined()
  })

  test("returns undefined when there is no PR", async () => {
    outcome = { code: 1, text: "" }
    const link = await restoreWorktree(nextWorktree(), () => detectPrLink())
    expect(link).toBeUndefined()
  })

  test("returns undefined on bad JSON", async () => {
    outcome = { code: 0, text: "not json" }
    const link = await restoreWorktree(nextWorktree(), () => detectPrLink())
    expect(link).toBeUndefined()
  })
})
