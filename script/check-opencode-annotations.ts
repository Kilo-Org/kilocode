#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Checks that every Kilo line in a shared upstream file carries a `kilocode_change` marker.
 *
 * The v2 line compares the whole Kilo tree with the pinned upstream release commit (the merge base
 * with upstream), not only the lines of one pull request:
 * - the pin is the second parent of the newest `chore(upstream): sync v2.x.y (<sha>)` merge in the
 *   history, or the initial base of `v2` before the first sync (`script/upstream/utils/upstream.ts`).
 * - Kilo-owned paths and generated files such as bun.lock need no markers (`script/upstream/utils/owned.ts`).
 * - A shared file that cannot carry markers (for example JSON) is allowed only when
 *   `script/upstream/shared-patches.json` lists it with an `unmarked` reason.
 *
 * Usage:
 *   bun script/check-opencode-annotations.ts               # HEAD against the pin
 *   bun script/check-opencode-annotations.ts --worktree    # working tree (untracked files included)
 *   bun script/check-opencode-annotations.ts --pin <ref>   # another upstream commit
 *
 * Covered lines:
 *   const url = Flag.KILO_MODELS_URL || "https://models.dev" // kilocode_change
 *   // kilocode_change start
 *   ...
 *   // kilocode_change end
 *   // kilocode_change - new file          (first line: the whole file)
 * JSX `{/* kilocode_change *\/}`, YAML/TOML/shell `# kilocode_change` and Markdown `<!-- kilocode_change -->`
 * work the same way. Empty lines need no marker.
 */

import { parseArgs, readBaseline, repoRoot } from "./upstream/utils/baseline"
import { sharedFiles } from "./upstream/utils/shared"
import { pinned } from "./upstream/utils/upstream"
import { owned } from "./upstream/utils/owned"

const args = parseArgs(process.argv.slice(2))
const root = await repoRoot()
const pin = args.pin ?? (await pinned("HEAD")).commit
const baseline = await readBaseline(root, args.baseline)
const files = await sharedFiles({ pin, ref: args.worktree ? undefined : "HEAD", cwd: root })

const violations = files
  .filter((file) => file.unmarked.length > 0 && !baseline.files[file.path]?.unmarked)
  .flatMap((file) => file.unmarked.map((item) => `  ${file.path}:${item.line}: ${item.text}`))

if (violations.length === 0) {
  console.log(`check-opencode-annotations: ok (${files.length} shared files against ${pin.slice(0, 11)})`)
  process.exit(0)
}

console.error(
  [
    `Unmarked Kilo changes in shared upstream files (against upstream ${pin.slice(0, 11)}):`,
    "",
    ...violations,
    "",
    "Mark every Kilo change in a shared upstream file:",
    "  inline:   const x = 1 // kilocode_change",
    "  block:    // kilocode_change start ... // kilocode_change end",
    "  new file: // kilocode_change - new file   (first line)",
    "  JSX {/* kilocode_change */}, YAML/shell # kilocode_change, Markdown <!-- kilocode_change -->",
    "",
    "Before you add a patch to a shared file, try the plugin-first order: 1 Kilo plugin, 2 Kilo host,",
    "3 small seam patch, 4 feature patch (last resort). See migration-tracking/principles.md, section 2.",
    "A file that cannot carry markers (JSON) needs an `unmarked` reason in script/upstream/shared-patches.json.",
    "",
    "Kilo-owned paths (no markers needed):",
    ...owned.map((pattern) => `  - ${pattern}`),
  ].join("\n"),
)
process.exit(1)
