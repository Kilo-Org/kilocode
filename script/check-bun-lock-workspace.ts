#!/usr/bin/env bun
// kilocode_change - new file

/**
 * Fails when the committed bun.lock does not match what `bun install` would
 * regenerate for this workspace.
 *
 * `bun install --frozen-lockfile` validates external dependency resolution but
 * does not check the `version` field of workspace entries, so a stale lockfile
 * (e.g. a JetBrains pin bump that forgot to re-run install) passes CI silently.
 * This regenerates the lockfile in place and diffs it against the committed one,
 * making drift explicit.
 *
 * Determinism: CI pins bun via package.json `packageManager`, so regeneration is
 * byte-identical to a maintainer's local `bun install`.
 *
 * Usage: bun script/check-bun-lock-workspace.ts
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"
import os from "node:os"

const ROOT = path.resolve(import.meta.dir, "..")
const LOCK = path.join(ROOT, "bun.lock")

// Snapshot the committed lockfile before regenerating.
const before = readFileSync(LOCK, "utf8")

try {
  // Regenerate the lockfile without touching node_modules.
  execSync("bun install --lockfile-only", { cwd: ROOT, stdio: "pipe" })
  const after = readFileSync(LOCK, "utf8")

  if (before !== after) {
    console.error("bun.lock is out of sync with workspace package.json.")
    console.error("Run 'bun install' and commit the regenerated bun.lock.")
    process.exit(1)
  }
} catch (err) {
  console.error("Failed to run lockfile check:", err)
  process.exit(1)
} finally {
  // Always restore the committed lockfile so the working tree stays clean.
  writeFileSync(LOCK, before)
}