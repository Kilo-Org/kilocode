#!/usr/bin/env bun
/**
 * Analyze an upstream sync without changing the working tree: the same as `merge.ts --dry-run`.
 *
 * Usage:
 *   bun script/upstream/analyze.ts [--version v2.0.27] [--commit <sha>] [--base-branch <name>] [--output <path>] [--no-fetch]
 *
 * It prints and saves the real conflicts (from `git merge-tree`), new upstream workflows, the shared
 * files Kilo patched that upstream changed, the commits and harness change the merge adds, and the
 * lag before and after.
 */

import { main } from "./merge"
import { error } from "./utils/logger"

main(["--dry-run", ...process.argv.slice(2)]).catch((err) => {
  error(`Error: ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
