// kilocode_change - new file (moved from src/kilo-sessions/pr-link.test.ts so the
// package test runner scans it; it previously sat under src/ and never ran).
import { afterAll, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
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

// The GitLab and Bitbucket checks ask their host's API through `fetch`, so the
// test intercepts those requests the way it intercepts `Process.text`. Any other
// request falls through to the real fetch.
const realFetch = globalThis.fetch
type ApiOutcome = { status?: number; body?: unknown } | { error: Error }
let apiResponder: ((url: string) => ApiOutcome) | undefined

const fetchMock = spyOn(globalThis, "fetch").mockImplementation(
  Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
      if (!apiResponder || !/\/api\/v4\/|\/2\.0\/repositories\//.test(url)) return realFetch(input, init)
      const out = apiResponder(url)
      if ("error" in out) throw out.error
      return new Response(typeof out.body === "string" ? out.body : JSON.stringify(out.body ?? null), {
        status: out.status ?? 200,
      })
    },
    { preconnect: realFetch.preconnect },
  ),
)

const {
  detectPrLink,
  detectPrLinkState,
  forgetRecordedPrLink,
  identityFor,
  linkMatchesWorktree,
  overrideKey,
  parsePrUrl,
  persistRecordedPrLink,
  readRecordedPrLink,
  recordedKey,
  recordPrLinkText,
} = await import("@/kilo-sessions/pr-link")
const { PR_POLL_INTERVAL_MS, bitbucketQuery, refreshPrLink, startPrLinkPoll } = await import(
  "@/kilo-sessions/pr-link-poller"
)
const { Instance } = await import("@/kilocode/instance")
import type { InstanceContext } from "@/project/instance-context"

// Write a record the way a previous process would have, so the read side can be
// exercised across processes. Storage persists each key as
// `<data>/storage/<key...>.json` (see `Storage.file`), so writing that file
// directly reproduces the exact on-disk shape `readRecordedPrLink` reads back.
function recordedPath(worktree: string) {
  return path.join(Global.Path.data, "storage", ...recordedKey(worktree)) + ".json"
}

async function writeRecorded(worktree: string, value: unknown) {
  const target = recordedPath(worktree)
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(value, null, 2))
}

function restoreWorktree<T>(worktree: string, fn: () => T): T {
  const ctx = {} as InstanceContext
  ctx.worktree = worktree
  ctx.directory = worktree
  return Instance.restore(ctx, fn)
}

const created: string[] = []

afterAll(async () => {
  // `mock.restore()` cannot undo a raw `globalThis.fetch = …` assignment; the
  // spy's own restore puts the real fetch back so a later file in the same
  // process (kilo-sessions.test.ts asserts no `mock` on globalThis.fetch) sees
  // the original.
  fetchMock.mockRestore()
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

function fetchUrls() {
  return fetchMock.mock.calls.map((call) =>
    typeof call[0] === "string" ? call[0] : call[0] instanceof URL ? call[0].toString() : call[0].url,
  )
}

function fetchHeader(index: number, name: string) {
  const headers = fetchMock.mock.calls[index]?.[1]?.headers
  if (!headers) return undefined
  if (headers instanceof Headers) return headers.get(name) ?? undefined
  if (Array.isArray(headers)) return headers.find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1]
  return headers[name]
}

function prLink(url: string) {
  const link = parsePrUrl(url)
  if (!link) throw new Error(`not a pull request URL: ${url}`)
  return link
}

function apiUrl(index = 0) {
  return new URL(fetchUrls()[index])
}

// Answer the GitLab or Bitbucket check's API call with a JSON body.
function respondApi(body: unknown, status = 200) {
  apiResponder = () => ({ status, body })
}

function respondApiError(error: Error) {
  apiResponder = () => ({ error })
}

// Answer the GitHub check's bounded `gh api` call with a pull-request listing.
function respondGh(payload: unknown, code = 0) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload)
  responder = (cmd) => (cmd[0] === "gh" ? { code, text } : { code: 1, text: "" })
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

  test("GitLab /-/merge_requests with /diffs subpath", () => {
    const link = parsePrUrl("https://gitlab.example.com/group/sub/proj/-/merge_requests/45/diffs")
    expect(link).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/45/diffs",
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

  test("generic /pull-requests/N with /overview subpath", () => {
    const link = parsePrUrl("https://bitbucket.org/team/repo/pull-requests/9/overview")
    expect(link).toEqual({
      platform: "bitbucket",
      prUrl: "https://bitbucket.org/team/repo/pull-requests/9/overview",
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

describe("refreshPrLink", () => {
  beforeEach(() => {
    outcome = { code: 0, text: "" }
    responder = undefined
    apiResponder = undefined
    ghText.mockClear()
    fetchMock.mockClear()
  })

  // GitHub retains `refs/pull/<n>/head` for every pull request ever opened, so
  // the check must not list that namespace: it asks the REST API for the
  // branch's open pull request instead, bounded to the branch and to open state.
  test("a GitHub branch with an open pull request links #12", async () => {
    const dir = await makeRepo()
    respondGh([{ html_url: "https://github.com/owner/repo/pull/12" }])

    const link = await restoreWorktree(dir, () => refreshPrLink(dir))
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/12", prNumber: 12 })
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/x", link, source: "poll" })
    expect(ghCalls()[0]).toEqual(["gh", "api", "repos/owner/repo/pulls?head=owner%3Afeature%2Fx&state=open"])
  })

  test("a GitHub Enterprise host asks its own host", async () => {
    // A self-hosted GitHub host is trusted only when the user designates it, so
    // the check cannot be pointed at whatever host a repository's remote names.
    process.env.GH_HOST = "github.mycorp.example"
    try {
      const dir = await makeRepo("feature/ghe", "git@github.mycorp.example:owner/repo.git")
      respondGh([{ html_url: "https://github.mycorp.example/owner/repo/pull/4" }])

      const link = await restoreWorktree(dir, () => refreshPrLink(dir))
      expect(link).toEqual({
        platform: "github",
        prUrl: "https://github.mycorp.example/owner/repo/pull/4",
        prNumber: 4,
      })
      expect(ghCalls()[0]).toEqual([
        "gh",
        "api",
        "--hostname",
        "github.mycorp.example",
        "repos/owner/repo/pulls?head=owner%3Afeature%2Fghe&state=open",
      ])
    } finally {
      delete process.env.GH_HOST
    }
  })

  test("a GitHub-like host the user did not designate stays inconclusive and runs no gh", async () => {
    const dir = await makeRepo("feature/gh", "git@github.attacker.example:owner/repo.git")
    respondGh([{ html_url: "https://github.attacker.example/owner/repo/pull/4" }])

    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toBeUndefined()
    expect(ghCalls().length).toBe(0)
  })

  // GitLab retains `refs/merge-requests/<n>/head` for closed merge requests, so
  // the check must not list that namespace either: it asks the API for the
  // branch's open merge request, bounded to the branch and to open state.
  test("a GitLab branch with an open merge request links #5 with the /-/merge_requests URL", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    respondApi([{ web_url: "https://gitlab.example.com/group/sub/proj/-/merge_requests/5" }])

    const link = await restoreWorktree(dir, () => refreshPrLink(dir))
    expect(link).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/5",
      prNumber: 5,
    })
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/gl", link, source: "poll" })
    expect(apiUrl().pathname).toBe("/api/v4/projects/group%2Fsub%2Fproj/merge_requests")
    expect(apiUrl().searchParams.get("source_branch")).toBe("feature/gl")
    expect(apiUrl().searchParams.get("state")).toBe("opened")
    expect(ghCalls().length).toBe(0)
  })

  test("a self-hosted GitLab host asks its own API", async () => {
    const dir = await makeRepo("feature/gle", "git@gitlab.mycorp.example:group/proj.git")
    respondApi([{ web_url: "https://gitlab.mycorp.example/group/proj/-/merge_requests/8" }])

    const link = await restoreWorktree(dir, () => refreshPrLink(dir))
    expect(link).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.mycorp.example/group/proj/-/merge_requests/8",
      prNumber: 8,
    })
    expect(apiUrl().origin).toBe("https://gitlab.mycorp.example")
    expect(apiUrl().pathname).toBe("/api/v4/projects/group%2Fproj/merge_requests")
  })

  // The token is the user's credential, so it is sent only to the canonical host
  // or to a host the user designated: a hostile remote whose host merely starts
  // with `gitlab` must never receive it.
  test("the GitLab token is sent to gitlab.com but not to an undesignated host", async () => {
    process.env.GITLAB_TOKEN = "gl-secret"
    try {
      const canonical = await makeRepo("feature/gl", "https://gitlab.com/group/proj.git")
      respondApi([{ web_url: "https://gitlab.com/group/proj/-/merge_requests/5" }])
      await restoreWorktree(canonical, () => refreshPrLink(canonical))
      expect(fetchHeader(0, "PRIVATE-TOKEN")).toBe("gl-secret")

      fetchMock.mockClear()
      const hostile = await makeRepo("feature/gl", "git@gitlab.attacker.example:group/proj.git")
      respondApi([{ web_url: "https://gitlab.attacker.example/group/proj/-/merge_requests/5" }])
      await restoreWorktree(hostile, () => refreshPrLink(hostile))
      expect(fetchUrls().length).toBe(1)
      expect(fetchHeader(0, "PRIVATE-TOKEN")).toBeUndefined()
    } finally {
      delete process.env.GITLAB_TOKEN
    }
  })

  test("the GitLab token is sent to a host the user designated", async () => {
    process.env.GITLAB_TOKEN = "gl-secret"
    process.env.GITLAB_HOST = "gitlab.mycorp.example"
    try {
      const dir = await makeRepo("feature/gle", "git@gitlab.mycorp.example:group/proj.git")
      respondApi([{ web_url: "https://gitlab.mycorp.example/group/proj/-/merge_requests/8" }])
      await restoreWorktree(dir, () => refreshPrLink(dir))
      expect(fetchHeader(0, "PRIVATE-TOKEN")).toBe("gl-secret")
    } finally {
      delete process.env.GITLAB_TOKEN
      delete process.env.GITLAB_HOST
    }
  })

  // Bitbucket does not advertise `refs/pull-requests/<n>/from`, so the check
  // asks the Cloud API for the branch's open pull request, bounded by the `q`
  // filter to the branch and to OPEN state.
  test("a Bitbucket branch with an open pull request links #3 with the /pull-requests URL", async () => {
    const dir = await makeRepo("feature/bb", "https://bitbucket.org/team/repo.git")
    respondApi({ values: [{ links: { html: { href: "https://bitbucket.org/team/repo/pull-requests/3" } } }] })

    const link = await restoreWorktree(dir, () => refreshPrLink(dir))
    expect(link).toEqual({
      platform: "bitbucket",
      prUrl: "https://bitbucket.org/team/repo/pull-requests/3",
      prNumber: 3,
    })
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/bb", link, source: "poll" })
    expect(apiUrl().origin).toBe("https://api.bitbucket.org")
    expect(apiUrl().pathname).toBe("/2.0/repositories/team/repo/pullrequests")
    expect(apiUrl().searchParams.get("q")).toBe('source.branch.name="feature/bb" AND state="OPEN"')
    expect(ghCalls().length).toBe(0)
  })

  // Git allows `"` in ref names, so the branch must be escaped inside the `q`
  // filter or the host answers 400 and the check never runs for that branch. The
  // escaping is asserted on the filter builder rather than through a repo: a
  // branch containing `"` is a valid ref, but on Windows its loose ref file name
  // is invalid, so a fixture that checks one out cannot be created there. The
  // Bitbucket test above covers the builder's wiring into the request.
  test("escapes a quote in the Bitbucket branch filter", () => {
    expect(bitbucketQuery('a"b')).toBe('source.branch.name="a\\"b" AND state="OPEN"')
  })

  // The check asks each host's bounded API, never the unbounded ref namespaces.
  test("the GitLab and Bitbucket checks never list refs", async () => {
    const gitlab = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    respondApi([{ web_url: "https://gitlab.example.com/group/sub/proj/-/merge_requests/5" }])
    await restoreWorktree(gitlab, () => refreshPrLink(gitlab))
    expect(fetchUrls().length).toBe(1)
    expect(ghCalls().length).toBe(0)

    const bitbucket = await makeRepo("feature/bb", "https://bitbucket.org/team/repo.git")
    respondApi({ values: [] })
    await restoreWorktree(bitbucket, () => refreshPrLink(bitbucket))
    expect(fetchUrls().length).toBe(2)
    expect(ghCalls().length).toBe(0)
  })

  test("a non-Cloud Bitbucket host stays inconclusive and queries nothing", async () => {
    const dir = await makeRepo("feature/bb", "https://bitbucket.mycorp.example/team/repo.git")
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toBeUndefined()
    expect(fetchUrls().length).toBe(0)
    expect(ghCalls().length).toBe(0)
  })

  test("bounds each host check with an abort signal", async () => {
    const gitlab = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    respondApi([])
    await restoreWorktree(gitlab, () => refreshPrLink(gitlab))
    expect(fetchMock.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal)

    const github = await makeRepo()
    respondGh([])
    await restoreWorktree(github, () => refreshPrLink(github))
    const opts = ghOptions()[0]
    expect(opts?.abort).toBeInstanceOf(AbortSignal)
    expect(opts?.timeout).toBe(10_000)
  })

  test("no open pull request clears a polled GitHub link and persists the clear", async () => {
    const dir = await makeRepo()
    respondGh([{ html_url: "https://github.com/owner/repo/pull/12" }])
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).not.toBeUndefined()

    respondGh([])
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toBeUndefined()
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/x", cleared: true, source: "poll" })
  })

  test("a closed merge request clears a polled link and persists the clear", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    respondApi([{ web_url: "https://gitlab.example.com/group/sub/proj/-/merge_requests/5" }])
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).not.toBeUndefined()

    respondApi([])
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toBeUndefined()
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/gl", cleared: true, source: "poll" })
  })

  test("a closed Bitbucket pull request clears a polled link", async () => {
    const dir = await makeRepo("feature/bb", "https://bitbucket.org/team/repo.git")
    respondApi({ values: [{ links: { html: { href: "https://bitbucket.org/team/repo/pull-requests/3" } } }] })
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).not.toBeUndefined()

    respondApi({ values: [] })
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toBeUndefined()
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/bb", cleared: true, source: "poll" })
  })

  test("no open merge request leaves a session-output record untouched", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    const url = "https://gitlab.example.com/group/sub/proj/-/merge_requests/7"
    recordPrLinkText(dir, `Opened ${url}`)
    await persistRecordedPrLink(dir)

    respondApi([])
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toBeUndefined()

    const stored = await readRecordedPrLink(dir)
    expect(stored?.link).toEqual({ platform: "gitlab", prUrl: url, prNumber: 7 })
    expect(stored?.cleared).toBeUndefined()
  })

  // A session-output record must not be relabelled `poll` when the check finds a
  // pull request, or a later clear would remove the session's own link. This is
  // also the two-open-pull-requests case: the check takes the host's first
  // result and must not replace the session-created link with a different one.
  test("the poll never overwrites a session-output record for the same branch", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    const url = "https://gitlab.example.com/group/sub/proj/-/merge_requests/7"
    recordPrLinkText(dir, `Opened ${url}`)
    // Bind the record to the branch the way the hot path does.
    expect(await restoreWorktree(dir, () => detectPrLink())).toEqual({
      platform: "gitlab",
      prUrl: url,
      prNumber: 7,
    })

    respondApi([{ web_url: "https://gitlab.example.com/group/sub/proj/-/merge_requests/5" }])
    await restoreWorktree(dir, () => refreshPrLink(dir))

    expect(await readRecordedPrLink(dir)).toEqual({
      key: "origin/feature/gl",
      link: { platform: "gitlab", prUrl: url, prNumber: 7 },
    })
  })

  test("a non-zero or spawn-failed GitHub check keeps the link and clears nothing", async () => {
    const dir = await makeRepo()
    respondGh([{ html_url: "https://github.com/owner/repo/pull/12" }])
    const link = await restoreWorktree(dir, () => refreshPrLink(dir))
    expect(link).not.toBeUndefined()

    respondGh("", 1)
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toEqual(link)
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/x", link, source: "poll" })

    responder = undefined
    outcome = { error: new Error("spawn gh ENOENT") }
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toEqual(link)
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/x", link, source: "poll" })
  })

  test("a failed or unauthorized API check keeps the link and clears nothing", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    respondApi([{ web_url: "https://gitlab.example.com/group/sub/proj/-/merge_requests/5" }])
    const link = await restoreWorktree(dir, () => refreshPrLink(dir))
    expect(link).not.toBeUndefined()

    respondApi({ message: "401 Unauthorized" }, 401)
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toEqual(link)
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/gl", link, source: "poll" })

    respondApiError(new Error("fetch failed"))
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toEqual(link)
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/gl", link, source: "poll" })
  })

  test("an unparseable remote queries nothing", async () => {
    const dir = await makeRepo("feature/x", "not a url")
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toBeUndefined()
    expect(ghCalls().length).toBe(0)
    expect(fetchUrls().length).toBe(0)
  })

  test("an unknown host stays inconclusive and queries nothing", async () => {
    const dir = await makeRepo("feature/x", "https://example.com/owner/repo.git")
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).toBeUndefined()
    expect(ghCalls().length).toBe(0)
    expect(fetchUrls().length).toBe(0)
  })

  test("the hot path never queries the host, even with an open PR", async () => {
    const dir = await makeRepo()
    respondGh([{ html_url: "https://github.com/owner/repo/pull/12" }])

    // The session hot path (`detectPrLink`) must not ask the host.
    expect(await restoreWorktree(dir, () => detectPrLink())).toBeUndefined()
    expect(ghCalls().length).toBe(0)

    // Only the 5-minute check asks, and it finds the PR through the bounded API
    // query rather than by enumerating the pull-ref namespace.
    expect(await restoreWorktree(dir, () => refreshPrLink(dir))).not.toBeUndefined()
    expect(ghCalls().length).toBe(1)
    expect(ghCalls()[0][0]).toBe("gh")
    expect(ghCalls()[0][1]).toBe("api")
  })

  test("the hot path never asks a GitLab or Bitbucket host either", async () => {
    const gitlab = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    const bitbucket = await makeRepo("feature/bb", "https://bitbucket.org/team/repo.git")
    respondApi([{ web_url: "https://gitlab.example.com/group/sub/proj/-/merge_requests/5" }])

    expect(await restoreWorktree(gitlab, () => detectPrLink())).toBeUndefined()
    expect(await restoreWorktree(bitbucket, () => detectPrLink())).toBeUndefined()
    expect(fetchUrls().length).toBe(0)

    expect(await restoreWorktree(gitlab, () => refreshPrLink(gitlab))).not.toBeUndefined()
    expect(fetchUrls().length).toBe(1)
  })
})

describe("startPrLinkPoll", () => {
  test("defaults to a 5-minute interval", () => {
    expect(PR_POLL_INTERVAL_MS).toBe(5 * 60_000)
  })

  test("runs immediately, again on the interval, and the stop function ends it", async () => {
    let calls = 0
    const stop = startPrLinkPoll(
      async () => {
        calls++
      },
      { intervalMs: 10 },
    )
    expect(calls).toBe(1)

    await new Promise((r) => setTimeout(r, 80))
    expect(calls).toBeGreaterThanOrEqual(3)

    stop()
    const seen = calls
    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toBe(seen)
  })

  test("coalesces overlapping runs", async () => {
    let calls = 0
    let release: (() => void) | undefined
    const stop = startPrLinkPoll(
      () =>
        new Promise<void>((resolve) => {
          calls++
          release = resolve
        }),
      { intervalMs: 10 },
    )
    expect(calls).toBe(1)

    await new Promise((r) => setTimeout(r, 60))
    expect(calls).toBe(1)

    release?.()
    await new Promise((r) => setTimeout(r, 40))
    expect(calls).toBe(2)
    stop()
  })
})

describe("detectPrLink", () => {
  beforeEach(() => {
    outcome = { code: 0, text: "" }
    responder = undefined
    ghText.mockClear()
  })

  // The hot-path contract: detection is local git only, so a worktree on any
  // host links without a host query.
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

    const after = await restoreWorktree(dir, () => detectPrLink())
    expect(after).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 })
    expect(ghCalls().length).toBe(0)
  })

  test("drops a recorded URL for another repo once the identity is known", async () => {
    const dir = await makeRepo()

    recordPrLinkText(dir, "mentions https://github.com/other/repo/pull/5")

    expect(await restoreWorktree(dir, () => detectPrLink())).toBeUndefined()
    expect(ghCalls().length).toBe(0)
  })

  // A foreign-host MR URL must not stick to the branch, and a later correct URL
  // in the same worktree still links normally.
  test("rejects another host's GitLab MR URL then accepts the own-host URL", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    await restoreWorktree(dir, () => detectPrLink())

    expect(recordPrLinkText(dir, "saw https://gitlab.other.example/group/sub/proj/-/merge_requests/3")).toBeUndefined()

    const own = recordPrLinkText(dir, "opened https://gitlab.example.com/group/sub/proj/-/merge_requests/3")
    expect(own).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/3",
      prNumber: 3,
    })

    const detected = await restoreWorktree(dir, () => detectPrLink())
    expect(detected).toEqual(own)
    expect(ghCalls().length).toBe(0)
  })

  // A cleared polled link for the matching branch reports cleared and is kept,
  // so the heartbeat can ingest the null triple that clears the app row.
  test("a cleared record for the branch reports cleared and is kept", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    await writeRecorded(dir, { key: "origin/feature/gl", cleared: true, source: "poll" })

    expect(await restoreWorktree(dir, () => detectPrLinkState())).toEqual({ cleared: true })
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/gl", cleared: true, source: "poll" })
  })

  test("a cleared record for another branch is dropped like a stale link", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    await writeRecorded(dir, { key: "origin/other", cleared: true, source: "poll" })

    expect(await restoreWorktree(dir, () => detectPrLinkState())).toEqual({})
    expect(await readRecordedPrLink(dir)).toBeUndefined()
  })

  // The happy state across processes: the link a previous process persisted from
  // the session's own output is returned by a later `detectPrLink` (the CLI's
  // `kilo pr status`), with no host query for a GitLab or Bitbucket host.
  test("persisted link: GitLab worktree returns the record with no host query", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    await writeRecorded(dir, {
      key: "origin/feature/gl",
      link: {
        platform: "gitlab",
        prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/3",
        prNumber: 3,
      },
    })

    const link = await restoreWorktree(dir, () => detectPrLink())
    expect(link).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/3",
      prNumber: 3,
    })
    expect(ghCalls().length).toBe(0)
  })

  test("persisted link: Bitbucket worktree returns the record with no host query", async () => {
    const dir = await makeRepo("feature/bb", "https://bitbucket.org/team/repo.git")
    await writeRecorded(dir, {
      key: "origin/feature/bb",
      link: { platform: "bitbucket", prUrl: "https://bitbucket.org/team/repo/pull-requests/9", prNumber: 9 },
    })

    const link = await restoreWorktree(dir, () => detectPrLink())
    expect(link).toEqual({
      platform: "bitbucket",
      prUrl: "https://bitbucket.org/team/repo/pull-requests/9",
      prNumber: 9,
    })
    expect(ghCalls().length).toBe(0)
  })

  test("persisted link: another branch is dropped and forgotten", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    await writeRecorded(dir, {
      key: "origin/other",
      link: {
        platform: "gitlab",
        prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/3",
        prNumber: 3,
      },
    })

    expect(await restoreWorktree(dir, () => detectPrLink())).toBeUndefined()
    expect(await readRecordedPrLink(dir)).toBeUndefined()
    expect(ghCalls().length).toBe(0)
  })

  test("persisted link: another host is dropped and forgotten", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    await writeRecorded(dir, {
      key: "origin/feature/gl",
      link: {
        platform: "gitlab",
        prUrl: "https://gitlab.other.example/group/sub/proj/-/merge_requests/3",
        prNumber: 3,
      },
    })

    expect(await restoreWorktree(dir, () => detectPrLink())).toBeUndefined()
    expect(await readRecordedPrLink(dir)).toBeUndefined()
    expect(ghCalls().length).toBe(0)
  })

  // The repro for the record that outlived its branch: a record persisted before
  // a branch key was known has no branch to compare against, so the old read
  // returned it on whatever branch the next process happened to be on. A keyless
  // record is untrusted and must be forgotten.
  test("persisted link: a record with no branch key is dropped and forgotten", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    await writeRecorded(dir, {
      link: {
        platform: "gitlab",
        prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/3",
        prNumber: 3,
      },
    })

    expect(await restoreWorktree(dir, () => detectPrLink())).toBeUndefined()
    expect(await readRecordedPrLink(dir)).toBeUndefined()
    expect(ghCalls().length).toBe(0)
  })

  test("persisted link: GitHub record is returned without querying the host", async () => {
    const dir = await makeRepo()
    await writeRecorded(dir, {
      key: "origin/feature/x",
      link: { platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 },
    })

    const link = await restoreWorktree(dir, () => detectPrLink())
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 })
    expect(ghCalls().length).toBe(0)
  })
})

describe("recordPrLinkText", () => {
  beforeEach(() => {
    outcome = { code: 0, text: "" }
    responder = undefined
    ghText.mockClear()
  })

  test("records a PR URL from session output without spawning a process", async () => {
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

  test("detectPrLink returns the recorded session-output link before any check", async () => {
    const dir = await makeRepo()

    recordPrLinkText(dir, "https://github.com/owner/repo/pull/7")
    const link = await restoreWorktree(dir, () => detectPrLink())

    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 })
    expect(ghCalls().length).toBe(0)
  })

  test("ignores a session-output URL for a different repository", async () => {
    const dir = await makeRepo()
    await restoreWorktree(dir, () => detectPrLink())

    expect(recordPrLinkText(dir, "saw https://github.com/other/repo/pull/5")).toBeUndefined()
  })

  test("gitlab worktree records its own MR URL and detectPrLink returns it with zero spawns", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")

    const link = recordPrLinkText(dir, "Opened https://gitlab.example.com/group/sub/proj/-/merge_requests/3")
    expect(link).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/3",
      prNumber: 3,
    })

    const detected = await restoreWorktree(dir, () => detectPrLink())
    expect(detected).toEqual(link)
    expect(ghCalls().length).toBe(0)
  })

  test("bitbucket worktree records its own PR URL and rejects another workspace", async () => {
    const dir = await makeRepo("feature/bb", "https://bitbucket.org/team/repo.git")
    expect(await restoreWorktree(dir, () => detectPrLink())).toBeUndefined()
    expect(ghCalls().length).toBe(0)

    const link = recordPrLinkText(dir, "Opened https://bitbucket.org/team/repo/pull-requests/9")
    expect(link).toEqual({
      platform: "bitbucket",
      prUrl: "https://bitbucket.org/team/repo/pull-requests/9",
      prNumber: 9,
    })
    expect(recordPrLinkText(dir, "saw https://bitbucket.org/other/repo/pull-requests/9")).toBeUndefined()
    expect(ghCalls().length).toBe(0)
  })

  test("SSH-alias remote still accepts the host's own MR URL on the path fallback", async () => {
    const dir = await makeRepo("feature/ssh", "git@gitlab:group/proj.git")
    await restoreWorktree(dir, () => detectPrLink())
    expect(ghCalls().length).toBe(0)

    const link = recordPrLinkText(dir, "https://gitlab.example.com/group/proj/-/merge_requests/3")
    expect(link).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/group/proj/-/merge_requests/3",
      prNumber: 3,
    })
    const detected = await restoreWorktree(dir, () => detectPrLink())
    expect(detected).toEqual(link)
  })

  // The fallback exists for an alias whose label (`gh`) has nothing to do with
  // the platform: comparing platforms there would reject the worktree's own PR,
  // so only the project path decides.
  test("an SSH alias with an unrelated label still matches its own PR URL", async () => {
    const dir = await makeRepo("feature/work", "git@gh:owner/repo.git")
    await restoreWorktree(dir, () => detectPrLink())

    const link = recordPrLinkText(dir, "Opened https://github.com/owner/repo/pull/7")
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 })
    expect(await restoreWorktree(dir, () => detectPrLink())).toEqual(link)
    expect(ghCalls().length).toBe(0)
  })

  // A single-segment remote path still names the worktree's project, so a
  // self-hosted GitLab serving a project at the root links its MR instead of
  // being rejected for having no owner.
  test("single-segment remote still records its own MR URL", async () => {
    const dir = await makeRepo("feature/root", "git@gitlab.example.com:proj.git")
    await restoreWorktree(dir, () => detectPrLink())
    expect(ghCalls().length).toBe(0)

    const link = recordPrLinkText(dir, "Opened https://gitlab.example.com/proj/-/merge_requests/5")
    expect(link).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/proj/-/merge_requests/5",
      prNumber: 5,
    })
    expect(await restoreWorktree(dir, () => detectPrLink())).toEqual(link)
    expect(ghCalls().length).toBe(0)
  })

  // A self-hosted GitLab at the root of an SSH alias is still the worktree's own
  // project on the dotless-host fallback.
  test("single-segment SSH-alias remote records its own MR URL", async () => {
    const dir = await makeRepo("feature/gl-root", "git@gl:proj.git")
    await restoreWorktree(dir, () => detectPrLink())
    expect(ghCalls().length).toBe(0)

    const link = recordPrLinkText(dir, "Opened https://gitlab.example.com/proj/-/merge_requests/5")
    expect(link).toEqual({
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/proj/-/merge_requests/5",
      prNumber: 5,
    })
    expect(await restoreWorktree(dir, () => detectPrLink())).toEqual(link)
  })

  // A GitHub Enterprise worktree still links the PR URL its session printed,
  // without a host query.
  test("a GitHub Enterprise remote still records its own session-output PR URL", async () => {
    const dir = await makeRepo("feature/ghe", "git@github.mycorp.example:owner/repo.git")
    await restoreWorktree(dir, () => detectPrLink())
    expect(ghCalls().length).toBe(0)

    const link = recordPrLinkText(dir, "Opened https://github.mycorp.example/owner/repo/pull/7")
    expect(link).toEqual({
      platform: "github",
      prUrl: "https://github.mycorp.example/owner/repo/pull/7",
      prNumber: 7,
    })
    expect(await restoreWorktree(dir, () => detectPrLink())).toEqual(link)
    expect(ghCalls().length).toBe(0)
  })

  test("non-PR URLs stay unlinked", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    await restoreWorktree(dir, () => detectPrLink())

    expect(recordPrLinkText(dir, "see https://gitlab.example.com/group/sub/proj/issues/3")).toBeUndefined()
    expect(recordPrLinkText(dir, "see https://gitlab.example.com/group/sub/proj/blob/main/x.ts")).toBeUndefined()
    expect(await restoreWorktree(dir, () => detectPrLink())).toBeUndefined()
    expect(ghCalls().length).toBe(0)
  })

  // The replaced `repoOf` ignored the link host; the host-aware `sameRepo` must
  // still fold a leading `www.` so a `www` link matches its bare worktree host.
  test("records a www link for a bare-host worktree", async () => {
    const dir = await makeRepo()
    await restoreWorktree(dir, () => detectPrLink())

    const link = recordPrLinkText(dir, "see https://www.github.com/owner/repo/pull/7")
    expect(link).toEqual({
      platform: "github",
      prUrl: "https://www.github.com/owner/repo/pull/7",
      prNumber: 7,
    })
  })

  // A remote ending `…/proj.git/` must resolve to the `proj` project, not
  // `proj.git`, or the worktree's own URL never matches.
  test("remote with a trailing slash after .git resolves its own URL", async () => {
    const dir = await makeRepo("feature/slash", "https://github.com/owner/repo.git/")
    await restoreWorktree(dir, () => detectPrLink())

    const link = recordPrLinkText(dir, "see https://github.com/owner/repo/pull/7")
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 })
  })

  // A `url.*.insteadOf` rewrite changes what `git remote get-url` prints; the
  // declared URL must still name the worktree's own host.
  test("a url.insteadOf rewrite does not hide the declared host", async () => {
    const dir = await makeRepo("feature/rewrite", "https://github.com/owner/repo.git")
    const git = simpleGit(dir)
    await git.raw(["config", "url.git@github-work:owner/repo.git.insteadOf", "https://github.com/owner/repo.git"])

    const link = recordPrLinkText(dir, "Opened https://github.com/owner/repo/pull/7")
    expect(link).toEqual({ platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 })
    expect(await restoreWorktree(dir, () => detectPrLink())).toEqual(link)
  })

  // A declared remote that is an `insteadOf` alias (`gh:owner/repo.git`) is not
  // itself a URL, so identity must fall back to `git remote get-url`, which
  // expands the alias to the real host. Treating the non-empty declared value as
  // final would lose detection for the worktree.
  test("an unparseable declared remote falls back to git remote get-url", async () => {
    const dir = await makeRepo("feature/expand", "gh:owner/repo.git")
    const git = simpleGit(dir)
    await git.raw(["config", "url.https://github.com/owner/repo.git.insteadOf", "gh:owner/repo.git"])

    const identity = await identityFor(dir)
    expect(identity?.host).toBe("github.com")
    expect(identity?.path).toBe("owner/repo")
    expect(identity?.platform).toBe("github")
  })
})

describe("linkMatchesWorktree", () => {
  test("accepts a pull request for the worktree's own repository", async () => {
    const dir = await makeRepo()
    expect(await linkMatchesWorktree(prLink("https://github.com/owner/repo/pull/7"), dir)).toBe(true)
  })

  test("refuses another repository on the same host", async () => {
    const dir = await makeRepo()
    expect(await linkMatchesWorktree(prLink("https://github.com/other/repo/pull/7"), dir)).toBe(false)
  })

  test("refuses a phishing host with the same project path", async () => {
    const dir = await makeRepo()
    expect(await linkMatchesWorktree(prLink("https://github.evil.example/owner/repo/pull/7"), dir)).toBe(false)
  })

  test("accepts when the worktree's repository cannot be resolved", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pr-link-none-"))
    created.push(dir)
    expect(await linkMatchesWorktree(prLink("https://github.com/owner/repo/pull/7"), dir)).toBe(true)
  })
})

describe("persistRecordedPrLink", () => {
  beforeEach(() => {
    outcome = { code: 0, text: "" }
    responder = undefined
    ghText.mockClear()
  })

  // The repro: a transient storage failure must not reject (the session watcher
  // awaits this before the immediate `session_pr_link` ingest) and must not
  // lose the record — a later persist call writes it, which is what the watcher
  // does for the next part that carries a PR URL.
  test("a failed write does not reject and is written by the next persist", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    await restoreWorktree(dir, () => detectPrLink())

    const link = {
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/3",
      prNumber: 3,
    }
    recordPrLinkText(dir, `Merged ${link.prUrl}`)

    // A directory where the record file belongs fails the write the way a
    // transient storage error does.
    const target = recordedPath(dir)
    await fs.mkdir(target, { recursive: true })
    await persistRecordedPrLink(dir)
    expect(await readRecordedPrLink(dir)).toBeUndefined()

    await fs.rm(target, { recursive: true, force: true })
    await persistRecordedPrLink(dir)
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/gl", link })
  })

  test("persists nothing when this process recorded no link", async () => {
    const dir = await makeRepo()
    await persistRecordedPrLink(dir)
    expect(await readRecordedPrLink(dir)).toBeUndefined()
  })

  // A link recorded before the branch was known is rewritten with the verified
  // key once detection binds it, so the record a later process reads is bound to
  // that branch instead of matching any branch of the repository.
  test("re-persists a link recorded before the branch was known once detection binds it", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    const expected = {
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/3",
      prNumber: 3,
    }

    const link = recordPrLinkText(dir, `Opened ${expected.prUrl}`)
    expect(link).toEqual(expected)

    // Before detection runs the record carries no branch key.
    await persistRecordedPrLink(dir)
    expect((await readRecordedPrLink(dir))?.key).toBeUndefined()

    expect(await restoreWorktree(dir, () => detectPrLink())).toEqual(expected)
    // Detection binds the record to the branch and rewrites it verified.
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/gl", link: expected })
  })

  // The repro for the record a stale detection drops: `forgetRecordedPrLink`
  // must also drop the write-dedup entry, or the next persist of that same link
  // is skipped, the record stays deleted and a fresh `kilo pr status` process
  // prints `no PR linked` until the process exits.
  test("rewrites a record this process forgot", async () => {
    const dir = await makeRepo("feature/gl", "https://gitlab.example.com/group/sub/proj.git")
    await restoreWorktree(dir, () => detectPrLink())

    const link = {
      platform: "gitlab",
      prUrl: "https://gitlab.example.com/group/sub/proj/-/merge_requests/3",
      prNumber: 3,
    }
    recordPrLinkText(dir, `Merged ${link.prUrl}`)
    await persistRecordedPrLink(dir)
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/gl", link })

    await forgetRecordedPrLink(dir)
    expect(await readRecordedPrLink(dir)).toBeUndefined()

    await persistRecordedPrLink(dir)
    expect(await readRecordedPrLink(dir)).toEqual({ key: "origin/feature/gl", link })
  })
})
