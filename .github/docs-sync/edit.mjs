// kilocode_change - new file

/**
 * Runs the LLM edit pass over docs-sync-out/worthy.json in batches.
 *
 * Batching bounds each `kilo run` context (a replay window can yield dozens
 * of docs-worthy PRs with large diffs). Each batch gets its own CLI session
 * and writes its own summary file; results are merged into
 * docs-sync-out/edit-summary.json. A batch that fails or is deferred by the
 * wall-clock budget is recorded as action "pending" so the watermark holds
 * back and the next run re-collects those PRs.
 *
 * Env: EDIT_MODEL (provider/model), KILO_API_KEY + KILO_ORG_ID (set by workflow; read natively by the kilo provider).
 * Budgets: EDIT_BUDGET_MINUTES (default 50), EDIT_BATCH_TIMEOUT_MINUTES (default 15).
 * Test hook: DOCS_SYNC_BACKOFF_MS replaces every retry wait when set.
 */

import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { backoffMsForAttempt, deadline, remainingMs, runKilo, sleepSync } from "./lib.mjs"
import { readLearningsBlock } from "./learn.mjs"

const BATCH_SIZE = 5
const ATTEMPTS = 3
const OUT_DIR = "docs-sync-out"
export const SUMMARY_FILE = ".docs-sync-summary.json"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const basePrompt = fs.readFileSync(path.join(HERE, "edit-prompt.md"), "utf8") + readLearningsBlock("edit")
const model = process.env.EDIT_MODEL
if (!model) throw new Error("EDIT_MODEL is required")

const EDIT_BUDGET_MINUTES = Number(process.env.EDIT_BUDGET_MINUTES) || 50
const EDIT_BATCH_TIMEOUT_MINUTES = Number(process.env.EDIT_BATCH_TIMEOUT_MINUTES) || 15
const BATCH_TIMEOUT_MS = EDIT_BATCH_TIMEOUT_MINUTES * 60 * 1000

const worthy = JSON.parse(fs.readFileSync(`${OUT_DIR}/worthy.json`, "utf8"))
const triage = JSON.parse(fs.readFileSync(`${OUT_DIR}/triage.json`, "utf8"))
const priority = new Map(triage.map((e) => [e.url, e]))
const ordered = [...worthy].sort((a, b) => {
  const rank = { high: 0, medium: 1, low: 2 }
  return (rank[priority.get(a.url)?.priority] ?? 1) - (rank[priority.get(b.url)?.priority] ?? 1)
})

/** @type {Map<string, string>} url → pending cause for failed/deferred batches */
const pendingCauses = new Map()

function formatCause(result) {
  const bits = []
  if (result.timedOut) bits.push("timed out")
  if (result.exitCode !== null && result.exitCode !== undefined) bits.push(`exit ${result.exitCode}`)
  if (result.stderrTail) bits.push(result.stderrTail.replaceAll("\n", " ").slice(0, 200))
  return bits.join("; ") || "no diagnostic"
}

function editBatch(batch, index, budgetDeadline) {
  const batchFile = `${OUT_DIR}/edit-batch-${index}.json`
  const triageFile = `${OUT_DIR}/edit-batch-triage-${index}.json`
  const summaryFile = `${OUT_DIR}/edit-summary-${index}.json`
  fs.writeFileSync(batchFile, JSON.stringify(batch, null, 2))
  fs.writeFileSync(triageFile, JSON.stringify(batch.map((d) => priority.get(d.url)).filter(Boolean), null, 2))

  const prompt = `${basePrompt}

Batch specifics for this run: the PRs to handle are in the attached ${batchFile} (full details) and ${triageFile} (triage verdicts). Handle ONLY the PRs in these batch files. When finished, write your per-PR results in the summary JSON format described above to the file \`${summaryFile}\` (path relative to the repository root).`

  let lastCause = "edit pass failed"
  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    const left = remainingMs(budgetDeadline)
    if (left < BATCH_TIMEOUT_MS) {
      lastCause = `edit budget exhausted before batch ${index} attempt ${attempt} (${Math.ceil(left / 1000)}s left, need ${EDIT_BATCH_TIMEOUT_MINUTES}m)`
      console.warn(
        `batch ${index}: stopping retries — remaining budget cannot fit another ${EDIT_BATCH_TIMEOUT_MINUTES}m attempt`,
      )
      break
    }

    // Headless `kilo run` auto-rejects every permission ask; without --auto the
    // agent cannot run shell commands. SECURITY: --auto grants unrestricted bash
    // to an agent steered by external PR content. Hardening deferred: a scoped
    // permission.bash map via KILO_CONFIG_CONTENT should replace --auto once the
    // required shell patterns are stable (see PR #12605 review thread).
    const result = runKilo({
      args: [
        "run",
        "--auto",
        prompt,
        "-m",
        model,
        "--variant",
        "high",
        "--dir",
        process.cwd(),
        "-f",
        batchFile,
        "-f",
        triageFile,
      ],
      timeoutMs: Math.min(BATCH_TIMEOUT_MS, left),
      streamStdout: true,
      label: `edit batch ${index} attempt ${attempt}`,
    })

    if (fs.existsSync(summaryFile)) return true
    // Tolerate the agent dropping the docs-sync-out/ prefix.
    const alt = path.basename(summaryFile)
    if (fs.existsSync(alt)) {
      fs.renameSync(alt, summaryFile)
      return true
    }

    // Exit 0 is not success: missing summary is a failure logged WITH the
    // captured stderrTail and exit code on every attempt.
    const cause = formatCause(result)
    lastCause = `edit batch ${index}: ${cause}`
    console.warn(
      `batch ${index} attempt ${attempt}: summary file ${summaryFile} not produced` +
        ` (exit ${result.exitCode}${result.timedOut ? ", timed out" : ""})` +
        (result.stderrTail ? `\nstderr tail:\n${result.stderrTail}` : "\nstderr tail: (empty)"),
    )

    if (attempt < ATTEMPTS) {
      const wait = backoffMsForAttempt(attempt)
      // Skip the wait when the remaining budget cannot fit another attempt.
      const afterWait = remainingMs(budgetDeadline) - wait
      if (wait > 0 && afterWait >= BATCH_TIMEOUT_MS) {
        console.warn(`batch ${index}: backing off ${wait / 1000}s before attempt ${attempt + 1}`)
        sleepSync(wait)
      } else if (wait > 0) {
        console.warn(`batch ${index}: skipping backoff — remaining budget cannot fit attempt ${attempt + 1} after wait`)
      }
    }
  }

  console.warn(`::warning::edit batch ${index} failed after up to ${ATTEMPTS} attempts; ${batch.length} PRs pending`)
  for (const d of batch) pendingCauses.set(d.url, lastCause)
  return false
}

const batches = []
for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
  batches.push(ordered.slice(i, i + BATCH_SIZE))
}
console.log(`editing docs for ${ordered.length} PRs in ${batches.length} batches of up to ${BATCH_SIZE}`)

const budgetDeadline = deadline(EDIT_BUDGET_MINUTES)
let deferredFrom = -1

for (let i = 0; i < batches.length; i++) {
  const left = remainingMs(budgetDeadline)
  if (left < BATCH_TIMEOUT_MS) {
    deferredFrom = i
    const deferredPrs = batches.slice(i).reduce((n, b) => n + b.length, 0)
    console.warn(
      `stopping edit pass before batch ${i}: remaining budget (${Math.ceil(left / 1000)}s) cannot fit a ${EDIT_BATCH_TIMEOUT_MINUTES}m batch; deferring ${deferredPrs} PRs`,
    )
    const cause = `edit budget exhausted before batch ${i} (${Math.ceil(left / 1000)}s left)`
    for (let j = i; j < batches.length; j++) {
      for (const d of batches[j]) pendingCauses.set(d.url, cause)
    }
    break
  }
  editBatch(batches[i], i, budgetDeadline)
}

if (deferredFrom >= 0) {
  console.warn(
    `edit pass deferred ${batches.slice(deferredFrom).reduce((n, b) => n + b.length, 0)} PRs due to wall-clock budget`,
  )
}

// Merge batch summaries. Coverage: every worthy PR gets an entry so the PR
// body accounts for it; failed/deferred batches show up as pending (not skipped).
const merged = []
const seen = new Set()
for (let i = 0; i < batches.length; i++) {
  const file = `${OUT_DIR}/edit-summary-${i}.json`
  let entries = []
  try {
    entries = JSON.parse(fs.readFileSync(file, "utf8"))
  } catch {
    continue
  }
  for (const e of entries) {
    const url = String(e?.url ?? "")
    if (!url.startsWith("http") || seen.has(url)) continue
    seen.add(url)
    merged.push({
      pr: Number(e.pr) || 0,
      url,
      action: String(e.action ?? "skipped"),
      reason: String(e.reason ?? ""),
    })
  }
}
for (const d of ordered) {
  if (seen.has(d.url)) continue
  const cause = pendingCauses.get(d.url) || "edit pass failed or timed out for this PR"
  merged.push({ pr: d.number, url: d.url, action: "pending", reason: cause })
}

// upsert-pr.mjs consumes the merged summary from the repo root; the file is
// removed there before committing so it never lands in the docs PR.
fs.writeFileSync(SUMMARY_FILE, JSON.stringify(merged, null, 2))
const changed = merged.filter((e) => e.action !== "skipped" && e.action !== "pending").length
const skipped = merged.filter((e) => e.action === "skipped").length
const pending = merged.filter((e) => e.action === "pending").length
console.log(`edit pass complete: ${changed} changed, ${skipped} skipped, ${pending} pending`)
