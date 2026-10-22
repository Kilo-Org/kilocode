#!/usr/bin/env bun

/**
 * Build the Kilo JetBrains plugin.
 *
 * Usage:
 *   bun script/build.ts               # Local plugin build
 *   bun script/build.ts --production  # Production plugin build
 *
 * The JetBrains plugin no longer bundles CLI binaries. Runtime downloads the
 * pinned release from GitHub using packages/kilo-jetbrains/package.json version.
 */

import { $ } from "bun"
import { join } from "node:path"

const production = process.argv.includes("--production")
const root = join(import.meta.dir, "..")
const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew"

function log(msg: string) {
  console.log(`[jetbrains-build] ${msg}`)
}

async function buildPlugin() {
  log("Building JetBrains plugin via Gradle...")
  const args = production ? ["-Pproduction=true"] : []
  await $`${gradlew} buildPlugin ${args}`.cwd(root)
  log("Done. Plugin archive is in build/distributions/")
}

try {
  await buildPlugin()
} catch (err) {
  console.error(`[jetbrains-build] ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
