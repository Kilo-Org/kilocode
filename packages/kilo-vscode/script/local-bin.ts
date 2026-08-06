#!/usr/bin/env bun
import { $ } from "bun"
import { createHash } from "node:crypto"
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
const compiledOnly = process.argv.includes("--compiled")

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
const repoDir = join(packagesDir, "..")
const opencodeDir = join(packagesDir, "opencode")
const sandboxDir = join(packagesDir, "kilo-sandbox")
const rootFile = join(repoDir, "package.json")

const targetBinDir = join(kiloVscodeDir, "bin")
const binName = process.platform === "win32" ? "kilo.exe" : "kilo"
const targetBinPath = join(targetBinDir, binName)
const versionFile = join(kiloVscodeDir, "node_modules", ".kilo-cli-version")

function log(msg: string) {
  console.log(`[local-bin] ${msg}`)
}

type Package = {
  name?: string
  workspaces?: string[] | { packages?: string[] }
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
}

async function cliInputs() {
  const root: Package = await Bun.file(rootFile).json()
  const workspaces = Array.isArray(root.workspaces) ? root.workspaces : (root.workspaces?.packages ?? [])
  const files = (
    await Promise.all(
      workspaces.map((pattern) =>
        Array.fromAsync(new Bun.Glob(`${pattern}/package.json`).scan({ cwd: repoDir, onlyFiles: true })),
      ),
    )
  ).flat()
  const entries = await Promise.all(
    files.map(async (file) => ({ file, pkg: (await Bun.file(join(repoDir, file)).json()) as Package })),
  )
  const packages = new Map(entries.flatMap((entry) => (entry.pkg.name ? [[entry.pkg.name, entry] as const] : [])))
  const dirs = new Set<string>()

  function visit(name: string) {
    const entry = packages.get(name)
    if (!entry) return
    const dir = dirname(entry.file)
    if (dirs.has(dir)) return
    dirs.add(dir)
    const deps = {
      ...entry.pkg.dependencies,
      ...entry.pkg.devDependencies,
      ...entry.pkg.optionalDependencies,
      ...entry.pkg.peerDependencies,
    }
    for (const dep of Object.keys(deps)) visit(dep)
  }

  // The CLI build embeds the console even though it is not a package dependency.
  for (const dir of [opencodeDir, join(packagesDir, "kilo-console")]) {
    const pkg: Package = await Bun.file(join(dir, "package.json")).json()
    if (!pkg.name) throw new Error(`Workspace package at ${dir} has no name`)
    visit(pkg.name)
  }

  return [
    relative(repoDir, rootFile),
    "bun.lock",
    "patches",
    ...[...dirs].sort(),
    "packages/kilo-vscode/script/bwrap-helper.ts",
    "packages/kilo-vscode/script/ffmpeg-helper.ts",
    "packages/kilo-vscode/script/local-bin.ts",
    "packages/kilo-vscode/src/services/cli-backend/cli-resources.ts",
  ]
}

async function cliSourceHash() {
  try {
    const inputs = await cliInputs()
    const [tree, diff, extra, branch] = await Promise.all([
      $`git ls-tree -r HEAD -- ${inputs}`.cwd(repoDir).quiet(),
      $`git diff --binary HEAD -- ${inputs}`.cwd(repoDir).quiet(),
      $`git ls-files --others --exclude-standard -z -- ${inputs}`.cwd(repoDir).quiet(),
      $`git branch --show-current`.cwd(repoDir).quiet(),
    ])
    const env = Object.fromEntries(
      [
        "GH_REPO",
        "KILO_BUMP",
        "KILO_BWRAP_CACHE",
        "KILO_CHANNEL",
        "KILO_MODELS_URL",
        "KILO_PRE_RELEASE",
        "KILO_RELEASE",
        "KILO_SKIP_BUNDLED_BWRAP",
        "KILO_VERSION",
        "MODELS_DEV_API_JSON",
        "ZIG",
      ].map((key) => [key, process.env[key] ?? ""]),
    )
    const hash = createHash("sha256")
      .update(tree.text())
      .update(diff.text())
      .update(branch.text())
      .update(JSON.stringify(env))
    const files = extra.text().split("\0").filter(Boolean).sort()

    for (const file of files) {
      hash.update(file)
      hash.update(new Uint8Array(await Bun.file(join(repoDir, file)).arrayBuffer()))
    }

    const models = process.env.MODELS_DEV_API_JSON
    if (models) hash.update(new Uint8Array(await Bun.file(models).arrayBuffer()))
    return hash.digest("hex")
  } catch (err) {
    log(`Could not determine CLI source hash: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}

async function isStale() {
  const hash = await cliSourceHash()
  if (!hash) {
    if (!compiledOnly) return false
    try {
      const stored: unknown = await Bun.file(versionFile).json()
      return Reflect.get(stored, "kind") !== "compiled"
    } catch {
      return true
    }
  }
  try {
    const stored: unknown = await Bun.file(versionFile).json()
    if (!stored || typeof stored !== "object") return true
    const input = Reflect.get(stored, "input")
    const target = Reflect.get(stored, "target")
    const kind = Reflect.get(stored, "kind")
    return input !== hash || target !== platformTag() || (compiledOnly && kind !== "compiled")
  } catch {
    return true // no version file — treat as stale
  }
}

async function writeVersion(kind: "compiled" | "wrapper") {
  const input = await cliSourceHash()
  if (!input) {
    rmSync(versionFile, { force: true })
    return
  }
  await Bun.write(versionFile, JSON.stringify({ input, target: platformTag(), kind }) + "\n")
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

  if (compiledOnly) return null

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

  if (!Bun.which("bun")) {
    throw new Error(
      `Bun is required to build the CLI binary, but was not found on PATH. ` +
        `Install bun, or build the CLI separately in ${opencodeDir} and re-run.`,
    )
  }

  // Use the repository-pinned Bun version throughout. Newer canaries can fail compilation
  // and must not cause packaged snapshots to fall back to the browser-mode source wrapper.
  const pkg = await Bun.file(join(repoDir, "package.json")).json()
  const bun = String(pkg.packageManager)
  log("Installing dependencies in opencode package...")
  await $`bunx ${bun} install --frozen-lockfile`.cwd(opencodeDir)
  await $`bunx ${bun} run build --single --skip-install`.cwd(opencodeDir)

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
      `exec ${JSON.stringify(bun)} --conditions=node src/index.ts "$@"`,
      "",
    ].join("\n"),
  )
  chmodSync(targetBinPath, 0o755)
  await bundleKiloSandboxWorker()
  await ensureLocalHelpers()

  await writeVersion("wrapper")
  log(
    `Compiled CLI build failed; wrote source wrapper at ${relative(kiloVscodeDir, targetBinPath)} for local development.`,
  )
}

async function main() {
  for (const file of [join(targetBinDir, ".cli-version"), join(targetBinDir, ".ffmpeg-target")]) {
    rmSync(file, { force: true })
  }
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

  if ((forceRebuild || compiledOnly) && !ready) {
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
    if (forceRebuild || compiledOnly) throw err
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

  await writeVersion("compiled")

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
