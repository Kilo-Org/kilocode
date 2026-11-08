// kilocode_change - new file

/**
 * Unit tests for the v2-port gate. Plain node:assert, no network, no LLM.
 * Run: node .github/v2-port/gate.test.mjs
 */

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseDiff, qualifyDiff, skipReason, truncateDiff } from "./gate.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, "gate.mjs")
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

// A minimal, realistic hunk. `+++ b/...` is the authoritative path.
function diffFor(file, added = [], removed = []) {
  return [
    `diff --git a/${file} b/${file}`,
    "index 1111111..2222222 100644",
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1,3 +1,4 @@",
    " context line",
    ...removed.map((l) => `-${l}`),
    ...added.map((l) => `+${l}`),
    "",
  ].join("\n")
}

test("parseDiff attributes added lines to the file in the +++ header", () => {
  const files = parseDiff(diffFor("packages/opencode/src/a.ts", ["const x = 1"]))
  assert.equal(files.length, 1)
  assert.equal(files[0].path, "packages/opencode/src/a.ts")
  assert.deepEqual(files[0].added, ["const x = 1"])
})

test("parseDiff does not treat the +++ header or removed lines as added", () => {
  const files = parseDiff(diffFor("packages/opencode/src/a.ts", [], ["old"]))
  assert.deepEqual(files[0].added, [], "only + lines count, not +++ or - lines")
})

test("parseDiff keeps the new path for a rename", () => {
  const text = [
    "diff --git a/packages/opencode/src/old.ts b/packages/opencode/src/kilocode/new.ts",
    "similarity index 90%",
    "rename from packages/opencode/src/old.ts",
    "rename to packages/opencode/src/kilocode/new.ts",
    "--- a/packages/opencode/src/old.ts",
    "+++ b/packages/opencode/src/kilocode/new.ts",
    "@@ -1 +1 @@",
    "-a",
    "+b",
    "",
  ].join("\n")
  assert.equal(parseDiff(text)[0].path, "packages/opencode/src/kilocode/new.ts")
})

test("parseDiff falls back to the git header path for a deletion", () => {
  const text = [
    "diff --git a/packages/opencode/src/kilocode/gone.ts b/packages/opencode/src/kilocode/gone.ts",
    "deleted file mode 100644",
    "--- a/packages/opencode/src/kilocode/gone.ts",
    "+++ /dev/null",
    "@@ -1 +0,0 @@",
    "-gone",
    "",
  ].join("\n")
  const files = parseDiff(text)
  assert.equal(files[0].path, "packages/opencode/src/kilocode/gone.ts", "/dev/null must not overwrite the path")
})

test("qualifies on a kilocode-owned path", () => {
  const v = qualifyDiff(diffFor("packages/opencode/src/kilocode/foo.ts", ["export const a = 1"]))
  assert.equal(v.qualifies, true)
  assert.match(v.reason, /Kilo-owned opencode path/)
})

test("qualifies on a test/kilocode path", () => {
  const v = qualifyDiff(diffFor("packages/opencode/test/kilocode/foo.test.ts", ["it('works', () => {})"]))
  assert.equal(v.qualifies, true)
})

test("qualifies on an added kilocode_change marker in a shared file", () => {
  const v = qualifyDiff(diffFor("packages/opencode/src/tool/bash.ts", ["const allow = true // kilocode_change"]))
  assert.equal(v.qualifies, true)
  assert.match(v.reason, /kilocode_change marker/)
})

test("qualifies on a marker inside a start/end block", () => {
  const v = qualifyDiff(
    diffFor("packages/opencode/src/session/prompt.ts", [
      "// kilocode_change start",
      "const extra = 1",
      "// kilocode_change end",
    ]),
  )
  assert.equal(v.qualifies, true)
})

test("does not qualify a shared opencode file with no marker", () => {
  const v = qualifyDiff(diffFor("packages/opencode/src/tool/bash.ts", ["const timeout = 5000"]))
  assert.equal(v.qualifies, false)
  assert.match(v.reason, /no Kilo-specific change/)
})

test("does not qualify when the marker is only removed", () => {
  const v = qualifyDiff(diffFor("packages/opencode/src/tool/bash.ts", [], ["const x = 1 // kilocode_change"]))
  assert.equal(v.qualifies, false, "a removal is not new Kilo behavior to carry over")
})

test("does not qualify a change outside packages/opencode", () => {
  const v = qualifyDiff(diffFor("packages/kilo-vscode/src/kilocode/thing.ts", ["export const a = 1"]))
  assert.equal(v.qualifies, false)
  assert.match(v.reason, /touches nothing under packages\/opencode\//)
})

test("does not qualify a mixed diff whose only opencode change is unmarked", () => {
  const text =
    diffFor("packages/kilo-vscode/src/kilocode/thing.ts", ["export const a = 1"]) +
    diffFor("packages/opencode/src/tool/bash.ts", ["const timeout = 5000"])
  assert.equal(qualifyDiff(text).qualifies, false)
})

test("does not qualify an empty diff", () => {
  assert.equal(qualifyDiff("").qualifies, false)
  assert.equal(qualifyDiff("   \n").qualifies, false)
})

test("skipReason rejects unmerged PRs", () => {
  assert.match(skipReason({ mergedAt: null, author: { login: "a", is_bot: false } }), /not merged/)
})

test("skipReason rejects bot authors", () => {
  const pr = { mergedAt: "2026-10-16T00:00:00Z", author: { login: "dependabot[bot]", is_bot: true } }
  assert.match(skipReason(pr), /is a bot/)
})

test("skipReason honours the no-v2-port label", () => {
  const pr = { mergedAt: "2026-10-16T00:00:00Z", author: { login: "a", is_bot: false } }
  assert.match(skipReason(pr, ["no-v2-port"]), /no-v2-port/)
})

test("skipReason skips a PR already carrying the tracking label", () => {
  const pr = { mergedAt: "2026-10-16T00:00:00Z", author: { login: "a", is_bot: false } }
  assert.match(skipReason(pr, ["core-v1-changes-port"]), /already applied/)
})

test("skipReason passes a normal merged human PR", () => {
  const pr = { mergedAt: "2026-10-16T00:00:00Z", author: { login: "a", is_bot: false } }
  assert.equal(skipReason(pr, ["core"]), null)
})

test("track checkout never persists the write-capable workflow token", () => {
  const workflow = fs.readFileSync(path.join(HERE, "..", "workflows", "v2-port-tracker.yml"), "utf8")
  assert.match(workflow, /- name: Checkout\n\s+uses: actions\/checkout@v6\n\s+with:[\s\S]*?persist-credentials: false/)
})

test("truncateDiff leaves a short diff untouched", () => {
  const text = "diff --git a/x b/x\n+hello\n"
  const out = truncateDiff(text, 1024)
  assert.equal(out.truncated, false)
  assert.equal(out.text, text)
})

test("truncateDiff caps a long diff on a line boundary with a trailer", () => {
  const line = "x".repeat(99)
  const text = Array.from({ length: 200 }, (_, i) => `${line}${i % 10}`).join("\n")
  const out = truncateDiff(text, 1000)
  assert.equal(out.truncated, true)
  assert.equal(out.bytes, Buffer.byteLength(text))
  assert.match(out.text, /\[diff truncated: 1000 of \d+ bytes\]/)
  const body = out.text.split("\n\n[diff truncated")[0]
  assert.ok(!body.endsWith("x"), "must not cut mid-line")
  assert.ok(Buffer.byteLength(body) <= 1000)
})

test("truncateDiff counts bytes, not characters", () => {
  const text = "é".repeat(100) // 200 bytes
  assert.equal(truncateDiff(text, 100).truncated, true)
  assert.equal(truncateDiff(text, 300).truncated, false)
})

// ---------------------------------------------------------------------------
// End-to-end: real gate.mjs main() against a stubbed `gh`
// ---------------------------------------------------------------------------

const temps = []
function mktemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-port-gate-"))
  temps.push(dir)
  return dir
}

/** Fake `gh` on PATH: logs argv and returns metadata or the diff by subcommand. */
function makeFakeGh(dir, pr, diffText) {
  const bin = path.join(dir, "bin")
  fs.mkdirSync(bin, { recursive: true })
  const prFile = path.join(dir, "fake-pr.json")
  const diffFile = path.join(dir, "fake.diff")
  const logFile = path.join(dir, "gh-log.txt")
  fs.writeFileSync(prFile, JSON.stringify(pr))
  fs.writeFileSync(diffFile, diffText)
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/bin/sh\necho "$@" >> ${JSON.stringify(logFile)}\nif [ "$2" = "view" ]; then cat ${JSON.stringify(prFile)}; else cat ${JSON.stringify(diffFile)}; fi\n`,
    { mode: 0o755 },
  )
  return { bin, logFile }
}

function runGate(dir, { bin }) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [SCRIPT], {
      cwd: dir,
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        GH_TOKEN: "stub-token",
        GITHUB_REPOSITORY: REPO,
        PR_NUMBER: "1234",
        GITHUB_OUTPUT: path.join(dir, "gh-output"),
        GITHUB_STEP_SUMMARY: path.join(dir, "gh-summary"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (d) => (output += d))
    child.stderr.on("data", (d) => (output += d))
    child.on("close", (status) => resolve({ status, output }))
  })
}

function mergedPr(overrides = {}) {
  return {
    number: 1234,
    url: `https://github.com/${REPO}/pull/1234`,
    title: "fix(cli): keep queued messages on abort",
    body: "Preserve queued messages when a session aborts.",
    state: "MERGED",
    mergedAt: "2026-10-16T00:00:00Z",
    mergeCommit: { oid: "abc123" },
    author: { login: "octocat", is_bot: false },
    labels: [],
    files: [{ path: "packages/opencode/src/kilocode/queue.ts", additions: 1, deletions: 0 }],
    commits: [{ oid: "abc123", messageHeadline: "fix queued messages" }],
    comments: [{ body: "Reproduces after abort.", author: { login: "reviewer" } }],
    reviews: [{ body: "Ordering matters here.", author: { login: "reviewer" }, state: "APPROVED" }],
    closingIssuesReferences: [{ number: 99, url: `https://github.com/${REPO}/issues/99` }],
    ...overrides,
  }
}

function outputs(dir) {
  const file = path.join(dir, "gh-output")
  const text = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : ""
  return Object.fromEntries(
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  )
}

async function withStub(pr, diff, fn) {
  const dir = mktemp()
  const { bin, logFile } = makeFakeGh(dir, pr, diff)
  return fn({ dir, bin, logFile })
}

await (async () => {
  const diff = diffFor("packages/opencode/src/kilocode/queue.ts", ["export const keep = true"])
  await withStub(mergedPr(), diff, async (ctx) => {
    const result = await runGate(ctx.dir, ctx)
    assert.equal(result.status, 0, result.output)
    const out = outputs(ctx.dir)
    assert.equal(out.qualifies, "true", result.output)
    assert.equal(out.author, "octocat")
    const written = JSON.parse(fs.readFileSync(path.join(ctx.dir, "v2-port-out/pr.json"), "utf8"))
    assert.equal(written.number, 1234)
    assert.equal(written.mergedAt, "2026-10-16T00:00:00Z")
    assert.equal(written.author.login, "octocat")
    assert.equal(written.reviews[0].body, "Ordering matters here.")
    assert.equal(written.comments[0].body, "Reproduces after abort.")
    assert.equal(written.closingIssuesReferences[0].number, 99)
    const calls = fs.readFileSync(ctx.logFile, "utf8")
    assert.match(calls, /pr view 1234 --repo acme\/repo --json number,url,title,body,state,mergedAt,mergeCommit,author,labels,files,commits,comments,reviews,closingIssuesReferences/)
    assert.match(calls, /pr diff 1234 --repo acme\/repo --patch/)
    assert.ok(fs.readFileSync(path.join(ctx.dir, "v2-port-out/pr.diff"), "utf8").includes("queue.ts"))
    assert.match(fs.readFileSync(path.join(ctx.dir, "gh-summary"), "utf8"), /qualifies/)
  })
  passed++
  console.log("ok - e2e: a qualifying PR writes pr.json/pr.diff and reports qualifies=true")
})()

await (async () => {
  const diff = diffFor("packages/opencode/src/tool/bash.ts", ["const timeout = 5000"])
  await withStub(mergedPr(), diff, async (ctx) => {
    const result = await runGate(ctx.dir, ctx)
    assert.equal(result.status, 0, result.output)
    const out = outputs(ctx.dir)
    assert.equal(out.qualifies, "false")
    assert.match(out.skip_reason, /no Kilo-specific change/)
  })
  passed++
  console.log("ok - e2e: an unmarked shared-file change reports qualifies=false with a reason")
})()

await (async () => {
  const pr = mergedPr({ author: { login: "dependabot[bot]", is_bot: true } })
  await withStub(pr, "diff --git a/x b/x\n", async (ctx) => {
    const result = await runGate(ctx.dir, ctx)
    assert.equal(result.status, 0, result.output)
    assert.equal(outputs(ctx.dir).qualifies, "false")
    assert.match(outputs(ctx.dir).skip_reason, /is a bot/)
    const calls = fs.readFileSync(ctx.logFile, "utf8")
    assert.match(calls, /pr view/)
    assert.doesNotMatch(calls, /pr diff/, "a metadata skip must not fetch the diff")
  })
  passed++
  console.log("ok - e2e: a bot-authored PR is skipped before any diff fetch")
})()

await (async () => {
  const diff = diffFor("packages/opencode/src/kilocode/huge.ts", ["const x = 1"])
  await withStub(mergedPr(), diff, async (ctx) => {
    const result = await runGate(ctx.dir, ctx)
    assert.equal(result.status, 0, result.output)
    assert.equal(outputs(ctx.dir).qualifies, "true")
    assert.ok(!fs.readFileSync(path.join(ctx.dir, "v2-port-out/pr.diff"), "utf8").includes("[diff truncated"))
  })
  passed++
  console.log("ok - e2e: a small diff is passed to the agent untruncated")
})()

for (const dir of temps.splice(0)) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

console.log(`\n${passed} gate tests passed.`)
