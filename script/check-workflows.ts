#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Keeps upstream OpenCode workflows out of Kilo CI.
 *
 * The Kilo v2 line merges `upstream/v2` regularly. Upstream workflows can publish, deploy, post, label or
 * close things, and a merge can bring them back: a new upstream workflow arrives as a new file, and an
 * upstream change to a workflow that Kilo removed arrives as a modify/delete conflict.
 *
 * Check (CI): `bun script/check-workflows.ts` fails when `.github/workflows/` differs from `active`.
 *
 * Fix (after an upstream merge): `bun script/check-workflows.ts --fix` runs `git rm -f` on every workflow in
 * `removed` that the merge brought back, which also resolves its modify/delete conflict. This is the v2 form
 * of the v1 merge tooling `skipFiles` list (`script/upstream/utils/config.ts` on `main`). A workflow that is
 * in neither list still fails the check, so a person reviews it.
 *
 * To accept a workflow: review what it does, then add its filename to `active`.
 * To drop an upstream workflow: delete the file and move its filename to `removed`.
 */

import { $ } from "bun"
import { readdirSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const DIR = path.join(ROOT, ".github", "workflows")

// Workflows deliberately accepted into Kilo CI. Sort alphabetically.
const active = new Set([
  // Upstream: lint and typecheck (`bun run check`).
  "check.yml",
  // Kilo: v2 lane (this guard).
  "kilo-v2.yml",
  // Upstream: unit, e2e and compiled CLI smoke tests.
  "test.yml",
])

// Upstream workflows that Kilo removed: they act outside Kilo CI, or they never trigger on Kilo branches.
// Sort alphabetically.
const removed = new Set([
  "close-issues.yml",
  "close-prs.yml",
  "compliance-close.yml",
  "containers.yml",
  "deploy-changelog.yml",
  "deploy-files.yml",
  "deploy-posts.yml",
  "deploy-update.yml",
  "deploy-www.yml",
  "deploy.yml",
  "docs-locale-sync.yml",
  "docs-update.yml",
  "duplicate-issues.yml",
  "models-snapshot.yml",
  "nix-eval.yml",
  "nix-hashes.yml",
  "notify-discord.yml",
  "opencode.yml",
  "pr-management.yml",
  "pr-standards.yml",
  "publish-github-action.yml",
  "publish-vscode.yml",
  "publish.yml",
  "release-github-action.yml",
  "review.yml",
  "stats.yml",
  "storybook.yml",
  "triage.yml",
])

// GitHub runs both .yml and .yaml files in .github/workflows/, so both count as drift.
const workflows = () => readdirSync(DIR).filter((file) => file.endsWith(".yml") || file.endsWith(".yaml"))

if (process.argv.includes("--fix")) {
  for (const file of workflows().filter((file) => removed.has(file))) {
    await $`git rm -f --quiet ${path.join(".github", "workflows", file)}`.cwd(ROOT)
    console.log(`check-workflows: removed ${file}`)
  }
}

const actual = new Set(workflows())
const errors = [
  ...[...actual]
    .filter((file) => !active.has(file))
    .map((file) =>
      removed.has(file)
        ? `removed upstream workflow is back: ${file}. Run \`bun script/check-workflows.ts --fix\``
        : `unexpected workflow: ${file}. Review it, then add it to \`active\` or \`removed\` in script/check-workflows.ts`,
    ),
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
