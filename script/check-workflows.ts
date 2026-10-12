#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Guards against accidentally inheriting workflows from upstream OpenCode.
 *
 * The Kilo v2 line merges `upstream/v2` regularly. When upstream adds a workflow under
 * `.github/workflows/`, or a merge brings back one that Kilo removed, it silently starts to run in
 * Kilo's CI. Upstream workflows can publish, deploy, post, label or close things. This check makes
 * that decision explicit: the allowed workflows are listed below, and any drift (an added or a
 * removed file) fails CI until the list is updated deliberately.
 *
 * To accept a new workflow: review what it does, then add its filename to `active`.
 * To drop one: delete the file and remove its filename from `active`.
 */

import { readdirSync } from "node:fs"
import path from "node:path"

const DIR = path.resolve(import.meta.dir, "..", ".github", "workflows")

// Workflows deliberately accepted into Kilo CI. Sort alphabetically.
const active = new Set([
  // Upstream: lint and typecheck (`bun run check`).
  "check.yml",
  // Kilo: v2 lane (this guard).
  "kilo-v2.yml",
  // Upstream: unit, e2e and compiled CLI smoke tests.
  "test.yml",
])

// GitHub runs both .yml and .yaml files in .github/workflows/, so both count as drift.
const actual = new Set(readdirSync(DIR).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml")))

const errors = [
  ...[...actual]
    .filter((file) => !active.has(file))
    .map((file) => `unexpected workflow: ${file}. If it was added intentionally, add it to script/check-workflows.ts`),
  ...[...active]
    .filter((file) => !actual.has(file))
    .map(
      (file) =>
        `expected workflow not found: ${file}. If it was removed intentionally, remove it from script/check-workflows.ts`,
    ),
].sort()

if (errors.length === 0) {
  console.log(`check-workflows: ok (${actual.size} workflows)`)
  process.exit(0)
}

for (const error of errors) console.error(error)
console.error("")
console.error(`Found ${errors.length} workflow drift issue(s).`)
console.error("This guard keeps workflows from upstream merges from running in Kilo CI without review.")
process.exit(1)
