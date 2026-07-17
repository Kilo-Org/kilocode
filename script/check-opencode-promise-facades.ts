#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Prevents new service-local runtimes in shared Effect modules while the
 * remaining Kilo Promise facades are migrated away. It also prevents tests
 * from reaching through the global application runtime unless the integration
 * boundary is explicitly classified.
 *
 * Existing sites are allowed only when classified below. Remove transitional
 * entries after their migration lands so later reintroductions fail CI.
 */

import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const DIR = path.join(ROOT, "packages", "opencode", "src")
const TEST_DIR = path.join(ROOT, "packages", "opencode", "test")
const PATTERN = /makeRuntime\s*\(\s*Service\s*,/g
const TEST_PATTERN = /\bAppRuntime\b/g

const allow: Record<string, string> = {
  "bus/index.ts": "core bus callback and synchronous runtime boundary",
  "cli/cmd/run/runtime.boot.ts": "direct run startup resolver runtime boundary",
  "cli/cmd/run/stream.transport.ts": "per-subscription direct run transport runtime boundary",
  "config/tui.ts": "separately tracked TUI config facade moved by the upstream TUI extraction",
  "installation/index.ts": "existing installation facade outside #10655",
}

const testAllow: Record<string, { count: number; reason: string }> = {
  "preload.ts": { count: 2, reason: "global test-suite AppRuntime cleanup boundary" },
  "kilocode/config-resilience.test.ts": { count: 4, reason: "existing runtime integration test" },
  "kilocode/config-validation.test.ts": { count: 2, reason: "existing runtime integration test" },
  "kilocode/plan-followup.test.ts": { count: 3, reason: "existing runtime integration test" },
  "kilocode/session-compaction-chunks.test.ts": {
    count: 2,
    reason: "disk-backed instance integration test cleanup",
  },
  "kilocode/session-fork-remap.test.ts": {
    count: 2,
    reason: "disk-backed instance integration test cleanup",
  },
  "kilocode/session/platform-attribution.test.ts": { count: 2, reason: "existing runtime integration test" },
  "kilocode/session-prompt-queue.test.ts": { count: 6, reason: "prompt queue legacy instance bridge regression" },
  "server/experimental-session-list.test.ts": { count: 2, reason: "Kilo session list integration test" },
  "kilocode/server/cloud-session-import.test.ts": { count: 5, reason: "full app cloud import transaction integration" },
  "kilocode/server/listener-runtime.test.ts": { count: 4, reason: "listener and AppRuntime integration test" },
  "tool/recall.test.ts": { count: 11, reason: "existing runtime integration test" },
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

const testHits: Array<{ file: string; line: number }> = []
for (const file of glob.scanSync({ cwd: TEST_DIR, onlyFiles: true })) {
  const text = await Bun.file(path.join(TEST_DIR, file)).text()
  for (const match of text.matchAll(TEST_PATTERN)) {
    const line = text.slice(0, match.index ?? 0).split("\n").length
    testHits.push({ file, line })
  }
}

const testInvalid = testHits.filter((hit) => !testAllow[hit.file])
const testDrift = Object.entries(testAllow).flatMap(([file, entry]) => {
  const count = testHits.filter((hit) => hit.file === file).length
  if (count === entry.count) return []
  return [
    `  packages/opencode/test/${file}: expected ${entry.count} classified reference(s), found ${count} (${entry.reason})`,
  ]
})

if (invalid.length > 0 || drift.length > 0 || testInvalid.length > 0 || testDrift.length > 0) {
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
  if (testInvalid.length > 0) {
    console.error("Found unclassified AppRuntime use in opencode tests:")
    for (const hit of testInvalid) console.error(`  packages/opencode/test/${hit.file}:${hit.line}`)
    console.error("")
  }
  if (testDrift.length > 0) {
    console.error("Classified test AppRuntime exceptions no longer match the current source:")
    for (const item of testDrift) console.error(item)
    console.error("")
  }
  console.error("Do not add Promise facades to shared Effect services or global AppRuntime dependencies to tests.")
  console.error("Yield services directly in scoped layers, or classify intentional integration boundaries explicitly.")
  console.error("Remove migrated exceptions, or classify intentional runtime changes with an explicit reason.")
  process.exit(1)
}

console.log(
  `check-opencode-promise-facades: ${hits.length} classified runtime site(s), ${testHits.length} classified test reference(s), no runtime drift found.`,
)
