#!/usr/bin/env bun
/**
 * Rebuild kilocode_change markers for one file by comparing it with the last
 * merged upstream version.
 *
 * Usage:
 *   bun run script/upstream/fix-kilocode-markers.ts packages/opencode/src/file.ts
 *   bun run script/upstream/fix-kilocode-markers.ts packages/opencode/src/file.ts --dry-run
 */

import path from "node:path"
import { error, header, info, success, warn } from "./utils/logger"
import {
  annotate,
  annotates,
  changed,
  clean,
  fresh,
  ranges,
  supported,
} from "./utils/markers"
import { last, normalize, root, translate, upstream } from "./utils/upstream"

interface Args {
  file?: string
  dryRun: boolean
  help: boolean
}

function usage() {
  console.log(`Usage: bun run script/upstream/fix-kilocode-markers.ts <repo-relative-file> [--dry-run]

Rebuilds kilocode_change markers by:
  1. Finding the newest upstream tag whose commit is already merged into HEAD.
  2. Applying upstream merge branding transforms to that upstream file.
  3. Comparing the transformed upstream file with the current working tree file.
  4. Removing existing kilocode_change markers and adding fresh markers around remaining changed lines.

Options:
  --dry-run  Show what would change without writing the file.
  --help     Show this help message.`)
}

function args(): Args {
  const raw = process.argv.slice(2)
  return {
    file: raw.find((arg) => !arg.startsWith("--")),
    dryRun: raw.includes("--dry-run"),
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
  const abs = path.join(top, file)
  const current = await Bun.file(abs).text()
  if (!supported(file, current)) throw new Error(`Cannot safely add comment markers to ${file}`)
  if (current.includes("\0")) throw new Error(`${file} appears to be binary`)

  header("Fix kilocode_change markers")

  const version = await last()
  success(`Last merged upstream: ${version.tag} (${version.commit.slice(0, 8)})`)

  const base = await upstream(version.commit, file)
  const head = clean(file, current)
  const baseText = base === null ? null : await translate(file, base)
  const diff = baseText === null ? null : await changed(clean(file, baseText).text, head.text)
  const found = ranges(diff?.lines ?? new Set())
  const next = base === null ? fresh(file, head) : annotate(file, head, found)

  if (base === null && annotates(file)) warn(`${file} does not exist upstream; marked as a new Kilo file`)
  if (base === null && !annotates(file)) warn(`${file} does not exist upstream`)
  if (diff && diff.deleted > 0)
    warn(`${diff.deleted} upstream-only deleted line(s) cannot be annotated in the current file`)
  if (!annotates(file)) warn(`${file} is exempt from annotation checks; this command still reports differences`)
  if (!annotates(file)) {
    success(`${file} differs from ${version.tag} in ${found.length} range(s)`)
    return
  }

  if (next === current) {
    success(`${file} already has normalized kilocode_change markers`)
    return
  }

  if (opts.dryRun) {
    info(`[DRY-RUN] Would update ${file}`)
    return
  }

  await Bun.write(abs, next)
  success(`Updated ${file}`)
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
