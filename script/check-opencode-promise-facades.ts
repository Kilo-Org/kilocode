#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Prevents new service-local runtimes in shared Effect modules while the
 * remaining Kilo Promise facades are migrated away.
 *
 * Existing sites are allowed only when classified below. Remove transitional
 * entries after their migration lands so later reintroductions fail CI.
 */

import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const DIR = path.join(ROOT, "packages", "opencode", "src")
const PATTERN = /makeRuntime\s*\(\s*Service\s*,/g

const allow: Record<string, string> = {
  "bus/index.ts": "core bus callback and synchronous runtime boundary",
  "cli/cmd/tui/config/tui.ts": "separately tracked TUI config facade",
  "installation/index.ts": "existing installation facade outside #10655",
  "permission/index.ts": "transitional facade removed by #10620",
  "project/vcs.ts": "transitional facade removed by #10620",
  "question/index.ts": "transitional facade deferred for upstream reconciliation in #10655",
  "session/compaction.ts": "existing compaction facade outside #10655",
  "session/prompt.ts": "transitional facade tracked by #10655",
  "session/session.ts": "transitional facade tracked by #10655",
  "sync/index.ts": "sync event runtime boundary",
}

const owned = (file: string) => file.startsWith("kilocode/") || file.startsWith("kilo-sessions/")
const hits: Array<{ file: string; line: number }> = []
const glob = new Bun.Glob("**/*.ts")

for (const file of glob.scanSync({ cwd: DIR, onlyFiles: true })) {
  if (owned(file)) continue
  const text = await Bun.file(path.join(DIR, file)).text()
  for (const match of text.matchAll(PATTERN)) {
    const line = text.slice(0, match.index ?? 0).split("\n").length
    hits.push({ file, line })
  }
}

const invalid = hits.filter((hit) => !allow[hit.file])
const drift = Object.entries(allow).flatMap(([file, reason]) => {
  const count = hits.filter((hit) => hit.file === file).length
  if (count === 1) return []
  return [`  packages/opencode/src/${file}: expected 1 classified site, found ${count} (${reason})`]
})

if (invalid.length > 0 || drift.length > 0) {
  if (invalid.length > 0) {
    console.error("Found unclassified service-local Effect runtimes in shared opencode modules:")
    for (const hit of invalid) console.error(`  packages/opencode/src/${hit.file}:${hit.line}`)
    console.error("")
  }
  if (drift.length > 0) {
    console.error("Classified service-local runtime exceptions no longer match the current source:")
    for (const item of drift) console.error(item)
    console.error("")
  }
  console.error("Do not add Promise facades to shared Effect services.")
  console.error("Yield the service directly, or bridge at an existing AppRuntime or Kilo-owned boundary.")
  console.error("Remove migrated exceptions, or classify intentional runtime changes with an explicit reason.")
  process.exit(1)
}

console.log(`check-opencode-promise-facades: ${hits.length} classified runtime site(s), no facade drift found.`)
