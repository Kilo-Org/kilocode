#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Guards against accidentally inheriting workflows from upstream opencode.
 *
 * We regularly merge upstream. When upstream adds a new workflow under
 * `.github/workflows/`, it silently starts running in our CI unless we
 * explicitly review and accept it. This check makes that decision explicit:
 * the list of allowed workflows is hardcoded below, and any drift (added or
 * removed file in `.github/workflows/`) fails CI until the list is updated
 * deliberately.
 *
 * Only runnable workflows are checked (`.yml` / `.yaml`). Files under
 * `.github/workflows/disabled/` are Kilo-specific and can't run, so they're
 * not tracked here.
 *
 * To accept a new workflow: add its filename to `active`.
 * To drop one: remove its filename from the list.
 */

import { readdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const DIR = path.join(ROOT, ".github", "workflows")

// Workflows we have deliberately accepted into CI. Sort alphabetically.
const active = new Set([
  "auto-docs.yml",
  "beta.yml",
  "check-kilo-generated-artifacts.yml",
  "check-md-table-padding.yml",
  "check-opencode-annotations.yml",
  "check-org-member.yml",
  "close-issues.yml",
  "close-stale-prs.yml",
  "containers.yml",
  "docs-build.yml",
  "docs-check-links.yml",
  "duplicate-issues.yml",
  "generate.yml",
  "nix-eval.yml",
  "nix-hashes.yml",
  "publish-jetbrains.yml",
  "publish.yml",
  "smoke-test.yml",
  "source-check-links.yml",
  "test-vscode.yml",
  "test.yml",
  "triage.yml",
  "typecheck.yml",
  "visual-regression.yml",
  "watch-opencode-releases.yml",
])

// GitHub picks up both .yml and .yaml in .github/workflows/. We accept both so
// an upstream `.yaml` addition also shows up as unexpected drift.
const isWorkflow = (f: string) => f.endsWith(".yml") || f.endsWith(".yaml")
const actualActive = new Set(readdirSync(DIR).filter(isWorkflow))

const missing = [...active].filter((f) => !actualActive.has(f)).sort()
const extra = [...actualActive].filter((f) => !active.has(f)).sort()
const errs: string[] = []
for (const f of extra) {
  errs.push(`unexpected workflow: ${f} — if this was added intentionally, add it to script/check-workflows.ts`)
}
for (const f of missing) {
  errs.push(
    `expected workflow not found: ${f} — if this was removed intentionally, remove it from script/check-workflows.ts`,
  )
}

if (errs.length === 0) {
  console.log(`check-workflows: ok (${actualActive.size} workflows).`)
  process.exit(0)
}

for (const e of errs) console.error(e)
console.error("")
console.error(`Found ${errs.length} workflow drift issue(s).`)
console.error("This guard prevents upstream-merged workflows from silently running in our CI.")
process.exit(1)
