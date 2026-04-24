#!/usr/bin/env bun

/**
 * Build the Kilo JetBrains plugin.
 *
 * Usage:
 *   bun script/build.ts               # Local build — only current platform binary required
 *   bun script/build.ts --production  # Production build — all 6 platform binaries required
 *   bun script/build.ts --prepare-cli # Only prepare local CLI resources for Gradle
 *
 * Steps:
 * 1. Builds CLI binaries (or uses prebuilt ones from dist/).
 *    Local: builds only current platform (--single).
 *    Production: builds all platforms.
 * 2. Copies them into backend/build/generated/cli/cli/{os}/kilo[.exe]
 *    so they end up inside the backend jar at /cli/{os}/kilo.
 * 3. Invokes Gradle to build the plugin.
 */

import { $ } from "bun"
import { join, relative } from "node:path"
import { existsSync, mkdirSync, chmodSync, cpSync, rmSync } from "node:fs"

const production = process.argv.includes("--production")
const cliOnly = process.argv.includes("--prepare-cli")

const root = join(import.meta.dir, "..")
const packages = join(root, "..")
const opencodeDir = join(packages, "opencode")
const distDir = join(opencodeDir, "dist")
const cliDir = join(root, "backend", "build", "generated", "cli", "cli")

/** All desktop platforms. */
const platforms = [
  { os: "darwin-arm64", exe: "kilo" },
  { os: "darwin-x64", exe: "kilo" },
  { os: "linux-arm64", exe: "kilo" },
  { os: "linux-x64", exe: "kilo" },
  { os: "windows-x64", exe: "kilo.exe" },
  { os: "windows-arm64", exe: "kilo.exe" },
] as const

function localPlatformTag(): string {
  const os = process.platform === "win32" ? "windows" : process.platform
  return `${os}-${process.arch}`
}

function log(msg: string) {
  console.log(`[jetbrains-build] ${msg}`)
}

function distBinPath(os: string, exe: string): string {
  return join(distDir, `@kilocode/cli-${os}`, "bin", exe)
}

function hasDist(): boolean {
  if (production) {
    return platforms.every((p) => existsSync(distBinPath(p.os, p.exe)))
  }
  const tag = localPlatformTag()
  const local = platforms.find((p) => p.os === tag)
  return local ? existsSync(distBinPath(local.os, local.exe)) : false
}

async function prepareCli() {
  const mode = production ? "production" : "local"
  log(`Mode: ${mode}`)

  if (!hasDist()) {
    log("Building CLI binaries via opencode...")
    if (!existsSync(join(opencodeDir, "package.json"))) {
      throw new Error(`Expected opencode package at ${opencodeDir}`)
    }
    const args = production ? [] : ["--single"]
    await $`bun run build ${args}`.cwd(opencodeDir)
  } else {
    log("Found prebuilt CLI binaries in opencode/dist/, skipping CLI build")
  }

  if (existsSync(cliDir)) {
    rmSync(cliDir, { recursive: true })
  }

  const missing: string[] = []
  let copied = 0
  for (const p of platforms) {
    const src = distBinPath(p.os, p.exe)
    if (!existsSync(src)) {
      missing.push(p.os)
      continue
    }

    const dir = join(cliDir, p.os)
    mkdirSync(dir, { recursive: true })
    const dest = join(dir, p.exe)
    cpSync(src, dest)
    chmodSync(dest, 0o755)
    copied++
    log(`Copied ${relative(root, src)} -> ${relative(root, dest)}`)
  }

  if (copied === 0) {
    throw new Error("No CLI binaries were copied — the build cannot proceed")
  }

  if (production && missing.length > 0) {
    throw new Error(`Production build requires all platform binaries. Missing: ${missing.join(", ")}`)
  }

  if (missing.length > 0) {
    log(`Skipped ${missing.length} platforms (not needed for local build): ${missing.join(", ")}`)
  }

  log(`Copied ${copied}/${platforms.length} platform binaries`)
}

const gradlew = process.platform === "win32" ? "gradlew.bat" : "./gradlew"

async function buildPlugin() {
  log("Building JetBrains plugin via Gradle...")
  const args = production ? ["-Pproduction=true"] : []
  await $`${gradlew} buildPlugin ${args}`.cwd(root)
  log("Done. Plugin archive is in build/distributions/")
}

try {
  await prepareCli()
  if (!cliOnly) {
    await buildPlugin()
  }
} catch (err) {
  console.error(`[jetbrains-build] ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
