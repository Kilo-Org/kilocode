// kilocode_change - new file

/**
 * Checks the handoff between the docs-sync agent job and the publish job:
 * `pack` writes what the publish job needs, and `check` refuses anything
 * outside the expected shape (extra or linked files, oversized or foreign
 * bundles, changes outside packages/kilo-docs/, symlinks, mode changes,
 * malformed scalars).
 *
 * Each case builds a bare origin, an agent clone that packs, and a publish
 * clone that checks, all in a temporary directory.
 *
 * Run: node .github/docs-sync/handoff.test.mjs
 */

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"

import { BUNDLE_MAX_BYTES, check, pack, parseRaw } from "./handoff.mjs"

const failures = []
const temps = []
function test(label, fn) {
  try {
    fn()
    console.log(`ok - ${label}`)
  } catch (err) {
    failures.push(`${label}: ${err.message}`)
    console.error(`not ok - ${label}: ${err.stack}`)
  }
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, stdio: ["ignore", "pipe", "pipe"] }).toString().trim()
}

function write(dir, rel, text) {
  const p = path.join(dir, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, text)
}

function commitAll(dir, message) {
  git(dir, ["add", "-A"])
  git(dir, ["commit", "-q", "-m", message])
  return git(dir, ["rev-parse", "HEAD"])
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true })
  git(dir, ["init", "-q", "-b", "main"])
  git(dir, ["config", "user.name", "test"])
  git(dir, ["config", "user.email", "test@example.test"])
  git(dir, ["config", "commit.gpgsign", "false"])
}

function clone(origin, dir) {
  execFileSync("git", ["clone", "-q", origin, dir], { stdio: "ignore" })
  git(dir, ["config", "user.name", "test"])
  git(dir, ["config", "user.email", "test@example.test"])
  git(dir, ["config", "commit.gpgsign", "false"])
}

const NOW = "2026-09-01T07:00:00.000Z"
const MARKER = `<!-- docs-sync: learned-through commit=${"a".repeat(40)} comment=2026-08-31T12:00:00Z -->`

/** origin with main, an agent clone on the integration branch, and the handoff path. */
function scenario() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "docs-sync-handoff-"))
  temps.push(root)
  const origin = path.join(root, "origin.git")
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin])
  const seed = path.join(root, "seed")
  initRepo(seed)
  write(seed, "README.md", "readme\n")
  write(seed, "packages/kilo-docs/pages/a.md", "# a\n")
  write(seed, "packages/kilo-docs/pages/b.md", "# b\n")
  commitAll(seed, "base")
  git(seed, ["remote", "add", "origin", origin])
  git(seed, ["push", "-q", "origin", "main"])

  const agent = path.join(root, "agent")
  clone(origin, agent)
  git(agent, ["checkout", "-q", "-b", "docs/auto-sync"])
  // The commit the run started from (GITHUB_SHA in the publish job).
  const runSha = git(seed, ["rev-parse", "HEAD"])
  return { root, origin, seed, agent, runSha, handoff: path.join(root, "handoff") }
}

function packEnv(s, extra = {}) {
  return {
    HANDOFF_DIR: s.handoff,
    WORTHY_COUNT: "1",
    SINCE: "2026-08-31T07:00:00.000Z",
    NOW,
    SINCE_OVERRIDE: "false",
    LEARNED_THROUGH: "",
    MARKER_PATCH: "",
    BRANCH: "docs/auto-sync",
    VERIFIED: "true",
    ...extra,
  }
}

/** A fresh publish clone (taken after every origin change), then check. */
function runCheck(s) {
  const publish = path.join(s.root, `publish-${fs.readdirSync(s.root).length}`)
  clone(s.origin, publish)
  return { publish, outputs: check({ cwd: publish, env: { HANDOFF_DIR: s.handoff, GITHUB_SHA: s.runSha } }) }
}

function expectRejected(s, pattern, env = { GITHUB_SHA: s.runSha }) {
  let publish
  assert.throws(() => {
    publish = path.join(s.root, `publish-${fs.readdirSync(s.root).length}`)
    clone(s.origin, publish)
    check({ cwd: publish, env: { HANDOFF_DIR: s.handoff, ...env } })
  }, pattern)
  assert.ok(!fs.existsSync(path.join(publish, "docs-sync-out")), "a refused handoff stages nothing")
}

function editManifest(s, change) {
  const file = path.join(s.handoff, "handoff.json")
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"))
  change(manifest)
  fs.writeFileSync(file, JSON.stringify(manifest))
}

// --- pack and the accepted shapes ---

test("a docs-only handoff passes and stages the data files", () => {
  const s = scenario()
  write(s.agent, "docs-sync-out/triage.json", "[]")
  write(s.agent, "docs-sync-out/worthy.json", '[{"url":"https://github.com/Kilo-Org/kilocode/pull/1"}]')
  write(s.agent, "docs-sync-out/digest-full.json", "[]")
  write(s.agent, ".docs-sync-summary.json", "[]")
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  write(s.agent, "packages/kilo-docs/pages/new.md", "# new\n")
  write(s.agent, "unrelated.txt", "not part of the docs commit\n")

  const packed = pack({ cwd: s.agent, env: packEnv(s, { LEARNED_THROUGH: MARKER }) })
  assert.deepEqual(packed, { publish: "true", has_edits: "true" })
  const tip = git(s.agent, ["rev-parse", "HEAD"])
  assert.equal(git(s.agent, ["log", "-1", "--format=%s"]), "docs: sync with merged PRs (2026-09-01)")
  assert.deepEqual(git(s.agent, ["show", "--name-only", "--format=", "HEAD"]).split("\n").sort(), [
    "packages/kilo-docs/pages/a.md",
    "packages/kilo-docs/pages/new.md",
  ])

  const { publish, outputs } = runCheck(s)
  assert.equal(outputs.integration_sha, tip)
  assert.equal(outputs.has_edits, "true")
  assert.equal(outputs.learned_through, MARKER)
  assert.equal(outputs.branch, "docs/auto-sync")
  assert.equal(outputs.durable_base, "", "no integration branch existed, so the lease says it must not exist")
  assert.equal(outputs.now, NOW)
  assert.equal(fs.readFileSync(path.join(publish, "docs-sync-out/worthy.json"), "utf8"), '[{"url":"https://github.com/Kilo-Org/kilocode/pull/1"}]')
  assert.equal(fs.readFileSync(path.join(publish, ".docs-sync-summary.json"), "utf8"), "[]")
  assert.equal(git(publish, ["rev-parse", "refs/docs-sync/handoff"]), tip, "the tip is fetched, never checked out")
  assert.equal(git(publish, ["rev-parse", "HEAD"]), git(publish, ["rev-parse", "origin/main"]))
})

test("a marker-only handoff passes without a bundle", () => {
  const s = scenario()
  const packed = pack({ cwd: s.agent, env: packEnv(s, { WORTHY_COUNT: "0", MARKER_PATCH: MARKER, BRANCH: "", VERIFIED: "" }) })
  assert.deepEqual(packed, { publish: "true", has_edits: "false" })
  assert.ok(!fs.existsSync(path.join(s.handoff, "docs.bundle")))
  const { outputs } = runCheck(s)
  assert.equal(outputs.marker_patch, MARKER)
  assert.equal(outputs.integration_sha, "")
})

test("pack records the integration tip it built on as the push lease", () => {
  const s = scenario()
  git(s.seed, ["checkout", "-q", "-b", "integ"])
  write(s.seed, "packages/kilo-docs/pages/b.md", "# b, integrated\n")
  const integ = commitAll(s.seed, "integration tree")
  git(s.seed, ["push", "-q", "origin", "HEAD:refs/heads/docs/auto-sync-integration"])
  git(s.agent, ["fetch", "-q", "origin", "+refs/heads/docs/auto-sync-integration:refs/remotes/origin/docs/auto-sync-integration"])
  git(s.agent, ["reset", "-q", "--hard", "refs/remotes/origin/docs/auto-sync-integration"])
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  assert.equal(runCheck(s).outputs.durable_base, integ)

  // A conflicted run pushes its dated branch, so the lease is that branch's tip.
  const t = scenario()
  write(t.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: t.agent, env: packEnv(t, { BRANCH: "docs/auto-sync-2026-09-01" }) })
  assert.equal(runCheck(t).outputs.durable_base, "", "the dated branch did not exist")
})

test("no docs pass and no marker leaves nothing to publish", () => {
  const s = scenario()
  const packed = pack({ cwd: s.agent, env: packEnv(s, { WORTHY_COUNT: "0" }) })
  assert.deepEqual(packed, { publish: "false", has_edits: "false" })
})

test("a docs pass without a diff still publishes, for the no-diff report", () => {
  const s = scenario()
  const packed = pack({ cwd: s.agent, env: packEnv(s) })
  assert.deepEqual(packed, { publish: "true", has_edits: "false" })
  const { outputs } = runCheck(s)
  assert.equal(outputs.has_edits, "false")
  assert.equal(outputs.branch, "", "branch and mode travel only with a docs commit")
})

test("main content merged in from a surface branch passes", () => {
  const s = scenario()
  // main moves on after the agent job's checkout, and a surface branch merged it.
  write(s.seed, "README.md", "readme, newer main\n")
  commitAll(s.seed, "main moves on")
  git(s.seed, ["push", "-q", "origin", "main"])
  git(s.seed, ["checkout", "-q", "-b", "surface"])
  write(s.seed, "packages/kilo-docs/pages/b.md", "# b, from the surface\n")
  commitAll(s.seed, "surface docs")
  git(s.seed, ["push", "-q", "origin", "HEAD:refs/heads/docs/auto-sync/cli"])
  git(s.agent, ["fetch", "-q", "origin", "+refs/heads/docs/auto-sync/cli:refs/docs-sync/surfaces/cli"])
  git(s.agent, ["merge", "-q", "--no-edit", "refs/docs-sync/surfaces/cli"])
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  const { outputs } = runCheck(s)
  assert.equal(outputs.has_edits, "true")
})

// --- refusals: the handoff directory ---

test("an unexpected file in the handoff is refused", () => {
  const s = scenario()
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  write(s.handoff, "run-me.sh", "echo hi\n")
  expectRejected(s, /unexpected handoff entry: "run-me.sh"/)
})

test("a linked file in the handoff is refused", () => {
  const s = scenario()
  pack({ cwd: s.agent, env: packEnv(s, { WORTHY_COUNT: "0", MARKER_PATCH: MARKER }) })
  fs.symlinkSync("/etc/hostname", path.join(s.handoff, "triage.json"))
  expectRejected(s, /triage.json is not a regular file/)
})

test("a data file that is not a JSON array is refused", () => {
  const s = scenario()
  pack({ cwd: s.agent, env: packEnv(s, { WORTHY_COUNT: "0", MARKER_PATCH: MARKER }) })
  write(s.handoff, "worthy.json", '{"url":"x"}')
  expectRejected(s, /worthy.json must hold a JSON array/)
  write(s.handoff, "worthy.json", "[not json")
  expectRejected(s, /worthy.json does not parse as JSON/)
})

// --- refusals: the manifest ---

test("a malformed scalar is refused", () => {
  const cases = [
    [(m) => (m.branch = "main"), /branch has an invalid value/],
    [(m) => (m.learned_through = `${MARKER}\nINJECTED=1`), /learned_through has an invalid value/],
    [(m) => (m.since = "yesterday"), /since has an invalid value/],
    [(m) => (m.durable_base = "origin/docs/auto-sync-integration"), /durable_base has an invalid value/],
    [(m) => (m.base_main = "HEAD"), /base_main has an invalid value/],
    [(m) => (m.extra = "x"), /keys must be exactly/],
    [(m) => (m.verified = true), /verified has an invalid value/],
  ]
  for (const [change, pattern] of cases) {
    const s = scenario()
    write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
    pack({ cwd: s.agent, env: packEnv(s) })
    editManifest(s, change)
    expectRejected(s, pattern)
  }
})

test("has_edits must match the presence of the bundle", () => {
  const s = scenario()
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  const bundle = fs.readFileSync(path.join(s.handoff, "docs.bundle"))
  fs.rmSync(path.join(s.handoff, "docs.bundle"))
  expectRejected(s, /has_edits is true but the handoff has no docs.bundle/)
  fs.writeFileSync(path.join(s.handoff, "docs.bundle"), bundle)
  editManifest(s, (m) => {
    m.has_edits = "false"
  })
  expectRejected(s, /branch must be empty when has_edits is false/)
  editManifest(s, (m) => {
    m.branch = ""
    m.base_main = ""
  })
  expectRejected(s, /has_edits is false but the handoff has a docs.bundle/)
})

test("a base older than the commit the run started from is refused", () => {
  const s = scenario()
  const oldBase = s.runSha
  write(s.seed, "README.md", "readme, second main commit\n")
  s.runSha = commitAll(s.seed, "second main commit")
  git(s.seed, ["push", "-q", "origin", "main"])
  git(s.agent, ["fetch", "-q", "origin"])
  git(s.agent, ["reset", "-q", "--hard", "origin/main"])
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  assert.equal(runCheck(s).outputs.has_edits, "true", "the run's own base passes")
  editManifest(s, (m) => {
    m.base_main = oldBase
  })
  expectRejected(s, /is older than the commit this run started from/)
})

test("a bundle needs the run's commit", () => {
  const s = scenario()
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  expectRejected(s, /GITHUB_SHA must be the run's commit id/, {})
})

// --- refusals: the bundle ---

test("an oversized bundle is refused before git reads it", () => {
  const s = scenario()
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  fs.truncateSync(path.join(s.handoff, "docs.bundle"), BUNDLE_MAX_BYTES + 1)
  expectRejected(s, /docs.bundle is 10485761 bytes, over the 10485760-byte limit/)
})

test("a bundle with another head is refused", () => {
  const s = scenario()
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  const base = git(s.agent, ["rev-parse", "origin/main"])
  git(s.agent, ["bundle", "create", path.join(s.handoff, "docs.bundle"), "HEAD", `^${base}`])
  expectRejected(s, /must hold exactly refs\/heads\/docs-sync-handoff/)
})

test("a base that is not a commit of main is refused", () => {
  const s = scenario()
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  const tip = git(s.agent, ["rev-parse", "HEAD"])
  editManifest(s, (m) => {
    m.base_main = tip
  })
  expectRejected(s, /is not a commit of origin\/main/)
})

test("a change outside packages/kilo-docs is refused", () => {
  const s = scenario()
  write(s.agent, "README.md", "changed by the agent job\n")
  commitAll(s.agent, "outside")
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  expectRejected(s, /changes a path outside packages\/kilo-docs\/: "README.md"/)
})

test("a change outside packages/kilo-docs that a later commit reverts is refused", () => {
  const s = scenario()
  write(s.agent, ".github/workflows/x.yml", "on: push\n")
  commitAll(s.agent, "add a workflow")
  fs.rmSync(path.join(s.agent, ".github"), { recursive: true })
  commitAll(s.agent, "remove it again")
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  expectRejected(s, /changes a path outside packages\/kilo-docs\/: ".github\/workflows\/x.yml"/)
})

test("a merge of another origin branch is refused", () => {
  const s = scenario()
  git(s.seed, ["checkout", "-q", "-b", "feature"])
  write(s.seed, "src/app.ts", "export {}\n")
  commitAll(s.seed, "feature work")
  git(s.seed, ["push", "-q", "origin", "feature"])
  git(s.agent, ["fetch", "-q", "origin", "feature"])
  git(s.agent, ["merge", "-q", "--no-edit", "FETCH_HEAD"])
  write(s.agent, "packages/kilo-docs/pages/a.md", "# a, updated\n")
  pack({ cwd: s.agent, env: packEnv(s) })
  expectRejected(s, /changes a path outside packages\/kilo-docs\/: "src\/app.ts"/)
})

test("a symlink under packages/kilo-docs is refused", () => {
  const s = scenario()
  fs.symlinkSync("../../../README.md", path.join(s.agent, "packages/kilo-docs/pages/link.md"))
  pack({ cwd: s.agent, env: packEnv(s) })
  expectRejected(s, /adds a symlink: packages\/kilo-docs\/pages\/link.md/)
})

test("a mode change under packages/kilo-docs is refused", () => {
  const s = scenario()
  fs.chmodSync(path.join(s.agent, "packages/kilo-docs/pages/a.md"), 0o755)
  pack({ cwd: s.agent, env: packEnv(s) })
  expectRejected(s, /changes the mode of packages\/kilo-docs\/pages\/a.md to 100755/)
})

test("a new executable file under packages/kilo-docs is refused", () => {
  const s = scenario()
  write(s.agent, "packages/kilo-docs/pages/run.md", "#!/bin/sh\n")
  fs.chmodSync(path.join(s.agent, "packages/kilo-docs/pages/run.md"), 0o755)
  pack({ cwd: s.agent, env: packEnv(s) })
  expectRejected(s, /adds packages\/kilo-docs\/pages\/run.md with mode 100755/)
})

test("parseRaw reads plain and combined raw records", () => {
  const plain = parseRaw(":100644 100755 aaaa bbbb M\0packages/kilo-docs/x.md\0")
  assert.deepEqual(plain, [{ modes: ["100644", "100755"], path: "packages/kilo-docs/x.md" }])
  const combined = parseRaw("::100644 100644 120000 aaaa bbbb cccc MM\0packages/kilo-docs/y.md\0")
  assert.deepEqual(combined, [{ modes: ["100644", "100644", "120000"], path: "packages/kilo-docs/y.md" }])
  assert.deepEqual(parseRaw(""), [])
})

for (const dir of temps) fs.rmSync(dir, { recursive: true, force: true })

if (failures.length > 0) {
  console.error(`\n${failures.length} check(s) failed`)
  process.exit(1)
}
console.log("\nhandoff: all checks passed")
