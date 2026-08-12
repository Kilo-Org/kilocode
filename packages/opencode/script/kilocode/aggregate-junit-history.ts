// Merge per-shard junit artifacts into one file per OS. The unit matrix
// runs each shard in isolation, so a shard that ran last week has no way
// to know what files were slow in sibling shards. After the matrix
// completes, this script reads the per-shard junit bodies the matrix
// uploaded as `unit-<os>-<i>-<attempt>` artifacts, combines them with the
// max-per-file rule, and writes one aggregated junit per OS. The unit
// matrix restores these on the next run so every shard sees the full
// cross-shard history before it splits.
//
// Invoked by the `aggregate-junit-history` job in `.github/workflows/test.yml`:
//   bun script/kilocode/aggregate-junit-history.ts <input-dir> <output-dir>
//
// Layout of <input-dir>: one subdirectory per artifact
// (`unit-linux-1-1/`, `unit-windows-4-6/`, ...), each containing the
// runner's merged `packages/opencode/.artifacts/unit/junit.xml`.

import * as fs from "fs/promises"
import * as path from "path"
import { JunitDurations } from "./junit-durations"

if (!process.argv[2] || !process.argv[3]) {
  console.error("usage: aggregate-junit-history.ts <input-dir> <output-dir>")
  process.exit(2)
}
const inputDir = path.resolve(process.argv[2])
const outputDir = path.resolve(process.argv[3])

// Only Linux and Windows are aggregated. macOS runs the curated `darwin`
// profile against a small fixed test set; the unit matrix skips the
// aggregate restore for macos shards and there is no Save macOS step,
// so writing an aggregate-macos file would be wasted bandwidth.
const osBuckets: Record<string, Record<string, number>> = {
  Linux: {},
  Windows: {},
}

let totalArtifacts = 0
let skippedArtifacts = 0
// Tolerate a missing input dir (e.g. docs-only PRs that never produced
// unit-* artifacts). `walk` below would otherwise throw ENOENT and fail
// the job. Anything already on disk is processed; an empty input is a
// no-op that produces no aggregate files.
try {
  await fs.access(inputDir)
} catch {
  console.log(`no artifacts at ${inputDir}; skipping aggregation`)
  process.exit(0)
}
for (const abs of await walk(inputDir)) {
  const rel = path.relative(inputDir, abs)
  if (!rel.endsWith("/packages/opencode/.artifacts/unit/junit.xml")) continue
  const head = rel.split("/")[0]
  // Macos excluded explicitly; the unit matrix doesn't restore it and
  // there is no Save macOS step, so it'd be a dead write.
  const match = head?.match(/^unit-(linux|windows)-\d+-\d+$/)
  if (!match) {
    skippedArtifacts++
    continue
  }
  const os = match[1][0].toUpperCase() + match[1].slice(1)
  const bucket = osBuckets[os]
  if (!bucket) {
    skippedArtifacts++
    continue
  }
  const content = await Bun.file(abs).text()
  const durations = JunitDurations.parse(content)
  for (const [file, time] of Object.entries(durations)) {
    const prev = bucket[file]
    if (prev === undefined || time > prev) bucket[file] = time
  }
  totalArtifacts++
}

await fs.mkdir(outputDir, { recursive: true })
for (const [os, durations] of Object.entries(osBuckets)) {
  const entries = Object.entries(durations)
  if (entries.length === 0) continue
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuites tests="${entries.length}" failures="0" time="${total(entries)}">`,
    ...entries.map(([file, time]) => `  <testsuite name="${esc(file)}" time="${time}"/>`),
    `</testsuites>`,
    "",
  ].join("\n")
  const out = `${outputDir}/aggregate-${os}.xml`
  await Bun.write(out, body)
  console.log(`wrote ${out} (${entries.length} files)`)
}
console.log(`aggregated ${totalArtifacts} artifacts (${skippedArtifacts} skipped)`)

async function walk(dir: string): Promise<string[]> {
  const out: string[] = []
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...(await walk(full)))
    else out.push(full)
  }
  return out
}

function total(entries: ReadonlyArray<[string, number]>): string {
  let sum = 0
  for (const [, t] of entries) sum += t
  return sum.toFixed(3)
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}