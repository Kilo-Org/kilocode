// kilocode_change - new file (moved from src/kilo-sessions/pr-link.test.ts so the
// package test runner scans it; it previously sat under src/ and never ran).
import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import simpleGit from "simple-git"

// Mock @/util/process before importing the module under test. Bun's
// mock.module is process-wide; spread the real exports and only override
// `Process.text` so nothing else that imports the process util breaks.
const realProcess = await import("@/util/process")

type Outcome = { code: number; text: string } | { error: Error }
type GhOptions = { nothrow?: boolean; cwd?: string; timeout?: number; abort?: AbortSignal }
let outcome: Outcome = { code: 0, text: "" }
let responder: ((cmd: string[]) => Outcome) | undefined

const ghText = mock(async (cmd: string[], _opts?: GhOptions) => {
  const out = responder ? responder(cmd) : outcome
  if ("error" in out) throw out.error
  return { code: out.code, text: out.text, stdout: Buffer.from(out.text), stderr: Buffer.alloc(0) }
})

void mock.module("@/util/process", () => ({
  ...realProcess,
  Process: {
    ...realProcess.Process,
    text: ghText,
  },
}))

const { detectPrLink, overrideKey, parsePrUrl, recordPrLinkText } = await import("@/kilo-sessions/pr-link")
const { Instance } = await import("@/kilocode/instance")
import type { InstanceContext } from "@/project/instance-context"

function restoreWorktree<T>(worktree: string, fn: () => T): T {
  const ctx = {} as InstanceContext
  ctx.worktree = worktree
  ctx.directory = worktree
  return Instance.restore(ctx, fn)
}

const created: string[] = []

afterAll(async () => {
  await Promise.all(created.map((dir) => fs.rm(dir, { recursive: true, force: true })))
})

// A real offline git repo: an origin remote, a committed HEAD, a tracking ref,
// and branch.<b>.remote/merge config so `git rev-parse @{upstream}` resolves
// without network.
async function makeRepo(branch = "feature/x", remote = "https://github.com/owner/repo.git") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pr-link-"))
  created.push(dir)
  const git = simpleGit(dir)
  await git.init()
  await git.addConfig("user.email", "test@example.com")
  await git.addConfig("user.name", "Test")
  await git.checkoutLocalBranch(branch)
  await fs.writeFile(path.join(dir, "a.txt"), "hello")
  await git.add("a.txt")
  await git.commit("init")
  await git.addRemote("origin", remote)
  const head = (await git.revparse(["HEAD"])).trim()
  await git.raw(["update-ref", `refs/remotes/origin/${branch}`, head])
  await git.addConfig(`branch.${branch}.remote`, "origin")
  await git.addConfig(`branch.${branch}.merge`, `refs/heads/${branch}`)
  return dir
}

function ghCalls() {
  return ghText.mock.calls.map((call) => call[0])
}

function ghOptions() {
  return ghText.mock.calls.map((call) => call[1])
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
  beforeEach(() => {
    outcome = { code: 0, text: "" }
    responder = undefined
    ghText.mockClear()
  })

  // The repro: before the fix this ran `gh pr view --json url` on every call
  // (the 10s in-flight/TTL cache drops an undefined result), so three calls
  // produced three GraphQL probes. After the fix it is local git plus at most
  // one REST lookup.
  test("never probes gh pr view and makes at most one REST lookup for three calls", async () => {
    const dir = await makeRepo()
    outcome = { code: 0, text: "[]" }

    const first = await restoreWorktree(dir, () => detectPrLink())
    const second = await restoreWorktree(dir, () => detectPrLink())
    const third = await restoreWorktree(dir, () => detectPrLink())

    expect(first).toBeUndefined()
    expect(second).toBeUndefined()
    expect(third).toBeUndefined()

    const calls = ghCalls()
    expect(calls.some((cmd) => cmd[0] === "gh" && cmd[1] === "pr" && cmd[2] === "view")).toBe(false)
    expect(calls.length).toBe(1)
    expect(calls[0]).toEqual([
      "gh",
      "api",
      "repos/owner/repo/pulls?head=owner%3Afeature%2Fx&state=all",
    ])
  })

  test("re-checks once when the branch head changes", async () => {
    const dir = await makeRepo()
    outcome = { code: 0, text: "[]" }

    await restoreWorktree(dir, () => detectPrLink())
    expect(ghCalls().length).toBe(1)

    const git = simpleGit(dir)
    await fs.writeFile(path.join(dir, "b.txt"), "second")
    await git.add("b.txt")
    await git.commit("second")

    await restoreWorktree(dir, () => detectPrLink())
    expect(ghCalls().length).toBe(2)
  })

  test("maps a positive REST result to a PrLink and caches it", async () => {
    const dir = await makeRepo()
    outcome = {
      code: 0,
      text: JSON.stringify([{ html_url: "https://github.com/owner/repo/pull/42" }]),
    }

    const link = await restoreWorktree(dir, () => detectPrLink())
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/42", prNumber: 42 })

    const again = await restoreWorktree(dir, () => detectPrLink())
    expect(again).toEqual(link)
    expect(ghCalls().length).toBe(1)
  })

  test("keeps the last known link when a head change triggers a failed lookup", async () => {
    const dir = await makeRepo()
    outcome = { code: 0, text: JSON.stringify([{ html_url: "https://github.com/owner/repo/pull/42" }]) }

    const link = await restoreWorktree(dir, () => detectPrLink())
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/42", prNumber: 42 })
    expect(ghCalls().length).toBe(1)

    const git = simpleGit(dir)
    await fs.writeFile(path.join(dir, "b.txt"), "second")
    await git.add("b.txt")
    await git.commit("second")

    outcome = { code: 1, text: "API rate limit exceeded" }
    const after = await restoreWorktree(dir, () => detectPrLink())
    expect(after).toEqual(link)
    expect(ghCalls().length).toBe(2)
  })

  test("bounds a hung lookup with an abort signal", async () => {
    const dir = await makeRepo()
    outcome = { code: 0, text: "[]" }

    await restoreWorktree(dir, () => detectPrLink())

    const opts = ghOptions()[0]
    expect(opts?.abort).toBeInstanceOf(AbortSignal)
    expect(opts?.timeout).toBe(5000)
  })

  test("backs off after a failed lookup and spawns nothing on the next call", async () => {
    const dir = await makeRepo()
    outcome = { code: 1, text: "API rate limit exceeded" }

    const first = await restoreWorktree(dir, () => detectPrLink())
    expect(first).toBeUndefined()
    expect(ghCalls().length).toBe(1)

    const second = await restoreWorktree(dir, () => detectPrLink())
    expect(second).toBeUndefined()
    expect(ghCalls().length).toBe(1)
  })

  test("backs off when gh is missing", async () => {
    const dir = await makeRepo()
    outcome = { error: new Error("spawn gh ENOENT") }

    const first = await restoreWorktree(dir, () => detectPrLink())
    expect(first).toBeUndefined()
    expect(ghCalls().length).toBe(1)

    const second = await restoreWorktree(dir, () => detectPrLink())
    expect(second).toBeUndefined()
    expect(ghCalls().length).toBe(1)
  })

  test("zero spawns without a GitHub remote", async () => {
    const dir = await makeRepo("feature/y", "https://gitlab.com/owner/repo.git")

    const link = await restoreWorktree(dir, () => detectPrLink())
    expect(link).toBeUndefined()
    expect(ghCalls().length).toBe(0)
  })

  // The repro for the dropped session-output link: a PR URL the session itself
  // printed must survive a later commit on the same branch. The recorded branch
  // identity is head-independent, so the new head still returns it locally.
  test("keeps the recorded session-output link across a branch head change", async () => {
    const dir = await makeRepo()

    recordPrLinkText(dir, "Opened https://github.com/owner/repo/pull/7")
    const link = await restoreWorktree(dir, () => detectPrLink())
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 })

    const git = simpleGit(dir)
    await fs.writeFile(path.join(dir, "b.txt"), "second")
    await git.add("b.txt")
    await git.commit("second")

    outcome = { code: 0, text: "[]" }
    const before = ghCalls().length
    const after = await restoreWorktree(dir, () => detectPrLink())
    expect(after).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 })
    expect(ghCalls().length).toBe(before)
  })

  // The repro for the stale last-positive fallback: after a branch switch a
  // failed lookup must not advertise the previous branch's link.
  test("does not advertise the previous branch's link after a failed switch", async () => {
    const dir = await makeRepo()
    outcome = { code: 0, text: JSON.stringify([{ html_url: "https://github.com/owner/repo/pull/42" }]) }

    const link = await restoreWorktree(dir, () => detectPrLink())
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/42", prNumber: 42 })

    const git = simpleGit(dir)
    await git.checkoutLocalBranch("feature/y")

    outcome = { code: 1, text: "API rate limit exceeded" }
    const after = await restoreWorktree(dir, () => detectPrLink())
    expect(after).toBeUndefined()
  })

  test("drops a recorded URL for another repo once the identity is known", async () => {
    const dir = await makeRepo()

    recordPrLinkText(dir, "mentions https://github.com/other/repo/pull/5")
    outcome = { code: 0, text: JSON.stringify([{ html_url: "https://github.com/owner/repo/pull/42" }]) }

    const link = await restoreWorktree(dir, () => detectPrLink())
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/42", prNumber: 42 })
    expect(ghCalls().length).toBe(1)
  })

  test("bounds the per-worktree state and evicts the least recent worktree", async () => {
    const dir = await makeRepo()
    recordPrLinkText(dir, "https://github.com/owner/repo/pull/7")
    for (let i = 0; i < 128; i++) {
      recordPrLinkText(path.join(os.tmpdir(), `pr-link-other-${i}`), `https://github.com/owner/repo/pull/${i + 1}`)
    }

    outcome = { code: 0, text: JSON.stringify([{ html_url: "https://github.com/owner/repo/pull/42" }]) }
    const link = await restoreWorktree(dir, () => detectPrLink())

    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/42", prNumber: 42 })
  })
})

describe("recordPrLinkText", () => {
  beforeEach(() => {
    outcome = { code: 0, text: "" }
    responder = undefined
    ghText.mockClear()
  })

  test("records a PR URL from session output without spawning gh", async () => {
    const dir = await makeRepo()

    const link = recordPrLinkText(dir, "Opened https://github.com/owner/repo/pull/7 for this branch")
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 })
    expect(ghCalls().length).toBe(0)
  })

  test("returns undefined for an unchanged link so callers sync once", async () => {
    const dir = await makeRepo()

    expect(recordPrLinkText(dir, "see https://github.com/owner/repo/pull/7")).not.toBeUndefined()
    expect(recordPrLinkText(dir, "see https://github.com/owner/repo/pull/7")).toBeUndefined()
  })

  test("returns undefined when the text has no PR marker", async () => {
    const dir = await makeRepo()
    expect(recordPrLinkText(dir, "no link here")).toBeUndefined()
    expect(ghCalls().length).toBe(0)
  })

  test("detectPrLink returns the recorded session-output link before any lookup", async () => {
    const dir = await makeRepo()
    responder = () => ({ code: 0, text: JSON.stringify([{ html_url: "https://github.com/owner/repo/pull/99" }]) })

    recordPrLinkText(dir, "https://github.com/owner/repo/pull/7")
    const link = await restoreWorktree(dir, () => detectPrLink())

    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 })
    expect(ghCalls().length).toBe(0)
  })

  test("ignores a session-output URL for a different repository", async () => {
    const dir = await makeRepo()
    outcome = { code: 0, text: "[]" }
    await restoreWorktree(dir, () => detectPrLink())

    expect(recordPrLinkText(dir, "saw https://github.com/other/repo/pull/5")).toBeUndefined()
  })
})
