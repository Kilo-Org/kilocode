#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Shared-patch counter (unit U-L3-01): counts Kilo's patches in shared upstream files against the
 * pinned upstream release, and fails when the count grows without a stated seam.
 *
 * It prints each shared file Kilo adds or changes, its marked lines, its unmarked lines (allowed only
 * for files with an `unmarked` reason, for example JSON), and the shared files Kilo deleted.
 * Generated files (bun.lock, see script/upstream/utils/owned.ts) are listed but not counted.
 *
 * It fails when:
 * - a shared file that Kilo adds or changes has no entry (rung and seam) in script/upstream/shared-patches.json
 * - a count is above its limit in that file
 *
 * To add a shared patch: add the file entry with its rung and the missing seam, and raise the limit
 * in the same pull request. When a count goes down, lower the limit so it cannot grow back silently.
 *
 * Usage:
 *   bun script/check-shared-patches.ts               # HEAD against the pin
 *   bun script/check-shared-patches.ts --worktree    # working tree
 *   bun script/check-shared-patches.ts --json        # machine-readable counts
 *   bun script/check-shared-patches.ts --pin <ref>   # another upstream commit
 */

import { parseArgs, readBaseline, repoRoot, BASELINE, type Limits } from "./upstream/utils/baseline"
import { sharedFiles } from "./upstream/utils/shared"
import { pinned } from "./upstream/utils/upstream"

const args = parseArgs(process.argv.slice(2))
const root = await repoRoot()
const pin = args.pin ?? (await pinned("HEAD")).commit
const baseline = await readBaseline(root, args.baseline)
const files = await sharedFiles({ pin, ref: args.worktree ? undefined : "HEAD", cwd: root })

const patched = files.filter((file) => file.status !== "D" && !file.generated).sort((a, b) => a.path.localeCompare(b.path))
const generated = files.filter((file) => file.generated).map((file) => file.path).sort()
// Deleted workflows are governed by script/check-workflows.ts (its `removed` list), so a sync that
// brings a new upstream workflow does not change this count.
const removed = files.filter((file) => file.status === "D" && !file.generated).map((file) => file.path).sort()
const workflows = removed.filter((file) => file.startsWith(".github/workflows/"))
const deleted = removed.filter((file) => !file.startsWith(".github/workflows/"))
const counts: Limits = {
  files: patched.length,
  markedLines: patched.reduce((sum, file) => sum + file.marked, 0),
  unmarkedLines: patched.reduce((sum, file) => sum + file.unmarked.length, 0),
  deletedFiles: deleted.length,
}

if (args.json) {
  console.log(JSON.stringify({ pin, counts, limits: baseline.limits, files: patched, deleted, workflows, generated }, null, 2))
}

if (!args.json) {
  console.log(`Shared-patch counter against upstream ${pin.slice(0, 11)}`)
  console.log("")
  console.log("| File | Status | Rung | Marked | Unmarked | Removed |")
  console.log("|---|---|---|---|---|---|")
  for (const file of patched) {
    const entry = baseline.files[file.path]
    console.log(
      `| ${file.path} | ${file.status} | ${entry?.rung ?? "?"} | ${file.marked} | ${file.unmarked.length} | ${file.removed} |`,
    )
  }
  console.log("")
  console.log(`Deleted shared files: ${deleted.length}`)
  for (const file of deleted) console.log(`  - ${file}`)
  console.log(`Deleted upstream workflows (script/check-workflows.ts): ${workflows.length}`)
  console.log(`Generated shared files (not counted): ${generated.length === 0 ? "none" : generated.join(", ")}`)
  console.log("")
  console.log("| Count | Current | Limit |")
  console.log("|---|---|---|")
  for (const key of Object.keys(counts) as (keyof Limits)[]) {
    console.log(`| ${key} | ${counts[key]} | ${baseline.limits[key]} |`)
  }
  console.log("")
}

const errors = [
  ...patched
    .filter((file) => !baseline.files[file.path])
    .map((file) => `new shared patch without a stated seam: ${file.path}. Add it to ${BASELINE} with its rung and seam`),
  ...(Object.keys(counts) as (keyof Limits)[])
    .filter((key) => counts[key] > baseline.limits[key])
    .map(
      (key) =>
        `${key} grew from ${baseline.limits[key]} to ${counts[key]}. State the seam in ${BASELINE} and raise the limit in the same PR`,
    ),
]
const lower = (Object.keys(counts) as (keyof Limits)[]).filter((key) => counts[key] < baseline.limits[key])
const stale = Object.keys(baseline.files).filter((file) => !patched.some((item) => item.path === file))

for (const key of lower) console.error(`note: ${key} went down to ${counts[key]}. Lower its limit in ${BASELINE}`)
for (const file of stale) console.error(`note: ${file} is no longer patched. Remove its entry from ${BASELINE}`)

if (errors.length === 0) {
  console.error("check-shared-patches: ok")
  process.exit(0)
}

for (const error of errors) console.error(error)
console.error("")
console.error("Before you patch a shared file, try the plugin-first order (.kilo/skills/v2-migration/SKILL.md).")
process.exit(1)
