// kilocode_change - new file

/**
 * Tests for the v2-port PR resolver. Pure-function cases plus end-to-end runs
 * of the real prs.mjs against a local stub of the GitHub API (the
 * `DOCS_SYNC_API_BASE` hook), so the push-to-PR mapping, its scope filter,
 * cap, error isolation and commit-message fallback run as real code.
 *
 * Run: node .github/v2-port/prs.test.mjs
 */

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { CAP, dispatchPr, mergedInto, prRefs, pushShas, touchesScope } from "./prs.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, "prs.mjs")
const REPO = "acme/repo"

let passed = 0

function test(name, fn) {
  try {
    fn()
    passed++
    console.log(`ok - ${name}`)
  } catch (err) {
    console.error(`not ok - ${name}`)
    throw err
  }
}

// The number leads, so the 12-character short SHA in logs tells commits apart.
const sha = (n) => String(n).padEnd(40, "a")
const merged = (number, base = "main", merge = undefined) => ({
  number,
  merged_at: "2026-11-26T00:00:00Z",
  base: { ref: base },
  merge_commit_sha: merge,
})
const inScope = { added: [], removed: [], modified: ["packages/opencode/src/kilocode/x.ts"] }
const outOfScope = { added: ["docs/readme.md"], removed: [], modified: ["packages/kilo-vscode/src/a.ts"] }
const commit = (n, files = inScope, extra = {}) => ({
  id: sha(n),
  distinct: true,
  message: `change ${n}`,
  ...files,
  ...extra,
})

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

test("touchesScope reads the file lists and keeps commits whose lists are missing or empty", () => {
  assert.equal(touchesScope(inScope), true)
  assert.equal(touchesScope(outOfScope), false)
  assert.equal(touchesScope({ removed: ["packages/opencode/old.ts"], added: [], modified: [] }), true)
  assert.equal(touchesScope({ id: sha(1) }), true)
  assert.equal(touchesScope({ added: [], removed: [], modified: [] }), true)
})

test("pushShas keeps distinct in-scope commits, once each, head_commit first, then newest first", () => {
  const event = {
    commits: [commit(1), commit(2, inScope, { distinct: false }), commit(3, outOfScope), commit(4), commit(1)],
    head_commit: commit(5, outOfScope),
  }
  assert.deepEqual(pushShas(event), { shas: [sha(5), sha(4), sha(1)], skipped: 0 })
})

test("pushShas drops malformed ids and handles an empty event", () => {
  assert.deepEqual(pushShas({ commits: [{ id: "../../x", distinct: true }] }), { shas: [], skipped: 0 })
  assert.deepEqual(pushShas(null), { shas: [], skipped: 0 })
})

test("pushShas caps lookups at CAP, keeping the newest and head_commit", () => {
  const commits = Array.from({ length: 60 }, (_, i) => commit(100 + i))
  const head = commits.at(-1)
  const out = pushShas({ commits, head_commit: head })
  assert.equal(out.shas.length, CAP)
  assert.equal(out.skipped, 60 - CAP)
  assert.equal(out.shas[0], head.id)
  assert.equal(out.shas[1], sha(100 + 58))
  assert.equal(out.shas.at(-1), sha(100 + 60 - CAP))
})

test("prRefs reads squash and merge commit subjects only", () => {
  assert.deepEqual(prRefs("fix(cli): keep queue (#123)\n\nbody (#9)"), [123])
  assert.deepEqual(prRefs("Merge pull request #456 from acme/branch\n\ntitle"), [456])
  assert.deepEqual(prRefs("chore: bump (#12) deps"), [])
  assert.deepEqual(prRefs(undefined), [])
})

test("mergedInto keeps only PRs merged into the pushed branch", () => {
  const pulls = [
    merged(10),
    { number: 11, merged_at: null, base: { ref: "main" } },
    merged(12, "v2"),
    { number: "13", merged_at: "2026-11-26T00:00:00Z", base: { ref: "main" } },
  ]
  assert.deepEqual(mergedInto(pulls, "main"), [10])
  assert.deepEqual(mergedInto(null, "main"), [])
})

test("dispatchPr accepts a positive integer only", () => {
  assert.equal(dispatchPr("42"), 42)
  assert.equal(dispatchPr(" 7 "), 7)
  for (const bad of ["", "0", "-1", "1.5", "12abc", undefined]) assert.throws(() => dispatchPr(bad), /positive integer/)
})

// ---------------------------------------------------------------------------
// End-to-end: real prs.mjs against a stubbed GitHub API
// ---------------------------------------------------------------------------

const temps = []
function mktemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-port-prs-"))
  temps.push(dir)
  return dir
}

/**
 * Stub for `commits/{sha}/pulls` and `pulls/{n}`. A sha in `fail` answers 404,
 * a sha in `limited` answers a rate limit with a one-hour Retry-After, a sha
 * in `hang` never answers, and a sha missing from `pulls` answers an empty list.
 */
function startStub({ pulls = {}, prs = {}, fail = [], limited = [], hang = [] }) {
  const log = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://stub")
    log.push(url.pathname)
    const send = (status, data, headers = {}) => {
      res.writeHead(status, { "content-type": "application/json", ...headers })
      res.end(JSON.stringify(data))
    }
    const bySha = url.pathname.match(/^\/repos\/acme\/repo\/commits\/([0-9a-f]{40})\/pulls$/)
    if (req.method === "GET" && bySha) {
      if (hang.includes(bySha[1])) return
      if (fail.includes(bySha[1])) return send(404, { message: "No commit found" })
      if (limited.includes(bySha[1]))
        return send(403, { message: "API rate limit exceeded" }, { "retry-after": "3600" })
      return send(200, pulls[bySha[1]] ?? [])
    }
    const byNumber = url.pathname.match(/^\/repos\/acme\/repo\/pulls\/(\d+)$/)
    if (req.method === "GET" && byNumber) {
      const pr = prs[byNumber[1]]
      return pr ? send(200, pr) : send(404, { message: "Not Found" })
    }
    send(404, { message: `unhandled ${req.method} ${req.url}` })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, log, port: server.address().port }))
  })
}

function runPrs(dir, port, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: dir,
      env: {
        ...process.env,
        GH_TOKEN: "stub-token",
        GITHUB_REPOSITORY: REPO,
        GITHUB_OUTPUT: path.join(dir, "gh-output"),
        GITHUB_STEP_SUMMARY: path.join(dir, "gh-summary"),
        DOCS_SYNC_API_BASE: `http://127.0.0.1:${port}`,
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (d) => (output += d))
    child.stderr.on("data", (d) => (output += d))
    child.on("close", (status) => {
      const read = (name) => {
        const file = path.join(dir, name)
        return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
      }
      const line = read("gh-output")
        .split("\n")
        .find((l) => l.startsWith("prs="))
      resolve({ status, output, summary: read("gh-summary"), prs: line ? JSON.parse(line.slice(4)) : undefined })
    })
  })
}

async function withPush(event, stubOptions, env = {}) {
  const dir = mktemp()
  const eventPath = path.join(dir, "event.json")
  fs.writeFileSync(eventPath, JSON.stringify({ ref: "refs/heads/main", ...event }))
  const stub = await startStub(stubOptions)
  try {
    const result = await runPrs(dir, stub.port, { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: eventPath, ...env })
    return { ...result, log: stub.log }
  } finally {
    stub.server.closeAllConnections()
    await new Promise((r) => stub.server.close(r))
  }
}

const lookups = (log) => log.filter((p) => p.endsWith("/pulls") && p.includes("/commits/"))

async function scenario(name, fn) {
  await fn()
  passed++
  console.log(`ok - integration: ${name}`)
}

async function integration() {
  await scenario("a rebase merge yields its PR once", async () => {
    const commits = [1, 2, 3].map((n) => commit(n))
    const r = await withPush({ commits }, { pulls: Object.fromEntries(commits.map((c) => [c.id, [merged(100)]])) })
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [100])
  })

  await scenario("a merge commit is the only lookup", async () => {
    const commits = [commit(4, inScope, { distinct: false }), commit(5, inScope, { distinct: false }), commit(6)]
    const r = await withPush({ commits }, { pulls: { [sha(6)]: [merged(101)] } })
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [101])
    assert.deepEqual(lookups(r.log), [`/repos/${REPO}/commits/${sha(6)}/pulls`])
  })

  await scenario("several PRs in one push, each once, sorted; open and other-branch PRs ignored", async () => {
    const commits = [7, 8, 9].map((n) => commit(n))
    const r = await withPush(
      { commits },
      {
        pulls: {
          [sha(7)]: [merged(203), { number: 300, merged_at: null, base: { ref: "main" } }],
          [sha(8)]: [merged(202), merged(400, "v2")],
          [sha(9)]: [merged(203)],
        },
      },
    )
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [202, 203])
  })

  await scenario("commits outside packages/opencode/ are not looked up", async () => {
    const commits = [commit(10, outOfScope), commit(11)]
    const r = await withPush({ commits }, { pulls: { [sha(10)]: [merged(500)], [sha(11)]: [merged(501)] } })
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [501])
    assert.deepEqual(lookups(r.log), [`/repos/${REPO}/commits/${sha(11)}/pulls`])
  })

  await scenario("lookups stop at CAP and the skipped commits are reported", async () => {
    const commits = Array.from({ length: CAP + 5 }, (_, i) => commit(1000 + i))
    const r = await withPush(
      { commits, head_commit: commits.at(-1) },
      { pulls: Object.fromEntries(commits.map((c) => [c.id, [merged(600)]])) },
    )
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [600])
    assert.equal(lookups(r.log).length, CAP)
    assert.match(r.output, /::warning::Looked up 50 commits; 5 older in-scope commits were skipped/)
    assert.match(
      r.summary,
      /5 older in-scope commits were skipped\. replay a missed PR with workflow_dispatch \(pr_number\)/,
    )
  })

  await scenario("one failed lookup is skipped; the others still count", async () => {
    const r = await withPush(
      { commits: [commit(20), commit(21)] },
      { pulls: { [sha(21)]: [merged(700)] }, fail: [sha(20)] },
    )
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [700])
    assert.match(r.output, /::warning::PR lookup for 20aaaaaaaaaa failed/)
  })

  await scenario("the step fails when every lookup failed", async () => {
    const r = await withPush({ commits: [commit(22), commit(23)] }, { fail: [sha(22), sha(23)] })
    assert.notEqual(r.status, 0)
    assert.equal(r.prs, undefined)
    assert.match(r.output, /all 2 PR lookups failed/)
  })

  await scenario("no association: the PR number in a commit message is verified and used", async () => {
    const commits = [
      commit(30, inScope, { distinct: false, message: "fix(cli): keep queue (#77)" }),
      commit(31, inScope, { message: "Merge pull request #78 from acme/side" }),
    ]
    const r = await withPush(
      { commits, head_commit: commits[1] },
      { prs: { 77: merged(77, "main", sha(31)), 78: { number: 78, merged_at: null, base: { ref: "main" } } } },
    )
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [77])
    assert.ok(r.log.includes(`/repos/${REPO}/pulls/78`), "the merge-commit reference must be checked too")
    assert.doesNotMatch(r.output, /No merged PR found/)
  })

  await scenario("no association and no usable message: a warning names the in-scope commits", async () => {
    const commits = [commit(40, inScope, { message: "queue batch" }), commit(41, outOfScope, { message: "docs (#90)" })]
    const r = await withPush({ commits, head_commit: commits[0] }, { prs: { 90: merged(90, "v2") } })
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [])
    assert.match(r.output, /::warning::No merged PR found for in-scope commits 40aaaaaaaaaa;/)
    assert.doesNotMatch(r.output, /41aaaaaaaaaa/)
    assert.match(
      r.summary,
      /No merged PR found for in-scope commits 40aaaaaaaaaa; replay a missed PR with workflow_dispatch/,
    )
  })

  await scenario("one PR by association, another only by its subject, a third by neither", async () => {
    const commits = [
      commit(60),
      commit(61, inScope, { message: "feat(cli): add flag (#801)" }),
      commit(62, inScope, { message: "tidy up" }),
    ]
    const r = await withPush(
      { commits, head_commit: commits[2] },
      { pulls: { [sha(60)]: [merged(800)] }, prs: { 801: merged(801, "main", sha(61)) } },
    )
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [800, 801])
    assert.match(r.output, /::warning::No merged PR found for in-scope commits 62aaaaaaaaaa;/)
    assert.doesNotMatch(r.output, /in-scope commits [^;]*6[01]aaaaaaaaaa/)
  })

  await scenario("an upstream-style (#N) naming an unrelated merged PR is not accepted", async () => {
    const commits = [commit(63, inScope, { message: "fix(session): port upstream retry (#555)" })]
    const r = await withPush({ commits, head_commit: commits[0] }, { prs: { 555: merged(555, "main", sha(999)) } })
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [])
    assert.ok(r.log.includes(`/repos/${REPO}/pulls/555`))
    assert.match(r.output, /#555 from a commit message merged as 999aaaaaaaaa, which is not in this push/)
    assert.match(r.output, /::warning::No merged PR found for in-scope commits 63aaaaaaaaaa;/)
  })

  await scenario("the head commit is looked up first and, out of scope, never named", async () => {
    const commits = [commit(64), commit(65, outOfScope)]
    const r = await withPush({ commits, head_commit: commits[1] }, { pulls: { [sha(64)]: [merged(810)] } })
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [810])
    assert.deepEqual(
      lookups(r.log),
      [sha(65), sha(64)].map((s) => `/repos/${REPO}/commits/${s}/pulls`),
    )
    assert.doesNotMatch(r.output, /No merged PR found/)
  })

  await scenario("a request that hangs is aborted and counts as a failed lookup", async () => {
    const started = Date.now()
    const r = await withPush(
      { commits: [commit(66), commit(67)] },
      { pulls: { [sha(67)]: [merged(820)] }, hang: [sha(66)] },
      { V2_PORT_REQUEST_TIMEOUT_MS: "300" },
    )
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [820])
    assert.match(r.output, /::warning::PR lookup for 66aaaaaaaaaa failed/)
    assert.ok(Date.now() - started < 10_000, "an aborted request must not be retried at length")
  })

  await scenario("a long Retry-After fails that lookup at once instead of waiting", async () => {
    const started = Date.now()
    const r = await withPush(
      { commits: [commit(70), commit(71)] },
      { pulls: { [sha(71)]: [merged(900)] }, limited: [sha(70)] },
    )
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [900])
    assert.match(r.output, /::warning::PR lookup for 70aaaaaaaaaa failed: .*-> 403/)
    assert.ok(Date.now() - started < 10_000, "must not sleep the one-hour Retry-After")
  })

  await scenario("past the time budget no lookup starts and the run says so", async () => {
    const r = await withPush(
      { commits: [commit(72), commit(73)] },
      { pulls: { [sha(72)]: [merged(901)] } },
      { V2_PORT_BUDGET_MS: "0" },
    )
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [])
    assert.deepEqual(lookups(r.log), [])
    assert.match(r.output, /::warning::Stopped at the time budget after 0 of 2 commit lookups/)
    assert.match(r.summary, /Stopped at the time budget after 0 of 2 commit lookups\. replay a missed PR/)
  })

  await scenario("a push with no in-scope commit and no head_commit stays quiet", async () => {
    const r = await withPush({ commits: [commit(50, outOfScope)] }, {})
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [])
    assert.deepEqual(r.log, [])
    assert.doesNotMatch(r.output, /::warning::/)
  })

  await scenario("workflow_dispatch passes a valid PR number through", async () => {
    const ok = await runPrs(mktemp(), 1, { GITHUB_EVENT_NAME: "workflow_dispatch", PR_NUMBER: "1234" })
    assert.equal(ok.status, 0, ok.output)
    assert.deepEqual(ok.prs, [1234])
    const bad = await runPrs(mktemp(), 1, { GITHUB_EVENT_NAME: "workflow_dispatch", PR_NUMBER: "12; echo" })
    assert.notEqual(bad.status, 0)
    assert.equal(bad.prs, undefined)
  })
}

await integration()

for (const dir of temps.splice(0)) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

console.log(`\n${passed} prs tests passed.`)
