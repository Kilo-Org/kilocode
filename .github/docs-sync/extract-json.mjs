// kilocode_change - new file

/**
 * Extracts and validates the triage JSON array from raw LLM stdout.
 * Usage: extract-json.mjs <raw-input-file> <output-file>
 * Exit 0 on success, 1 on any failure. Also exports parseTriageEntries for
 * the chunked triage runner.
 */

import fs from "node:fs"
import { pathToFileURL } from "node:url"

/** Returns validated triage entries, or null when extraction fails. */
export function parseTriageEntries(raw) {
  // `kilo run` prints the assistant message twice (streaming render + final
  // summary), so stdout can hold the same array back-to-back. Try each "["
  // from the right and return the first slice that parses — i.e. the last
  // (most recent) valid array in the output.
  const end = raw.lastIndexOf("]")
  if (end < 0) return null

  const starts = []
  for (let i = 0; i <= end; i++) {
    if (raw[i] === "[") starts.push(i)
  }

  for (let s = starts.length - 1; s >= 0; s--) {
    let parsed
    try {
      parsed = JSON.parse(raw.slice(starts[s], end + 1))
    } catch {
      continue
    }
    if (!Array.isArray(parsed)) continue
    const entries = validate(parsed)
    if (entries) return entries
  }
  return null
}

function validate(parsed) {
  const entries = []
  for (const e of parsed) {
    const pr = Number(e?.pr)
    const url = String(e?.url ?? "")
    if (!Number.isInteger(pr) || !url.startsWith("http")) continue
    entries.push({
      pr,
      url,
      docs_worthy: e.docs_worthy === true,
      reason: String(e.reason ?? ""),
      target_sections: Array.isArray(e.target_sections) ? e.target_sections.map(String) : [],
      priority: ["high", "medium", "low"].includes(e.priority) ? e.priority : "medium",
    })
  }
  return entries.length > 0 ? entries : null
}

function main() {
  const [, , inputPath, outputPath] = process.argv
  if (!inputPath || !outputPath) {
    console.error("usage: extract-json.mjs <raw-input-file> <output-file>")
    process.exit(1)
  }
  const entries = parseTriageEntries(fs.readFileSync(inputPath, "utf8"))
  if (!entries) {
    console.error("no valid triage JSON array found in input")
    process.exit(1)
  }
  fs.writeFileSync(outputPath, JSON.stringify(entries, null, 2))
  console.log(`extracted ${entries.length} triage entries (${entries.filter((e) => e.docs_worthy).length} docs-worthy)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
