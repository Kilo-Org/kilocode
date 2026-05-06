#!/usr/bin/env bun
/**
 * Reset one file to the last merged upstream version after applying Kilo merge
 * branding transforms.
 *
 * Usage:
 *   bun run script/upstream/reset-to-upstream.ts packages/opencode/src/file.ts
 *   bun run script/upstream/reset-to-upstream.ts packages/opencode/src/file.ts --dry-run
 */

import { rm } from "node:fs/promises"
import path from "node:path"
import { error, header, info, success, warn } from "./utils/logger"
import { last, normalize, root, translate, upstreamData } from "./utils/upstream"

interface Args {
  file?: string
  dryRun: boolean
  help: boolean
}

function usage() {
  console.log(`Usage: bun run script/upstream/reset-to-upstream.ts <repo-relative-file> [--dry-run]

Resets one file by:
  1. Finding the newest upstream tag whose commit is already merged into HEAD.
  2. Reading that file from upstream at the merged tag.
  3. Applying upstream merge branding transforms.
  4. Writing the transformed upstream file to the working tree.

If the file does not exist upstream, the local file is deleted. Binary files are
written back as raw upstream bytes without text transforms.

Options:
  --dry-run  Show what would change without writing the file.
  --help     Show this help message.`)
}

function binary(data: Uint8Array) {
  return data.includes(0)
}

function same(left: Uint8Array, right: Uint8Array) {
  return left.length === right.length && left.every((byte, index) => byte === right[index])
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

  header("Reset file to upstream")

  const version = await last()
  success(`Last merged upstream: ${version.tag} (${version.commit.slice(0, 8)})`)

  const data = await upstreamData(version.commit, file)
  if (data === null) {
    warn(`${file} does not exist upstream`)
    if (opts.dryRun) {
      info(`[DRY-RUN] Would delete ${file}`)
      return
    }

    await rm(abs, { force: true })
    success(`Deleted ${file}`)
    return
  }

  if (binary(data)) {
    const current = await Bun.file(abs)
      .arrayBuffer()
      .then((buffer) => new Uint8Array(buffer))
      .catch(() => null)
    if (current && same(current, data)) {
      success(`${file} already matches upstream ${version.tag}`)
      return
    }

    if (opts.dryRun) {
      info(`[DRY-RUN] Would reset binary ${file} to upstream ${version.tag}`)
      return
    }

    await Bun.write(abs, data)
    success(`Reset binary ${file} to upstream ${version.tag}`)
    return
  }

  const base = new TextDecoder().decode(data)
  const next = await translate(file, base)
  const current = await Bun.file(abs)
    .text()
    .catch(() => null)
  if (current === next) {
    success(`${file} already matches transformed upstream ${version.tag}`)
    return
  }

  if (opts.dryRun) {
    info(`[DRY-RUN] Would reset ${file} to transformed upstream ${version.tag}`)
    return
  }

  await Bun.write(abs, next)
  success(`Reset ${file} to transformed upstream ${version.tag}`)
}

main().catch((err) => {
  error(err instanceof Error ? err.message : String(err))
  process.exit(1)
})
