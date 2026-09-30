// kilocode_change - new file (moved from src/kilo-sessions/pr-link.test.ts so the
// package test runner scans it; it previously sat under src/ and never ran).
import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
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
  clearSessionLink,
  linkMatchesWorktree,
  loadSessionLinks,
  mapLimit,
  parsePrUrl,
  pruneLegacyWorktreeLinks,
  readSessionPrLink,
  recordPrCreate,
  recordPush,
  recordSessionLink,
  sessionLinkKey,
  writeSessionPrLink,
} = await import("@/kilo-sessions/pr-link")
const { PR_POLL_INTERVAL_MS, bitbucketQuery, refreshPrLink, startPrLinkPoll } = await import(
  "@/kilo-sessions/pr-link-poller"
)

// A record the shape a session owns, for seeding the refresh tests without
// going through the create/push evidence path.
function sessionRecord(url: string, headRef: string, headSha: string, evidence: "pr_create" | "push" = "pr_create") {
  const link = parsePrUrl(url)
  if (!link) throw new Error(`not a pull request URL: ${url}`)
  return { link, headRef, headSha, evidence } as const
}

async function clearAllSessionLinks() {
  const links = await loadSessionLinks()
  for (const sessionId of links.keys()) await clearSessionLink(sessionId)
}

// Write a legacy per-worktree record the way an older CLI would have, directly
// to the storage file, so the prune can be exercised against the real on-disk
// layout.
async function writeLegacy(key: string[], value: unknown) {
  const target = path.join(Global.Path.data, "storage", ...key) + ".json"
  await fs.mkdir(path.dirname(target), { recursive: true })
  await fs.writeFile(target, JSON.stringify(value, null, 2))
  return target
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

let client: string | undefined
beforeEach(() => {
  client = process.env.KILO_CLIENT
  process.env.KILO_CLIENT = "cli"
})
afterEach(async () => {
  try {
    await clearAllSessionLinks()
  } finally {
    if (client == null) delete process.env.KILO_CLIENT
    if (client != null) process.env.KILO_CLIENT = client
  }
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

async function commit(dir: string, name: string) {
  const git = simpleGit(dir)
  await fs.writeFile(path.join(dir, name), name)
  await git.add(name)
  await git.commit(name)
  return (await git.revparse(["HEAD"])).trim()
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

// The shape `gh api repos/<owner>/<repo>/pulls` returns for the session's own
// pull request.
function ghPr(url: string, ref: string, full: string) {
  return {
    html_url: url,
    head: { ref, sha: "abc1234", repo: { full_name: full } },
    base: { repo: { full_name: full } },
  }
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

describe("session link storage", () => {
  test("round-trips a link through the per-session key", async () => {
    const dir = await makeRepo()
    const url = "https://github.com/owner/repo/pull/7"
    const record = await recordPrCreate("ses_a", dir, `Opened\n${url}\n`)
    expect(record?.link).toEqual(prLink(url))
    expect(await readSessionPrLink("ses_a")).toEqual(record)
    expect(sessionLinkKey("ses_a")).toEqual(["session_pr_link_session", "ses_a"])
  })

  test("loadSessionLinks reads only present sessions", async () => {
    const dir = await makeRepo()
    await recordPrCreate("ses_a", dir, "https://github.com/owner/repo/pull/7")
    const links = await loadSessionLinks()
    expect(links.get("ses_a")?.link.prNumber).toBe(7)
    expect(links.has("ses_missing")).toBe(false)
  })

  test("loadSessionLinks with ids reads only those sessions", async () => {
    const dir = await makeRepo()
    await recordPrCreate("ses_a", dir, "https://github.com/owner/repo/pull/7")
    await recordPrCreate("ses_b", dir, "https://github.com/owner/repo/pull/8")
    const links = await loadSessionLinks(["ses_a"])
    expect([...links.keys()]).toEqual(["ses_a"])
    expect(links.get("ses_a")?.link.prNumber).toBe(7)
  })

  test("mapLimit bounds in-flight work and preserves order", async () => {
    let active = 0
    let peak = 0
    const out = await mapLimit([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 3, async (n) => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((r) => setTimeout(r, 5))
      active -= 1
      return n * 2
    })
    expect(out).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20])
    expect(peak).toBeLessThanOrEqual(3)
    expect(peak).toBeGreaterThan(1)
  })

  test("clearSessionLink withdraws only that session", async () => {
    const dir = await makeRepo()
    await recordPrCreate("ses_a", dir, "https://github.com/owner/repo/pull/7")
    await recordPrCreate("ses_b", dir, "https://github.com/owner/repo/pull/8")
    await clearSessionLink("ses_a")
    expect(await readSessionPrLink("ses_a")).toBeUndefined()
    expect((await readSessionPrLink("ses_b"))?.link.prNumber).toBe(8)
  })

  test("recordSessionLink refuses a link for another repository", async () => {
    const dir = await makeRepo()
    const record = await recordSessionLink(
      "ses_a",
      sessionRecord("https://github.com/other/repo/pull/1", "feature/x", "a"),
      dir,
    )
    expect(record).toBeUndefined()
    expect(await readSessionPrLink("ses_a")).toBeUndefined()
  })
})

describe("refreshPrLink", () => {
  beforeEach(async () => {
    outcome = { code: 0, text: "" }
    responder = undefined
    apiResponder = undefined
    ghText.mockClear()
    fetchMock.mockClear()
    await clearAllSessionLinks()
  })

  async function seedGitHub(sessionId: string, url = "https://github.com/owner/repo/pull/12", headSha = "abc1234") {
    await writeSessionPrLink(sessionId, sessionRecord(url, "feature/x", headSha))
  }

  test("keeps a session's own open pull request", async () => {
    await seedGitHub("ses_a")
    respondGh([ghPr("https://github.com/owner/repo/pull/12", "feature/x", "owner/repo")])

    await refreshPrLink()

    expect(ghCalls()[0]).toEqual(["gh", "api", "repos/owner/repo/pulls?head=owner%3Afeature%2Fx&state=open"])
    expect((await readSessionPrLink("ses_a"))?.link.prNumber).toBe(12)
  })

  test("clears a session's link when the host reports no open pull request", async () => {
    await seedGitHub("ses_a")
    respondGh([])

    await refreshPrLink()

    expect(await readSessionPrLink("ses_a")).toBeUndefined()
  })

  test("never replaces a session's link with a different open pull request", async () => {
    await seedGitHub("ses_a")
    respondGh([ghPr("https://github.com/owner/repo/pull/99", "feature/x", "owner/repo")])

    await refreshPrLink()

    expect((await readSessionPrLink("ses_a"))?.link.prNumber).toBe(12)
  })

  test("refresh never rewrites headSha with a commit the session did not push", async () => {
    await seedGitHub("ses_a")
    // The host reports a different head commit for the session's own open pull
    // request (a force-push by someone else). The refresh must not overwrite the
    // session's evidence with a commit it never pushed.
    respondGh([
      {
        html_url: "https://github.com/owner/repo/pull/12",
        head: { ref: "feature/x", sha: "deadbeefcafe", repo: { full_name: "owner/repo" } },
        base: { repo: { full_name: "owner/repo" } },
      },
    ])

    await refreshPrLink()

    const record = await readSessionPrLink("ses_a")
    expect(record?.link.prNumber).toBe(12)
    expect(record?.headSha).toBe("abc1234")
  })

  test("a fork pull request on the same branch is not the session's link", async () => {
    await seedGitHub("ses_a")
    respondGh([ghPr("https://github.com/owner/repo/pull/12", "feature/x", "someone/fork")])

    await refreshPrLink()

    expect((await readSessionPrLink("ses_a"))?.link.prNumber).toBe(12)
  })

  test("an inconclusive GitHub check keeps the link and clears nothing", async () => {
    await seedGitHub("ses_a")
    respondGh("", 1)

    await refreshPrLink()

    expect((await readSessionPrLink("ses_a"))?.link.prNumber).toBe(12)
  })

  test("refresh only touches links sessions already own (no discovery)", async () => {
    respondGh([ghPr("https://github.com/owner/repo/pull/12", "feature/x", "owner/repo")])

    await refreshPrLink()

    expect(ghCalls().length).toBe(0)
    expect((await loadSessionLinks()).size).toBe(0)
  })

  test("refreshPrLink({ sessionId }) queries only the requested session's link", async () => {
    await seedGitHub("ses_a")
    await writeSessionPrLink("ses_b", sessionRecord("https://github.com/other/repo/pull/3", "feature/y", "def5678"))
    responder = (cmd) =>
      cmd.join(" ").includes("repos/other/repo/")
        ? { code: 0, text: JSON.stringify([ghPr("https://github.com/other/repo/pull/3", "feature/y", "other/repo")]) }
        : { code: 0, text: JSON.stringify([ghPr("https://github.com/owner/repo/pull/12", "feature/x", "owner/repo")]) }

    await refreshPrLink({ sessionId: "ses_a" })

    // One host call for the requested session, not one per unrelated session.
    expect(ghCalls().length).toBe(1)
    expect(ghCalls()[0]!.join(" ")).toContain("repos/owner/repo/")
    expect((await readSessionPrLink("ses_a"))?.link.prNumber).toBe(12)
    expect((await readSessionPrLink("ses_b"))?.link.prNumber).toBe(3)
  })

  test("a scoped refresh clears only the requested session when its PR closed", async () => {
    await seedGitHub("ses_a")
    await writeSessionPrLink("ses_b", sessionRecord("https://github.com/other/repo/pull/3", "feature/y", "def5678"))
    respondGh([])

    await refreshPrLink({ sessionId: "ses_a" })

    expect(await readSessionPrLink("ses_a")).toBeUndefined()
    expect((await readSessionPrLink("ses_b"))?.link.prNumber).toBe(3)
  })

  test("one host query per distinct repository and branch across many sessions", async () => {
    await seedGitHub("ses_a")
    await seedGitHub("ses_b")
    await writeSessionPrLink("ses_c", sessionRecord("https://github.com/other/repo/pull/3", "feature/x", "def5678"))
    responder = (cmd) => {
      const line = cmd.join(" ")
      if (line.includes("repos/other/repo/")) {
        return {
          code: 0,
          text: JSON.stringify([ghPr("https://github.com/other/repo/pull/3", "feature/x", "other/repo")]),
        }
      }
      return {
        code: 0,
        text: JSON.stringify([ghPr("https://github.com/owner/repo/pull/12", "feature/x", "owner/repo")]),
      }
    }

    await refreshPrLink()

    expect(ghCalls().length).toBe(2)
    expect((await readSessionPrLink("ses_a"))?.link.prNumber).toBe(12)
    expect((await readSessionPrLink("ses_b"))?.link.prNumber).toBe(12)
    expect((await readSessionPrLink("ses_c"))?.link.prNumber).toBe(3)
  })

  test("a GitLab branch refreshes its own open merge request", async () => {
    await writeSessionPrLink(
      "ses_gl",
      sessionRecord("https://gitlab.example.com/group/sub/proj/-/merge_requests/5", "feature/gl", "sha1"),
    )
    respondApi([
      {
        web_url: "https://gitlab.example.com/group/sub/proj/-/merge_requests/5",
        sha: "sha1",
        source_branch: "feature/gl",
        source_project_id: 1,
        target_project_id: 1,
      },
    ])

    await refreshPrLink()

    expect(apiUrl().pathname).toBe("/api/v4/projects/group%2Fsub%2Fproj/merge_requests")
    expect(apiUrl().searchParams.get("source_branch")).toBe("feature/gl")
    expect(apiUrl().searchParams.get("state")).toBe("opened")
    expect((await readSessionPrLink("ses_gl"))?.link.prNumber).toBe(5)
    expect(ghCalls().length).toBe(0)
  })

  test("a GitLab fork merge request is not the session's link", async () => {
    await writeSessionPrLink(
      "ses_gl",
      sessionRecord("https://gitlab.example.com/group/sub/proj/-/merge_requests/5", "feature/gl", "sha1"),
    )
    respondApi([
      {
        web_url: "https://gitlab.example.com/group/sub/proj/-/merge_requests/5",
        sha: "sha2",
        source_branch: "feature/gl",
        source_project_id: 2,
        target_project_id: 1,
      },
    ])

    await refreshPrLink()

    expect((await readSessionPrLink("ses_gl"))?.link.prNumber).toBe(5)
  })

  test("a closed merge request clears the session's link", async () => {
    await writeSessionPrLink(
      "ses_gl",
      sessionRecord("https://gitlab.example.com/group/sub/proj/-/merge_requests/5", "feature/gl", "sha1"),
    )
    respondApi([])

    await refreshPrLink()

    expect(await readSessionPrLink("ses_gl")).toBeUndefined()
  })

  // The token is the user's credential, so it is sent only to the canonical host
  // or to a host the user designated: a hostile remote whose host merely starts
  // with `gitlab` must never receive it.
  test("the GitLab token is sent to gitlab.com but not to an undesignated host", async () => {
    process.env.GITLAB_TOKEN = "gl-secret"
    try {
      await writeSessionPrLink(
        "ses_canonical",
        sessionRecord("https://gitlab.com/group/proj/-/merge_requests/5", "feature/gl", "sha1"),
      )
      respondApi([{ web_url: "https://gitlab.com/group/proj/-/merge_requests/5", source_branch: "feature/gl" }])
      await refreshPrLink()
      expect(fetchHeader(0, "PRIVATE-TOKEN")).toBe("gl-secret")

      fetchMock.mockClear()
      await clearAllSessionLinks()
      await writeSessionPrLink(
        "ses_hostile",
        sessionRecord("https://gitlab.attacker.example/group/proj/-/merge_requests/5", "feature/gl", "sha1"),
      )
      respondApi([
        { web_url: "https://gitlab.attacker.example/group/proj/-/merge_requests/5", source_branch: "feature/gl" },
      ])
      await refreshPrLink()
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
      await writeSessionPrLink(
        "ses_gle",
        sessionRecord("https://gitlab.mycorp.example/group/proj/-/merge_requests/8", "feature/gl", "sha1"),
      )
      respondApi([
        { web_url: "https://gitlab.mycorp.example/group/proj/-/merge_requests/8", source_branch: "feature/gl" },
      ])
      await refreshPrLink()
      expect(fetchHeader(0, "PRIVATE-TOKEN")).toBe("gl-secret")
    } finally {
      delete process.env.GITLAB_TOKEN
      delete process.env.GITLAB_HOST
    }
  })

  test("a Bitbucket branch refreshes its own open pull request", async () => {
    await writeSessionPrLink(
      "ses_bb",
      sessionRecord("https://bitbucket.org/team/repo/pull-requests/3", "feature/bb", "sha1"),
    )
    respondApi({
      values: [
        {
          links: { html: { href: "https://bitbucket.org/team/repo/pull-requests/3" } },
          source: { branch: { name: "feature/bb" }, repository: { full_name: "team/repo" }, commit: { hash: "sha1" } },
          destination: { repository: { full_name: "team/repo" } },
        },
      ],
    })

    await refreshPrLink()

    expect(apiUrl().origin).toBe("https://api.bitbucket.org")
    expect(apiUrl().pathname).toBe("/2.0/repositories/team/repo/pullrequests")
    expect(apiUrl().searchParams.get("q")).toBe('source.branch.name="feature/bb" AND state="OPEN"')
    expect((await readSessionPrLink("ses_bb"))?.link.prNumber).toBe(3)
    expect(ghCalls().length).toBe(0)
  })

  test("a non-Cloud Bitbucket host stays inconclusive and queries nothing", async () => {
    await writeSessionPrLink(
      "ses_bb",
      sessionRecord("https://bitbucket.mycorp.example/team/repo/pull-requests/3", "feature/bb", "sha1"),
    )
    await refreshPrLink()
    expect(fetchUrls().length).toBe(0)
    expect(ghCalls().length).toBe(0)
    expect((await readSessionPrLink("ses_bb"))?.link.prNumber).toBe(3)
  })

  test("a non-zero or spawn-failed GitHub check keeps the link and clears nothing", async () => {
    await seedGitHub("ses_a")
    respondGh("", 1)
    await refreshPrLink()
    expect((await readSessionPrLink("ses_a"))?.link.prNumber).toBe(12)

    responder = undefined
    outcome = { error: new Error("spawn gh ENOENT") }
    await refreshPrLink()
    expect((await readSessionPrLink("ses_a"))?.link.prNumber).toBe(12)
  })

  test("a failed or unauthorized API check keeps the link and clears nothing", async () => {
    await writeSessionPrLink(
      "ses_gl",
      sessionRecord("https://gitlab.example.com/group/sub/proj/-/merge_requests/5", "feature/gl", "sha1"),
    )
    respondApi({ message: "401 Unauthorized" }, 401)
    await refreshPrLink()
    expect((await readSessionPrLink("ses_gl"))?.link.prNumber).toBe(5)

    respondApiError(new Error("fetch failed"))
    await refreshPrLink()
    expect((await readSessionPrLink("ses_gl"))?.link.prNumber).toBe(5)
  })

  test("escapes a quote in the Bitbucket branch filter", () => {
    expect(bitbucketQuery('a"b')).toBe('source.branch.name="a\\"b" AND state="OPEN"')
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

describe("recordPush", () => {
  beforeEach(async () => {
    outcome = { code: 0, text: "" }
    responder = undefined
    ghText.mockClear()
    await clearAllSessionLinks()
  })

  test("advances headSha and keeps the link on a later push", async () => {
    const dir = await makeRepo()
    const first = await recordPrCreate("ses_a", dir, "Opened\nhttps://github.com/owner/repo/pull/7\n")
    const next = await commit(dir, "b.txt")

    const pushed = await recordPush(
      "ses_a",
      dir,
      "git push origin feature/x",
      `To github.com:owner/repo.git\n   ${first?.headSha}..${next}  feature/x -> feature/x\n`,
    )

    expect(pushed?.link.prNumber).toBe(7)
    expect(pushed?.headRef).toBe("feature/x")
    expect(pushed?.headSha).toBe(next)
    expect((await readSessionPrLink("ses_a"))?.headSha).toBe(next)
  })

  test("a push a session never linked does not create a link", async () => {
    const dir = await makeRepo()
    const pushed = await recordPush(
      "ses_a",
      dir,
      "git push origin feature/x",
      "To github.com:owner/repo.git\n * [new branch]      feature/x -> feature/x\n",
    )
    expect(pushed).toBeUndefined()
    expect(await readSessionPrLink("ses_a")).toBeUndefined()
  })

  test("a push on another branch does not move the link", async () => {
    const dir = await makeRepo()
    const first = await recordPrCreate("ses_a", dir, "Opened\nhttps://github.com/owner/repo/pull/7\n")
    const next = await commit(dir, "c.txt")
    const pushed = await recordPush(
      "ses_a",
      dir,
      "git push origin other",
      `To github.com:owner/repo.git\n   ${first?.headSha}..${next}  other -> other\n`,
    )
    expect(pushed).toBeUndefined()
    expect((await readSessionPrLink("ses_a"))?.headSha).toBe(first?.headSha)
  })

  test("a dry run does not advance headSha", async () => {
    const dir = await makeRepo()
    const first = await recordPrCreate("ses_a", dir, "Opened\nhttps://github.com/owner/repo/pull/7\n")
    const next = await commit(dir, "d.txt")
    const pushed = await recordPush(
      "ses_a",
      dir,
      "git push --dry-run origin feature/x",
      `To github.com:owner/repo.git\n   ${first?.headSha}..${next}  feature/x -> feature/x\n`,
    )
    expect(pushed).toBeUndefined()
    expect((await readSessionPrLink("ses_a"))?.headSha).toBe(first?.headSha)
  })

  test("a short dry-run flag does not advance headSha", async () => {
    const dir = await makeRepo()
    const first = await recordPrCreate("ses_a", dir, "Opened\nhttps://github.com/owner/repo/pull/7\n")
    const next = await commit(dir, "e.txt")
    const pushed = await recordPush(
      "ses_a",
      dir,
      "git push -n origin feature/x",
      `To github.com:owner/repo.git\n   ${first?.headSha}..${next}  feature/x -> feature/x\n`,
    )
    expect(pushed).toBeUndefined()
    expect((await readSessionPrLink("ses_a"))?.headSha).toBe(first?.headSha)
  })

  test("a branch deletion does not advance headSha", async () => {
    const dir = await makeRepo()
    const first = await recordPrCreate("ses_a", dir, "Opened\nhttps://github.com/owner/repo/pull/7\n")
    // The local branch moved on but was never pushed; a delete must not promote
    // that local commit to the session's pushed evidence.
    await commit(dir, "f.txt")
    const pushed = await recordPush(
      "ses_a",
      dir,
      "git push origin --delete feature/x",
      "To github.com:owner/repo.git\n - [deleted]         feature/x\n",
    )
    expect(pushed).toBeUndefined()
    expect((await readSessionPrLink("ses_a"))?.headSha).toBe(first?.headSha)
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

describe("pruneLegacyWorktreeLinks", () => {
  test("deletes the old per-worktree recorded and override keys", async () => {
    const worktree = "/tmp/legacy-worktree"
    const recorded = await writeLegacy(["session_pr_link_recorded", encodeURIComponent(worktree)], {
      key: "origin/main",
      link: { platform: "github", prUrl: "https://github.com/owner/repo/pull/1", prNumber: 1 },
    })
    const override = await writeLegacy(["session_pr_link", encodeURIComponent(worktree)], {
      platform: "github",
      prUrl: "https://github.com/owner/repo/pull/2",
      prNumber: 2,
    })

    // A session link is untouched by the prune.
    const dir = await makeRepo()
    await recordPrCreate("ses_a", dir, "Opened\nhttps://github.com/owner/repo/pull/7\n")

    expect(await pruneLegacyWorktreeLinks()).toBe(2)
    expect(await fs.stat(recorded).catch(() => undefined)).toBeUndefined()
    expect(await fs.stat(override).catch(() => undefined)).toBeUndefined()
    expect((await readSessionPrLink("ses_a"))?.link.prNumber).toBe(7)
  })

  test("reports zero when there is nothing to prune", async () => {
    expect(await pruneLegacyWorktreeLinks()).toBe(0)
  })
})
