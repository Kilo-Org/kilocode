// kilocode_change - new file

/**
 * Filters the full digest down to PRs the triage pass marked docs-worthy.
 * Usage: filter-worthy.mjs <digest-full.json> <triage.json> <output.json>
 * The edit pass consumes the output so its context stays small.
 */

import fs from "node:fs"

const [, , digestPath, triagePath, outputPath] = process.argv
if (!digestPath || !triagePath || !outputPath) {
  console.error("usage: filter-worthy.mjs <digest-full.json> <triage.json> <output.json>")
  process.exit(1)
}

const digest = JSON.parse(fs.readFileSync(digestPath, "utf8"))
const triage = JSON.parse(fs.readFileSync(triagePath, "utf8"))

const worthy = new Set(triage.filter((e) => e.docs_worthy).map((e) => e.url))
const out = digest.filter((d) => worthy.has(d.url))

fs.writeFileSync(outputPath, JSON.stringify(out, null, 2))
console.log(`${out.length} of ${digest.length} digest entries are docs-worthy`)
