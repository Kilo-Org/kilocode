#!/usr/bin/env bun
/**
 * Reset one file to the last merged upstream version after applying Kilo merge
 * branding transforms.
 *
 * Usage:
 *   bun run script/upstream/reset-to-upstream.ts packages/core/src/file.ts
 *   bun run script/upstream/reset-to-upstream.ts packages/core/src/file.ts --dry-run
 */

import path from "node:path"
import { error, header, info, success, warn } from "./utils/logger"
import { resetFile } from "./utils/reset"
import { last, normalize, root } from "./utils/upstream"
import { BASELINE } from "./utils/baseline"

interface Args {
  file?: string
  dryRun: boolean
  force: boolean
  help: boolean
}

function usage() {
  console.log(`Usage: bun run script/upstream/reset-to-upstream.ts <repo-relative-file> [--dry-run]

Resets one file by:
  1. Finding the pinned upstream release (the newest sync merge, or the initial v2 base).
  2. Reading that file from upstream at the pinned release.
  3. Applying the enabled transforms (none with the v2 defaults).
  4. Writing the transformed upstream file to the working tree.

If the file does not exist upstream, the local file is deleted. Binary files are
written back as raw upstream bytes without text transforms.

Options:
  --dry-run  Show what would change without writing the file.
  --force    Reset a file that script/upstream/shared-patches.json lists as an intentional Kilo patch.
  --help     Show this help message.`)
}

function args(): Args {
  const raw = process.argv.slice(2)
  return {
    file: raw.find((arg) => !arg.startsWith("--")),
    dryRun: raw.includes("--dry-run"),
    force: raw.includes("--force"),
    help: raw.includes("--help") || raw.includes("-h"),
  }
}

async function main() {
  const opts = args()
  if (opts.help) {
    usage()
    return
  }
  if (!opts.file) {
    usage()
    process.exit(1)
  }

  const top = await root()
  process.chdir(top)

  const file = normalize(top, opts.file)
  const baseline = await Bun.file(path.join(top, BASELINE))
    .json()
    .catch(() => ({ files: {} }))
  if (baseline.files[file] && !opts.force && !opts.dryRun) {
    error(`${file} is an intentional Kilo patch (${BASELINE}). Pass --force to reset it anyway`)
    process.exit(1)
  }

  header("Reset file to upstream")

  const version = await last()
  success(`Last merged upstream: ${version.tag} (${version.commit.slice(0, 8)})`)

  const result = await resetFile({ root: top, file, commit: version.commit, dryRun: opts.dryRun })

  if (result.action === "deleted") {
    if (opts.dryRun) {
      warn(`${file} does not exist upstream`)
      info(`[DRY-RUN] Would delete ${file}`)
      return
    }
    warn(`${file} does not exist upstream`)
    success(`Deleted ${file}`)
    return
  }

  if (result.action === "identical") {
    success(`${file} already matches transformed upstream ${version.tag}`)
    return
  }

  if (opts.dryRun) {
    info(`[DRY-RUN] Would reset ${file} to transformed upstream ${version.tag}`)
    return
  }

  success(`Reset ${file} to transformed upstream ${version.tag}`)
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
