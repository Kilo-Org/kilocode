#!/usr/bin/env bun

/**
 * Refreshes test-durations.json from the JUnit reports of a CI run (the `unit-reports-*` artifacts of `test`):
 *
 *   gh run download <run-id> --pattern 'unit-reports-*' --dir /tmp/unit-reports
 *   bun script/kilocode/test/test-durations.ts linux /tmp/unit-reports/unit-reports-linux-*\/*.xml
 *   bun script/kilocode/test/test-durations.ts win32 /tmp/unit-reports/unit-reports-windows-*\/*.xml
 *
 * The first argument is the platform section to update (`process.platform` of the runner that reads it).
 * The weight of a file is the time of its test suite in the report. Files without a report keep their entry.
 */

import path from "node:path"

const DURATIONS = path.join(import.meta.dir, "test-durations.json")

/**
 * Milliseconds per `<package>/<file>` key in one merged runner report. Bun writes a `file` attribute on every
 * suite (with backslashes on Windows) and the describe name as `name` of a nested suite, so the key uses `file`.
 * Suites without `file` are the runner's records of a crashed or timed-out process.
 */
export function suiteTimes(xml: string) {
  // The runner names the merged report after the package directory, for example `packages/core`.
  const pkg = xml.match(/<testsuites\b[^>]*\bname="([^"]*)"/)?.[1]
  const times = new Map<string, number>()
  if (!pkg) return times
  for (const match of xml.matchAll(/<testsuite\b[^>]*>/g)) {
    const file = attr(match[0], "file").replaceAll("\\", "/")
    const time = Number(attr(match[0], "time"))
    if (!file || !Number.isFinite(time)) continue
    // Nested describe blocks repeat the file; the outer suite has the largest time.
    const key = `${pkg}/${file}`
    times.set(key, Math.max(times.get(key) ?? 0, Math.round(time * 1000)))
  }
  return times
}

export function attr(tag: string, name: string) {
  return tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1] ?? ""
}

if (import.meta.main) {
  const [platform, ...reports] = process.argv.slice(2)
  if (!platform || !["linux", "win32", "darwin"].includes(platform) || reports.length === 0) {
    console.error("Usage: bun script/kilocode/test/test-durations.ts <linux|win32|darwin> <junit.xml>...")
    process.exit(2)
  }
  const sections: Record<string, Record<string, number>> = await Bun.file(DURATIONS)
    .json()
    .catch(() => ({}))
  const fresh = new Map((await Promise.all(reports.map(async (report) => [...suiteTimes(await Bun.file(report).text())]))).flat())
  const merged = Object.fromEntries(
    Object.entries({ ...sections[platform], ...Object.fromEntries(fresh) }).sort(([a], [b]) => a.localeCompare(b)),
  )
  await Bun.write(DURATIONS, JSON.stringify({ ...sections, [platform]: merged }, null, 1) + "\n")
  console.log(`Updated ${path.basename(DURATIONS)} (${platform}): ${fresh.size} files from ${reports.length} reports`)
}
