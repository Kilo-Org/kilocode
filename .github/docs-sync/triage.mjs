// kilocode_change - new file

/**
 * Runs the LLM triage pass over docs-sync-out/digest.json in chunks.
 *
 * A daily window holds ~30-50 PRs; a replay can hold several hundred. A
 * single triage call over that volume truncates its JSON output, so the
 * digest is split into chunks of CHUNK_SIZE and each chunk is triaged with
 * its own `kilo run` call. A chunk that fails twice is degraded to
 * "unclassified" entries (docs_worthy=false) instead of failing the run —
 * the PR body then shows those PRs as skipped, visible to reviewers.
 *
 * Env: TRIAGE_MODEL (provider/model), KILO_API_KEY (gateway auth, set by the workflow;
 * the kilo provider reads it natively). Reads the prompt from triage-prompt.md next to this script.
 */

import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { parseTriageEntries } from "./extract-json.mjs"

const CHUNK_SIZE = 25
const ATTEMPTS = 2
const OUT_DIR = "docs-sync-out"

const HERE = path.dirname(fileURLToPath(import.meta.url))
const prompt = fs.readFileSync(path.join(HERE, "triage-prompt.md"), "utf8")
const model = process.env.TRIAGE_MODEL
if (!model) throw new Error("TRIAGE_MODEL is required")

const digest = JSON.parse(fs.readFileSync(`${OUT_DIR}/digest.json`, "utf8"))

function triageChunk(chunk, index) {
  const chunkFile = `${OUT_DIR}/triage-chunk-${index}.json`
  fs.writeFileSync(chunkFile, JSON.stringify(chunk, null, 2))

  for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
    let raw
    try {
      // Message positional first: --file is multi-value and would otherwise
      // consume a trailing message as a file path ("File not found").
      raw = execFileSync(
        "kilo",
        ["run", prompt, "-m", model, "--dir", process.cwd(), "-f", chunkFile],
        { encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: 10 * 60 * 1000, stdio: ["ignore", "pipe", "pipe"] },
      )
    } catch (err) {
      const stderr = String(err.stderr ?? "").trim().split("\n").slice(-5).join("\n")
      console.warn(`chunk ${index} attempt ${attempt}: kilo run failed: ${stderr || err.message}`)
      continue
    }
    fs.writeFileSync(`${OUT_DIR}/triage-raw-${index}.txt`, raw)
    const entries = parseTriageEntries(raw)
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
    console.warn(`chunk ${index} attempt ${attempt}: no valid JSON in output`)
  }

  console.warn(`::warning::chunk ${index} failed triage after ${ATTEMPTS} attempts; marking ${chunk.length} PRs unclassified`)
  return chunk.map((d) => ({
    pr: d.number,
    url: d.url,
    docs_worthy: false,
    reason: "triage failed to classify this PR",
    target_sections: [],
    priority: "medium",
  }))
}

const chunks = []
for (let i = 0; i < digest.length; i += CHUNK_SIZE) {
  chunks.push(digest.slice(i, i + CHUNK_SIZE))
}
console.log(`triaging ${digest.length} PRs in ${chunks.length} chunks of up to ${CHUNK_SIZE}`)

const merged = []
const seen = new Set()
for (let i = 0; i < chunks.length; i++) {
  for (const e of triageChunk(chunks[i], i)) {
    if (seen.has(e.url)) continue
    seen.add(e.url)
    merged.push(e)
  }
}

// Coverage: every digest PR gets a triage entry so the PR body's skipped
// table is complete. Unclassified defaults to not-docs-worthy (conservative).
for (const d of digest) {
  if (seen.has(d.url)) continue
  merged.push({
    pr: d.number,
    url: d.url,
    docs_worthy: false,
    reason: "not classified by triage",
    target_sections: [],
    priority: "medium",
  })
}

fs.writeFileSync(`${OUT_DIR}/triage.json`, JSON.stringify(merged, null, 2))
const worthy = merged.filter((e) => e.docs_worthy).length
console.log(`triage complete: ${merged.length} entries, ${worthy} docs-worthy`)
