#!/usr/bin/env bun
import { $ } from "bun"
import { join, relative, dirname, basename } from "node:path"
import { chmodSync, statSync, rmSync, readdirSync } from "node:fs"

const forceRebuild = process.argv.includes("--force")

/**
 * Ensures the VS Code extension has a CLI binary at `packages/kilo-vscode/bin/kilo`.
 *
 * Strategy:
 * 1) If `bin/kilo` already exists -> ok.
 * 2) Else try to locate a prebuilt binary produced by `packages/opencode` build.
 * 3) Else try to build it via `bun run build --single` in `packages/opencode`.
 * 4) Copy the resulting binary into `packages/kilo-vscode/bin/kilo` and chmod +x.
 *
 * This script is intended to be run from `packages/kilo-vscode` as part of build/package.
 */

const kiloVscodeDir = join(import.meta.dir, "..")
const packagesDir = join(kiloVscodeDir, "..")
const opencodeDir = join(packagesDir, "opencode")

const targetBinDir = join(kiloVscodeDir, "bin")
const targetBinPath = join(targetBinDir, "kilo")

function log(msg: string) {
  console.log(`[local-bin] ${msg}`)
}

function platformTag(): string {
  const os = process.platform === "win32" ? "windows" : process.platform
  return `cli-${os}-${process.arch}`
}

async function findKiloBinaryInOpencodeDist(): Promise<string | null> {
  const distDir = join(opencodeDir, "dist")

  try {
    readdirSync(distDir)
  } catch {
    return null
  }

  // Prefer the binary matching the current platform (e.g. cli-darwin-arm64)
  const tag = platformTag()
  const preferred = join(distDir, `@kilocode`, tag, "bin", "kilo")
  try {
    statSync(preferred)
    return preferred
  } catch {
    // fall through to generic search
  }

  // Fallback: find any dist/**/bin/kilo
  const queue = [distDir]
  while (queue.length) {
    const dir = queue.pop()
    if (!dir) continue

    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const e of entries) {
      const p = join(dir, e.name)
      if (e.isDirectory()) {
        queue.push(p)
        continue
      }
      if (e.isFile() && e.name === "kilo" && basename(dirname(p)) === "bin") {
        return p
      }
    }
  }
  return null
}

async function ensureBuiltBinary(): Promise<string> {
  const found = await findKiloBinaryInOpencodeDist()
  if (found) return found

  log(
    `No prebuilt binary found under ${relative(kiloVscodeDir, join(opencodeDir, "dist"))} - attempting build via bun.`,
  )

  const bunFile = Bun.file(await Bun.which("bun"))
  if (!(await bunFile.exists())) {
    throw new Error(
      `Bun is required to build the CLI binary, but was not found on PATH. ` +
        `Install bun, or build the CLI separately in ${opencodeDir} and re-run.`,
    )
  }

  // Ensure dependencies are installed before building.
  log("Installing dependencies in opencode package...")
  await $`bun install --frozen-lockfile`.cwd(opencodeDir)

  // Build using the opencode package script.
  await $`bun run build --single`.cwd(opencodeDir)

  const built = await findKiloBinaryInOpencodeDist()
  if (!built) {
    throw new Error(
      `CLI build completed but no binary was found in ${join(opencodeDir, "dist")} (expected dist/**/bin/kilo).`,
    )
  }
  return built
}

async function main() {
  const targetFile = Bun.file(targetBinPath)

  if ((await targetFile.exists()) && !forceRebuild) {
    const st = statSync(targetBinPath)
    log(
      `CLI binary already present at ${relative(kiloVscodeDir, targetBinPath)} (${Math.round(st.size / 1024 / 1024)}MB). Use --force to rebuild.`,
    )
    return
  }

  if ((await targetFile.exists()) && forceRebuild) {
    log(`Removing existing binary (--force).`)
    rmSync(targetBinPath)
    // Also remove the prebuilt dist so ensureBuiltBinary() triggers a fresh build
    const distDir = join(opencodeDir, "dist")
    const distFile = Bun.file(distDir)
    if (await distFile.exists()) {
      rmSync(distDir, { recursive: true })
      log(`Removed ${relative(kiloVscodeDir, distDir)} to force rebuild.`)
    }
  }

  const opencodePkgFile = Bun.file(join(opencodeDir, "package.json"))
  if (!(await opencodePkgFile.exists())) {
    throw new Error(`Expected opencode package at ${opencodeDir}, but it does not exist.`)
  }

  const sourceBinPath = await ensureBuiltBinary()
  await $`mkdir -p ${targetBinDir}`
  await $`cp ${sourceBinPath} ${targetBinPath}`
  chmodSync(targetBinPath, 0o755)

  log(`Copied CLI binary from ${relative(packagesDir, sourceBinPath)} -> ${relative(kiloVscodeDir, targetBinPath)}`)
}

try {
  await main()
} catch (err) {
  console.error(`[local-bin] ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
