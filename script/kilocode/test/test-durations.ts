#!/usr/bin/env bun

/**
 * Refreshes test-durations.json from the JUnit reports of a CI run (the `unit-reports-*` artifacts of `test`):
 *
 *   gh run download <run-id> --pattern 'unit-reports-*' --dir /tmp/unit-reports
 *   bun script/kilocode/test/test-durations.ts /tmp/unit-reports/*\/*.xml
 *
 * The weight of a file is the time of its test suite in the report. Files without a report keep their entry.
 * Use the reports of one platform: the split needs consistent relative times, not absolute ones.
 */

import path from "node:path"

const DURATIONS = path.join(import.meta.dir, "test-durations.json")
const reports = process.argv.slice(2)

if (reports.length === 0) {
  console.error("Usage: bun script/kilocode/test/test-durations.ts <junit.xml>...")
  process.exit(2)
}

const durations: Record<string, number> = await Bun.file(DURATIONS)
  .json()
  .catch(() => ({}))
const fresh = new Map<string, number>()

for (const report of reports) {
  const xml = await Bun.file(report).text()
  // The runner names the merged report after the package directory, for example `packages/core`.
  const pkg = xml.match(/<testsuites\b[^>]*\bname="([^"]*)"/)?.[1]
  if (!pkg) continue
  for (const match of xml.matchAll(/<testsuite\b[^>]*>/g)) {
    const file = attr(match[0], "file")
    const time = Number(attr(match[0], "time"))
    if (!file || !Number.isFinite(time)) continue
    // Nested describe blocks repeat the file; the outer suite has the largest time.
    const key = `${pkg}/${file}`
    fresh.set(key, Math.max(fresh.get(key) ?? 0, Math.round(time * 1000)))
  }
}

const merged = Object.fromEntries(
  Object.entries({ ...durations, ...Object.fromEntries(fresh) }).sort(([a], [b]) => a.localeCompare(b)),
)
await Bun.write(DURATIONS, JSON.stringify(merged, null, 1) + "\n")
console.log(`Updated ${path.basename(DURATIONS)}: ${fresh.size} files from ${reports.length} reports`)

function attr(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ""
}
