#!/usr/bin/env bun
import { $ } from "bun"
import { join, relative, dirname, basename } from "node:path"
import { chmodSync, statSync, rmSync, readdirSync, existsSync } from "node:fs"
import {
  copyKiloSandboxWorker,
  copySandboxResources,
  copyTreeSitterResources,
  hasKiloSandboxWorker,
  hasTreeSitterResources,
  kiloSandboxWorkerForBinary,
  sanitizeSandboxResources,
} from "../src/services/cli-backend/cli-resources"
import { currentBwrapTarget, ensureBwrapForTarget } from "./bwrap-helper"
import { currentFfmpegTarget, ensureFfmpegForTarget } from "./ffmpeg-helper"

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
const coreDir = join(packagesDir, "core")
const gatewayDir = join(packagesDir, "kilo-gateway")
const indexingDir = join(packagesDir, "kilo-indexing")
const sandboxDir = join(packagesDir, "kilo-sandbox")

const targetBinDir = join(kiloVscodeDir, "bin")
const binName = process.platform === "win32" ? "kilo.exe" : "kilo"
const targetBinPath = join(targetBinDir, binName)
const versionFile = join(targetBinDir, ".cli-version")

function log(msg: string) {
  console.log(`[local-bin] ${msg}`)
}

async function cliSourceHash(): Promise<string | null> {
  try {
    const opencodeResult = await $`git log -1 --format=%H -- .`.cwd(opencodeDir).quiet()
    const coreResult = await $`git log -1 --format=%H -- .`.cwd(coreDir).quiet()
    const gatewayResult = await $`git log -1 --format=%H -- .`.cwd(gatewayDir).quiet()
    const indexingResult = await $`git log -1 --format=%H -- .`.cwd(indexingDir).quiet()
    const sandboxResult = await $`git log -1 --format=%H -- .`.cwd(sandboxDir).quiet()
    return `${opencodeResult.text().trim()}-${coreResult.text().trim()}-${gatewayResult.text().trim()}-${indexingResult.text().trim()}-${sandboxResult.text().trim()}`
  } catch {
    return null
  }
}

async function isDirty(): Promise<boolean> {
  try {
    const opencodeResult = await $`git status --porcelain -- .`.cwd(opencodeDir).quiet()
    const coreResult = await $`git status --porcelain -- .`.cwd(coreDir).quiet()
    const gatewayResult = await $`git status --porcelain -- .`.cwd(gatewayDir).quiet()
    const indexingResult = await $`git status --porcelain -- .`.cwd(indexingDir).quiet()
    const sandboxResult = await $`git status --porcelain -- .`.cwd(sandboxDir).quiet()
    return (
      opencodeResult.text().trim().length > 0 ||
      coreResult.text().trim().length > 0 ||
      gatewayResult.text().trim().length > 0 ||
      indexingResult.text().trim().length > 0 ||
      sandboxResult.text().trim().length > 0
    )
  } catch {
    return false
  }
}

async function isStale(): Promise<boolean> {
  if (await isDirty()) return true
  const hash = await cliSourceHash()
  if (!hash) return false // can't determine — assume fresh
  try {
    const stored = (await Bun.file(versionFile).text()).trim()
    return stored !== hash
  } catch {
    return true // no version file — treat as stale
  }
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
  const preferred = join(distDir, `@kilocode`, tag, "bin", binName)
  try {
    statSync(preferred)
    if (!hasTreeSitterResources(preferred) || !hasKiloSandboxWorker(preferred)) return null
    return preferred
  } catch {
    // fall through to generic search
  }

  // Fallback: find any dist/**/bin/kilo or kilo.exe
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
      if (e.isFile() && (e.name === "kilo" || e.name === "kilo.exe") && basename(dirname(p)) === "bin") {
        if (!hasTreeSitterResources(p) || !hasKiloSandboxWorker(p)) continue
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

  const bunPath = Bun.which("bun")
  if (!bunPath) {
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

async function bundleKiloSandboxWorker() {
  const result = await Bun.build({
    entrypoints: [join(sandboxDir, "src", "kilo-sandbox-mutation-worker.ts")],
    target: "bun",
    format: "esm",
    minify: true,
  })
  if (!result.success || result.outputs.length !== 1) throw new Error("Could not bundle Kilo sandbox mutation worker")
  await Bun.write(kiloSandboxWorkerForBinary(targetBinPath), result.outputs[0])
}

async function ensureLocalHelpers() {
  await ensureFfmpegForTarget(currentFfmpegTarget(), targetBinDir)
  if (process.env.KILO_SKIP_BUNDLED_BWRAP === "1") return
  if (await sanitizeSandboxResources(targetBinDir, true)) return
  await ensureBwrapForTarget(currentBwrapTarget())
}

async function writeSourceWrapper() {
  if (process.platform === "win32") {
    throw new Error("Compiled CLI build failed and source wrapper fallback is not supported on Windows.")
  }

  const bun = Bun.which("bun") ?? "bun"
  await $`mkdir -p ${targetBinDir}`
  await Bun.write(
    targetBinPath,
    [
      "#!/usr/bin/env bash",
      "set -euo pipefail",
      `cd ${JSON.stringify(opencodeDir)}`,
      `exec ${JSON.stringify(bun)} --conditions=browser src/index.ts "$@"`,
      "",
    ].join("\n"),
  )
  chmodSync(targetBinPath, 0o755)
  await bundleKiloSandboxWorker()
  await ensureLocalHelpers()

  const hash = await cliSourceHash()
  if (hash) await Bun.write(versionFile, hash + "\n")
  log(
    `Compiled CLI build failed; wrote source wrapper at ${relative(kiloVscodeDir, targetBinPath)} for local development.`,
  )
}

async function main() {
  const targetFile = Bun.file(targetBinPath)
  const exists = await targetFile.exists()
  const ready = exists && hasTreeSitterResources(targetBinPath) && hasKiloSandboxWorker(targetBinPath)

  const stale = ready && !forceRebuild && (await isStale())
  const rebuild = forceRebuild || stale || !ready

  if (ready && !rebuild) {
    const st = statSync(targetBinPath)
    log(
      `CLI binary already present at ${relative(kiloVscodeDir, targetBinPath)} (${Math.round(st.size / 1024 / 1024)}MB). Use --force to rebuild.`,
    )
    await ensureLocalHelpers()
    return
  }

  if (forceRebuild && !exists) {
    removeDist()
  }

  if (exists && rebuild) {
    log(stale ? `CLI source has changed — rebuilding.` : `Refreshing existing CLI resources.`)
    rmSync(targetBinPath)
    if (forceRebuild || stale || !ready) {
      removeDist()
    }
  }

  const opencodePkgFile = Bun.file(join(opencodeDir, "package.json"))
  if (!(await opencodePkgFile.exists())) {
    throw new Error(`Expected opencode package at ${opencodeDir}, but it does not exist.`)
  }

  const sourceBinPath = await ensureBuiltBinary().catch(async (err) => {
    await writeSourceWrapper()
    log(`Wrapper fallback reason: ${err instanceof Error ? err.message : String(err)}`)
    return null
  })
  if (!sourceBinPath) return
  await $`mkdir -p ${targetBinDir}`
  await $`cp ${sourceBinPath} ${targetBinPath}`
  await copyTreeSitterResources(sourceBinPath, targetBinPath)
  await copySandboxResources(sourceBinPath, targetBinPath)
  await copyKiloSandboxWorker(sourceBinPath, targetBinPath)
  chmodSync(targetBinPath, 0o755)
  await ensureLocalHelpers()

  const hash = await cliSourceHash()
  if (hash) await Bun.write(versionFile, hash + "\n")

  log(`Copied CLI binary from ${relative(packagesDir, sourceBinPath)} -> ${relative(kiloVscodeDir, targetBinPath)}`)
}

function removeDist() {
  // Also remove the prebuilt dist so ensureBuiltBinary() triggers a fresh build
  const distDir = join(opencodeDir, "dist")
  if (!existsSync(distDir)) return
  rmSync(distDir, { recursive: true })
  log(`Removed ${relative(kiloVscodeDir, distDir)} to force rebuild.`)
}

try {
  await main()
} catch (err) {
  console.error(`[local-bin] ERROR: ${err instanceof Error ? err.message : String(err)}`)
  process.exit(1)
}
