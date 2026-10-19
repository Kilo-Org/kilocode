// kilocode_change - new file

/**
 * Tests for the v2-port issue writer.
 *
 * Pure-function cases cover draft validation; the integration cases drive the
 * real issue.mjs end to end against a local stub of the GitHub API (the same
 * `DOCS_SYNC_API_BASE` hook docs-sync's selftest uses), so dedup, label ensure,
 * assignee resolution, and comment idempotency are exercised as real code
 * rather than re-implemented in the test.
 *
 * Run: node .github/v2-port/issue.test.mjs
 */

import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  HEADINGS,
  backLinkComment,
  buildBody,
  findPlaceholders,
  headingCounts,
  markerFor,
  validateDraft,
  withAuthor,
} from "./issue.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCRIPT = path.join(HERE, "issue.mjs")
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

function validBody(extra = {}) {
  const sections = {
    "## Context": "Kilo CLI gained X for the Y flow.",
    "## Problem In V1": "Before this, users hit Z whenever they did W.",
    "## Behavior To Preserve In V2": "- Queued messages survive an abort.\n- Default stays 30s.",
    "## Non-Goals": "None.",
    "## Why This May Not Carry Over Automatically": "The ordering is non-obvious.",
    "## Acceptance Criteria": "- [ ] Confirmed whether opencode v2 already provides this behavior, and where.",
    "## V1 Reference": "- Source PR: https://github.com/Kilo-Org/kilocode/pull/1234 — `Title`, merged 2026-01-01",
    "## Prompt For V2 Agent": "```\nYou are working in the opencode v2 codebase.\n```",
    ...extra,
  }
  return HEADINGS.map((h) => `${h}\n\n${sections[h]}`).join("\n\n") + "\n"
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

test("findPlaceholders flags the skill's angle-bracket slots", () => {
  assert.deepEqual(findPlaceholders("## Context\n\n<1-3 sentences: what the change was.>"), [
    "<1-3 sentences: what the change was.>",
  ])
  assert.deepEqual(findPlaceholders("Verify by: <check or test>."), ["<check or test>"])
  assert.deepEqual(findPlaceholders("- Source PR: #<N>"), ["<N>"])
})

test("findPlaceholders ignores code generics, self-closing tags, autolinks, and comments", () => {
  const text = [
    "`const p: Promise<void> = f()`",
    "`const items: Array<Item> = []`",
    "`return <div className=\"x\" />`",
    "See <https://example.com/docs>.",
    markerFor(1234),
    "<!-- v2-port:comment -->",
  ].join("\n")
  assert.deepEqual(findPlaceholders(text), [])
})

test("headingCounts counts template sections", () => {
  const counts = headingCounts(validBody())
  for (const h of HEADINGS) assert.equal(counts[h], 1, `${h} counted once`)
})

test("validateDraft accepts a well-formed draft", () => {
  assert.deepEqual(validateDraft("[v2-port] Keep queued messages on abort", validBody()), [])
})

test("validateDraft rejects a non-v2-port title", () => {
  const errs = validateDraft("Keep queued messages", validBody())
  assert.equal(errs.length, 1)
  assert.match(errs[0], /must start with "\[v2-port\] "/)
})

test("validateDraft rejects a missing section", () => {
  const body = validBody().replace("## Non-Goals\n\nNone.\n\n", "")
  const errs = validateDraft("[v2-port] x", body)
  assert.deepEqual(errs, ["missing section: ## Non-Goals"])
})

test("validateDraft rejects a duplicated section", () => {
  const body = `${validBody()}\n## Context\n\nagain\n`
  const errs = validateDraft("[v2-port] x", body)
  assert.deepEqual(errs, ["section appears 2 times: ## Context"])
})

test("validateDraft rejects unresolved placeholders", () => {
  const body = validBody({ "## Problem In V1": "The <concrete symptom> was bad." })
  const errs = validateDraft("[v2-port] x", body)
  assert.equal(errs.length, 1)
  assert.match(errs[0], /unresolved placeholders: <concrete symptom>/)
})

test("withAuthor records the author inside V1 Reference", () => {
  const out = withAuthor(validBody(), "octocat", true)
  assert.match(out, /## V1 Reference\n\n- Author: octocat\n\n- Source PR:/)
})

test("withAuthor marks an unassignable author", () => {
  const out = withAuthor(validBody(), "outsider", false)
  assert.match(out, /- Author: outsider \(not assignable — issue left unassigned\)/)
})

test("withAuthor is a no-op without an author", () => {
  const body = validBody()
  assert.equal(withAuthor(body, "", true), body)
})

test("withAuthor appends the section when the agent dropped it", () => {
  const out = withAuthor("## Context\n\nx\n", "octocat", true)
  assert.match(out, /## V1 Reference\n\n- Author: octocat/)
})

test("buildBody leads with the PR marker and provenance banner", () => {
  const body = buildBody({ number: 42, url: "https://github.com/acme/repo/pull/42", author: "octocat", assignable: true, body: validBody() })
  assert.ok(body.startsWith(markerFor(42)))
  assert.match(body, /Auto-created by the `v2-port-tracker` workflow from Kilo v1 PR #42/)
  assert.match(body, /## Context/)
})

test("backLinkComment carries the idempotency marker", () => {
  const c = backLinkComment(77)
  assert.ok(c.includes("<!-- v2-port:comment -->"))
  assert.match(c, /Tracked for the opencode v2 rewrite in #77 \(`core-v1-changes-port`\)/)
})

// ---------------------------------------------------------------------------
// Stub API + integration
// ---------------------------------------------------------------------------

const temps = []
function mktemp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-port-"))
  temps.push(dir)
  return dir
}

function writeDraft(dir, { title, body, skip, pr }) {
  const out = path.join(dir, "v2-port-out")
  fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, "pr.json"), JSON.stringify(pr ?? defaultPr()))
  if (skip !== undefined) fs.writeFileSync(path.join(out, "skip.txt"), skip)
  if (title !== undefined) fs.writeFileSync(path.join(out, "title.txt"), title)
  if (body !== undefined) fs.writeFileSync(path.join(out, "body.md"), body)
}

function defaultPr(login = "octocat") {
  return {
    number: 1234,
    url: "https://github.com/acme/repo/pull/1234",
    title: "fix(cli): keep queued messages on abort",
    mergedAt: "2026-10-16T00:00:00Z",
    author: { login, is_bot: false },
  }
}

/** In-process stub. Runs in this process, so the child is spawned async. */
function startStub({ assignable = ["octocat"], issues = [], comments = [] } = {}) {
  const state = { assignable: new Set(assignable), issues: [...issues], comments: [...comments], log: [], nextIssue: 900 }
  const send = (res, status, data) => {
    if (data === undefined) {
      res.writeHead(status)
      res.end()
      return
    }
    res.writeHead(status, { "content-type": "application/json" })
    res.end(JSON.stringify(data))
  }
  const server = http.createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const url = new URL(req.url, "http://stub")
      const p = url.pathname
      state.log.push({ method: req.method, path: p })

      const assignee = p.match(/^\/repos\/acme\/repo\/assignees\/(.+)$/)
      if (assignee) {
        return send(res, state.assignable.has(decodeURIComponent(assignee[1])) ? 204 : 404, undefined)
      }
      if (p === `/repos/${REPO}/labels` && req.method === "POST") {
        if (state.labelCreated) return send(res, 422, { message: "Validation Failed: already exists" })
        state.labelCreated = true
        return send(res, 201, { name: "core-v1-changes-port" })
      }
      const commentPatch = p.match(/^\/repos\/acme\/repo\/issues\/comments\/(\d+)$/)
      if (commentPatch && req.method === "PATCH") {
        const target = state.comments.find((c) => String(c.id) === commentPatch[1])
        if (target) target.body = JSON.parse(raw).body
        return send(res, 200, target ?? {})
      }
      const issueComments = p.match(/^\/repos\/acme\/repo\/issues\/(\d+)\/comments$/)
      if (issueComments) {
        if (req.method === "POST") {
          const created = { id: state.comments.length + 1, body: JSON.parse(raw).body }
          state.comments.push(created)
          return send(res, 201, created)
        }
        return send(res, 200, state.comments)
      }
      if (p === `/repos/${REPO}/issues` && req.method === "POST") {
        const body = JSON.parse(raw)
        const created = {
          number: state.nextIssue++,
          html_url: `https://github.com/acme/repo/issues/${state.nextIssue - 1}`,
          title: body.title,
          body: body.body,
          labels: body.labels,
          assignees: body.assignees,
        }
        state.issues.push(created)
        return send(res, 201, created)
      }
      if (p === `/repos/${REPO}/issues` && req.method === "GET") {
        return send(res, 200, state.issues)
      }
      send(res, 404, { message: `unhandled ${req.method} ${req.url}` })
    })
  })
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, state, port: server.address().port }))
  })
}

function runIssue(dir, port, env = {}) {
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
        PR_NUMBER: "1234",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    })
    let output = ""
    child.stdout.on("data", (d) => (output += d))
    child.stderr.on("data", (d) => (output += d))
    child.on("close", (status) => resolve({ status, output }))
  })
}

async function withStub(options, fn) {
  const stub = await startStub(options)
  try {
    return await fn(stub)
  } finally {
    await new Promise((r) => stub.server.close(r))
  }
}

async function integration() {
  await (async () => {
    const dir = mktemp()
    writeDraft(dir, { title: "[v2-port] Keep queued messages on abort", body: validBody() })
    const result = await withStub({}, async ({ state, port }) => {
      const first = await runIssue(dir, port)
      const second = await runIssue(dir, port)
      return { first, second, state }
    })
    assert.equal(result.first.status, 0, result.first.output)
    assert.equal(result.second.status, 0, result.second.output)
    assert.equal(result.state.issues.length, 1, "second run must not duplicate the issue")
    assert.equal(result.state.issues[0].title, "[v2-port] Keep queued messages on abort")
    assert.deepEqual(result.state.issues[0].assignees, ["octocat"])
    assert.deepEqual(result.state.issues[0].labels, ["core-v1-changes-port"])
    assert.ok(result.state.issues[0].body.startsWith(markerFor(1234)))
    assert.equal(result.state.comments.length, 1, "one back-link comment")
    assert.ok(result.state.comments[0].body.includes("<!-- v2-port:comment -->"))
    assert.match(result.second.output, /already tracked/)
    passed++
    console.log("ok - integration: creates one issue with label/assignee and a back-link comment, dedups on re-run")
  })()

  await (async () => {
    const dir = mktemp()
    writeDraft(dir, { title: "[v2-port] x", body: validBody(), pr: defaultPr("outsider") })
    const { state } = await withStub({ assignable: [] }, async ({ state, port }) => {
      const result = await runIssue(dir, port)
      assert.equal(result.status, 0, result.output)
      assert.match(result.output, /::warning::outsider is not assignable/)
      return { state }
    })
    assert.deepEqual(state.issues[0].assignees, [], "unassignable author leaves the issue unassigned")
    assert.match(state.issues[0].body, /- Author: outsider \(not assignable — issue left unassigned\)/)
    passed++
    console.log("ok - integration: unassignable author leaves the issue unassigned with a warning")
  })()

  await (async () => {
    const dir = mktemp()
    writeDraft(dir, { title: "[v2-port] x", body: validBody() })
    const { state } = await withStub(
      { comments: [{ id: 55, body: `<!-- v2-port:comment -->\nold text` }], issues: [{ number: 1, body: "unrelated" }] },
      async ({ state, port }) => {
        const result = await runIssue(dir, port)
        assert.equal(result.status, 0, result.output)
        assert.match(result.output, /updated back-link comment 55/)
        return { state }
      },
    )
    assert.equal(state.comments.length, 1, "must patch, not append")
    assert.match(state.comments[0].body, /#900/)
    passed++
    console.log("ok - integration: an existing back-link comment is updated in place")
  })()

  await (async () => {
    const dir = mktemp()
    writeDraft(dir, { skip: "SKIP: pure dependency bump" })
    const { state } = await withStub({}, async ({ state, port }) => {
      const result = await runIssue(dir, port)
      assert.equal(result.status, 0, result.output)
      assert.match(result.output, /agent skipped #1234/)
      return { state }
    })
    assert.equal(state.log.length, 0, "a skip must make no API calls")
    passed++
    console.log("ok - integration: skip.txt short-circuits without touching the API")
  })()

  await (async () => {
    const dir = mktemp()
    writeDraft(dir, { title: "[v2-port] x", body: "## Context\n\n<fill this in>\n" })
    const { state } = await withStub({}, async ({ state, port }) => {
      const result = await runIssue(dir, port)
      assert.equal(result.status, 1, "an invalid draft must fail the job")
      assert.match(result.output, /::error::missing section: ## Problem In V1/)
      assert.match(result.output, /unresolved placeholders: <fill this in>/)
      return { state }
    })
    assert.equal(state.issues.length, 0, "nothing may be created from an invalid draft")
    passed++
    console.log("ok - integration: an invalid draft fails without creating anything")
  })()

  await (async () => {
    const dir = mktemp()
    writeDraft(dir, { title: "[v2-port] x", body: validBody() })
    const { state } = await withStub({}, async ({ state, port }) => {
      const result = await runIssue(dir, port, { DRY_RUN: "true" })
      assert.equal(result.status, 0, result.output)
      assert.match(result.output, /dry run: nothing created/)
      assert.match(result.output, /assignable=true/)
      return { state }
    })
    assert.equal(state.issues.length, 0, "dry run must not create an issue")
    assert.equal(state.comments.length, 0, "dry run must not comment")
    passed++
    console.log("ok - integration: dry run previews and mutates nothing")
  })()

  await (async () => {
    const dir = mktemp()
    writeDraft(dir, { title: "[v2-port] x", body: validBody() })
    const { state } = await withStub({}, async ({ state, port }) => {
      const result = await runIssue(dir, port)
      assert.equal(result.status, 0, result.output)
      return { state }
    })
    assert.ok(
      state.log.some((r) => r.method === "GET" && r.path === "/repos/acme/repo/issues"),
      "dedup must scan the label set",
    )
    assert.ok(
      state.log.some((r) => r.method === "POST" && r.path === "/repos/acme/repo/labels"),
      "the label is ensured before filing",
    )
    passed++
    console.log("ok - integration: scans for duplicates and ensures the label exists")
  })()

  await (async () => {
    const dir = mktemp()
    writeDraft(dir, { body: validBody() }) // no title.txt, no skip.txt
    const { state } = await withStub({}, async ({ state, port }) => {
      const result = await runIssue(dir, port)
      assert.equal(result.status, 1)
      assert.match(result.output, /agent produced neither title.txt nor skip.txt/)
      return { state }
    })
    assert.equal(state.issues.length, 0)
    passed++
    console.log("ok - integration: a missing draft file fails the job")
  })()
}

await integration()

for (const dir of temps.splice(0)) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
  } catch {
    // best-effort
  }
}

console.log(`\n${passed} issue tests passed.`)
