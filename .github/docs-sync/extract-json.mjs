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
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start < 0 || end <= start) return null

  let parsed
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

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
