// kilocode_change - new file

/**
 * Offline self-check for the docs-sync failure paths (S4).
 * Plain node:assert, no network, no LLM, no new dependency.
 * Run: node .github/docs-sync/selftest.mjs
 */

import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { mergeOrFallback, DEFAULT_BRANCH } from "./prepare-branch.mjs"
import { applyCap } from "./watermark.mjs"
import {
  computeUncovered,
  computeProcessedThrough,
  routeRows,
  dropLegacySkipped,
  noDiffReport,
  renderBody,
  extractSectionRows,
} from "./upsert-pr.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDIT_SCRIPT = path.join(HERE, "edit.mjs")
const TRIAGE_SCRIPT = path.join(HERE, "triage.mjs")
const COLLECT_SCRIPT = path.join(HERE, "collect.mjs")

const temps = []

function mktemp(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  temps.push(dir)
  return dir
}

function cleanup() {
  for (const dir of temps.splice(0)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true })
    } catch {
      // best-effort
    }
  }
}

function writeExecutable(filePath, body) {
  fs.writeFileSync(filePath, body, { mode: 0o755 })
}

function makeStubKiloDir({ mode, callLog, stderrText = "event stream disconnected" }) {
  const dir = mktemp("docs-sync-kilo-")
  const kiloPath = path.join(dir, "kilo")
  // mode: "stderr-exit0" | "record" | "partial-triage" | "mixed-triage" | "write-edit-summary"
  const script = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const mode = ${JSON.stringify(mode)};
const callLog = ${JSON.stringify(callLog ?? "")};
const stderrText = ${JSON.stringify(stderrText)};
if (callLog) {
  fs.appendFileSync(callLog, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
}
if (mode === "stderr-exit0") {
  process.stderr.write(stderrText + "\\n");
  process.exit(0);
}
if (mode === "record") {
  process.stderr.write("recorded\\n");
  process.exit(0);
}
// Parse -f chunk/batch file from args for triage stubs
const args = process.argv.slice(2);
const fIdx = args.indexOf("-f");
const fileArg = fIdx >= 0 ? args[fIdx + 1] : null;
let chunk = [];
if (fileArg && fs.existsSync(fileArg)) {
  try { chunk = JSON.parse(fs.readFileSync(fileArg, "utf8")); } catch { chunk = []; }
}
if (mode === "write-edit-summary") {
  // Success path: write the batch summary so edit.mjs returns true, while still
  // emitting stderr so selftest can assert runKilo persisted it unconditionally.
  process.stderr.write(stderrText + "\\n");
  const m = fileArg && String(fileArg).match(/edit-batch-(\\d+)\\.json/);
  const index = m ? m[1] : "0";
  const summary = chunk.map((d) => ({
    pr: d.number,
    url: d.url,
    action: "skipped",
    reason: "selftest stub",
  }));
  fs.mkdirSync("docs-sync-out", { recursive: true });
  fs.writeFileSync("docs-sync-out/edit-summary-" + index + ".json", JSON.stringify(summary));
  process.exit(0);
}
if (mode === "partial-triage") {
  // Classify only a proper subset (first URL) of the chunk.
  const owned = chunk.slice(0, Math.max(0, chunk.length - 1));
  const entries = owned.map((d) => ({
    pr: d.number,
    url: d.url,
    docs_worthy: false,
    reason: "genuine not worthy",
    target_sections: [],
    priority: "medium",
  }));
  if (entries.length === 0 && chunk.length > 0) {
    // single-PR chunk: still leave one missing by emitting empty-ish foreign-only
    process.stdout.write("[]\\n");
  } else {
    process.stdout.write(JSON.stringify(entries) + "\\n");
  }
  process.exit(0);
}
if (mode === "mixed-triage") {
  // Half docs_worthy true, half fail (no output for second half — but we return
  // only some entries so backfill marks the rest pending). Actually: return
  // docs_worthy:true for first half of chunk URLs so worthy > 0.
  const half = Math.ceil(chunk.length / 2);
  const entries = chunk.slice(0, half).map((d) => ({
    pr: d.number,
    url: d.url,
    docs_worthy: true,
    reason: "needs docs",
    target_sections: ["overview"],
    priority: "high",
  }));
  process.stdout.write(JSON.stringify(entries) + "\\n");
  process.exit(0);
}
if (mode === "triage-embed-env-secret") {
  // Valid triage JSON with a secret env value embedded in a string field
  // (stdout is persisted to triage-raw-*.txt; must be redacted at capture).
  const secret = process.env.KILO_API_KEY || "missing-secret";
  const entries = chunk.map((d) => ({
    pr: d.number,
    url: d.url,
    docs_worthy: true,
    reason: "needs docs; diagnostic=" + secret,
    target_sections: ["overview"],
    priority: "high",
  }));
  process.stdout.write(JSON.stringify(entries) + "\\n");
  process.exit(0);
}
process.stderr.write("unknown stub mode\\n");
process.exit(1);
`
  writeExecutable(kiloPath, script)
  return dir
}

function gitIn(cwd, args, env = {}) {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
  })
    .toString()
    .trim()
}

function makeGitRunner(cwd, env = {}) {
  return (args) => gitIn(cwd, args, env)
}

function initRepoWithIdentity(dir) {
  gitIn(dir, ["init", "-b", "main"])
  gitIn(dir, ["config", "user.name", "docs-sync-selftest"])
  gitIn(dir, ["config", "user.email", "docs-sync-selftest@example.com"])
  gitIn(dir, ["config", "commit.gpgsign", "false"])
}

// ---------------------------------------------------------------------------
// Case 1 — Defect A: mergeOrFallback
// ---------------------------------------------------------------------------
function case1_mergeOrFallback() {
  console.log("case 1: Defect A (mergeOrFallback)")

  // 1a — identity configured + clean merge → mode=update
  {
    const dir = mktemp("docs-sync-merge-clean-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "a.txt"), "base\n")
    gitIn(dir, ["add", "a.txt"])
    gitIn(dir, ["commit", "-m", "base"])
    gitIn(dir, ["checkout", "-b", DEFAULT_BRANCH])
    fs.writeFileSync(path.join(dir, "b.txt"), "on branch\n")
    gitIn(dir, ["add", "b.txt"])
    gitIn(dir, ["commit", "-m", "branch commit"])
    // Advance main without conflict
    gitIn(dir, ["checkout", "main"])
    fs.writeFileSync(path.join(dir, "c.txt"), "on main\n")
    gitIn(dir, ["add", "c.txt"])
    gitIn(dir, ["commit", "-m", "main advance"])
    gitIn(dir, ["update-ref", "refs/remotes/origin/main", "main"])
    gitIn(dir, ["checkout", DEFAULT_BRANCH])

    const result = mergeOrFallback({ branch: DEFAULT_BRANCH, git: makeGitRunner(dir) })
    assert.equal(result.mode, "update")
    assert.equal(result.branch, DEFAULT_BRANCH)
    // merge brought c.txt in
    assert.ok(fs.existsSync(path.join(dir, "c.txt")))
  }

  // 1b — genuine conflict → mode=conflict, abort succeeds, original branch untouched
  {
    const dir = mktemp("docs-sync-merge-conflict-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "conflict.txt"), "base\n")
    gitIn(dir, ["add", "conflict.txt"])
    gitIn(dir, ["commit", "-m", "base"])
    const baseSha = gitIn(dir, ["rev-parse", "HEAD"])

    gitIn(dir, ["checkout", "-b", DEFAULT_BRANCH])
    fs.writeFileSync(path.join(dir, "conflict.txt"), "branch side\n")
    gitIn(dir, ["add", "conflict.txt"])
    gitIn(dir, ["commit", "-m", "branch edit"])
    const branchShaBefore = gitIn(dir, ["rev-parse", "HEAD"])

    gitIn(dir, ["checkout", "main"])
    fs.writeFileSync(path.join(dir, "conflict.txt"), "main side\n")
    gitIn(dir, ["add", "conflict.txt"])
    gitIn(dir, ["commit", "-m", "main edit"])
    gitIn(dir, ["update-ref", "refs/remotes/origin/main", "main"])
    gitIn(dir, ["checkout", DEFAULT_BRANCH])

    const result = mergeOrFallback({ branch: DEFAULT_BRANCH, git: makeGitRunner(dir) })
    assert.equal(result.mode, "conflict")
    assert.ok(result.branch.startsWith(`${DEFAULT_BRANCH}-`))
    // Original rolling branch tip unchanged
    const branchShaAfter = gitIn(dir, ["rev-parse", DEFAULT_BRANCH])
    assert.equal(branchShaAfter, branchShaBefore)
    // No merge in progress
    let mergeHead = true
    try {
      gitIn(dir, ["rev-parse", "-q", "--verify", "MERGE_HEAD"])
    } catch {
      mergeHead = false
    }
    assert.equal(mergeHead, false)
    void baseSha
  }

  // 1c — identity-less / non-conflict merge failure → throws (does not fake conflict)
  {
    const dir = mktemp("docs-sync-merge-noid-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "a.txt"), "base\n")
    gitIn(dir, ["add", "a.txt"])
    gitIn(dir, ["commit", "-m", "base"])
    gitIn(dir, ["checkout", "-b", DEFAULT_BRANCH])
    fs.writeFileSync(path.join(dir, "b.txt"), "branch\n")
    gitIn(dir, ["add", "b.txt"])
    gitIn(dir, ["commit", "-m", "branch"])
    gitIn(dir, ["checkout", "main"])
    fs.writeFileSync(path.join(dir, "c.txt"), "main\n")
    gitIn(dir, ["add", "c.txt"])
    gitIn(dir, ["commit", "-m", "main"])
    gitIn(dir, ["update-ref", "refs/remotes/origin/main", "main"])
    gitIn(dir, ["checkout", DEFAULT_BRANCH])

    // Strip identity so merge cannot create a commit
    gitIn(dir, ["config", "--unset", "user.name"])
    gitIn(dir, ["config", "--unset", "user.email"])

    const env = {
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_CONFIG_SYSTEM: "/dev/null",
      GIT_CONFIG_NOSYSTEM: "1",
    }
    const git = (args) =>
      execFileSync("git", ["-c", "user.useConfigOnly=true", ...args], {
        cwd: dir,
        env: { ...process.env, ...env },
        stdio: ["ignore", "pipe", "pipe"],
        encoding: "utf8",
      })
        .toString()
        .trim()

    assert.throws(
      () => mergeOrFallback({ branch: DEFAULT_BRANCH, git }),
      (err) => {
        // Must throw the original merge error, not a merge --abort failure
        const msg = String(err?.stderr ?? err?.message ?? err)
        assert.ok(!/no merge to abort/i.test(msg), `should not reach merge --abort: ${msg}`)
        return true
      },
    )
  }
}

// ---------------------------------------------------------------------------
// Helpers to run edit.mjs / triage.mjs as child processes
// ---------------------------------------------------------------------------
function setupEditCwd(worthy, triage) {
  const cwd = mktemp("docs-sync-edit-")
  fs.mkdirSync(path.join(cwd, "docs-sync-out"), { recursive: true })
  fs.writeFileSync(path.join(cwd, "docs-sync-out", "worthy.json"), JSON.stringify(worthy, null, 2))
  fs.writeFileSync(path.join(cwd, "docs-sync-out", "triage.json"), JSON.stringify(triage, null, 2))
  return cwd
}

function setupTriageCwd(digest) {
  const cwd = mktemp("docs-sync-triage-")
  fs.mkdirSync(path.join(cwd, "docs-sync-out"), { recursive: true })
  fs.writeFileSync(path.join(cwd, "docs-sync-out", "digest.json"), JSON.stringify(digest, null, 2))
  return cwd
}

function runNodeScript(scriptPath, { cwd, env = {}, kiloDir }) {
  const pathEnv = [kiloDir, process.env.PATH].filter(Boolean).join(path.delimiter)
  const result = spawnSync(process.execPath, [scriptPath], {
    cwd,
    env: {
      ...process.env,
      ...env,
      PATH: pathEnv,
      DOCS_SYNC_BACKOFF_MS: env.DOCS_SYNC_BACKOFF_MS ?? "0",
    },
    encoding: "utf8",
    timeout: 60_000,
  })
  return {
    status: result.status,
    stdout: String(result.stdout ?? ""),
    stderr: String(result.stderr ?? ""),
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    error: result.error,
  }
}

function samplePr(n, { merged_at, repo = "Kilo-Org/cloud" } = {}) {
  return {
    repo,
    number: n,
    title: `feat: sample ${n}`,
    url: `https://github.com/${repo}/pull/${n}`,
    author: "dev",
    merged_at: merged_at ?? "2026-07-20T12:00:00.000Z",
    labels: [],
    body: "body",
    files: [],
    files_total: 1,
    patch_excerpt: "",
  }
}

// ---------------------------------------------------------------------------
// Case 2 — Defect B: edit.mjs with stub kilo (exit 0 + stderr)
// ---------------------------------------------------------------------------
function case2_defectB() {
  console.log("case 2: Defect B (edit.mjs stderr-on-exit-0)")

  const prs = [1, 2, 3, 4, 5].map((n) => samplePr(n))
  const worthy = prs
  const triage = prs.map((p) => ({
    pr: p.number,
    url: p.url,
    docs_worthy: true,
    reason: "needs docs",
    target_sections: ["overview"],
    priority: "high",
  }))
  const cwd = setupEditCwd(worthy, triage)
  const stderrText = "event stream disconnected DIAG-CASE2"
  const kiloDir = makeStubKiloDir({ mode: "stderr-exit0", stderrText })

  const started = Date.now()
  const result = runNodeScript(EDIT_SCRIPT, {
    cwd,
    kiloDir,
    env: {
      EDIT_MODEL: "test/model",
      DOCS_SYNC_BACKOFF_MS: "0",
      // Enough budget for 3 attempts × tiny timeout
      EDIT_BUDGET_MINUTES: "5",
      EDIT_BATCH_TIMEOUT_MINUTES: "1",
    },
  })
  const elapsed = Date.now() - started

  assert.equal(result.status, 0, `edit.mjs exit: ${result.output}`)
  // Backoff collapsed — 3 attempts without 60s+300s waits
  assert.ok(elapsed < 15_000, `backoff should collapse with DOCS_SYNC_BACKOFF_MS=0; elapsed=${elapsed}ms`)

  assert.match(result.output, /stderr tail:/)
  assert.match(result.output, /DIAG-CASE2|event stream disconnected/)
  assert.match(result.output, /attempt 1/)
  assert.match(result.output, /attempt 2/)
  // 3 attempts
  assert.match(result.output, /attempt 3|failed after up to 3 attempts/)

  const summary = JSON.parse(fs.readFileSync(path.join(cwd, ".docs-sync-summary.json"), "utf8"))
  assert.equal(summary.length, 5)
  for (const e of summary) {
    assert.equal(e.action, "pending", `expected pending, got ${JSON.stringify(e)}`)
  }

  const uncovered = computeUncovered({ worthy, summary, triage })
  assert.equal(uncovered.length, 5)
  for (const u of uncovered) {
    assert.ok(u.reason, "uncovered reason present")
  }
}

// ---------------------------------------------------------------------------
// Case 2b — AC4a: every docs-sync kilo run argv carries --auto
// ---------------------------------------------------------------------------
/** Slice `args: [` … matching `]` from source (newlines allowed inside). */
function extractArgsArraySlice(source) {
  const start = source.indexOf("args: [")
  assert.ok(start >= 0, "args: [ not found in source")
  let i = start + "args: ".length
  assert.equal(source[i], "[")
  let depth = 0
  for (; i < source.length; i++) {
    const ch = source[i]
    if (ch === "[") depth++
    else if (ch === "]") {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  throw new assert.AssertionError({ message: "unclosed args: [ array in source" })
}

/** Label → kilo-stderr filename rule (must match lib.mjs runKilo). */
function kiloStderrLogName(label) {
  return `kilo-stderr-${String(label).replace(/[^A-Za-z0-9._-]/g, "-")}.log`
}

function case2b_autoFlag() {
  console.log("case 2b: AC4a (--auto on every docs-sync kilo run)")

  // (i) region-scoped static check on triage.mjs / edit.mjs argv arrays
  for (const name of ["triage.mjs", "edit.mjs"]) {
    const src = fs.readFileSync(path.join(HERE, name), "utf8")
    const slice = extractArgsArraySlice(src)
    assert.ok(slice.includes('"--auto"'), `${name} args array must contain "--auto"; got:\n${slice}`)
  }

  // (ii) Fix verify failures step: join the run: | block and require --auto on kilo run
  {
    const yml = fs.readFileSync(path.join(HERE, "..", "workflows", "docs-sync.yml"), "utf8")
    const stepIdx = yml.indexOf("Fix verify failures")
    assert.ok(stepIdx >= 0, "Fix verify failures step missing")
    const afterStep = yml.slice(stepIdx)
    const runIdx = afterStep.indexOf("run: |")
    assert.ok(runIdx >= 0, "run: | missing after Fix verify failures")
    const blockStart = stepIdx + runIdx + "run: |".length
    const rest = yml.slice(blockStart)
    // Block ends at next unindented step key or EOF — collect indented lines
    const lines = []
    for (const line of rest.split("\n")) {
      if (line === "") {
        lines.push(line)
        continue
      }
      // stop at next top-level list item under steps (two-space + "- ")
      if (/^ {0,6}- name:/.test(line) || (/^\S/.test(line) && lines.length > 0)) break
      lines.push(line)
    }
    // Join continuation backslashes then collapse whitespace for the kilo run line
    const joined = lines
      .map((l) => l.replace(/^\s+/, ""))
      .join("\n")
      .replace(/\\\n/g, " ")
      .replace(/\s+/g, " ")
    assert.match(joined, /kilo run\b/, `expected kilo run in Fix verify block:\n${joined}`)
    const kiloCmd = joined.match(/kilo run\b[^|]*/)?.[0] ?? ""
    assert.ok(
      /\s--auto\b/.test(kiloCmd) || /kilo run\s+--auto\b/.test(kiloCmd),
      `Fix verify kilo run must contain --auto; got: ${kiloCmd}`,
    )

    // The step runs under `set -o pipefail` + the default `bash -e`, so an
    // unguarded kilo pipeline aborts the block before verify2.log is written
    // once the CLI exits nonzero on a mid-stream error. The rebuild must decide
    // this step's outcome, not the agent's exit code.
    // Window is the end of the kilo pipeline → the rebuild, so a comment
    // elsewhere in the block cannot satisfy the guard assertion.
    const teeIdx = joined.indexOf("tee -a docs-sync-out/edit-log.txt")
    assert.ok(teeIdx >= 0, `expected the kilo pipeline to tee edit-log.txt:\n${joined}`)
    const kiloPipeline = joined.slice(teeIdx, joined.indexOf("bun run", teeIdx))
    assert.match(
      kiloPipeline,
      /\|\|\s*(echo|true)\b/,
      `Fix verify kilo pipeline must be guarded (|| echo/true) so bash -e cannot skip the rebuild; got: ${kiloPipeline}`,
    )
    assert.match(joined, /verify2\.log/, "Fix verify block must still write verify2.log")
  }

  // (iii) authoritative: real stub invocations with callLog — every argv has --auto
  {
    const prs = [1, 2, 3, 4, 5].map((n) => samplePr(n))
    const worthy = prs
    const triage = prs.map((p) => ({
      pr: p.number,
      url: p.url,
      docs_worthy: true,
      reason: "needs docs",
      target_sections: ["overview"],
      priority: "high",
    }))
    const cwd = setupEditCwd(worthy, triage)
    const callLog = path.join(cwd, "kilo-calls.log")
    const stderrText = "event stream disconnected DIAG-AUTO"
    const kiloDir = makeStubKiloDir({ mode: "stderr-exit0", stderrText, callLog })

    const result = runNodeScript(EDIT_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        EDIT_MODEL: "test/model",
        DOCS_SYNC_BACKOFF_MS: "0",
        EDIT_BUDGET_MINUTES: "5",
        EDIT_BATCH_TIMEOUT_MINUTES: "1",
      },
    })
    assert.equal(result.status, 0, `edit.mjs exit: ${result.output}`)

    assert.ok(fs.existsSync(callLog), "callLog must be written (stub was invoked)")
    const lines = fs.readFileSync(callLog, "utf8").trim().split("\n").filter(Boolean)
    assert.ok(lines.length > 0, "callCount > 0 required (vacuous empty log forbidden)")
    for (const line of lines) {
      const { argv } = JSON.parse(line)
      assert.ok(
        Array.isArray(argv) && argv.includes("--auto"),
        `every kilo argv must include --auto; got ${JSON.stringify(argv)}`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Case 2c — full child stderr always written (success and failure paths)
// ---------------------------------------------------------------------------
function case2c_stderrLogAlways() {
  console.log("case 2c: unconditional kilo-stderr-*.log")

  const prs = [1, 2, 3, 4, 5].map((n) => samplePr(n))
  const worthy = prs
  const triage = prs.map((p) => ({
    pr: p.number,
    url: p.url,
    docs_worthy: true,
    reason: "needs docs",
    target_sections: ["overview"],
    priority: "high",
  }))

  // Failure path: stub exits 0 without summary (same mode as case 2)
  {
    const cwd = setupEditCwd(worthy, triage)
    const stderrText = "FAILPATH-STDERR-MARKER"
    const kiloDir = makeStubKiloDir({ mode: "stderr-exit0", stderrText })
    const result = runNodeScript(EDIT_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        EDIT_MODEL: "test/model",
        DOCS_SYNC_BACKOFF_MS: "0",
        EDIT_BUDGET_MINUTES: "5",
        EDIT_BATCH_TIMEOUT_MINUTES: "1",
      },
    })
    assert.equal(result.status, 0, result.output)
    const logName = kiloStderrLogName("edit batch 0 attempt 1")
    const logPath = path.join(cwd, "docs-sync-out", logName)
    assert.equal(logName, "kilo-stderr-edit-batch-0-attempt-1.log")
    assert.ok(fs.existsSync(logPath), `expected ${logPath} on failure path`)
    assert.match(fs.readFileSync(logPath, "utf8"), /FAILPATH-STDERR-MARKER/)
  }

  // Success path: stub writes summary (today's path that discarded stderr)
  {
    const cwd = setupEditCwd(worthy, triage)
    const stderrText = "SUCCESSPATH-STDERR-MARKER"
    const kiloDir = makeStubKiloDir({ mode: "write-edit-summary", stderrText })
    const result = runNodeScript(EDIT_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        EDIT_MODEL: "test/model",
        DOCS_SYNC_BACKOFF_MS: "0",
        EDIT_BUDGET_MINUTES: "5",
        EDIT_BATCH_TIMEOUT_MINUTES: "1",
      },
    })
    assert.equal(result.status, 0, result.output)
    assert.ok(
      fs.existsSync(path.join(cwd, "docs-sync-out", "edit-summary-0.json")),
      "stub must write summary (success path)",
    )
    const logName = kiloStderrLogName("edit batch 0 attempt 1")
    const logPath = path.join(cwd, "docs-sync-out", logName)
    assert.ok(fs.existsSync(logPath), `expected ${logPath} on success path`)
    assert.match(fs.readFileSync(logPath, "utf8"), /SUCCESSPATH-STDERR-MARKER/)
  }
}

// ---------------------------------------------------------------------------
// Case 2d — redact secret env values from captured kilo stderr (artifact-safe)
// ---------------------------------------------------------------------------
function case2d_redactEnvSecrets() {
  console.log("case 2d: redact env secrets from kilo stderr capture")

  const prs = [1, 2, 3, 4, 5].map((n) => samplePr(n))
  const worthy = prs
  const triage = prs.map((p) => ({
    pr: p.number,
    url: p.url,
    docs_worthy: true,
    reason: "needs docs",
    target_sections: ["overview"],
    priority: "high",
  }))
  const cwd = setupEditCwd(worthy, triage)
  const secret = "selftest-secret-value-12345"
  const stderrText = `leak before ${secret} after`
  const kiloDir = makeStubKiloDir({ mode: "stderr-exit0", stderrText })

  const result = runNodeScript(EDIT_SCRIPT, {
    cwd,
    kiloDir,
    env: {
      EDIT_MODEL: "test/model",
      DOCS_SYNC_BACKOFF_MS: "0",
      EDIT_BUDGET_MINUTES: "5",
      EDIT_BATCH_TIMEOUT_MINUTES: "1",
      KILO_API_KEY: secret,
    },
  })
  assert.equal(result.status, 0, `edit.mjs exit: ${result.output}`)

  const logName = kiloStderrLogName("edit batch 0 attempt 1")
  const logPath = path.join(cwd, "docs-sync-out", logName)
  assert.ok(fs.existsSync(logPath), `expected ${logPath}`)
  const logBody = fs.readFileSync(logPath, "utf8")
  assert.ok(!logBody.includes(secret), `persisted stderr must not contain secret; got: ${logBody}`)
  assert.ok(logBody.includes("leak before *** after"), `persisted stderr must redact to exact line; got: ${logBody}`)

  // Console stderr-tail region must also be redacted (not only the artifact file).
  const tailIdx = result.output.indexOf("stderr tail:")
  assert.ok(tailIdx >= 0, `expected stderr tail: in output; got: ${result.output}`)
  const tailRegion = result.output.slice(tailIdx)
  assert.ok(!tailRegion.includes(secret), `console stderr tail must not contain secret; got: ${tailRegion}`)
}

// ---------------------------------------------------------------------------
// Case 2e — longer secret first when a shorter env value is a prefix
// ---------------------------------------------------------------------------
function case2e_prefixSecretOrdering() {
  console.log("case 2e: prefix-secret ordering (longer value redacted first)")

  const prs = [1, 2, 3, 4, 5].map((n) => samplePr(n))
  const worthy = prs
  const triage = prs.map((p) => ({
    pr: p.number,
    url: p.url,
    docs_worthy: true,
    reason: "needs docs",
    target_sections: ["overview"],
    priority: "high",
  }))
  const cwd = setupEditCwd(worthy, triage)
  const shortSecret = "abcdefgh"
  const longSecret = "abcdefghIJKL-tail"
  const stderrText = `leak: ${longSecret} end`
  const kiloDir = makeStubKiloDir({ mode: "stderr-exit0", stderrText })

  const result = runNodeScript(EDIT_SCRIPT, {
    cwd,
    kiloDir,
    env: {
      EDIT_MODEL: "test/model",
      DOCS_SYNC_BACKOFF_MS: "0",
      EDIT_BUDGET_MINUTES: "5",
      EDIT_BATCH_TIMEOUT_MINUTES: "1",
      A_KEY: shortSecret,
      B_TOKEN: longSecret,
    },
  })
  assert.equal(result.status, 0, `edit.mjs exit: ${result.output}`)

  const logName = kiloStderrLogName("edit batch 0 attempt 1")
  const logPath = path.join(cwd, "docs-sync-out", logName)
  assert.ok(fs.existsSync(logPath), `expected ${logPath}`)
  const logBody = fs.readFileSync(logPath, "utf8")
  assert.ok(!logBody.includes("IJKL-tail"), `must not leak prefix remainder; got: ${logBody}`)
  assert.ok(logBody.includes("leak: *** end"), `expected full long secret redacted; got: ${logBody}`)
}

// ---------------------------------------------------------------------------
// Case 2f — redact secret values from captured kilo stdout (triage-raw artifact)
// ---------------------------------------------------------------------------
function case2f_redactStdout() {
  console.log("case 2f: redact env secrets from kilo stdout (triage-raw)")

  const digest = [samplePr(501), samplePr(502)]
  const cwd = setupTriageCwd(digest)
  const secret = "selftest-stdout-secret-99999"
  const kiloDir = makeStubKiloDir({ mode: "triage-embed-env-secret" })
  const summaryFile = path.join(cwd, "step-summary.md")
  fs.writeFileSync(summaryFile, "")

  const result = runNodeScript(TRIAGE_SCRIPT, {
    cwd,
    kiloDir,
    env: {
      TRIAGE_MODEL: "test/model",
      DOCS_SYNC_BACKOFF_MS: "0",
      TRIAGE_BUDGET_MINUTES: "30",
      GITHUB_STEP_SUMMARY: summaryFile,
      KILO_API_KEY: secret,
    },
  })
  assert.equal(result.status, 0, `triage.mjs exit: ${result.output}`)

  const rawFiles = fs.readdirSync(path.join(cwd, "docs-sync-out")).filter((f) => f.startsWith("triage-raw-"))
  assert.ok(rawFiles.length > 0, "expected triage-raw-*.txt artifact")
  for (const f of rawFiles) {
    const body = fs.readFileSync(path.join(cwd, "docs-sync-out", f), "utf8")
    assert.ok(!body.includes(secret), `triage-raw must not contain secret; ${f}: ${body}`)
  }

  const triage = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "triage.json"), "utf8"))
  assert.ok(triage.length >= 1, "triage must still parse after redaction")
  assert.ok(
    triage.some((e) => e.docs_worthy === true || e.pending === true || e.docs_worthy === false),
    "triage entries must be structured",
  )
}

// ---------------------------------------------------------------------------
// Case 2g — redact-stream.mjs line-wise filter (including partial last line)
// ---------------------------------------------------------------------------
function case2g_redactStream() {
  console.log("case 2g: redact-stream.mjs stdin filter")

  const secret = "stream-secret-value-xyz"
  const filterPath = path.join(HERE, "redact-stream.mjs")
  assert.ok(fs.existsSync(filterPath), `expected ${filterPath}`)

  const input = `leak ${secret} after\npartial-${secret}`
  const result = spawnSync(process.execPath, [filterPath], {
    env: { ...process.env, KILO_API_KEY: secret },
    input,
    encoding: "utf8",
    timeout: 10_000,
  })
  assert.equal(result.status, 0, `redact-stream exit: ${result.stderr || result.error}`)
  assert.equal(result.stdout, "leak *** after\npartial-***")
}

// ---------------------------------------------------------------------------
// Case 2h — pending causes reach the rolling PR free of ANSI escapes
// ---------------------------------------------------------------------------
function case2h_pendingCauseIsReadable() {
  console.log("case 2h: pending cause has no ANSI escapes")

  const prs = [1, 2, 3, 4, 5].map((n) => samplePr(n))
  const worthy = prs
  const triage = prs.map((p) => ({
    pr: p.number,
    url: p.url,
    docs_worthy: true,
    reason: "needs docs",
    target_sections: ["overview"],
    priority: "high",
  }))
  const cwd = setupEditCwd(worthy, triage)
  // Verbatim shape of a real kilo TUI stderr line (see PR #12521's pending table).
  const ESC = "\u001b"
  const stderrText = `${ESC}[0m→ ${ESC}[0mRead packages/kilo-docs/AGENTS.md${ESC}[2K${ESC}[1G done`
  const kiloDir = makeStubKiloDir({ mode: "stderr-exit0", stderrText })

  const result = runNodeScript(EDIT_SCRIPT, {
    cwd,
    kiloDir,
    env: {
      EDIT_MODEL: "test/model",
      DOCS_SYNC_BACKOFF_MS: "0",
      EDIT_BUDGET_MINUTES: "5",
      EDIT_BATCH_TIMEOUT_MINUTES: "1",
    },
  })
  assert.equal(result.status, 0, `edit.mjs exit: ${result.output}`)

  const summary = JSON.parse(fs.readFileSync(path.join(cwd, ".docs-sync-summary.json"), "utf8"))
  assert.equal(summary.length, 5)
  for (const e of summary) {
    assert.equal(e.action, "pending", `expected pending, got ${JSON.stringify(e)}`)
    assert.ok(!e.reason.includes(ESC), `pending reason must not contain ANSI escapes: ${JSON.stringify(e.reason)}`)
    // Non-vacuous: the diagnostic text itself must survive the strip.
    assert.match(e.reason, /Read packages\/kilo-docs\/AGENTS\.md/)
  }

  // The raw artifact log keeps the escapes — it is the debugging record.
  const rawLog = fs.readFileSync(path.join(cwd, "docs-sync-out", "kilo-stderr-edit-batch-0-attempt-1.log"), "utf8")
  assert.ok(rawLog.includes(ESC), "persisted stderr log must stay raw")
}

// ---------------------------------------------------------------------------
// Case 2i — wall-clock budgets can actually fit work
// ---------------------------------------------------------------------------
/**
 * The pre-unit gates in triage.mjs/edit.mjs refuse to start a chunk/batch unless
 * a whole per-unit timeout remains, so a budget below that timeout silently runs
 * ZERO units and defers every PR. Run 30306629290 hit the weaker form of this:
 * 8 of 11 chunks and 4 of 11 batches ran, the rest deferred untried. Assert the
 * workflow sets both budgets and that each fits at least two units.
 */
function case2i_budgetsFitWork() {
  console.log("case 2i: triage/edit budgets fit at least two units")

  const yml = fs.readFileSync(path.join(HERE, "..", "workflows", "docs-sync.yml"), "utf8")
  const readEnvNumber = (key) => {
    const m = yml.match(new RegExp(`^\\s*${key}:\\s*"?(\\d+)"?\\s*$`, "m"))
    assert.ok(m, `${key} must be set in docs-sync.yml (default is too small to drain a backlog)`)
    return Number(m[1])
  }

  // Per-unit timeouts are script constants, not workflow env; read them from source.
  const triageSrc = fs.readFileSync(path.join(HERE, "triage.mjs"), "utf8")
  const chunkMin = Number(triageSrc.match(/CHUNK_TIMEOUT_MS = (\d+) \* 60 \* 1000/)?.[1])
  assert.ok(Number.isFinite(chunkMin), "could not read CHUNK_TIMEOUT_MS from triage.mjs")

  const editSrc = fs.readFileSync(path.join(HERE, "edit.mjs"), "utf8")
  const batchMin = Number(editSrc.match(/EDIT_BATCH_TIMEOUT_MINUTES\) \|\| (\d+)/)?.[1])
  assert.ok(Number.isFinite(batchMin), "could not read EDIT_BATCH_TIMEOUT_MINUTES default from edit.mjs")

  const triageBudget = readEnvNumber("TRIAGE_BUDGET_MINUTES")
  const editBudget = readEnvNumber("EDIT_BUDGET_MINUTES")
  assert.ok(
    triageBudget >= 2 * chunkMin,
    `TRIAGE_BUDGET_MINUTES=${triageBudget} must be >= 2x chunk timeout (${chunkMin}m)`,
  )
  assert.ok(editBudget >= 2 * batchMin, `EDIT_BUDGET_MINUTES=${editBudget} must be >= 2x batch timeout (${batchMin}m)`)

  // The job timeout must outlast both budgets plus the non-LLM steps.
  const jobTimeout = Number(yml.match(/^\s*timeout-minutes:\s*(\d+)\s*$/m)?.[1])
  assert.ok(Number.isFinite(jobTimeout), "could not read job timeout-minutes")
  assert.ok(
    jobTimeout > triageBudget + editBudget,
    `job timeout-minutes=${jobTimeout} must exceed triage+edit budgets (${triageBudget}+${editBudget})`,
  )
}

// ---------------------------------------------------------------------------
// Case 3 — watermark invariant
// ---------------------------------------------------------------------------
function case3_watermark() {
  console.log("case 3: watermark invariant")

  const now = "2026-07-27T12:00:00.000Z"
  const nowMs = Date.parse(now)

  const prA = samplePr(10, { merged_at: "2026-07-20T10:00:00.000Z" })
  const prB = samplePr(11, { merged_at: "2026-07-22T15:30:00.000Z" })
  const prC = samplePr(12, { merged_at: "2026-07-25T08:00:00.000Z" })
  const digest = [prA, prB, prC]

  // all covered → processed-through === now
  {
    const worthy = [prA, prB]
    const summary = [
      { pr: 10, url: prA.url, action: "updated packages/kilo-docs/pages/x.md", reason: "" },
      { pr: 11, url: prB.url, action: "skipped", reason: "already documented" },
    ]
    const triage = [
      { pr: 10, url: prA.url, docs_worthy: true, pending: false, reason: "ok" },
      { pr: 11, url: prB.url, docs_worthy: true, pending: false, reason: "ok" },
    ]
    const uncovered = computeUncovered({ worthy, summary, triage })
    assert.equal(uncovered.length, 0)
    const through = computeProcessedThrough({ uncovered, digest, now })
    assert.equal(through, now)
  }

  // one uncovered → merged_at − 1 ms, strictly < now
  {
    const worthy = [prA, prB]
    const summary = [
      { pr: 10, url: prA.url, action: "updated x", reason: "" },
      { pr: 11, url: prB.url, action: "pending", reason: "edit batch 0: exit 0" },
    ]
    const uncovered = computeUncovered({ worthy, summary, triage: [] })
    assert.equal(uncovered.length, 1)
    assert.equal(uncovered[0].url, prB.url)
    const through = computeProcessedThrough({ uncovered, digest, now })
    const expected = new Date(Date.parse(prB.merged_at) - 1).toISOString()
    assert.equal(through, expected)
    assert.ok(Date.parse(through) < nowMs)
  }

  // several uncovered → earliest merge time wins
  {
    const worthy = [prA, prB, prC]
    const summary = [
      { pr: 10, url: prA.url, action: "pending", reason: "fail" },
      { pr: 12, url: prC.url, action: "pending", reason: "fail" },
    ]
    // prB missing from summary entirely
    const uncovered = computeUncovered({ worthy, summary, triage: [] })
    assert.ok(uncovered.length >= 2)
    const through = computeProcessedThrough({ uncovered, digest, now })
    // earliest among A, B, C that are uncovered — A is earliest
    const times = uncovered
      .map((u) => digest.find((d) => d.url === u.url)?.merged_at)
      .filter(Boolean)
      .map((t) => Date.parse(t))
    const earliest = Math.min(...times)
    assert.equal(through, new Date(earliest - 1).toISOString())
  }

  // summary missing/truncated while worthy non-empty → every worthy URL held back
  {
    const worthy = [prA, prB]
    const uncovered = computeUncovered({ worthy, summary: [], triage: [] })
    assert.equal(uncovered.length, 2)
    const through = computeProcessedThrough({ uncovered, digest, now })
    assert.equal(through, new Date(Date.parse(prA.merged_at) - 1).toISOString())
  }

  // noDiffReport three arms
  {
    const uncovered = [{ url: prA.url, reason: "edit batch failed" }]
    const arm1 = noDiffReport({ uncovered, sinceOverride: true })
    assert.ok(arm1.summary.includes(prA.url))
    assert.ok(arm1.warning, "override + uncovered → warning present")

    const arm2 = noDiffReport({ uncovered: [], sinceOverride: true })
    assert.equal(arm2.warning, null, "override + empty uncovered → warning absent")

    const arm3 = noDiffReport({ uncovered, sinceOverride: false })
    assert.equal(arm3.warning, null, "scheduled + uncovered → warning absent")
  }

  // triage pending:true backfill rows land in uncovered (consumption)
  {
    const triage = [
      {
        pr: 99,
        url: "https://github.com/Kilo-Org/cloud/pull/99",
        docs_worthy: false,
        pending: true,
        reason: "not classified by triage",
      },
    ]
    const uncovered = computeUncovered({ worthy: [], summary: [], triage })
    assert.equal(uncovered.length, 1)
    assert.equal(uncovered[0].url, triage[0].url)
    const through = computeProcessedThrough({
      uncovered,
      digest: [{ url: triage[0].url, merged_at: "2026-07-21T00:00:00.000Z" }],
      now,
    })
    assert.equal(through, new Date(Date.parse("2026-07-21T00:00:00.000Z") - 1).toISOString())
  }

  // fallback field (post-plan repair)
  {
    const uncovered = [{ url: "https://github.com/Kilo-Org/cloud/pull/50", reason: "missing" }]
    const fallback = "2026-07-17T00:00:00.000Z"
    // unresolved merged_at + parseable fallback → hold at fallback, warn
    const prevWarn = console.warn
    const warnings = []
    console.warn = (...a) => warnings.push(a.join(" "))
    try {
      const through = computeProcessedThrough({ uncovered, digest: [], now, fallback })
      assert.equal(through, new Date(fallback).toISOString())
      assert.ok(Date.parse(through) < nowMs)
      assert.ok(warnings.some((w) => w.includes("::warning::")))
    } finally {
      console.warn = prevWarn
    }

    // unresolved + unparseable/missing fallback → throws
    assert.throws(() => computeProcessedThrough({ uncovered, digest: [], now }), /fallback|SINCE|refusing/i)
    assert.throws(
      () => computeProcessedThrough({ uncovered, digest: [], now, fallback: "not-a-date" }),
      /fallback|SINCE|refusing/i,
    )

    // resolved merged_at ignores fallback
    const throughResolved = computeProcessedThrough({
      uncovered: [{ url: prA.url, reason: "x" }],
      digest: [prA],
      now,
      fallback: "2020-01-01T00:00:00.000Z",
    })
    assert.equal(throughResolved, new Date(Date.parse(prA.merged_at) - 1).toISOString())

    // empty uncovered ignores fallback
    const throughEmpty = computeProcessedThrough({
      uncovered: [],
      digest: [],
      now,
      fallback: "2020-01-01T00:00:00.000Z",
    })
    assert.equal(throughEmpty, now)
  }
}

// ---------------------------------------------------------------------------
// Case 4 — routing and round trip
// ---------------------------------------------------------------------------
function case4_routing() {
  console.log("case 4: routing and round trip")

  const summary = [
    { pr: 1, url: "https://github.com/Kilo-Org/cloud/pull/1", action: "updated pages/a.md", reason: "" },
    { pr: 2, url: "https://github.com/Kilo-Org/cloud/pull/2", action: "skipped", reason: "already documented" },
    { pr: 3, url: "https://github.com/Kilo-Org/cloud/pull/3", action: "pending", reason: "edit batch 1: exit 0" },
  ]
  const triage = [
    {
      pr: 4,
      url: "https://github.com/Kilo-Org/cloud/pull/4",
      docs_worthy: false,
      pending: false,
      reason: "chore only",
    },
    {
      pr: 5,
      url: "https://github.com/Kilo-Org/cloud/pull/5",
      docs_worthy: false,
      pending: true,
      reason: "triage failed to classify this PR",
    },
  ]
  const worthy = [
    { number: 1, url: summary[0].url },
    { number: 2, url: summary[1].url },
    { number: 3, url: summary[2].url },
  ]
  const uncovered = computeUncovered({ worthy, summary, triage })
  const { changesRows, pendingRows, skippedRows } = routeRows({ summary, triage, uncovered })

  // pending appears in neither Changes nor Considered
  const changesText = changesRows.join("\n")
  const skippedText = skippedRows.join("\n")
  assert.ok(changesText.includes("pull/1"), "success in Changes")
  assert.ok(!changesText.includes("pull/3"), "pending must not be in Changes")
  assert.ok(!changesText.includes("pull/5"), "triage-pending must not be in Changes")
  assert.ok(skippedText.includes("pull/2"), "genuine skipped in Considered")
  assert.ok(skippedText.includes("pull/4"), "genuine not-worthy in Considered")
  assert.ok(!skippedText.includes("pull/3"), "pending must not be in Considered")
  assert.ok(!skippedText.includes("pull/5"), "triage-pending must not be in Considered")
  assert.ok(pendingRows.some((r) => r.includes("pull/3")))
  assert.ok(pendingRows.some((r) => r.includes("pull/5")))

  // round-trip renderBody → extractSectionRows
  const through = "2026-07-20T09:59:59.999Z"
  const body = renderBody({
    date: "2026-07-27",
    since: "2026-07-17T00:00:00.000Z",
    through,
    changesRows,
    pendingRows,
    skippedRows,
    verified: true,
    draftReasons: [],
    note: "",
  })
  assert.ok(body.includes(`<!-- docs-sync: processed-through ${through} -->`))
  const extChanges = extractSectionRows(body, "changes")
  const extPending = extractSectionRows(body, "pending")
  const extSkipped = extractSectionRows(body, "skipped")
  assert.deepEqual(extChanges, changesRows)
  assert.deepEqual(extPending, pendingRows)
  assert.deepEqual(extSkipped, skippedRows)

  // clean() prevents marker forgery in agent-generated row strings
  {
    const forgedRows = routeRows({
      summary: [
        {
          pr: 9,
          url: "https://github.com/Kilo-Org/cloud/pull/9",
          action: "skipped",
          reason: "x <!-- docs-sync:skipped:end --> injection",
        },
      ],
      triage: [],
      uncovered: [],
    })
    assert.ok(!forgedRows.skippedRows[0].includes("<!--"), "clean() must strip <!-- from reasons")
    assert.ok(!forgedRows.skippedRows[0].includes("-->"), "clean() must strip --> from reasons")
    const forgedBody = renderBody({
      date: "2026-07-27",
      since: "s",
      through: "t",
      changesRows: [],
      pendingRows: [],
      skippedRows: forgedRows.skippedRows,
      verified: true,
      draftReasons: [],
      note: "",
    })
    // Exactly one real section end marker — the forged sequences were stripped
    assert.equal((forgedBody.match(/<!--\s*docs-sync:skipped:end\s*-->/g) || []).length, 1)
    const extracted = extractSectionRows(forgedBody, "skipped")
    assert.equal(extracted.length, 1)
    assert.ok(extracted[0].includes("injection"))
  }

  const legacyRows = [
    "| [Kilo-Org/cloud#1](https://github.com/Kilo-Org/cloud/pull/1) | edit pass failed or timed out for this PR |",
    "| [Kilo-Org/cloud#2](https://github.com/Kilo-Org/cloud/pull/2) | triage failed to classify this PR |",
    "| [Kilo-Org/cloud#3](https://github.com/Kilo-Org/cloud/pull/3) | not classified by triage |",
    "| [Kilo-Org/cloud#4](https://github.com/Kilo-Org/cloud/pull/4) | already covered by existing docs |",
  ]
  const kept = dropLegacySkipped(legacyRows)
  assert.equal(kept.length, 1)
  assert.ok(kept[0].includes("pull/4"))
  assert.ok(!kept.some((r) => r.includes("edit pass failed")))
  assert.ok(!kept.some((r) => r.includes("triage failed to classify")))
  assert.ok(!kept.some((r) => r.includes("not classified by triage")))
}

// ---------------------------------------------------------------------------
// Case 5 — re-collection window
// ---------------------------------------------------------------------------
function case5_recollection() {
  console.log("case 5: re-collection closes the loop")

  const collectSrc = fs.readFileSync(COLLECT_SCRIPT, "utf8")
  // Query template must use merged:>=
  assert.ok(
    /merged:>=\$\{since\.toISOString\(\)\}/.test(collectSrc) || /merged:>=/.test(collectSrc),
    "collect.mjs must search merged:>=since",
  )
  assert.match(collectSrc, /merged:>=/)

  const mergedAt = "2026-07-22T15:30:00.000Z"
  const uncovered = [{ url: "https://github.com/Kilo-Org/cloud/pull/11", reason: "pending" }]
  const digest = [{ url: uncovered[0].url, merged_at: mergedAt }]
  const now = "2026-07-27T12:00:00.000Z"
  const since = computeProcessedThrough({ uncovered, digest, now })
  // held-back since is strictly before the uncovered PR's merged_at
  assert.ok(Date.parse(since) < Date.parse(mergedAt), `since ${since} must be < merged_at ${mergedAt}`)
  // And the query window merged:>=since therefore includes that PR
  assert.ok(Date.parse(mergedAt) >= Date.parse(since))
}

// ---------------------------------------------------------------------------
// Case 6 — budgets
// ---------------------------------------------------------------------------
function case6_budgets() {
  console.log("case 6: budgets")

  // --- edit budget ---
  {
    // 12 PRs = 3 batches of 5; budget too small for even one batch unit
    const prs = Array.from({ length: 12 }, (_, i) => samplePr(100 + i))
    const worthy = prs
    const triage = prs.map((p) => ({
      pr: p.number,
      url: p.url,
      docs_worthy: true,
      reason: "needs docs",
      target_sections: [],
      priority: "medium",
    }))
    const cwd = setupEditCwd(worthy, triage)
    const callLog = path.join(cwd, "kilo-calls.log")
    const kiloDir = makeStubKiloDir({ mode: "record", callLog })

    // EDIT_BUDGET_MINUTES must be positive (0 falls through to default 50).
    // BATCH_TIMEOUT default would be 15m; set both tiny so left < BATCH_TIMEOUT immediately.
    const result = runNodeScript(EDIT_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        EDIT_MODEL: "test/model",
        DOCS_SYNC_BACKOFF_MS: "0",
        EDIT_BUDGET_MINUTES: "0.0001",
        EDIT_BATCH_TIMEOUT_MINUTES: "15",
      },
    })
    assert.equal(result.status, 0, result.output)
    assert.match(result.output, /deferring \d+ PRs/)
    assert.match(result.output, /deferred \d+ PRs due to wall-clock budget/)

    const calls = fs.existsSync(callLog) ? fs.readFileSync(callLog, "utf8").trim() : ""
    const callCount = calls ? calls.split("\n").filter(Boolean).length : 0
    assert.equal(callCount, 0, `kilo must not be invoked for deferred edit batches; got ${callCount}`)

    const summary = JSON.parse(fs.readFileSync(path.join(cwd, ".docs-sync-summary.json"), "utf8"))
    assert.ok(summary.every((e) => e.action === "pending"))
    const uncovered = computeUncovered({ worthy, summary, triage })
    assert.equal(uncovered.length, 12)
    assert.ok(summary.every((e) => e.action !== "skipped"))
  }

  // --- triage budget ---
  {
    // CHUNK_SIZE=25; 30 PRs = 2 chunks; budget too small for a 10m chunk
    const digest = Array.from({ length: 30 }, (_, i) => samplePr(200 + i))
    const cwd = setupTriageCwd(digest)
    const callLog = path.join(cwd, "kilo-calls.log")
    const kiloDir = makeStubKiloDir({ mode: "record", callLog })
    const summaryFile = path.join(cwd, "step-summary.md")
    fs.writeFileSync(summaryFile, "")

    const result = runNodeScript(TRIAGE_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_BACKOFF_MS: "0",
        TRIAGE_BUDGET_MINUTES: "0.0001",
        GITHUB_STEP_SUMMARY: summaryFile,
      },
    })
    assert.equal(result.status, 0, result.output)
    assert.match(result.output, /deferring \d+ PRs/)

    const calls = fs.existsSync(callLog) ? fs.readFileSync(callLog, "utf8").trim() : ""
    const callCount = calls ? calls.split("\n").filter(Boolean).length : 0
    assert.equal(callCount, 0, `kilo must not be invoked for deferred triage chunks; got ${callCount}`)

    const triage = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "triage.json"), "utf8"))
    assert.equal(triage.length, 30)
    assert.ok(triage.every((e) => e.pending === true))
    assert.ok(triage.every((e) => e.docs_worthy === false))
    const uncovered = computeUncovered({ worthy: [], summary: [], triage })
    assert.equal(uncovered.length, 30)
  }
}

// ---------------------------------------------------------------------------
// Case 7 — applyCap both arms
// ---------------------------------------------------------------------------
function case7_cap() {
  console.log("case 7: applyCap")

  const now = new Date("2026-07-27T12:00:00.000Z")
  const old = new Date("2026-06-01T00:00:00.000Z")

  const prevLog = console.log
  const prevWarn = console.warn
  const logs = []
  const warnings = []
  console.log = (...a) => logs.push(a.join(" "))
  console.warn = (...a) => warnings.push(a.join(" "))
  try {
    // explicit:false + older than 14 days → clamped AND reported
    const a = applyCap(old, now, { explicit: false })
    assert.equal(a.clamped, true)
    assert.ok(a.since.getTime() > old.getTime())
    const cap = new Date(now.getTime() - 14 * 24 * 3600 * 1000)
    assert.equal(a.since.toISOString(), cap.toISOString())
    assert.ok(warnings.some((w) => w.includes("::warning::") && w.includes("clamped")))

    // explicit:true + older than 14 days → unchanged, skip reported
    logs.length = 0
    warnings.length = 0
    const b = applyCap(old, now, { explicit: true })
    assert.equal(b.clamped, false)
    assert.equal(b.since.toISOString(), old.toISOString())
    assert.ok(logs.some((l) => /cap skipped|INPUT_SINCE/i.test(l)))
  } finally {
    console.log = prevLog
    console.warn = prevWarn
  }
}

// ---------------------------------------------------------------------------
// Case 8 — triage.mjs outputs
// ---------------------------------------------------------------------------
function case8_triage() {
  console.log("case 8: triage pass outputs")

  // 8a Run A: SINCE_OVERRIDE=true + everything pending → warning present
  {
    const digest = [samplePr(301), samplePr(302), samplePr(303)]
    const cwd = setupTriageCwd(digest)
    const kiloDir = makeStubKiloDir({ mode: "stderr-exit0", stderrText: "stream end before idle" })
    const summaryFile = path.join(cwd, "step-summary.md")
    fs.writeFileSync(summaryFile, "")

    const result = runNodeScript(TRIAGE_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_BACKOFF_MS: "0",
        TRIAGE_BUDGET_MINUTES: "30",
        SINCE_OVERRIDE: "true",
        GITHUB_STEP_SUMMARY: summaryFile,
      },
    })
    assert.equal(result.status, 0, result.output)
    const triage = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "triage.json"), "utf8"))
    assert.equal(triage.length, 3)
    assert.ok(triage.every((e) => e.pending === true))
    const summary = fs.readFileSync(summaryFile, "utf8")
    assert.match(summary, /triage pending/)
    for (const d of digest) {
      assert.ok(summary.includes(d.url), `summary lists ${d.url}`)
    }
    assert.match(result.output, /::warning::.*since-override/)
  }

  // 8a Run B: SINCE_OVERRIDE unset → warning absent
  {
    const digest = [samplePr(311), samplePr(312)]
    const cwd = setupTriageCwd(digest)
    const kiloDir = makeStubKiloDir({ mode: "stderr-exit0", stderrText: "stream end" })
    const summaryFile = path.join(cwd, "step-summary.md")
    fs.writeFileSync(summaryFile, "")

    const result = runNodeScript(TRIAGE_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_BACKOFF_MS: "0",
        TRIAGE_BUDGET_MINUTES: "30",
        GITHUB_STEP_SUMMARY: summaryFile,
      },
    })
    assert.equal(result.status, 0, result.output)
    const triage = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "triage.json"), "utf8"))
    assert.ok(triage.every((e) => e.pending === true))
    assert.ok(fs.readFileSync(summaryFile, "utf8").includes("triage pending"))
    assert.ok(!/::warning::.*since-override/.test(result.output), "override warning must be absent when unset")
  }

  // 8a Run C: SINCE_OVERRIDE=true with MIXED stub (worthy > 0) → warning ABSENT
  {
    const digest = [samplePr(321), samplePr(322), samplePr(323), samplePr(324)]
    const cwd = setupTriageCwd(digest)
    const kiloDir = makeStubKiloDir({ mode: "mixed-triage" })
    const summaryFile = path.join(cwd, "step-summary.md")
    fs.writeFileSync(summaryFile, "")

    const result = runNodeScript(TRIAGE_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_BACKOFF_MS: "0",
        TRIAGE_BUDGET_MINUTES: "30",
        SINCE_OVERRIDE: "true",
        GITHUB_STEP_SUMMARY: summaryFile,
      },
    })
    assert.equal(result.status, 0, result.output)
    const triage = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "triage.json"), "utf8"))
    const worthy = triage.filter((e) => e.docs_worthy === true).length
    const pending = triage.filter((e) => e.pending === true).length
    assert.ok(worthy > 0, "mixed stub must produce worthy > 0")
    assert.ok(pending > 0, "mixed stub must leave some pending")
    assert.ok(
      !/::warning::.*since-override/.test(result.output),
      "override warning must be ABSENT when worthy > 0 (Upsert will run)",
    )
  }

  // 8b — partial classification → missing URLs pending:true + computeUncovered
  {
    // One chunk of 4 PRs; stub classifies first 3 only
    const digest = [samplePr(401), samplePr(402), samplePr(403), samplePr(404)]
    const cwd = setupTriageCwd(digest)
    const kiloDir = makeStubKiloDir({ mode: "partial-triage" })
    const summaryFile = path.join(cwd, "step-summary.md")
    fs.writeFileSync(summaryFile, "")

    const result = runNodeScript(TRIAGE_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_BACKOFF_MS: "0",
        TRIAGE_BUDGET_MINUTES: "30",
        GITHUB_STEP_SUMMARY: summaryFile,
      },
    })
    assert.equal(result.status, 0, result.output)
    const triage = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "triage.json"), "utf8"))
    assert.equal(triage.length, 4)
    const missing = triage.filter((e) => e.reason === "not classified by triage")
    assert.ok(missing.length >= 1, "backfill must mark unclassified URLs")
    assert.ok(missing.every((e) => e.pending === true))
    const uncovered = computeUncovered({ worthy: [], summary: [], triage })
    for (const m of missing) {
      assert.ok(
        uncovered.some((u) => u.url === m.url),
        `${m.url} must appear in computeUncovered`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
function main() {
  const cases = [
    case1_mergeOrFallback,
    case2_defectB,
    case2b_autoFlag,
    case2c_stderrLogAlways,
    case2d_redactEnvSecrets,
    case2e_prefixSecretOrdering,
    case2f_redactStdout,
    case2g_redactStream,
    case2h_pendingCauseIsReadable,
    case2i_budgetsFitWork,
    case3_watermark,
    case4_routing,
    case5_recollection,
    case6_budgets,
    case7_cap,
    case8_triage,
  ]
  let failed = 0
  for (const fn of cases) {
    try {
      fn()
      console.log(`  ok: ${fn.name}`)
    } catch (err) {
      failed++
      console.error(`  FAIL: ${fn.name}`)
      console.error(err)
    } finally {
      cleanup()
    }
  }
  if (failed > 0) {
    console.error(`\nselftest: ${failed} case(s) failed`)
    process.exit(1)
  }
  console.log("\nselftest: all cases passed")
}

main()
