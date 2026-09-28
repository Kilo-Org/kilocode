#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Fails when a workspace package's on-disk version disagrees with its entry in
 * bun.lock.
 *
 * `bun install --frozen-lockfile` validates external dependency resolution but
 * does not check the `version` field of workspace entries, so a stale lockfile
 * (e.g. a JetBrains pin bump that forgot to re-run install) passes CI silently.
 * This makes the drift explicit.
 *
 * Usage: bun script/check-bun-lock-workspace.ts
 */

import { readFileSync, existsSync } from "node:fs"
import path from "node:path"

const ROOT = path.resolve(import.meta.dir, "..")
const LOCK = path.join(ROOT, "bun.lock")

// bun.lock is JSONC (trailing commas). Strip them before parsing.
const raw = readFileSync(LOCK, "utf8").replace(/,\s*([}\]])/g, "$1")
const lock = JSON.parse(raw)

let drift = false

for (const [pkgPath, entry] of Object.entries(lock.workspaces ?? {})) {
  if (pkgPath === "" || !pkgPath.startsWith("packages/")) continue
  const pkgJson = path.join(ROOT, pkgPath, "package.json")
  if (!existsSync(pkgJson)) continue
  const onDisk = JSON.parse(readFileSync(pkgJson, "utf8")).version
  if (onDisk && entry.version && onDisk !== entry.version) {
    console.error(`${pkgJson}: on-disk ${onDisk} != lockfile ${entry.version}`)
    drift = true
  }
}

if (drift) {
  console.error("Run 'bun install' and commit the regenerated bun.lock.")
  process.exit(1)
}