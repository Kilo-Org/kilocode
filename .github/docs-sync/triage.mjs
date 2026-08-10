// kilocode_change - new file

/**
 * Runs the LLM triage pass over docs-sync-out/digest.json in chunks.
 *
 * A daily window holds ~30-50 PRs; a replay can hold several hundred. A
 * single triage call over that volume truncates its JSON output, so the
 * digest is split into chunks of CHUNK_SIZE and each chunk is triaged with
 * its own `kilo run` call. A chunk that fails, is only partially classified,
 * or is deferred by the wall-clock budget is marked pending:true (still
 * docs_worthy:false so filter-worthy excludes it) so the watermark holds
 * back and the next run re-collects those PRs.
 *
 * Env: TRIAGE_MODEL (provider/model), KILO_API_KEY + KILO_ORG_ID (gateway auth, set by
 * the workflow; the kilo provider reads them natively). Reads the prompt from triage-prompt.md next to this script.
 * Budget: TRIAGE_BUDGET_MINUTES (default 35). Test hook: DOCS_SYNC_BACKOFF_MS.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseTriageEntries } from "./extract-json.mjs"
import { appendSummary, backoffMsForAttempt, deadline, remainingMs, runKilo, sleepSync } from "./lib.mjs"
import { readLearningsBlock } from "./learn.mjs"

const CHUNK_SIZE = 25
const ATTEMPTS = 3
const OUT_DIR = "docs-sync-out"
const CHUNK_TIMEOUT_MS = 10 * 60 * 1000

const HERE = path.dirname(fileURLToPath(import.meta.url))
const prompt = fs.readFileSync(path.join(HERE, "triage-prompt.md"), "utf8") + readLearningsBlock("triage")
const model = process.env.TRIAGE_MODEL
if (!model) throw new Error("TRIAGE_MODEL is required")

const TRIAGE_BUDGET_MINUTES = Number(process.env.TRIAGE_BUDGET_MINUTES) || 35

const digest = JSON.parse(fs.readFileSync(`${OUT_DIR}/digest.json`, "utf8"))

function formatCause(result) {
  const bits = []
  if (result.timedOut) bits.push("timed out")
  if (result.exitCode !== null && result.exitCode !== undefined) bits.push(`exit ${result.exitCode}`)
  if (result.stderrTail) bits.push(result.stderrTail.replaceAll("\n", " ").slice(0, 200))
  return bits.join("; ") || "no diagnostic"
}

function pendingEntry(d, reason) {
  return {
    pr: d.number,
    url: d.url,
    docs_worthy: false,
    pending: true,
    reason,
    target_sections: [],
    priority: "medium",
  }
}

function triageChunk(chunk, index, budgetDeadline) {
  const chunkFile = `${OUT_DIR}/triage-chunk-${index}.json`
  fs.writeFileSync(chunkFile, JSON.stringify(chunk, null, 2))

  let lastCause = "triage failed to classify this PR"
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const left = remainingMs(budgetDeadline)
    if (left < CHUNK_TIMEOUT_MS) {
      lastCause = `triage budget exhausted before chunk ${index} attempt ${attempt}`
      console.warn(
        `chunk ${index}: stopping retries — remaining budget cannot fit another ${CHUNK_TIMEOUT_MS / 60000}m attempt`,
      )
      break
    }

    // Headless `kilo run` auto-rejects every permission ask; without --auto the
    // agent cannot run shell commands. SECURITY: --auto grants unrestricted bash
    // to an agent steered by external PR content. Hardening deferred: a scoped
    // permission.bash map via KILO_CONFIG_CONTENT should replace --auto once the
    // required shell patterns are stable (see PR #12605 review thread).
    const result = runKilo({
      args: ["run", "--auto", prompt, "-m", model, "--dir", process.cwd(), "-f", chunkFile],
      timeoutMs: Math.min(CHUNK_TIMEOUT_MS, left),
      streamStdout: false,
      label: `triage chunk ${index} attempt ${attempt}`,
    })

    const raw = result.stdout
    if (raw) fs.writeFileSync(`${OUT_DIR}/triage-raw-${index}.txt`, raw)

    const entries = raw ? parseTriageEntries(raw) : null
    if (entries) {
      // An entry for a PR outside this chunk must not win the shared dedupe
      // against the chunk that actually owns it — drop foreign entries.
      const allowed = new Set(chunk.map((d) => d.url))
      const owned = entries.filter((e) => allowed.has(e.url))
      if (owned.length !== entries.length) {
        console.warn(`chunk ${index}: dropped ${entries.length - owned.length} entries for PRs outside the chunk`)
      }
      if (owned.length > 0) return owned
    }

    // Exit 0 is not success: unparseable output is a failure logged WITH
    // the captured stderrTail and exit code on every attempt.
    const cause = formatCause(result)
    lastCause = `triage chunk ${index}: ${cause}`
    console.warn(
      `chunk ${index} attempt ${attempt}: no valid JSON in output` +
        ` (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""})` +
        (result.stderrTail ? `\nstderr tail:\n${result.stderrTail}` : "\nstderr tail: (empty)"),
    )

    if (attempt < ATTEMPTS) {
      const wait = backoffMsForAttempt(attempt)
      const afterWait = remainingMs(budgetDeadline) - wait
      if (wait > 0 && afterWait >= CHUNK_TIMEOUT_MS) {
        console.warn(`chunk ${index}: backing off ${wait / 1000}s before attempt ${attempt + 1}`)
        sleepSync(wait)
      } else if (wait > 0) {
        console.warn(`chunk ${index}: skipping backoff — remaining budget cannot fit attempt ${attempt + 1} after wait`)
      }
    }
  }

  console.warn(
    `::warning::chunk ${index} failed triage after up to ${ATTEMPTS} attempts; marking ${chunk.length} PRs pending`,
  )
  return chunk.map((d) =>
    pendingEntry(
      d,
      lastCause.includes("triage failed") ? lastCause : `triage failed to classify this PR (${lastCause})`,
    ),
  )
}

const chunks = []
for (let i = 0; i < digest.length; i += CHUNK_SIZE) {
  chunks.push(digest.slice(i, i + CHUNK_SIZE))
}
console.log(`triaging ${digest.length} PRs in ${chunks.length} chunks of up to ${CHUNK_SIZE}`)

const budgetDeadline = deadline(TRIAGE_BUDGET_MINUTES)
const merged = []
const seen = new Set()

for (let i = 0; i < chunks.length; i++) {
  const left = remainingMs(budgetDeadline)
  if (left < CHUNK_TIMEOUT_MS) {
    const deferredPrs = chunks.slice(i).reduce((n, c) => n + c.length, 0)
    console.warn(
      `stopping triage before chunk ${i}: remaining budget (${Math.ceil(left / 1000)}s) cannot fit a ${CHUNK_TIMEOUT_MS / 60000}m chunk; deferring ${deferredPrs} PRs`,
    )
    const cause = `triage budget exhausted before chunk ${i} (${Math.ceil(left / 1000)}s left)`
    for (let j = i; j < chunks.length; j++) {
      for (const d of chunks[j]) {
        if (seen.has(d.url)) continue
        seen.add(d.url)
        merged.push(pendingEntry(d, cause))
      }
    }
    break
  }

  for (const e of triageChunk(chunks[i], i, budgetDeadline)) {
    if (seen.has(e.url)) continue
    seen.add(e.url)
    merged.push(e)
  }
}

// Coverage: every digest PR gets a triage entry. Partial-chunk backfill and
// any other missing URL are pending:true — not a genuine "not worthy" verdict.
for (const d of digest) {
  if (seen.has(d.url)) continue
  merged.push(pendingEntry(d, "not classified by triage"))
}

fs.writeFileSync(`${OUT_DIR}/triage.json`, JSON.stringify(merged, null, 2))
const worthy = merged.filter((e) => e.docs_worthy).length
const pending = merged.filter((e) => e.pending === true)
console.log(`triage complete: ${merged.length} entries, ${worthy} docs-worthy, ${pending.length} pending`)

// Upsert is gated off when worthy == 0, so triage emits its own Step Summary
// listing every PR it marked pending:true and why.
if (pending.length > 0) {
  const lines = pending.map((e) => `- [${e.url}] ${e.reason}`)
  appendSummary(
    `### docs-sync: triage pending (will retry)\n\n${pending.length} PR(s) were not classified and will be re-collected on the next run:\n\n${lines.join("\n")}`,
  )
}

// Replay warning (S2j): warn IFF since-override AND something pending AND
// docs-worthy count is 0 (Upsert is gated off, so noDiffReport never runs).
const sinceOverride = process.env.SINCE_OVERRIDE === "true"
if (sinceOverride && pending.length > 0 && worthy === 0) {
  console.warn(
    "::warning::docs-sync since-override replay left uncovered PRs and wrote no PR body (worthy=0); re-run the override — the watermark was not held back in the body",
  )
}
