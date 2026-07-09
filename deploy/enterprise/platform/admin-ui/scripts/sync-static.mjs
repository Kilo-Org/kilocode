#!/usr/bin/env node
/**
 * Copy Umi build output into Go embed static dir.
 * Usage: node scripts/sync-static.mjs
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const dist = join(root, "dist")
const target = join(root, "..", "internal", "admin", "static")

if (!existsSync(dist)) {
  console.error("[sync-static] missing dist/ — run max build first")
  process.exit(1)
}

if (existsSync(target)) {
  for (const name of readdirSync(target)) {
    if (name === ".gitkeep") continue
    rmSync(join(target, name), { recursive: true, force: true })
  }
} else {
  mkdirSync(target, { recursive: true })
}

cpSync(dist, target, { recursive: true })
console.log("[sync-static] copied", dist, "→", target)
