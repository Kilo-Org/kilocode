// kilocode_change - new file

/**
 * Tests for the v2-port PR resolver. Pure-function cases plus end-to-end runs
 * of the real prs.mjs against a local stub of the GitHub API (the
 * `DOCS_SYNC_API_BASE` hook), so the push-to-PR mapping and its deduplication
 * run as real code.
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
import { dispatchPr, mergedInto, pushShas } from "./prs.mjs"

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

const sha = (n) => String(n).padStart(40, "a")
const merged = (number, base = "main") => ({ number, merged_at: "2026-11-26T00:00:00Z", base: { ref: base } })

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

test("pushShas keeps distinct commits in push order, once each", () => {
  const event = {
    commits: [
      { id: sha(1), distinct: true },
      { id: sha(2), distinct: false },
      { id: sha(3), distinct: true },
      { id: sha(1), distinct: true },
    ],
  }
  assert.deepEqual(pushShas(event), [sha(1), sha(3)])
})

test("pushShas falls back to head_commit and drops malformed ids", () => {
  assert.deepEqual(pushShas({ commits: [], head_commit: { id: sha(9) } }), [sha(9)])
  assert.deepEqual(pushShas({ commits: [{ id: "../../x", distinct: true }] }), [])
  assert.deepEqual(pushShas(null), [])
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

test("workflow tracks pushes to main and keeps the selftest secretless", () => {
  const workflow = fs.readFileSync(path.join(HERE, "..", "workflows", "v2-port-tracker.yml"), "utf8")
  assert.doesNotMatch(workflow, /pull_request_target/)
  assert.match(workflow, /\n {2}push:\n {4}branches: \[main\]\n {4}paths:\n {6}- "packages\/opencode\/\*\*"/)
  const selftest = workflow.slice(workflow.indexOf("\n  selftest:"), workflow.indexOf("\n  prs:"))
  assert.doesNotMatch(selftest, /secrets\./)
  assert.match(workflow, /concurrency:\n\s+group: v2-port-\$\{\{ matrix\.pr \}\}/)
  assert.match(workflow, /name: v2-port-out-\$\{\{ matrix\.pr \}\}/)
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

/** Stub answering `commits/{sha}/pulls` from a sha → pulls map. */
function startStub(pullsBySha) {
  const log = []
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://stub")
    log.push(url.pathname)
    const m = url.pathname.match(/^\/repos\/acme\/repo\/commits\/([0-9a-f]{40})\/pulls$/)
    if (req.method === "GET" && m) {
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify(pullsBySha[m[1]] ?? []))
      return
    }
    res.writeHead(404, { "content-type": "application/json" })
    res.end(JSON.stringify({ message: `unhandled ${req.method} ${req.url}` }))
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
      const file = path.join(dir, "gh-output")
      const out = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
      const line = out.split("\n").find((l) => l.startsWith("prs="))
      resolve({ status, output, prs: line ? JSON.parse(line.slice(4)) : undefined })
    })
  })
}

async function withPush(event, pullsBySha) {
  const dir = mktemp()
  const eventPath = path.join(dir, "event.json")
  fs.writeFileSync(eventPath, JSON.stringify({ ref: "refs/heads/main", ...event }))
  const stub = await startStub(pullsBySha)
  try {
    const result = await runPrs(dir, stub.port, { GITHUB_EVENT_NAME: "push", GITHUB_EVENT_PATH: eventPath })
    return { ...result, log: stub.log }
  } finally {
    await new Promise((r) => stub.server.close(r))
  }
}

async function integration() {
  {
    // Rebase merge: three new commits of one PR. One entry, not three.
    const commits = [1, 2, 3].map((n) => ({ id: sha(n), distinct: true }))
    const pulls = Object.fromEntries(commits.map((c) => [c.id, [merged(100)]]))
    const r = await withPush({ commits }, pulls)
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [100])
    passed++
    console.log("ok - integration: a rebase merge yields its PR once")
  }

  {
    // Merge commit: the PR branch commits already existed, so only the merge
    // commit is looked up.
    const commits = [
      { id: sha(4), distinct: false },
      { id: sha(5), distinct: false },
      { id: sha(6), distinct: true },
    ]
    const r = await withPush({ commits }, { [sha(4)]: [merged(101)], [sha(5)]: [merged(101)], [sha(6)]: [merged(101)] })
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [101])
    assert.deepEqual(r.log, [`/repos/${REPO}/commits/${sha(6)}/pulls`])
    passed++
    console.log("ok - integration: a merge commit is the only lookup")
  }

  {
    // One push carrying two PRs (merge queue), plus an open PR and a PR into
    // another branch that share a commit: both are ignored.
    const commits = [7, 8, 9].map((n) => ({ id: sha(n), distinct: true }))
    const r = await withPush(
      { commits },
      {
        [sha(7)]: [merged(203), { number: 300, merged_at: null, base: { ref: "main" } }],
        [sha(8)]: [merged(202), merged(400, "v2")],
        [sha(9)]: [merged(203)],
      },
    )
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [202, 203])
    passed++
    console.log("ok - integration: several PRs in one push, each once, sorted")
  }

  {
    // A direct push with no PR yields an empty list, and the run stays green.
    const r = await withPush({ commits: [{ id: sha(10), distinct: true }] }, {})
    assert.equal(r.status, 0, r.output)
    assert.deepEqual(r.prs, [])
    passed++
    console.log("ok - integration: a push without a merged PR yields nothing")
  }

  {
    const dir = mktemp()
    const ok = await runPrs(dir, 1, { GITHUB_EVENT_NAME: "workflow_dispatch", PR_NUMBER: "1234" })
    assert.equal(ok.status, 0, ok.output)
    assert.deepEqual(ok.prs, [1234])
    const bad = await runPrs(mktemp(), 1, { GITHUB_EVENT_NAME: "workflow_dispatch", PR_NUMBER: "12; echo" })
    assert.notEqual(bad.status, 0)
    assert.equal(bad.prs, undefined)
    passed++
    console.log("ok - integration: workflow_dispatch passes a valid PR number through")
  }
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
