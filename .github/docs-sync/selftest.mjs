// kilocode_change - new file

/**
 * Offline self-check for the docs-sync failure paths (S4).
 * Plain node:assert, no network, no LLM, no new dependency.
 * Run: node .github/docs-sync/selftest.mjs
 */

import assert from "node:assert/strict"
import { execFileSync, spawn, spawnSync } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import { sleepSync } from "./lib.mjs"
import { mergeOrFallback, DEFAULT_BRANCH } from "./prepare-branch.mjs"
import { applyCap } from "./watermark.mjs"
import {
  computeUncovered,
  computeProcessedThrough,
  routeRows,
  dropLegacySkipped,
  noDiffReport,
  LEARNINGS_FILE,
  nonContentFiles,
  resolveLearnedThrough,
  renderBody,
  extractSectionRows,
} from "./upsert-pr.mjs"
import {
  revertTitleKind,
  parseRevertTargets,
  computeRevertAnnotations,
  applyRevertAnnotations,
  unannotatedRevertSignals,
} from "./reverts.mjs"
import {
  parseLearnings,
  renderLearnings,
  parseLearnedThrough,
  patchMarkerIntoBody,
  parseDelta,
  validateDelta,
  applyDelta,
  isTrustedComment,
  promptBlock,
} from "./learn.mjs"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EDIT_SCRIPT = path.join(HERE, "edit.mjs")
const TRIAGE_SCRIPT = path.join(HERE, "triage.mjs")
const COLLECT_SCRIPT = path.join(HERE, "collect.mjs")
const LEARN_SCRIPT = path.join(HERE, "learn.mjs")

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
if (mode === "extraction-delta") {
  const deltaFile = "docs-sync-out/extraction-delta.json";
  if (fs.existsSync(deltaFile)) {
    const delta = JSON.parse(fs.readFileSync(deltaFile, "utf8"));
    process.stdout.write(JSON.stringify(delta) + "\\n");
  } else {
    process.stdout.write('{"add":[],"remove":[]}' + "\\n");
  }
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

function runNodeScript(scriptPath, { cwd, env = {}, kiloDir, args = [] }) {
  const pathEnv = [kiloDir, process.env.PATH].filter(Boolean).join(path.delimiter)
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
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
  const learnedMarker = "<!-- docs-sync: learned-through commit=deadbeef comment=2026-07-20T10:00:00Z -->"
  const body = renderBody({
    date: "2026-07-27",
    since: "2026-07-17T00:00:00.000Z",
    through,
    learnedThrough: learnedMarker,
    changesRows,
    pendingRows,
    skippedRows,
    verified: true,
    draftReasons: [],
    note: "",
  })
  assert.ok(body.includes(`<!-- docs-sync: processed-through ${through} -->`))
  assert.ok(body.includes(learnedMarker), "learned-through marker must appear in rendered body")
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
      learnedThrough: "",
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
// Case 9 — revert interception (title/body/annotations + source-order guards)
// ---------------------------------------------------------------------------
function case9_reverts() {
  console.log("case 9: revert interception")

  // --- revertTitleKind ---
  assert.equal(revertTitleKind("revert(cli): restore opt-in stream idle timeouts"), "conventional")
  assert.equal(revertTitleKind('Revert "feat(cli): default stream watchdog"'), "github-native")
  assert.equal(revertTitleKind("REVERT: all of it"), "conventional")
  assert.equal(revertTitleKind("feat(cli): add x"), null)
  assert.equal(revertTitleKind("docs: update y"), null)
  assert.equal(revertTitleKind("Reverted behavior docs"), null)

  // --- parseRevertTargets ---
  const defaultRepo = "Kilo-Org/kilocode"
  const body12497 = `The default stream inactivity watchdog introduced by #12249 aborts requests based only on the absence of normalized AI SDK events. That signal cannot distinguish a dead provider stream from long prompt processing, reasoning, buffering, or transport behavior, and the follow-up in #12481 reduces false positives without resolving that ambiguity.

Revert both changes and restore the previous opt-in contract: Kilo does not impose a stream idle timeout unless the provider configuration explicitly sets \`chunkTimeout\`. Explicit provider timeouts continue to use the existing AI SDK and SSE timeout paths. This removes the global heuristic while the underlying stalled-stream source and the required transport-level observability are investigated.

This deliberately restores the possibility that an unconfigured provider stream can remain open indefinitely. A default watchdog should be reintroduced only with evidence that its liveness signal and threshold do not terminate healthy responses.

Reverts #12249 and #12481.
`
  {
    const targets = parseRevertTargets(body12497, defaultRepo)
    assert.equal(targets.length, 2)
    assert.deepEqual(
      targets.map((t) => ({ repo: t.repo, number: t.number, url: t.url })),
      [
        {
          repo: "Kilo-Org/kilocode",
          number: 12249,
          url: "https://github.com/Kilo-Org/kilocode/pull/12249",
        },
        {
          repo: "Kilo-Org/kilocode",
          number: 12481,
          url: "https://github.com/Kilo-Org/kilocode/pull/12481",
        },
      ],
    )
  }

  {
    const narrative = "Revert the mistaken fix in #99999 because it broke streams.\n\nReverts #12249."
    const targets = parseRevertTargets(narrative, defaultRepo)
    assert.equal(targets.length, 1)
    assert.equal(targets[0].number, 12249)
    assert.ok(!targets.some((t) => t.number === 99999))
  }

  {
    const targets = parseRevertTargets("Reverts Kilo-Org/cloud#42.", defaultRepo)
    assert.equal(targets.length, 1)
    assert.equal(targets[0].repo, "Kilo-Org/cloud")
    assert.equal(targets[0].number, 42)
    assert.equal(targets[0].url, "https://github.com/Kilo-Org/cloud/pull/42")
  }

  {
    const targets = parseRevertTargets("Reverts #1, #2.", defaultRepo)
    assert.equal(targets.length, 2)
    assert.deepEqual(
      targets.map((t) => t.number),
      [1, 2],
    )
  }

  assert.deepEqual(parseRevertTargets("This reverts commit deadbeefcafe.", defaultRepo), [])
  assert.deepEqual(parseRevertTargets("This reverts #5.", defaultRepo), [])
  assert.deepEqual(parseRevertTargets("No revert trailer here at all.", defaultRepo), [])

  // bulleted / quoted single-line trailers
  {
    const targets = parseRevertTargets("- Reverts #7.", defaultRepo)
    assert.equal(targets.length, 1)
    assert.equal(targets[0].number, 7)
  }
  {
    const targets = parseRevertTargets("> Reverts #8.", defaultRepo)
    assert.equal(targets.length, 1)
    assert.equal(targets[0].number, 8)
  }
  // word-boundary: prose glued to "Reverts" is not a trailer
  assert.deepEqual(parseRevertTargets("Revertsomething #5", defaultRepo), [])

  // --- computeRevertAnnotations ---
  // Map keys are lowercased; lookups must use .toLowerCase()
  const fUrl = "https://github.com/Kilo-Org/kilocode/pull/100"
  const r1Url = "https://github.com/Kilo-Org/kilocode/pull/200"
  const r2Url = "https://github.com/Kilo-Org/kilocode/pull/300"
  const f2Url = "https://github.com/Kilo-Org/kilocode/pull/101"
  const mergedAt = "2026-07-20T12:00:00.000Z"
  const mergedAt2 = "2026-07-21T12:00:00.000Z"

  {
    const annotations = computeRevertAnnotations([
      {
        url: r1Url,
        merged_at: mergedAt,
        targets: [{ repo: "Kilo-Org/kilocode", number: 100, url: fUrl }],
      },
    ])
    assert.equal(annotations.size, 1)
    assert.deepEqual(annotations.get(fUrl.toLowerCase()), { url: r1Url, merged_at: mergedAt })
  }

  {
    // two-target signal (#12497-shaped)
    const annotations = computeRevertAnnotations([
      {
        url: r1Url,
        merged_at: mergedAt,
        targets: [
          { repo: "Kilo-Org/kilocode", number: 100, url: fUrl },
          { repo: "Kilo-Org/kilocode", number: 101, url: f2Url },
        ],
      },
    ])
    assert.equal(annotations.size, 2)
    assert.deepEqual(annotations.get(fUrl.toLowerCase()), { url: r1Url, merged_at: mergedAt })
    assert.deepEqual(annotations.get(f2Url.toLowerCase()), { url: r1Url, merged_at: mergedAt })
  }

  {
    // revert-of-revert: R1 reverts F, R2 reverts R1 → F not annotated; R1 gets R2
    const annotations = computeRevertAnnotations([
      {
        url: r1Url,
        merged_at: mergedAt,
        targets: [{ repo: "Kilo-Org/kilocode", number: 100, url: fUrl }],
      },
      {
        url: r2Url,
        merged_at: mergedAt2,
        targets: [{ repo: "Kilo-Org/kilocode", number: 200, url: r1Url }],
      },
    ])
    assert.equal(annotations.has(fUrl.toLowerCase()), false)
    assert.deepEqual(annotations.get(r1Url.toLowerCase()), { url: r2Url, merged_at: mergedAt2 })
  }

  {
    const annotations = computeRevertAnnotations([{ url: r1Url, merged_at: mergedAt, targets: [] }])
    assert.equal(annotations.size, 0)
  }

  // --- applyRevertAnnotations ---
  {
    const digest = [
      { url: fUrl, title: "feat F" },
      { url: "https://github.com/Kilo-Org/kilocode/pull/999", title: "untouched" },
    ]
    const applied = applyRevertAnnotations(digest, [
      {
        url: r1Url,
        merged_at: mergedAt,
        targets: [{ repo: "Kilo-Org/kilocode", number: 100, url: fUrl }],
      },
    ])
    assert.deepEqual(digest[0].reverted_by, { url: r1Url, merged_at: mergedAt })
    assert.equal(digest[1].reverted_by, undefined)
    assert.deepEqual(applied, [[fUrl, r1Url]])
  }

  {
    // end-to-end revert-of-revert: F must not gain reverted_by
    const digest = [{ url: fUrl, title: "feat F" }]
    const applied = applyRevertAnnotations(digest, [
      {
        url: r1Url,
        merged_at: mergedAt,
        targets: [{ repo: "Kilo-Org/kilocode", number: 100, url: fUrl }],
      },
      {
        url: r2Url,
        merged_at: mergedAt2,
        targets: [{ repo: "Kilo-Org/kilocode", number: 200, url: r1Url }],
      },
    ])
    assert.equal(digest[0].reverted_by, undefined)
    assert.deepEqual(applied, [])
  }

  {
    // case-insensitive url matching: lowercase signal target vs canonical digest entry
    const canonical = "https://github.com/Kilo-Org/kilocode/pull/12249"
    const lowerTarget = "https://github.com/kilo-org/kilocode/pull/12249"
    const reverter = "https://github.com/Kilo-Org/kilocode/pull/12497"
    const digest = [{ url: canonical, title: "feat stream" }]
    const applied = applyRevertAnnotations(digest, [
      {
        url: reverter,
        merged_at: mergedAt,
        targets: [{ repo: "kilo-org/kilocode", number: 12249, url: lowerTarget }],
      },
    ])
    assert.deepEqual(digest[0].reverted_by, { url: reverter, merged_at: mergedAt })
    assert.deepEqual(applied, [[canonical, reverter]])
  }

  // --- unannotatedRevertSignals ---
  {
    // partial coverage: F in-digest, G pre-window → only G missed; chains empty
    const sUrl = "https://github.com/Kilo-Org/kilocode/pull/500"
    const gUrl = "https://github.com/Kilo-Org/kilocode/pull/102"
    const signals = [
      {
        url: sUrl,
        merged_at: mergedAt,
        targets: [
          { repo: "Kilo-Org/kilocode", number: 100, url: fUrl },
          { repo: "Kilo-Org/kilocode", number: 102, url: gUrl },
        ],
      },
    ]
    const result = unannotatedRevertSignals(signals, [[fUrl, sUrl]])
    assert.deepEqual(result, { missed: [{ url: sUrl, targets: [gUrl] }], unparsed: [], chains: [] })
  }

  {
    // fully covered signal (no chain) → all three buckets empty
    const signals = [
      {
        url: r1Url,
        merged_at: mergedAt,
        targets: [
          { repo: "Kilo-Org/kilocode", number: 100, url: fUrl },
          { repo: "Kilo-Org/kilocode", number: 101, url: f2Url },
        ],
      },
    ]
    const result = unannotatedRevertSignals(signals, [
      [fUrl, r1Url],
      [f2Url, r1Url],
    ])
    assert.deepEqual(result, { missed: [], unparsed: [], chains: [] })
  }

  {
    // depth-2 chain (#4709/#4759): R1→F, R2→R1 — both in chains; F visible as R1 target
    const signals = [
      {
        url: r1Url,
        merged_at: mergedAt,
        targets: [{ repo: "Kilo-Org/kilocode", number: 100, url: fUrl }],
      },
      {
        url: r2Url,
        merged_at: mergedAt2,
        targets: [{ repo: "Kilo-Org/kilocode", number: 200, url: r1Url }],
      },
    ]
    const result = unannotatedRevertSignals(signals, [])
    assert.deepEqual(result, {
      missed: [],
      unparsed: [],
      chains: [
        { url: r1Url, targets: [fUrl] },
        { url: r2Url, targets: [r1Url] },
      ],
    })
  }

  {
    // depth-3 chain: R1→F, R2→R1, R3→R2 — all three in chains; missed/unparsed empty
    const r3Url = "https://github.com/Kilo-Org/kilocode/pull/301"
    const signals = [
      {
        url: r1Url,
        merged_at: mergedAt,
        targets: [{ repo: "Kilo-Org/kilocode", number: 100, url: fUrl }],
      },
      {
        url: r2Url,
        merged_at: mergedAt2,
        targets: [{ repo: "Kilo-Org/kilocode", number: 200, url: r1Url }],
      },
      {
        url: r3Url,
        merged_at: "2026-04-03T00:00:00Z",
        targets: [{ repo: "Kilo-Org/kilocode", number: 201, url: r2Url }],
      },
    ]
    const result = unannotatedRevertSignals(signals, [])
    assert.deepEqual(result, {
      missed: [],
      unparsed: [],
      chains: [
        { url: r1Url, targets: [fUrl] },
        { url: r2Url, targets: [r1Url] },
        { url: r3Url, targets: [r2Url] },
      ],
    })
  }

  {
    // mixed signal: M targets [R1, A, B]; A annotated, B missed; chains lists only R1
    const mUrl = "https://github.com/Kilo-Org/kilocode/pull/800"
    const aUrl = "https://github.com/Kilo-Org/kilocode/pull/801"
    const bUrl = "https://github.com/Kilo-Org/kilocode/pull/802"
    const signals = [
      {
        url: r1Url,
        merged_at: mergedAt,
        targets: [{ repo: "Kilo-Org/kilocode", number: 100, url: fUrl }],
      },
      {
        url: mUrl,
        merged_at: mergedAt2,
        targets: [
          { repo: "Kilo-Org/kilocode", number: 200, url: r1Url },
          { repo: "Kilo-Org/kilocode", number: 801, url: aUrl },
          { repo: "Kilo-Org/kilocode", number: 802, url: bUrl },
        ],
      },
    ]
    const result = unannotatedRevertSignals(signals, [[aUrl, mUrl]])
    assert.deepEqual(result, {
      missed: [{ url: mUrl, targets: [bUrl] }],
      unparsed: [],
      chains: [
        { url: r1Url, targets: [fUrl] },
        { url: mUrl, targets: [r1Url] },
      ],
    })
  }

  {
    // zero-target signal → unparsed, not missed; chains empty
    const emptyUrl = "https://github.com/Kilo-Org/kilocode/pull/400"
    const result = unannotatedRevertSignals([{ url: emptyUrl, merged_at: mergedAt, targets: [] }], [])
    assert.deepEqual(result, { missed: [], unparsed: [emptyUrl], chains: [] })
  }

  {
    // case-insensitivity: annotated set matches target urls differing only by case
    const signalUrl = "https://github.com/Kilo-Org/kilocode/pull/600"
    const targetMixed = "https://github.com/Kilo-Org/kilocode/pull/700"
    const targetLower = "https://github.com/kilo-org/kilocode/pull/700"
    const signals = [
      {
        url: signalUrl,
        merged_at: mergedAt,
        targets: [{ repo: "Kilo-Org/kilocode", number: 700, url: targetMixed }],
      },
    ]
    const result = unannotatedRevertSignals(signals, [[targetLower, signalUrl]])
    assert.deepEqual(result, { missed: [], unparsed: [], chains: [] })
  }

  {
    // live-window lock: #12497-shaped signal with both targets covered
    const s12497 = "https://github.com/Kilo-Org/kilocode/pull/12497"
    const t12249 = "https://github.com/Kilo-Org/kilocode/pull/12249"
    const t12481 = "https://github.com/Kilo-Org/kilocode/pull/12481"
    const signals = [
      {
        url: s12497,
        merged_at: mergedAt,
        targets: [
          { repo: "Kilo-Org/kilocode", number: 12249, url: t12249 },
          { repo: "Kilo-Org/kilocode", number: 12481, url: t12481 },
        ],
      },
    ]
    const result = unannotatedRevertSignals(signals, [
      [t12249, s12497],
      [t12481, s12497],
    ])
    assert.deepEqual(result, { missed: [], unparsed: [], chains: [] })
  }

  // --- source-order guards (case-5 style) ---
  {
    const collectSrc = fs.readFileSync(COLLECT_SCRIPT, "utf8")
    assert.ok(collectSrc.includes("./reverts.mjs"), "collect.mjs must import ./reverts.mjs")
    const kindIdx = collectSrc.indexOf("revertTitleKind(item.title")
    const dropIdx = collectSrc.indexOf("DROP_TITLE.test")
    assert.ok(kindIdx >= 0, "revertTitleKind(item.title call missing")
    assert.ok(dropIdx >= 0, "DROP_TITLE.test missing")
    assert.ok(kindIdx < dropIdx, "revert interception must run before DROP_TITLE")

    const applyIdx = collectSrc.indexOf("applyRevertAnnotations(digest")
    const fullIdx = collectSrc.indexOf("digest-full.json")
    assert.ok(applyIdx >= 0, "applyRevertAnnotations(digest call missing")
    assert.ok(fullIdx >= 0, "digest-full.json write missing")
    assert.ok(applyIdx < fullIdx, "annotations must be applied before digests are written")

    assert.ok(
      collectSrc.includes('if (revertTitleKind(item.title ?? "")) {'),
      'collect must use exact intercept line if (revertTitleKind(item.title ?? "")) {',
    )
  }

  // --- prompt-text guards ---
  {
    const triagePrompt = fs.readFileSync(path.join(HERE, "triage-prompt.md"), "utf8")
    assert.ok(triagePrompt.includes("reverted_by"), "triage-prompt must mention reverted_by")
    assert.ok(triagePrompt.includes("stream-liveness"), "triage-prompt must mention stream-liveness")
    assert.ok(
      triagePrompt.includes("reverted by https://github.com/Kilo-Org/kilocode/pull/12497"),
      "triage-prompt must contain exact cite example",
    )

    const editPrompt = fs.readFileSync(path.join(HERE, "edit-prompt.md"), "utf8")
    assert.ok(editPrompt.includes("reverted_by"), "edit-prompt must mention reverted_by")
    assert.ok(editPrompt.includes("current source tree"), "edit-prompt must mention current source tree")
    assert.ok(editPrompt.includes("Skipping is a normal outcome"), "edit-prompt must mention skipping outcome")
    assert.ok(editPrompt.includes("Existence alone is not enough"), "edit-prompt must mention existence guard")
  }
}

// ---------------------------------------------------------------------------
// Case 10 — learnings extraction, validation, injection, upsert safety
// ---------------------------------------------------------------------------
function case10_learnings() {
  console.log("case 10: learnings")

  // --- helpers for extraction runs ---
  function writeFixture(cwd, data) {
    const f = path.join(cwd, "fixture.json")
    fs.writeFileSync(f, JSON.stringify(data, null, 2))
    return f
  }

  function writeExtractionDelta(cwd, delta) {
    fs.mkdirSync(path.join(cwd, "docs-sync-out"), { recursive: true })
    fs.writeFileSync(path.join(cwd, "docs-sync-out", "extraction-delta.json"), JSON.stringify(delta, null, 2))
  }

  // Prepare a git repo for learn.mjs tests: set origin refs, create docs-sync-out.
  function setupLearnRepo(dir) {
    fs.mkdirSync(path.join(dir, "docs-sync-out"), { recursive: true })
    gitIn(dir, ["update-ref", "refs/remotes/origin/main", "main"])
    gitIn(dir, ["update-ref", "refs/remotes/origin/docs/auto-sync", "docs/auto-sync"])
    return dir
  }

  const githubBotEmail = "41898282+github-actions[bot]@users.noreply.github.com"
  const kiloconnectBotEmail = "240665456+kiloconnect[bot]@users.noreply.github.com"

  // 10a — three commit classes
  {
    console.log("  10a — three commit classes")
    const dir = mktemp("docs-sync-learn-a-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
    gitIn(dir, ["add", "base.txt"])
    gitIn(dir, ["commit", "-m", "base"])

    // Branch
    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])
    // 1. kiloconnect[bot] commit that touches packages/kilo-docs/pages/x.md
    gitIn(dir, ["config", "user.email", kiloconnectBotEmail])
    fs.mkdirSync(path.join(dir, "packages", "kilo-docs", "pages"), { recursive: true })
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "x.md"), "# x\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/x.md"])
    gitIn(dir, ["commit", "-m", "docs: add x page"])
    const kiloconnectSha = gitIn(dir, ["rev-parse", "HEAD"])
    // 2. github-actions[bot] commit
    gitIn(dir, ["config", "user.email", githubBotEmail])
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "y.md"), "# y\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/y.md"])
    gitIn(dir, ["commit", "-m", "docs: add y page"])
    // 3. Merge commit (non-merge filter)
    gitIn(dir, ["config", "user.email", "someone@example.com"])
    gitIn(dir, ["checkout", "-b", "tmp-merge"])
    fs.writeFileSync(path.join(dir, "z.txt"), "z\n")
    gitIn(dir, ["add", "z.txt"])
    gitIn(dir, ["commit", "-m", "tmp"])
    gitIn(dir, ["checkout", "docs/auto-sync"])
    gitIn(dir, ["merge", "--no-ff", "tmp-merge", "-m", "merge tmp"])
    // 4. commit reachable from main
    gitIn(dir, ["checkout", "main"])
    fs.writeFileSync(path.join(dir, "main-only.txt"), "main only\n")
    gitIn(dir, ["add", "main-only.txt"])
    gitIn(dir, ["commit", "-m", "main only"])

    gitIn(dir, ["checkout", "docs/auto-sync"])
    const tip = gitIn(dir, ["rev-parse", "HEAD"])

    // Setup origin refs (needed by learn.mjs git commands)
    const cwd = setupLearnRepo(dir)

    const fixturePath = writeFixture(dir, {
      pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
      comments: [],
    })

    const callLog = path.join(dir, "kilo-calls.log")
    const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog })
    writeExtractionDelta(dir, { add: [], remove: [] })

    const result = runNodeScript(LEARN_SCRIPT, {
      cwd: dir,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_FIXTURE: fixturePath,
        LEARNINGS_BUDGET_MINUTES: "1",
        DOCS_SYNC_BACKOFF_MS: "0",
      },
    })

    // Assert: input file written, exactly one correction — kiloconnect only.
    // github-actions[bot] commit excluded (criterion 5), merge commit excluded
    // via --no-merges, main-reachable commit excluded by origin/main range (criterion 6).
    const inputFile = path.join(dir, "docs-sync-out", "learnings-input.json")
    assert.ok(fs.existsSync(inputFile), `expected ${inputFile}`)
    const input = JSON.parse(fs.readFileSync(inputFile, "utf8"))
    assert.equal(input.corrections.length, 1, "exactly one correction (kiloconnect commit)")
    assert.equal(
      input.corrections[0].source,
      `commit:${kiloconnectSha.slice(0, 7)}`,
      "correction must be kiloconnect commit only",
    )
  }

  // 10rz — timestamp correlation with different timezone offsets
  // A comment must map to the chronologically earliest eligible commit even when
  // timestamps use different timezone offsets (Z vs +05:00).
  {
    console.log("  10rz — timestamp correlation")
    const dir = mktemp("docs-sync-learn-rz-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
    gitIn(dir, ["add", "base.txt"])
    gitIn(dir, ["commit", "-m", "base"])

    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])

    // Commit A: non-UTC offset, chronologically earliest (UTC 08:00)
    // iso = 2026-08-03T13:00:00+05:00
    fs.mkdirSync(path.join(dir, "packages", "kilo-docs", "pages"), { recursive: true })
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "x.md"), "# x\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/x.md"])
    gitIn(dir, ["commit", "-m", "first edit x", "--author", `kiloconnect[bot] <${kiloconnectBotEmail}>`], {
      GIT_COMMITTER_DATE: "2026-08-03T13:00:00+05:00",
    })
    const shaA = gitIn(dir, ["rev-parse", "HEAD"])

    // Commit B: UTC offset, chronologically later (UTC 09:00)
    // iso = 2026-08-03T09:00:00Z — string comparison would pick this as "earlier" (09 < 13)
    // but chronologically A is earlier (08:00 < 09:00)
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "x.md"), "# x\n## edit\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/x.md"])
    gitIn(dir, ["commit", "-m", "second edit x", "--author", `kiloconnect[bot] <${kiloconnectBotEmail}>`], {
      GIT_COMMITTER_DATE: "2026-08-03T09:00:00Z",
    })
    const shaB = gitIn(dir, ["rev-parse", "HEAD"])

    // Seed LEARNINGS.md so existing entries are non-empty but irrelevant
    const existing = [
      { id: "pre", rule: "Pre-existing rule.", scope: "both", source: "commit:0000000", date: "2026-01-01" },
    ]
    const learningsPath = path.join(dir, "packages", "kilo-docs", "LEARNINGS.md")
    fs.mkdirSync(path.dirname(learningsPath), { recursive: true })
    fs.writeFileSync(learningsPath, renderLearnings(existing))
    gitIn(dir, ["add", "packages/kilo-docs/LEARNINGS.md"])
    gitIn(dir, ["commit", "-m", "seed learnings", "--author", `kiloconnect[bot] <${kiloconnectBotEmail}>`])

    const cwd = setupLearnRepo(dir)

    // Comment at UTC 05:30 on x.md — before both commits chronologically.
    // 05:30 < 08:00 (A) and 05:30 < 09:00 (B) → both eligible
    // The chronologically earliest eligible commit is A (08:00).
    const fixturePath = writeFixture(cwd, {
      pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
      comments: [
        {
          id: 101,
          created_at: "2026-08-03T05:30:00Z",
          path: "packages/kilo-docs/pages/x.md",
          body: "Please fix the docs.",
          author_association: "MEMBER",
          user: { login: "maintainer" },
        },
      ],
    })

    const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog: path.join(cwd, "kilo-calls.log") })
    writeExtractionDelta(cwd, { add: [], remove: [] })

    const result = runNodeScript(LEARN_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_FIXTURE: fixturePath,
        LEARNINGS_BUDGET_MINUTES: "1",
        DOCS_SYNC_BACKOFF_MS: "0",
      },
    })

    // Read learnings-input.json to inspect the correlation result
    const inputFile = path.join(cwd, "docs-sync-out", "learnings-input.json")
    assert.ok(fs.existsSync(inputFile), "learnings-input.json must exist")
    const input = JSON.parse(fs.readFileSync(inputFile, "utf8"))

    // Both commits must appear as corrections
    const commitA = input.corrections.find((c) => c.source === `commit:${shaA.slice(0, 7)}`)
    const commitB = input.corrections.find((c) => c.source === `commit:${shaB.slice(0, 7)}`)
    assert.ok(commitA, "commit A must be in corrections")
    assert.ok(commitB, "commit B must be in corrections")

    // Comment must be associated with commit A (chronologically earliest)
    assert.ok(commitA.comment, "commit A must have the comment associated")
    assert.equal(commitA.comment.path, "packages/kilo-docs/pages/x.md")
    assert.equal(commitB.comment, undefined, "commit B must not have the comment associated")

    // No standalone comment candidate — the comment was correlated, not orphaned
    const standalone = input.corrections.filter((c) => c.source && c.source.startsWith("comment:"))
    assert.equal(standalone.length, 0, "comment must be associated, not standalone")
  }

  // 10b — watermark suppression (no model call when marker covers all)
  {
    console.log("  10b — watermark suppression")
    const dir = mktemp("docs-sync-learn-b-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
    gitIn(dir, ["add", "base.txt"])
    gitIn(dir, ["commit", "-m", "base"])

    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])
    // corrective commit
    fs.mkdirSync(path.join(dir, "packages", "kilo-docs", "pages"), { recursive: true })
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "x.md"), "# x\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/x.md"])
    gitIn(dir, ["commit", "-m", "docs update", "--author", `kiloconnect[bot] <${kiloconnectBotEmail}>`])

    // Write LEARNINGS.md on the branch first, so the marker can point to the tip after it
    const existing = [
      { id: "test", rule: "existing rule", scope: "both", source: "commit:0000000", date: "2026-01-01" },
    ]
    const learningsPath = path.join(dir, "packages", "kilo-docs", "LEARNINGS.md")
    const learningsContent = renderLearnings(existing)
    fs.mkdirSync(path.dirname(learningsPath), { recursive: true })
    fs.writeFileSync(learningsPath, learningsContent)
    gitIn(dir, ["add", "packages/kilo-docs/LEARNINGS.md"])
    gitIn(dir, ["commit", "-m", "seed learnings"])

    const tip = gitIn(dir, ["rev-parse", "HEAD"])
    const tipDate = new Date().toISOString()

    const cwd = setupLearnRepo(dir)
    const body = `<!-- docs-sync: learned-through commit=${tip} comment=${tipDate} -->`
    const fixturePath = writeFixture(cwd, {
      pr: { number: 1, head: { ref: "docs/auto-sync" }, body, user: { login: "github-actions[bot]" } },
      comments: [],
    })

    const callLog = path.join(cwd, "kilo-calls.log")
    const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog })
    writeExtractionDelta(cwd, { add: [], remove: [] })

    fs.writeFileSync(path.join(cwd, "docs-sync-out", "learnings.json"), JSON.stringify(existing, null, 2))

    const result = runNodeScript(LEARN_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_FIXTURE: fixturePath,
        LEARNINGS_BUDGET_MINUTES: "1",
        DOCS_SYNC_BACKOFF_MS: "0",
      },
    })

    // Assert: stub never invoked, learnings.json unchanged, no model call
    const calls = fs.existsSync(callLog) ? fs.readFileSync(callLog, "utf8").trim() : ""
    assert.equal(calls, "", `kilo must not be invoked when marker covers all; got ${calls}`)
    const out = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "learnings.json"), "utf8"))
    assert.deepEqual(out, existing, "learnings.json must equal existing entries")

    // Run apply and prove LEARNINGS.md is byte-unchanged
    const lp = path.join(cwd, "packages", "kilo-docs", "LEARNINGS.md")
    const before = fs.readFileSync(lp, "utf8")
    runNodeScript(LEARN_SCRIPT, {
      cwd,
      kiloDir,
      args: ["--apply"],
      env: { DOCS_SYNC_BACKOFF_MS: "0" },
    })
    const after = fs.readFileSync(lp, "utf8")
    assert.equal(after, before, "LEARNINGS.md must be byte-unchanged after apply")
  }

  // 10c — rerun idempotency
  {
    console.log("  10c — rerun idempotency")
    const dir = mktemp("docs-sync-learn-c-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
    gitIn(dir, ["add", "base.txt"])
    gitIn(dir, ["commit", "-m", "base"])

    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])
    fs.mkdirSync(path.join(dir, "packages", "kilo-docs", "pages"), { recursive: true })
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "x.md"), "# x\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/x.md"])
    gitIn(dir, ["commit", "-m", "docs update", "--author", `kiloconnect[bot] <${kiloconnectBotEmail}>`])
    let tip = gitIn(dir, ["rev-parse", "HEAD"])

    const add = [
      {
        id: "new-rule",
        rule: "A new rule from testing.",
        scope: "both",
        source: `commit:${tip.slice(0, 7)}`,
        date: "2026-08-03",
      },
    ]
    let firstLEARNINGS

    // First run
    {
      const cwd = setupLearnRepo(dir)
      const fixturePath = writeFixture(cwd, {
        pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
        comments: [],
      })
      const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog: path.join(cwd, "kilo-calls.log") })
      writeExtractionDelta(cwd, { add, remove: [] })
      const result = runNodeScript(LEARN_SCRIPT, {
        cwd,
        kiloDir,
        env: {
          TRIAGE_MODEL: "test/model",
          DOCS_SYNC_FIXTURE: fixturePath,
          LEARNINGS_BUDGET_MINUTES: "1",
          DOCS_SYNC_BACKOFF_MS: "0",
        },
      })
      const out1 = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "learnings.json"), "utf8"))
      assert.equal(out1.length, 1)
      assert.equal(out1[0].id, "new-rule")
      // Write LEARNINGS.md on the branch so second run sees existing entries
      const learningsPath = path.join(dir, "packages", "kilo-docs", "LEARNINGS.md")
      fs.mkdirSync(path.dirname(learningsPath), { recursive: true })
      fs.writeFileSync(learningsPath, renderLearnings(out1))
      gitIn(dir, ["add", "packages/kilo-docs/LEARNINGS.md"])
      gitIn(dir, ["commit", "-m", "seed learnings"])
      tip = gitIn(dir, ["rev-parse", "HEAD"])
      firstLEARNINGS = fs.readFileSync(path.join(dir, "packages", "kilo-docs", "LEARNINGS.md"), "utf8")
    }

    // Second run with marker covering first run's result
    {
      const cwd = setupLearnRepo(dir)
      const body = `<!-- docs-sync: learned-through commit=${tip} comment=2026-08-03T12:00:00Z -->`
      const fixturePath = writeFixture(cwd, {
        pr: { number: 1, head: { ref: "docs/auto-sync" }, body, user: { login: "github-actions[bot]" } },
        comments: [],
      })
      const callLog2 = path.join(cwd, "kilo-calls-run2.log")
      const kiloDir2 = makeStubKiloDir({ mode: "extraction-delta", callLog: callLog2 })
      writeExtractionDelta(cwd, { add, remove: [] })
      const result = runNodeScript(LEARN_SCRIPT, {
        cwd,
        kiloDir: kiloDir2,
        env: {
          TRIAGE_MODEL: "test/model",
          DOCS_SYNC_FIXTURE: fixturePath,
          LEARNINGS_BUDGET_MINUTES: "1",
          DOCS_SYNC_BACKOFF_MS: "0",
        },
      })
      const calls2 = fs.existsSync(callLog2) ? fs.readFileSync(callLog2, "utf8").trim() : ""
      assert.equal(calls2, "", "second run must not invoke kilo")
      const out2 = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "learnings.json"), "utf8"))
      assert.equal(out2.length, 1)
      assert.equal(out2[0].id, "new-rule")
      // Run apply and prove LEARNINGS.md is byte-identical after idempotent rerun
      runNodeScript(LEARN_SCRIPT, {
        cwd,
        kiloDir: kiloDir2,
        args: ["--apply"],
        env: { DOCS_SYNC_BACKOFF_MS: "0" },
      })
      const afterApply = fs.readFileSync(path.join(dir, "packages", "kilo-docs", "LEARNINGS.md"), "utf8")
      assert.equal(afterApply.length, firstLEARNINGS.length, "LEARNINGS.md must be same length after apply")
      assert.equal(afterApply, firstLEARNINGS, "LEARNINGS.md must be byte-identical after apply")
    }
  }

  // 10d — contradiction replacement (applyDelta)
  {
    console.log("  10d — contradiction replacement")
    const old = [
      { id: "old-rule", rule: "Old rule text.", scope: "both", source: "commit:aaaaaaa", date: "2026-01-01" },
    ]
    const add = [
      { id: "new-rule", rule: "New rule text.", scope: "both", source: "commit:bbbbbbb", date: "2026-02-01" },
    ]
    const delta = { add, remove: ["old-rule"] }
    const result = applyDelta(old, delta)
    assert.equal(result.length, 1)
    assert.equal(result[0].id, "new-rule")
    // Third delta touching neither does not bring old back
    const again = applyDelta(result, { add: [], remove: [] })
    assert.equal(again.length, 1)
    assert.equal(again[0].id, "new-rule")
  }

  // 10e — prompt injection (triage/edit argv carry tagged rules)
  {
    console.log("  10e — prompt injection")
    const dir = mktemp("docs-sync-learn-e-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
    gitIn(dir, ["add", "base.txt"])
    gitIn(dir, ["commit", "-m", "base"])
    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])
    // Add a corrective commit so extraction has a candidate
    fs.mkdirSync(path.join(dir, "packages", "kilo-docs", "pages"), { recursive: true })
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "x.md"), "# x\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/x.md"])
    gitIn(dir, ["commit", "-m", "docs update", "--author", `kiloconnect[bot] <${kiloconnectBotEmail}>`])
    const commitSha = gitIn(dir, ["rev-parse", "HEAD"])

    const cwd = setupLearnRepo(dir)
    const fixturePath = writeFixture(cwd, {
      pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
      comments: [],
    })
    const callLog = path.join(cwd, "kilo-calls.log")
    const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog })
    // Three entries: triage, edit, both — all from the same candidate source
    const src = `commit:${commitSha.slice(0, 7)}`
    writeExtractionDelta(cwd, {
      add: [
        { id: "triage-rule", rule: "Triage-only rule text.", scope: "triage", source: src, date: "2026-08-01" },
        { id: "edit-rule", rule: "Edit-only rule text.", scope: "edit", source: src, date: "2026-08-02" },
        { id: "both-rule", rule: "Both scope rule text.", scope: "both", source: src, date: "2026-08-03" },
      ],
      remove: [],
    })

    // Run extraction so it writes learnings-<scope>.md blocks (extraction step 13).
    // Only extraction writes these files; --apply writes only LEARNINGS.md.
    runNodeScript(LEARN_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_FIXTURE: fixturePath,
        LEARNINGS_BUDGET_MINUTES: "1",
        DOCS_SYNC_BACKOFF_MS: "0",
      },
    })

    const triageBlockPath = path.join(cwd, "docs-sync-out", "learnings-triage.md")
    const editBlockPath = path.join(cwd, "docs-sync-out", "learnings-edit.md")
    assert.ok(fs.existsSync(triageBlockPath), "learnings-triage.md must exist")
    assert.ok(fs.existsSync(editBlockPath), "learnings-edit.md must exist")

    // Run triage.mjs against a recording stub. Copy the learnings block into
    // its cwd so readLearningsBlock picks it up.
    {
      const triageCwd = setupTriageCwd([samplePr(1)])
      fs.copyFileSync(triageBlockPath, path.join(triageCwd, "docs-sync-out", "learnings-triage.md"))
      const triageCallLog = path.join(triageCwd, "triage-calls.log")
      const triageKiloDir = makeStubKiloDir({ mode: "record", callLog: triageCallLog })
      runNodeScript(TRIAGE_SCRIPT, {
        cwd: triageCwd,
        kiloDir: triageKiloDir,
        env: { TRIAGE_MODEL: "test/model", DOCS_SYNC_BACKOFF_MS: "0" },
      })
      const logText = fs.readFileSync(triageCallLog, "utf8")
      assert.ok(logText.includes("Triage-only rule text"), "triage argv must contain triage rule")
      assert.ok(logText.includes("Both scope rule text"), "triage argv must contain both rule")
      assert.ok(!logText.includes("Edit-only rule text"), "triage argv must not contain edit-only rule")
    }

    // Run edit.mjs against a recording stub.
    {
      const triageEntry = {
        pr: 1,
        url: "https://github.com/Kilo-Org/cloud/pull/1",
        docs_worthy: true,
        reason: "needs docs",
        target_sections: [],
        priority: "medium",
      }
      const editCwd = setupEditCwd([samplePr(1)], [triageEntry])
      fs.copyFileSync(editBlockPath, path.join(editCwd, "docs-sync-out", "learnings-edit.md"))
      const editCallLog = path.join(editCwd, "edit-calls.log")
      const editKiloDir = makeStubKiloDir({ mode: "record", callLog: editCallLog })
      runNodeScript(EDIT_SCRIPT, {
        cwd: editCwd,
        kiloDir: editKiloDir,
        env: { EDIT_MODEL: "test/model", DOCS_SYNC_BACKOFF_MS: "0" },
      })
      const logText = fs.readFileSync(editCallLog, "utf8")
      assert.ok(logText.includes("Edit-only rule text"), "edit argv must contain edit rule")
      assert.ok(logText.includes("Both scope rule text"), "edit argv must contain both rule")
      assert.ok(!logText.includes("Triage-only rule text"), "edit argv must not contain triage-only rule")
    }
  }

  // 10f — failure path
  {
    console.log("  10f — failure path")
    const dir = mktemp("docs-sync-learn-f-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
    gitIn(dir, ["add", "base.txt"])
    gitIn(dir, ["commit", "-m", "base"])
    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])
    fs.mkdirSync(path.join(dir, "packages", "kilo-docs", "pages"), { recursive: true })
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "x.md"), "# x\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/x.md"])
    gitIn(dir, ["commit", "-m", "docs update", "--author", `kiloconnect[bot] <${kiloconnectBotEmail}>`])

    const existing = [
      { id: "test", rule: "existing rule", scope: "both", source: "commit:0000000", date: "2026-01-01" },
    ]
    // Write LEARNINGS.md on the branch so learn.mjs reads it as existing entries
    const learningsPath = path.join(dir, "packages", "kilo-docs", "LEARNINGS.md")
    fs.mkdirSync(path.dirname(learningsPath), { recursive: true })
    fs.writeFileSync(learningsPath, renderLearnings(existing))
    gitIn(dir, ["add", "packages/kilo-docs/LEARNINGS.md"])
    gitIn(dir, ["commit", "-m", "seed learnings"])

    const cwd = setupLearnRepo(dir)
    const fixturePath = writeFixture(cwd, {
      pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
      comments: [],
    })

    // Stub exits 0 with garbage stdout (stderr-exit0 mode)
    const stderrText = "some fake error stream"
    const kiloDir = makeStubKiloDir({ mode: "stderr-exit0", stderrText })

    const outputFile = path.join(cwd, "gh-output-f")
    const result = runNodeScript(LEARN_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_FIXTURE: fixturePath,
        LEARNINGS_BUDGET_MINUTES: "1",
        DOCS_SYNC_BACKOFF_MS: "0",
        GITHUB_OUTPUT: outputFile,
      },
    })

    assert.equal(result.status, 0, "learn.mjs must exit 0 on failure")
    const out = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "learnings.json"), "utf8"))
    assert.deepEqual(out, existing, "learnings.json must equal existing entries on failure")
    // No marker PATCH file
    assert.ok(!fs.existsSync(`${fixturePath}.patched`), "no marker PATCH on failure")
    // No learned_through output
    if (fs.existsSync(outputFile)) {
      const ghOut = fs.readFileSync(outputFile, "utf8")
      assert.ok(!ghOut.includes("learned_through="), "GITHUB_OUTPUT must not contain learned_through on failure")
    }

    // Run apply and prove LEARNINGS.md is byte-unchanged
    const lp = path.join(cwd, "packages", "kilo-docs", "LEARNINGS.md")
    const before = fs.readFileSync(lp, "utf8")
    runNodeScript(LEARN_SCRIPT, {
      cwd,
      kiloDir,
      args: ["--apply"],
      env: { DOCS_SYNC_BACKOFF_MS: "0" },
    })
    const after = fs.readFileSync(lp, "utf8")
    assert.equal(after, before, "LEARNINGS.md must be byte-unchanged after apply on failure")
  }

  // 10g — general-rule check (validateDelta rejections)
  {
    console.log("  10g — general-rule check")
    const existing = []
    const sources = ["commit:aaaaaaa"]
    const entryWithPR = {
      id: "bad-pr",
      rule: "See #12716 for details",
      scope: "both",
      source: "commit:aaaaaaa",
      date: "2026-08-03",
    }
    const entryWithURL = {
      id: "bad-url",
      rule: "Check https://example.com",
      scope: "both",
      source: "commit:aaaaaaa",
      date: "2026-08-03",
    }
    const entryWithPerson = {
      id: "bad-person",
      rule: "Ask @emilieschario",
      scope: "both",
      source: "commit:aaaaaaa",
      date: "2026-08-03",
    }
    const entryWithPage = {
      id: "bad-page",
      rule: "Edit packages/kilo-docs/pages/x.md",
      scope: "both",
      source: "commit:aaaaaaa",
      date: "2026-08-03",
    }
    const entryBadSource = {
      id: "bad-source",
      rule: "A valid sentence.",
      scope: "both",
      source: "invented",
      date: "2026-08-03",
    }
    const entryBadScope = {
      id: "bad-scope",
      rule: "A valid sentence.",
      scope: "wrong",
      source: "commit:aaaaaaa",
      date: "2026-08-03",
    }
    const entryCollide = {
      id: "existing-id",
      rule: "A valid sentence.",
      scope: "both",
      source: "commit:aaaaaaa",
      date: "2026-08-03",
    }
    const entryBadDate = {
      id: "bad-date",
      rule: "A valid sentence.",
      scope: "both",
      source: "commit:aaaaaaa",
      date: "not-a-date",
    }
    const entryRemoveUnknown = {
      id: "valid",
      rule: "A valid sentence.",
      scope: "both",
      source: "commit:aaaaaaa",
      date: "2026-08-03",
    }

    const existingWithId = [
      { id: "existing-id", rule: "Existing rule.", scope: "both", source: "commit:aaaaaaa", date: "2026-01-01" },
    ]

    // PR number
    {
      const { rejected } = validateDelta(
        { add: [entryWithPR], remove: [] },
        { existing, candidateSources: sources, deletedInWindow: [] },
      )
      assert.equal(rejected.length, 1, "PR number must be rejected")
      assert.ok(rejected[0].reason, "rejection must carry a reason")
    }

    // URL — docs-check-links.yml link-checks LEARNINGS.md with fail:true, so
    // a URL in a rule would break CI on every bot commit.
    {
      const { rejected } = validateDelta(
        { add: [entryWithURL], remove: [] },
        { existing, candidateSources: sources, deletedInWindow: [] },
      )
      assert.equal(rejected.length, 1, "URL must be rejected")
    }

    // Person
    {
      const { rejected } = validateDelta(
        { add: [entryWithPerson], remove: [] },
        { existing, candidateSources: sources, deletedInWindow: [] },
      )
      assert.equal(rejected.length, 1, "person reference must be rejected")
    }

    // Docs page
    {
      const { rejected } = validateDelta(
        { add: [entryWithPage], remove: [] },
        { existing, candidateSources: sources, deletedInWindow: [] },
      )
      assert.equal(rejected.length, 1, "docs page reference must be rejected")
    }

    // Bad source
    {
      const { rejected } = validateDelta(
        { add: [entryBadSource], remove: [] },
        { existing, candidateSources: sources, deletedInWindow: [] },
      )
      assert.equal(rejected.length, 1, "invented source must be rejected")
    }

    // Bad scope
    {
      const { rejected } = validateDelta(
        { add: [entryBadScope], remove: [] },
        { existing, candidateSources: sources, deletedInWindow: [] },
      )
      assert.equal(rejected.length, 1, "bad scope must be rejected")
    }

    // Colliding id
    {
      const { rejected } = validateDelta(
        { add: [entryCollide], remove: [] },
        { existing: existingWithId, candidateSources: sources, deletedInWindow: [] },
      )
      assert.equal(rejected.length, 1, "colliding id must be rejected")
    }

    // Remove unknown id
    {
      const { rejected } = validateDelta(
        { add: [entryRemoveUnknown], remove: ["unknown-id"] },
        { existing, candidateSources: sources, deletedInWindow: [] },
      )
      assert.equal(rejected.length, 1, "remove of unknown id must be rejected")
    }

    // Bad date
    {
      const { rejected } = validateDelta(
        { add: [entryBadDate], remove: [] },
        { existing, candidateSources: sources, deletedInWindow: [] },
      )
      assert.equal(rejected.length, 1, "bad date must be rejected")
    }
  }

  // 10h — comment trust (isTrustedComment)
  {
    console.log("  10h — comment trust")
    assert.equal(isTrustedComment({ author_association: "OWNER", user: { login: "owner-user" } }), true)
    assert.equal(isTrustedComment({ author_association: "MEMBER", user: { login: "emilieschario" } }), true)
    assert.equal(isTrustedComment({ author_association: "COLLABORATOR", user: { login: "collab-user" } }), true)
    assert.equal(isTrustedComment({ author_association: "CONTRIBUTOR", user: { login: "kilo-code-bot[bot]" } }), false)
    assert.equal(isTrustedComment({ author_association: "NONE", user: { login: "rando" } }), false)
    // MEMBER whose login ends in [bot]
    assert.equal(isTrustedComment({ author_association: "MEMBER", user: { login: "some-bot[bot]" } }), false)
  }

  // 10i — draft gate (nonContentFiles)
  {
    console.log("  10i — draft gate")
    const files = ["packages/kilo-docs/LEARNINGS.md", "packages/kilo-docs/pages/a.md"]
    const result = nonContentFiles(files)
    assert.equal(result.length, 0, "LEARNINGS.md and pages must not trigger the draft gate")
    // Still flags non-content
    const withConfig = ["packages/kilo-docs/next.config.js"]
    const flagged = nonContentFiles(withConfig)
    assert.equal(flagged.length, 1, "next.config.js must still trigger the gate")
    assert.equal(flagged[0], "packages/kilo-docs/next.config.js")
  }

  // 10j — no --auto on extraction call
  {
    console.log("  10j — no --auto on extraction call")
    const src = fs.readFileSync(LEARN_SCRIPT, "utf8")

    // Find the extraction-mode runKilo args array
    const argsStart = src.indexOf("runKilo({")
    assert.ok(argsStart >= 0, "runKilo call must exist in learn.mjs")
    const argsBlock = src.slice(argsStart, src.indexOf("})", argsStart) + 2)
    assert.ok(!argsBlock.includes("--auto"), "extraction runKilo must not include --auto")
    assert.ok(argsBlock.includes("-f"), "extraction runKilo must include -f")
  }

  // 10k — hand-mangled file (parseLearnings)
  {
    console.log("  10k — hand-mangled file")
    const text = `# header
<!-- docs-sync:learnings:start -->
- Valid rule. <!-- id=valid-rule scope=both source=commit:aaaaaaa date=2026-08-03 -->
- Broken meta. <!-- id=broken-rule scope=not-a-scope source=bad date=bad -->
Just prose, not a rule line.
<!-- docs-sync:learnings:end -->`
    const entries = parseLearnings(text)
    assert.equal(entries.length, 1, "only valid entry must parse")
    assert.equal(entries[0].id, "valid-rule")
  }

  // 10l — first-run fallback (main when branch has none)
  // Prove the git commands learn.mjs relies on: when the branch file is absent,
  // git show origin/<branch>:packages/kilo-docs/LEARNINGS.md fails, and
  // git show origin/main:packages/kilo-docs/LEARNINGS.md returns the main's entries.
  {
    console.log("  10l — empty file fallback")
    const dir = mktemp("docs-sync-learn-l-")
    initRepoWithIdentity(dir)

    // Write LEARNINGS.md on main
    const entries = [
      { id: "test", rule: "Test rule text.", scope: "both", source: "commit:aaaaaaa", date: "2026-01-01" },
    ]
    const lp = path.join(dir, "packages", "kilo-docs", "LEARNINGS.md")
    fs.mkdirSync(path.dirname(lp), { recursive: true })
    fs.writeFileSync(lp, renderLearnings(entries))
    gitIn(dir, ["add", "packages/kilo-docs/LEARNINGS.md"])
    gitIn(dir, ["commit", "-m", "main learnings"])

    // Branch from main, then remove LEARNINGS.md
    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])
    fs.rmSync(lp)
    gitIn(dir, ["add", "packages/kilo-docs/LEARNINGS.md"])
    gitIn(dir, ["commit", "-m", "remove learnings on branch"])

    // Set up origin refs so git show origin/<ref> resolves
    setupLearnRepo(dir)

    // git show on branch must fail — file absent at that ref
    let branchFailed = false
    try {
      gitIn(dir, ["show", "origin/docs/auto-sync:packages/kilo-docs/LEARNINGS.md"])
    } catch {
      branchFailed = true
    }
    assert.ok(branchFailed, "git show on branch must fail when LEARNINGS.md absent")

    // git show on main must succeed with the main's entries
    const mainContent = gitIn(dir, ["show", "origin/main:packages/kilo-docs/LEARNINGS.md"])
    const parsed = parseLearnings(mainContent)
    assert.equal(parsed.length, 1, "main fallback must return the main's entries")
    assert.equal(parsed[0].id, "test")

    // Also verify: empty parse and render (unit coverage of the empty case)
    const empty = parseLearnings("")
    assert.equal(empty.length, 0)
    assert.deepEqual(empty, [])
    const rendered = renderLearnings([])
    assert.ok(rendered.includes("<!-- docs-sync:learnings:start -->"))
    assert.ok(rendered.includes("<!-- docs-sync:learnings:end -->"))
  }

  // 10m — empty delta advances marker with no file change
  {
    console.log("  10m — empty delta marker advance")
    const dir = mktemp("docs-sync-learn-m-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
    gitIn(dir, ["add", "base.txt"])
    gitIn(dir, ["commit", "-m", "base"])
    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])
    fs.mkdirSync(path.join(dir, "packages", "kilo-docs", "pages"), { recursive: true })
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "x.md"), "# x\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/x.md"])
    gitIn(dir, ["commit", "-m", "docs update", "--author", `kiloconnect[bot] <${kiloconnectBotEmail}>`])
    const tip = gitIn(dir, ["rev-parse", "HEAD"])

    const cwd = setupLearnRepo(dir)
    const fixturePath = writeFixture(cwd, {
      pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
      comments: [],
    })

    const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog: path.join(cwd, "kilo-calls.log") })
    writeExtractionDelta(cwd, { add: [], remove: [] })

    const existing = []
    fs.writeFileSync(path.join(cwd, "docs-sync-out", "learnings.json"), JSON.stringify(existing, null, 2))
    const learningsPath = path.join(cwd, "packages", "kilo-docs", "LEARNINGS.md")
    fs.mkdirSync(path.dirname(learningsPath), { recursive: true })
    fs.writeFileSync(learningsPath, renderLearnings(existing))
    const before = fs.readFileSync(learningsPath, "utf8")

    const outputFile = path.join(cwd, "gh-output-m")
    const result = runNodeScript(LEARN_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_FIXTURE: fixturePath,
        LEARNINGS_BUDGET_MINUTES: "1",
        DOCS_SYNC_BACKOFF_MS: "0",
        GITHUB_OUTPUT: outputFile,
      },
    })

    // learnings.json unchanged
    const out = JSON.parse(fs.readFileSync(path.join(cwd, "docs-sync-out", "learnings.json"), "utf8"))
    assert.deepEqual(out, existing)

    // No learned_through output (empty delta route omits it per G5 table)
    if (fs.existsSync(outputFile)) {
      const ghOut = fs.readFileSync(outputFile, "utf8")
      assert.ok(!ghOut.includes("learned_through="), "GITHUB_OUTPUT must not contain learned_through on empty delta")
    }
    const patched = `${fixturePath}.patched`
    assert.ok(fs.existsSync(patched), "marker PATCH file must be written for empty delta")
    const markerText = fs.readFileSync(patched, "utf8")
    assert.ok(markerText.includes(tip), "marker PATCH must contain tip SHA")

    runNodeScript(LEARN_SCRIPT, {
      cwd,
      kiloDir,
      args: ["--apply"],
      env: { DOCS_SYNC_BACKOFF_MS: "0" },
    })
    assert.equal(fs.readFileSync(learningsPath, "utf8"), before, "LEARNINGS.md must be byte-unchanged after apply")

    // patchMarkerIntoBody: existing marker → replaced in place
    {
      const oldBody = "some text\n<!-- docs-sync: learned-through commit=old comment=old -->\nmore text\n"
      const newLine = "<!-- docs-sync: learned-through commit=abc comment=2026-01-01 -->"
      const patched = patchMarkerIntoBody(oldBody, newLine)
      assert.ok(patched.includes(newLine), "new marker must be in body")
      assert.ok(!patched.includes("commit=old"), "old marker must be gone")
      assert.equal(
        (patched.match(/<!--\s*docs-sync:\s*learned-through/g) || []).length,
        1,
        "exactly one marker after replace",
      )
    }

    // patchMarkerIntoBody: no marker → appended
    {
      const oldBody = "no marker here\n"
      const newLine = "<!-- docs-sync: learned-through commit=abc comment=2026-01-01 -->"
      const patched = patchMarkerIntoBody(oldBody, newLine)
      assert.ok(patched.includes(newLine))
    }
  }

  // 10n — non-empty delta routes through upsert (not learn.mjs PATCH)
  {
    console.log("  10n — non-empty delta marker route")
    const dir = mktemp("docs-sync-learn-n-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
    gitIn(dir, ["add", "base.txt"])
    gitIn(dir, ["commit", "-m", "base"])
    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])
    fs.mkdirSync(path.join(dir, "packages", "kilo-docs", "pages"), { recursive: true })
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "x.md"), "# x\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/x.md"])
    gitIn(dir, ["commit", "-m", "docs update", "--author", `kiloconnect[bot] <${kiloconnectBotEmail}>`])
    const source = `commit:${gitIn(dir, ["rev-parse", "HEAD"]).slice(0, 7)}`
    const tip = gitIn(dir, ["rev-parse", "HEAD"])

    const cwd = setupLearnRepo(dir)
    const fixturePath = writeFixture(cwd, {
      pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
      comments: [],
    })

    const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog: path.join(cwd, "kilo-calls.log") })
    writeExtractionDelta(cwd, {
      add: [
        { id: "new-rule", rule: "A new rule.", scope: "both", source: `commit:${tip.slice(0, 7)}`, date: "2026-08-03" },
      ],
      remove: [],
    })

    const summaryFile = path.join(cwd, "step-summary.md")
    fs.writeFileSync(summaryFile, "")
    const outputFile = path.join(cwd, "gh-output")
    const result = runNodeScript(LEARN_SCRIPT, {
      cwd,
      kiloDir,
      env: {
        TRIAGE_MODEL: "test/model",
        DOCS_SYNC_FIXTURE: fixturePath,
        LEARNINGS_BUDGET_MINUTES: "1",
        DOCS_SYNC_BACKOFF_MS: "0",
        GITHUB_STEP_SUMMARY: summaryFile,
        GITHUB_OUTPUT: outputFile,
      },
    })

    // No marker PATCH file
    assert.ok(!fs.existsSync(`${fixturePath}.patched`), "non-empty delta must not PATCH marker")

    // Assert learned_through was written to GITHUB_OUTPUT (non-empty delta route)
    const ghOut = fs.readFileSync(outputFile, "utf8")
    assert.ok(ghOut.includes("learned_through="), "GITHUB_OUTPUT must contain learned_through on non-empty delta")
    assert.ok(ghOut.includes(`commit=${tip}`), "learned_through must contain tip SHA")

    // renderBody with learnedThrough marker
    const marker = "<!-- docs-sync: learned-through commit=abc comment=2026-01-01 -->"
    const body1 = renderBody({
      date: "2026-08-03",
      since: "2026-07-01T00:00:00.000Z",
      through: "2026-08-03T00:00:00.000Z",
      learnedThrough: marker,
      changesRows: [],
      pendingRows: [],
      skippedRows: [],
      verified: true,
      draftReasons: [],
      note: "",
    })
    assert.ok(body1.includes(marker), "renderBody must emit marker when given")

    // renderBody with parameter omitted → no marker
    const body2 = renderBody({
      date: "2026-08-03",
      since: "2026-07-01T00:00:00.000Z",
      through: "2026-08-03T00:00:00.000Z",
      changesRows: [],
      pendingRows: [],
      skippedRows: [],
      verified: true,
      draftReasons: [],
      note: "",
    })
    assert.ok(!body2.includes("learned-through"), "renderBody without learnedThrough must emit no marker")
    // Still round-trips
    const extChanges = extractSectionRows(body2, "changes")
    assert.deepEqual(extChanges, [])
  }

  // 10o — deleted-in-window rejection
  {
    console.log("  10o — deleted-in-window rejection")
    // Normalized match catches near-identical wording
    {
      const delta = {
        add: [
          {
            id: "dup",
            rule: "do not document experimental features!",
            scope: "both",
            source: "commit:aaaaaaa",
            date: "2026-08-03",
          },
        ],
        remove: [],
      }
      const { rejected } = validateDelta(delta, {
        existing: [],
        candidateSources: ["commit:aaaaaaa"],
        deletedInWindow: ["Do not document experimental features."],
      })
      assert.equal(rejected.length, 1, "normalized match must reject deleted rule")
    }

    // Different meaning on same topic — NOT rejected (accepted limit)
    {
      const delta = {
        add: [
          {
            id: "good",
            rule: "Document experimental features in a separate section.",
            scope: "both",
            source: "commit:aaaaaaa",
            date: "2026-08-03",
          },
        ],
        remove: [],
      }
      const { rejected } = validateDelta(delta, {
        existing: [],
        candidateSources: ["commit:aaaaaaa"],
        deletedInWindow: ["Do not document experimental features."],
      })
      assert.equal(rejected.length, 0, "different rule on same topic must not be rejected")
    }
  }

  // 10p — resolveLearnedThrough pure function and anti-drift assertions
  {
    console.log("  10p — resolveLearnedThrough + anti-drift")
    // Unit tests on the pure export
    // env value set wins over body marker
    assert.equal(
      resolveLearnedThrough({
        envValue: "<!-- docs-sync: learned-through commit=env commit=env -->",
        prBody: "<!-- docs-sync: learned-through commit=body comment=body -->",
      }),
      "<!-- docs-sync: learned-through commit=env commit=env -->",
    )
    // env unset, body marker present → body wins
    assert.equal(
      resolveLearnedThrough({ envValue: "", prBody: "<!-- docs-sync: learned-through commit=body comment=body -->" }),
      "<!-- docs-sync: learned-through commit=body comment=body -->",
    )
    // both absent → empty string
    assert.equal(resolveLearnedThrough({ envValue: "", prBody: "" }), "")
    // env set to whitespace → treated as unset
    assert.equal(
      resolveLearnedThrough({
        envValue: "   ",
        prBody: "<!-- docs-sync: learned-through commit=body comment=body -->",
      }),
      "<!-- docs-sync: learned-through commit=body comment=body -->",
    )

    // renderBody emits no marker for ""
    const bodyEmpty = renderBody({
      date: "d",
      since: "s",
      through: "t",
      learnedThrough: "",
      changesRows: [],
      pendingRows: [],
      skippedRows: [],
      verified: true,
      draftReasons: [],
      note: "",
    })
    assert.ok(!bodyEmpty.includes("learned-through"), "empty learnedThrough must emit no marker")

    // Anti-drift: static-source assertions on upsert-pr.mjs
    const upsertSrc = fs.readFileSync(path.join(HERE, "upsert-pr.mjs"), "utf8")

    // (a) exactly one resolveLearnedThrough( call passing process.env.LEARNED_THROUGH
    const calls = upsertSrc.match(/resolveLearnedThrough\(/g) || []
    // One in the export definition, one in the call site
    assert.ok(calls.length >= 2, `expected at least 2 resolveLearnedThrough( occurrences; got ${calls.length}`)
    assert.ok(
      upsertSrc.includes("process.env.LEARNED_THROUGH"),
      "resolveLearnedThrough must receive process.env.LEARNED_THROUGH",
    )
    assert.ok(upsertSrc.includes("prBody"), "resolveLearnedThrough must receive prBody")

    // (b) prBody is at function scope (let prBody before the if block)
    const prBodyIdx = upsertSrc.indexOf('let prBody = ""')
    assert.ok(prBodyIdx >= 0, 'prBody must be declared at function scope with let prBody = ""')
    const ifIdx = upsertSrc.indexOf('if (mode === "update"')
    assert.ok(prBodyIdx < ifIdx, 'let prBody must appear before if (mode === "update"...)')

    // (c) renderBody({ argument object contains learnedThrough
    const renderBodyIdx = upsertSrc.indexOf("const body = renderBody({")
    assert.ok(renderBodyIdx >= 0, "renderBody call must exist")
    const afterRenderBody = upsertSrc.slice(renderBodyIdx)
    const renderBodyArgsEnd = afterRenderBody.indexOf("})")
    const renderBodyArgs = afterRenderBody.slice(0, renderBodyArgsEnd)
    assert.ok(renderBodyArgs.includes("learnedThrough"), "renderBody call in main() must pass learnedThrough")
  }

  // 10q — dry run makes no live write
  {
    console.log("  10q — dry run no live write")
    const dir = mktemp("docs-sync-learn-q-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
    gitIn(dir, ["add", "base.txt"])
    gitIn(dir, ["commit", "-m", "base"])
    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])
    fs.mkdirSync(path.join(dir, "packages", "kilo-docs", "pages"), { recursive: true })
    fs.writeFileSync(path.join(dir, "packages", "kilo-docs", "pages", "x.md"), "# x\n")
    gitIn(dir, ["add", "packages/kilo-docs/pages/x.md"])
    gitIn(dir, ["commit", "-m", "docs update", "--author", `kiloconnect[bot] <${kiloconnectBotEmail}>`])

    // DRY_RUN=true
    {
      const cwd = setupLearnRepo(dir)
      const fixturePath = writeFixture(cwd, {
        pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
        comments: [],
      })

      const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog: path.join(cwd, "kilo-calls.log") })
      writeExtractionDelta(cwd, { add: [], remove: [] })

      const outputFile = path.join(cwd, "gh-output-q-dry")
      const result = runNodeScript(LEARN_SCRIPT, {
        cwd,
        kiloDir,
        env: {
          TRIAGE_MODEL: "test/model",
          DOCS_SYNC_FIXTURE: fixturePath,
          LEARNINGS_BUDGET_MINUTES: "1",
          DOCS_SYNC_BACKOFF_MS: "0",
          DRY_RUN: "true",
          GITHUB_OUTPUT: outputFile,
        },
      })

      assert.ok(!fs.existsSync(`${fixturePath}.patched`), "DRY_RUN must suppress marker PATCH")
      if (fs.existsSync(outputFile)) {
        const ghOut = fs.readFileSync(outputFile, "utf8")
        assert.ok(!ghOut.includes("learned_through="), "GITHUB_OUTPUT must not contain learned_through on DRY_RUN")
      }
      assert.ok(result.stdout.includes("marker PATCH suppressed"), "stdout must log marker suppression for DRY_RUN")
      assert.ok(
        result.stdout.includes("would have written marker"),
        "stdout must log the suppressed marker for DRY_RUN",
      )
    }

    // LEARNINGS_NO_PATCH=1 (same mechanism)
    {
      const cwd = setupLearnRepo(dir)
      const fixturePath = writeFixture(cwd, {
        pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
        comments: [],
      })

      const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog: path.join(cwd, "kilo-calls.log") })
      writeExtractionDelta(cwd, { add: [], remove: [] })

      const outputFile = path.join(cwd, "gh-output-q-nopatch")
      const result = runNodeScript(LEARN_SCRIPT, {
        cwd,
        kiloDir,
        env: {
          TRIAGE_MODEL: "test/model",
          DOCS_SYNC_FIXTURE: fixturePath,
          LEARNINGS_BUDGET_MINUTES: "1",
          DOCS_SYNC_BACKOFF_MS: "0",
          LEARNINGS_NO_PATCH: "1",
          GITHUB_OUTPUT: outputFile,
        },
      })

      assert.ok(!fs.existsSync(`${fixturePath}.patched`), "LEARNINGS_NO_PATCH must suppress marker PATCH")
      if (fs.existsSync(outputFile)) {
        const ghOut = fs.readFileSync(outputFile, "utf8")
        assert.ok(
          !ghOut.includes("learned_through="),
          "GITHUB_OUTPUT must not contain learned_through on LEARNINGS_NO_PATCH",
        )
      }
      assert.ok(
        result.stdout.includes("marker PATCH suppressed"),
        "stdout must log marker suppression for LEARNINGS_NO_PATCH",
      )
      assert.ok(
        result.stdout.includes("would have written marker"),
        "stdout must log the suppressed marker for LEARNINGS_NO_PATCH",
      )
    }

    // DRY_RUN=true with non-empty delta (suppresses learned_through output)
    {
      const cwd = setupLearnRepo(dir)
      const tipSource = `commit:${gitIn(dir, ["rev-parse", "HEAD"]).slice(0, 7)}`
      const fixturePath = writeFixture(cwd, {
        pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
        comments: [],
      })

      const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog: path.join(cwd, "kilo-calls.log") })
      writeExtractionDelta(cwd, {
        add: [
          {
            id: "dry-suppress",
            rule: "A rule suppressed under dry run.",
            scope: "both",
            source: tipSource,
            date: "2026-08-03",
          },
        ],
        remove: [],
      })

      const outputFile = path.join(cwd, "gh-output-q-dry-nonempty")
      const result = runNodeScript(LEARN_SCRIPT, {
        cwd,
        kiloDir,
        env: {
          TRIAGE_MODEL: "test/model",
          DOCS_SYNC_FIXTURE: fixturePath,
          LEARNINGS_BUDGET_MINUTES: "1",
          DOCS_SYNC_BACKOFF_MS: "0",
          DRY_RUN: "true",
          GITHUB_OUTPUT: outputFile,
        },
      })

      if (fs.existsSync(outputFile)) {
        const ghOut = fs.readFileSync(outputFile, "utf8")
        assert.ok(
          !ghOut.includes("learned_through="),
          "GITHUB_OUTPUT must not contain learned_through on DRY_RUN non-empty delta",
        )
      }
      assert.ok(
        result.stdout.includes("learned-through output suppressed"),
        "stdout must log learned-through output suppression for DRY_RUN non-empty delta",
      )
    }

    // LEARNINGS_NO_PATCH=1 with non-empty delta
    {
      const cwd = setupLearnRepo(dir)
      const tipSource = `commit:${gitIn(dir, ["rev-parse", "HEAD"]).slice(0, 7)}`
      const fixturePath = writeFixture(cwd, {
        pr: { number: 1, head: { ref: "docs/auto-sync" }, body: "", user: { login: "github-actions[bot]" } },
        comments: [],
      })

      const kiloDir = makeStubKiloDir({ mode: "extraction-delta", callLog: path.join(cwd, "kilo-calls.log") })
      writeExtractionDelta(cwd, {
        add: [
          {
            id: "nopatch-suppress",
            rule: "A rule suppressed under no-patch.",
            scope: "both",
            source: tipSource,
            date: "2026-08-03",
          },
        ],
        remove: [],
      })

      const outputFile = path.join(cwd, "gh-output-q-nopatch-nonempty")
      const result = runNodeScript(LEARN_SCRIPT, {
        cwd,
        kiloDir,
        env: {
          TRIAGE_MODEL: "test/model",
          DOCS_SYNC_FIXTURE: fixturePath,
          LEARNINGS_BUDGET_MINUTES: "1",
          DOCS_SYNC_BACKOFF_MS: "0",
          LEARNINGS_NO_PATCH: "1",
          GITHUB_OUTPUT: outputFile,
        },
      })

      if (fs.existsSync(outputFile)) {
        const ghOut = fs.readFileSync(outputFile, "utf8")
        assert.ok(
          !ghOut.includes("learned_through="),
          "GITHUB_OUTPUT must not contain learned_through on LEARNINGS_NO_PATCH non-empty delta",
        )
      }
      assert.ok(
        result.stdout.includes("learned-through output suppressed"),
        "stdout must log learned-through output suppression for LEARNINGS_NO_PATCH non-empty delta",
      )
    }
  }

  // 10s — a failed API call must not disable the existing learnings
  // The learn step is continue-on-error, and triage and edit read only the two prompt
  // artifacts. So learn.mjs must write them before the first call that can throw.
  {
    console.log("  10s — prompt artifacts survive an API failure")
    const dir = mktemp("docs-sync-learn-s-")
    const learningsPath = path.join(dir, "packages", "kilo-docs", "LEARNINGS.md")
    fs.mkdirSync(path.dirname(learningsPath), { recursive: true })
    const seeded = [
      {
        id: "seeded-rule",
        rule: "Do not document features behind experimental flags.",
        scope: "both",
        source: "commit:aaaaaaa",
        date: "2026-08-01",
      },
    ]
    fs.writeFileSync(learningsPath, renderLearnings(seeded))

    // No DOCS_SYNC_FIXTURE and an empty GITHUB_REPOSITORY: repo() throws inside
    // extract(). It stands for any API failure before the artifacts exist.
    const failEnv = {
      TRIAGE_MODEL: "test/model",
      GITHUB_REPOSITORY: "",
      GITHUB_OUTPUT: path.join(dir, "gh-output-s"),
      GITHUB_STEP_SUMMARY: path.join(dir, "gh-summary-s"),
      DOCS_SYNC_BACKOFF_MS: "0",
    }
    const result = runNodeScript(LEARN_SCRIPT, { cwd: dir, env: failEnv })
    assert.notEqual(result.status, 0, "extraction must fail without GITHUB_REPOSITORY")

    const triagePath = path.join(dir, "docs-sync-out", "learnings-triage.md")
    const editPath = path.join(dir, "docs-sync-out", "learnings-edit.md")
    for (const f of [triagePath, editPath]) {
      assert.ok(fs.existsSync(f), `${path.basename(f)} must survive the failure`)
      assert.ok(
        fs.readFileSync(f, "utf8").includes("Do not document features behind experimental flags."),
        `${path.basename(f)} must carry the checked-out rule`,
      )
    }

    // An empty file must clear the stale block, not leave the earlier rule in place.
    fs.writeFileSync(learningsPath, renderLearnings([]))
    runNodeScript(LEARN_SCRIPT, { cwd: dir, env: failEnv })
    assert.ok(!fs.existsSync(triagePath), "an empty learnings file must remove learnings-triage.md")
    assert.ok(!fs.existsSync(editPath), "an empty learnings file must remove learnings-edit.md")
  }

  // 10t — the direct marker PATCH must not overwrite a concurrent body edit
  // The body read at step 1 predates the extraction call, so learn.mjs must re-read
  // the body immediately before the PATCH.
  {
    console.log("  10t — marker PATCH preserves a concurrent body edit")
    const dir = mktemp("docs-sync-learn-t-")
    initRepoWithIdentity(dir)
    fs.writeFileSync(path.join(dir, "base.txt"), "base\n")
    gitIn(dir, ["add", "base.txt"])
    gitIn(dir, ["commit", "-m", "base"])
    gitIn(dir, ["checkout", "-b", "docs/auto-sync"])

    // github-actions[bot] authored the only branch commit, so there is no candidate
    // correction and no model call. The run goes straight to the direct marker PATCH.
    const learningsPath = path.join(dir, "packages", "kilo-docs", "LEARNINGS.md")
    fs.mkdirSync(path.dirname(learningsPath), { recursive: true })
    fs.writeFileSync(learningsPath, renderLearnings([]))
    gitIn(dir, ["add", "packages/kilo-docs/LEARNINGS.md"])
    gitIn(dir, ["commit", "-m", "seed learnings", "--author", `github-actions[bot] <${githubBotEmail}>`])
    gitIn(dir, ["remote", "add", "origin", dir]) // learn.mjs fetches origin itself
    const cwd = setupLearnRepo(dir)
    const tip = gitIn(dir, ["rev-parse", "HEAD"])

    // Stub GitHub API. The second read of the pull request returns the maintainer edit.
    const serverDir = mktemp("docs-sync-api-t-")
    const portFile = path.join(serverDir, "port")
    const patchFile = path.join(serverDir, "patch.json")
    const serverScript = path.join(serverDir, "server.cjs")
    fs.writeFileSync(
      serverScript,
      `const fs = require("node:fs")
const http = require("node:http")
let reads = 0
const json = (res, data) => {
  res.writeHead(200, { "content-type": "application/json" })
  res.end(JSON.stringify(data))
}
const server = http.createServer((req, res) => {
  let raw = ""
  req.on("data", (c) => (raw += c))
  req.on("end", () => {
    if (req.method === "PATCH") return fs.writeFileSync(process.env.PATCH_FILE, raw), json(res, {})
    if (req.url.startsWith("/search/issues")) return json(res, { items: [{ number: 1 }] })
    if (req.url.includes("/comments")) return json(res, [])
    if (req.url.includes("/pulls/1")) {
      const body = reads++ === 0 ? process.env.BODY_BEFORE : process.env.BODY_AFTER
      return json(res, {
        number: 1,
        body,
        head: { ref: "docs/auto-sync" },
        user: { login: "github-actions[bot]" },
      })
    }
    json(res, {})
  })
})
server.listen(0, "127.0.0.1", () => fs.writeFileSync(process.env.PORT_FILE, String(server.address().port)))
`,
    )

    const bodyBefore = "Rolling PR body.\n<!-- docs-sync: learned-through commit=old comment=none -->\n"
    const humanEdit = "A maintainer edited the body while extraction ran."
    const child = spawn(process.execPath, [serverScript], {
      stdio: "ignore",
      env: {
        ...process.env,
        PORT_FILE: portFile,
        PATCH_FILE: patchFile,
        BODY_BEFORE: bodyBefore,
        BODY_AFTER: bodyBefore + humanEdit + "\n",
      },
    })

    try {
      let port = ""
      for (let i = 0; i < 100 && !port; i++) {
        if (fs.existsSync(portFile)) port = fs.readFileSync(portFile, "utf8").trim()
        else sleepSync(50)
      }
      assert.ok(port, "the stub API server must report a port")

      const result = runNodeScript(LEARN_SCRIPT, {
        cwd,
        env: {
          TRIAGE_MODEL: "test/model",
          GITHUB_REPOSITORY: "acme/repo",
          GH_TOKEN: "stub-token",
          DOCS_SYNC_API_BASE: `http://127.0.0.1:${port}`,
          GITHUB_OUTPUT: path.join(dir, "gh-output-t"),
          GITHUB_STEP_SUMMARY: path.join(dir, "gh-summary-t"),
          LEARNINGS_BUDGET_MINUTES: "1",
          DOCS_SYNC_BACKOFF_MS: "0",
        },
      })
      assert.equal(result.status, 0, `learn.mjs must succeed against the stub API: ${result.output}`)

      assert.ok(fs.existsSync(patchFile), "the run must PATCH the pull request body")
      const patchedBody = JSON.parse(fs.readFileSync(patchFile, "utf8")).body
      assert.ok(patchedBody.includes(humanEdit), "the concurrent body edit must survive the marker PATCH")
      assert.ok(patchedBody.includes(tip), "the PATCH must carry the new tip SHA")
      assert.ok(!patchedBody.includes("commit=old"), "the old marker must be replaced")
      assert.equal(
        (patchedBody.match(/<!--\s*docs-sync:\s*learned-through/g) || []).length,
        1,
        "exactly one marker after the PATCH",
      )
    } finally {
      child.kill()
    }
  }

  // 10u — one model response cannot repeat an id or a rule
  {
    console.log("  10u — duplicates inside one delta")
    const base = { scope: "both", source: "commit:aaaaaaa", date: "2026-08-03" }
    const ctx = { existing: [], candidateSources: ["commit:aaaaaaa"], deletedInWindow: [] }

    const dupId = validateDelta(
      {
        add: [
          { ...base, id: "same-id", rule: "Do not document features behind experimental flags." },
          { ...base, id: "same-id", rule: "Keep the release notes short." },
        ],
        remove: [],
      },
      ctx,
    )
    assert.equal(dupId.add.length, 1, "a repeated id must be rejected")
    assert.equal(dupId.add[0].rule, "Do not document features behind experimental flags.")
    assert.equal(dupId.rejected.length, 1)
    assert.ok(dupId.rejected[0].reason.includes("earlier addition"), "the reason must name the earlier addition")

    const dupText = validateDelta(
      {
        add: [
          { ...base, id: "rule-one", rule: "Do not document features behind experimental flags." },
          { ...base, id: "rule-two", rule: "Do not document features behind experimental flags!" },
        ],
        remove: [],
      },
      ctx,
    )
    assert.equal(dupText.add.length, 1, "a repeated rule text must be rejected")
    assert.equal(dupText.rejected.length, 1)
    assert.ok(dupText.rejected[0].reason.includes("earlier addition"), "the reason must name the earlier addition")
  }

  // Prompt block format
  {
    console.log("  10 — promptBlock format")
    const entries = [
      { id: "r1", rule: "First rule.", scope: "triage", source: "commit:aaaaaaa", date: "2026-08-01" },
      { id: "r2", rule: "Second rule.", scope: "edit", source: "commit:bbbbbbb", date: "2026-08-02" },
      { id: "r3", rule: "Both rule.", scope: "both", source: "commit:ccccccc", date: "2026-08-03" },
    ]

    const triageBlock = promptBlock(entries, "triage")
    assert.ok(triageBlock.includes("First rule"), "triage block must include triage-scoped rule")
    assert.ok(triageBlock.includes("Both rule"), "triage block must include both-scoped rule")
    assert.ok(!triageBlock.includes("Second rule"), "triage block must not include edit-only rule")
    assert.ok(triageBlock.includes("## Learnings from maintainer corrections"))

    const editBlock = promptBlock(entries, "edit")
    assert.ok(editBlock.includes("Second rule"), "edit block must include edit-scoped rule")
    assert.ok(editBlock.includes("Both rule"), "edit block must include both-scoped rule")
    assert.ok(!editBlock.includes("First rule"), "edit block must not include triage-only rule")

    // Empty: no matching entries
    const emptyBlock = promptBlock(
      [{ id: "r1", rule: "R.", scope: "edit", source: "commit:aa", date: "2026-01-01" }],
      "triage",
    )
    assert.equal(emptyBlock, "")
  }

  // parseLearnedThrough
  {
    console.log("  10 — parseLearnedThrough")
    const body = "stuff\n<!-- docs-sync: learned-through commit=abc1234 comment=2026-08-03T12:00:00Z -->\nmore"
    const parsed = parseLearnedThrough(body)
    assert.equal(parsed.commit, "abc1234")
    assert.equal(parsed.comment, "2026-08-03T12:00:00Z")

    // none values → null
    const noneBody = "<!-- docs-sync: learned-through commit=none comment=none -->"
    const noneParsed = parseLearnedThrough(noneBody)
    assert.equal(noneParsed.commit, null)
    assert.equal(noneParsed.comment, null)

    // absent → both null
    const absent = parseLearnedThrough("no marker")
    assert.equal(absent.commit, null)
    assert.equal(absent.comment, null)
  }

  // renderLearnings deterministic order
  {
    console.log("  10 — renderLearnings deterministic order")
    const entries = [
      { id: "b", rule: "B rule.", scope: "both", source: "commit:bb", date: "2026-08-02" },
      { id: "a", rule: "A rule.", scope: "both", source: "commit:aa", date: "2026-08-01" },
      { id: "c", rule: "C rule.", scope: "both", source: "commit:cc", date: "2026-08-01" },
    ]
    const r1 = renderLearnings(entries)
    const r2 = renderLearnings(entries)
    assert.equal(r1, r2, "renderLearnings must be deterministic")
    // Order: date ascending, then id ascending. So a before b before c (a.date < c.date, both before b)
    const aPos = r1.indexOf("A rule")
    const cPos = r1.indexOf("C rule")
    const bPos = r1.indexOf("B rule")
    assert.ok(aPos < cPos, "a (earlier date) must come before c")
    assert.ok(cPos < bPos, "c (same date as a but later id) must come before b (later date)")
  }
}

// Case 11 — the created rolling PR gets an assignee and a review request
function case11_prOwner() {
  console.log("case 11 — created PR assignee and reviewer")
  const src = fs.readFileSync(path.join(HERE, "upsert-pr.mjs"), "utf8")

  assert.ok(/const DOCS_OWNER = "\S+"/.test(src), "DOCS_OWNER must be a module constant")
  assert.ok(src.includes("/assignees`, {"), "created PR must POST assignees")
  assert.ok(src.includes("/requested_reviewers`, {"), "created PR must POST requested_reviewers")

  // Both calls belong to the create arm, after the PR exists.
  const createIdx = src.indexOf("const pr = await api(`/repos/${repo()}/pulls`")
  assert.ok(createIdx >= 0, "create-PR call must exist")
  assert.ok(src.indexOf("/assignees`, {") > createIdx, "assignees POST must follow PR creation")
  assert.ok(src.indexOf("/requested_reviewers`, {") > createIdx, "reviewer POST must follow PR creation")

  // A failure here must not fail the run — the PR is already open.
  const ownerIdx = src.indexOf("/assignees`, {")
  const tryIdx = src.lastIndexOf("try {", ownerIdx)
  const catchIdx = src.indexOf("} catch", ownerIdx)
  assert.ok(tryIdx >= 0 && catchIdx > src.indexOf("/requested_reviewers`, {"), "both POSTs must sit in one try/catch")
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
    case9_reverts,
    case10_learnings,
    case11_prOwner,
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
