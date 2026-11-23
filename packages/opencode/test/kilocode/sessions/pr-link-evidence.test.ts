// kilocode_change - new file. Hard-evidence tests: a session owns a pull
// request only from its own `gh pr create` output, its own push of the PR's
// head branch, or an explicit user link. A same-named branch in another repo or
// a fork, a reused branch name, a PR merely checked out, or a PR merely
// mentioned/listed/viewed must never attach.
import { afterAll, afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Global } from "@opencode-ai/core/global"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { simpleGit } from "simple-git"

const realProcess = await import("@/util/process")

type Outcome = { code: number; text: string } | { error: Error }
let responder: ((cmd: string[]) => Outcome) | undefined

const ghText = mock(async (cmd: string[]) => {
  const out = responder ? responder(cmd) : { code: 0, text: "" }
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

const prLink = await import("@/kilo-sessions/pr-link")
const { clearSessionLink, loadSessionLinks, readSessionPrLink, recordPrCreate, recordPush } = prLink
const { refreshPrLink } = await import("@/kilo-sessions/pr-link-poller")

const created: string[] = []

afterAll(async () => {
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
    const links = await loadSessionLinks()
    for (const sessionId of links.keys()) await clearSessionLink(sessionId)
  } finally {
    if (client == null) delete process.env.KILO_CLIENT
    if (client != null) process.env.KILO_CLIENT = client
  }
})

async function makeRepo(branch = "feature/x", remote = "https://github.com/owner/repo.git") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pr-link-evidence-"))
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

async function headOf(dir: string) {
  return (await simpleGit(dir).revparse(["HEAD"])).trim()
}

function ghCalls() {
  return ghText.mock.calls.map((call) => call[0])
}

function ghPr(url: string, ref: string, full: string) {
  return {
    html_url: url,
    head: { ref, sha: "abc1234", repo: { full_name: full } },
    base: { repo: { full_name: full } },
  }
}

// The heartbeat only advertises a link the session itself owns.
async function heartbeatLink(sessionId: string) {
  return (await loadSessionLinks()).get(sessionId)?.link
}

describe("hard evidence", () => {
  beforeEach(async () => {
    responder = undefined
    apiResponder = undefined
    ghText.mockClear()
    fetchMock.mockClear()
    const links = await loadSessionLinks()
    for (const sessionId of links.keys()) await clearSessionLink(sessionId)
  })

  test("a session's own gh pr create output links with headRef and headSha", async () => {
    const dir = await makeRepo()
    const head = await headOf(dir)

    const record = await recordPrCreate(
      "ses_owner",
      dir,
      "Creating pull request for feature/x into main in owner/repo\n\nhttps://github.com/owner/repo/pull/7\n",
    )

    expect(record?.link.prNumber).toBe(7)
    expect(record?.headRef).toBe("feature/x")
    expect(record?.headSha).toBe(head)
    expect(record?.evidence).toBe("pr_create")
    expect(await readSessionPrLink("ses_owner")).toEqual(record)
  })

  test("a same-named branch in another repo never links", async () => {
    const dir = await makeRepo("feature/x", "https://github.com/owner/repo.git")

    const record = await recordPrCreate("ses_other", dir, "Opened\nhttps://github.com/other/repo/pull/5\n")

    expect(record).toBeUndefined()
    expect(await readSessionPrLink("ses_other")).toBeUndefined()
    expect(await heartbeatLink("ses_other")).toBeUndefined()
  })

  test("a same-named branch in a fork never links the upstream PR", async () => {
    // The session's worktree is its own fork; the PR URL names the upstream
    // repository, so the same branch name must not attach it.
    const dir = await makeRepo("feature/x", "git@github.com:me/repo.git")

    const record = await recordPrCreate("ses_fork", dir, "Opened\nhttps://github.com/upstream/repo/pull/9\n")

    expect(record).toBeUndefined()
    expect(await readSessionPrLink("ses_fork")).toBeUndefined()
  })

  test("a PR URL only mentioned in agent text or gh pr list/view output never links", async () => {
    const dir = await makeRepo()
    const url = "https://github.com/owner/repo/pull/5"

    // `gh pr list --json` prints JSON; `gh pr view` prints labelled fields.
    // Neither is a create result, so neither is evidence.
    expect(await recordPrCreate("ses_mention", dir, `[{"number":5,"url":"${url}"}]`)).toBeUndefined()
    expect(await recordPrCreate("ses_mention", dir, `title:\tFix\nurl:\t${url}\nnumber:\t5\n`)).toBeUndefined()
    expect(await recordPrCreate("ses_mention", dir, `I reviewed ${url} for a colleague`)).toBeUndefined()

    expect(await readSessionPrLink("ses_mention")).toBeUndefined()
    expect(await heartbeatLink("ses_mention")).toBeUndefined()
  })

  test("the mention-as-ownership scrapers are gone", () => {
    expect("recordPrLinkText" in prLink).toBe(false)
    expect("detectPrLink" in prLink).toBe(false)
    expect("persistRecordedPrLink" in prLink).toBe(false)
    expect("writePrLinkOverride" in prLink).toBe(false)
    expect("writePolledPrLink" in prLink).toBe(false)
  })

  test("a reused branch name whose old PR was recorded for the worktree stays unlinked", async () => {
    const dir = await makeRepo()
    // The old per-worktree record a previous CLI would have persisted for this
    // checkout and branch name.
    const legacy = path.join(Global.Path.data, "storage", "session_pr_link_recorded", encodeURIComponent(dir) + ".json")
    await fs.mkdir(path.dirname(legacy), { recursive: true })
    await fs.writeFile(
      legacy,
      JSON.stringify({
        key: "origin/feature/x",
        link: { platform: "github", prUrl: "https://github.com/owner/repo/pull/1", prNumber: 1 },
      }),
    )

    // A new session on the same branch name sees no link: the record is not
    // session-scoped, so it is ignored, and the prune removes it.
    expect(await heartbeatLink("ses_new")).toBeUndefined()
    expect(await loadSessionLinks()).toEqual(new Map())
    expect(await prLink.pruneLegacyWorktreeLinks()).toBeGreaterThanOrEqual(1)
    expect(await fs.stat(legacy).catch(() => undefined)).toBeUndefined()
    expect(await heartbeatLink("ses_new")).toBeUndefined()
  })

  test("a PR opened by someone else on a branch the session only checked out never links", async () => {
    const dir = await makeRepo()
    // The host reports an open PR on the branch, but the session pushed nothing
    // and owns no link, so the check must not discover it.
    responder = () => ({
      code: 0,
      text: JSON.stringify([ghPr("https://github.com/owner/repo/pull/5", "feature/x", "owner/repo")]),
    })

    await refreshPrLink()

    expect(ghCalls().length).toBe(0)
    expect(await readSessionPrLink("ses_checked_out")).toBeUndefined()
    expect(await loadSessionLinks()).toEqual(new Map())
  })

  test("pushing new commits to the PR keeps the link", async () => {
    const dir = await makeRepo()
    const first = await recordPrCreate("ses_push", dir, "Opened\nhttps://github.com/owner/repo/pull/7\n")
    const next = await commit(dir, "b.txt")

    const pushed = await recordPush(
      "ses_push",
      dir,
      "git push origin feature/x",
      `To github.com:owner/repo.git\n   ${first?.headSha}..${next}  feature/x -> feature/x\n`,
    )

    expect(pushed?.link.prNumber).toBe(7)
    expect(pushed?.headRef).toBe("feature/x")
    expect(pushed?.headSha).toBe(next)
    expect(await heartbeatLink("ses_push")).toEqual(pushed?.link)
  })

  test("several sessions in one worktree: only the creator gets the link", async () => {
    const dir = await makeRepo()
    await recordPrCreate("ses_owner", dir, "Opened\nhttps://github.com/owner/repo/pull/7\n")
    responder = () => ({
      code: 0,
      text: JSON.stringify([ghPr("https://github.com/owner/repo/pull/7", "feature/x", "owner/repo")]),
    })

    await refreshPrLink()

    expect((await heartbeatLink("ses_owner"))?.prNumber).toBe(7)
    // The other session in the same checkout has no evidence, so the heartbeat
    // carries no link for it.
    expect(await heartbeatLink("ses_bystander")).toBeUndefined()
    // Even the worktree's own recorded branch link is not inherited.
    expect((await loadSessionLinks()).size).toBe(1)
  })

  test("one host query per distinct repository and branch across many sessions", async () => {
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
        text: JSON.stringify([ghPr("https://github.com/owner/repo/pull/7", "feature/x", "owner/repo")]),
      }
    }
    await prLink.writeSessionPrLink("ses_one", {
      link: { platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 },
      headRef: "feature/x",
      headSha: "abc",
      evidence: "pr_create",
    })
    await prLink.writeSessionPrLink("ses_two", {
      link: { platform: "github", prUrl: "https://github.com/owner/repo/pull/7", prNumber: 7 },
      headRef: "feature/x",
      headSha: "abc",
      evidence: "pr_create",
    })
    await prLink.writeSessionPrLink("ses_three", {
      link: { platform: "github", prUrl: "https://github.com/other/repo/pull/3", prNumber: 3 },
      headRef: "feature/x",
      headSha: "def",
      evidence: "push",
    })

    await refreshPrLink()

    expect(ghCalls().length).toBe(2)
    expect((await heartbeatLink("ses_one"))?.prNumber).toBe(7)
    expect((await heartbeatLink("ses_two"))?.prNumber).toBe(7)
    expect((await heartbeatLink("ses_three"))?.prNumber).toBe(3)
  })
})
