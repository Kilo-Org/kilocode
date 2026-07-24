// kilocode_change - new file

/**
 * Runs the LLM edit pass over docs-sync-out/worthy.json in batches.
 *
 * Batching bounds each `kilo run` context (a replay window can yield dozens
 * of docs-worthy PRs with large diffs). Each batch gets its own CLI session
 * and writes its own summary file; results are merged into
 * docs-sync-out/edit-summary.json. A batch that fails is skipped with a
 * warning — its PRs show up in the rolling PR body as skipped, so nothing
 * fails silently.
 *
 * Env: EDIT_MODEL (provider/model), KILO_API_KEY (set by workflow; read natively by the kilo provider).
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const BATCH_SIZE = 5
const ATTEMPTS = 2
const OUT_DIR = "docs-sync-out"
export const SUMMARY_FILE = ".docs-sync-summary.json"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const basePrompt = fs.readFileSync(path.join(HERE, "edit-prompt.md"), "utf8")
const model = process.env.EDIT_MODEL
if (!model) throw new Error("EDIT_MODEL is required")

const worthy = JSON.parse(fs.readFileSync(`${OUT_DIR}/worthy.json`, "utf8"))
const triage = JSON.parse(fs.readFileSync(`${OUT_DIR}/triage.json`, "utf8"))
const priority = new Map(triage.map((e) => [e.url, e]))
const ordered = [...worthy].sort((a, b) => {
  const rank = { high: 0, medium: 1, low: 2 }
  return (rank[priority.get(a.url)?.priority] ?? 1) - (rank[priority.get(b.url)?.priority] ?? 1)
})

function editBatch(batch, index) {
  const batchFile = `${OUT_DIR}/edit-batch-${index}.json`
  const triageFile = `${OUT_DIR}/edit-batch-triage-${index}.json`
  const summaryFile = `${OUT_DIR}/edit-summary-${index}.json`
  fs.writeFileSync(batchFile, JSON.stringify(batch, null, 2))
  fs.writeFileSync(
    triageFile,
    JSON.stringify(
      batch.map((d) => priority.get(d.url)).filter(Boolean),
      null,
      2,
    ),
  )

  const prompt = `${basePrompt}

Batch specifics for this run: the PRs to handle are in the attached ${batchFile} (full details) and ${triageFile} (triage verdicts). Handle ONLY the PRs in these batch files. When finished, write your per-PR results in the summary JSON format described above to the file \`${summaryFile}\` (path relative to the repository root).`

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    try {
      // Message positional first: --file is multi-value and would otherwise
      // consume a trailing message as a file path ("File not found").
      execFileSync(
        "kilo",
        ["run", prompt, "-m", model, "--variant", "high", "--dir", process.cwd(), "-f", batchFile, "-f", triageFile],
        // stdout streams live to the Actions log; stderr is piped so failure
        // warnings can include the tail of the actual CLI error.
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 25 * 60 * 1000, stdio: ["ignore", "inherit", "pipe"] },
      )
      if (fs.existsSync(summaryFile)) return true
      // Tolerate the agent dropping the docs-sync-out/ prefix.
      const alt = path.basename(summaryFile)
      if (fs.existsSync(alt)) {
        fs.renameSync(alt, summaryFile)
        return true
      }
      console.warn(`batch ${index} attempt ${attempt}: summary file ${summaryFile} not produced`)
    } catch (err) {
      const stderr = String(err.stderr ?? "").trim().split("\n").slice(-5).join("\n")
      console.warn(`batch ${index} attempt ${attempt}: kilo run failed: ${stderr || err.message}`)
    }
  }
  console.warn(`::warning::edit batch ${index} failed after ${ATTEMPTS} attempts; ${batch.length} PRs skipped`)
  return false
}

const batches = []
for (let i = 0; i < ordered.length; i += BATCH_SIZE) {
  batches.push(ordered.slice(i, i + BATCH_SIZE))
}
console.log(`editing docs for ${ordered.length} PRs in ${batches.length} batches of up to ${BATCH_SIZE}`)

for (let i = 0; i < batches.length; i++) {
  editBatch(batches[i], i)
}

// Merge batch summaries. Coverage: every worthy PR gets an entry so the PR
// body accounts for it; failed batches show up as skipped.
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
    merged.push({ pr: Number(e.pr) || 0, url, action: String(e.action ?? "skipped"), reason: String(e.reason ?? "") })
  }
}
for (const d of ordered) {
  if (seen.has(d.url)) continue
  merged.push({ pr: d.number, url: d.url, action: "skipped", reason: "edit pass failed or timed out for this PR" })
}

// upsert-pr.mjs consumes the merged summary from the repo root; the file is
// removed there before committing so it never lands in the docs PR.
fs.writeFileSync(SUMMARY_FILE, JSON.stringify(merged, null, 2))
console.log(`edit pass complete: ${merged.filter((e) => e.action !== "skipped").length} changed, ${merged.filter((e) => e.action === "skipped").length} skipped`)
