#!/usr/bin/env bun
/**
 * Watches packages/opencode/src/ for changes and rebuilds the CLI binary,
 * then copies it into packages/kilo-vscode/bin/kilo.
 *
 * Used during development so the VS Code extension always has an up-to-date
 * CLI backend without manual rebuild steps.
 */
import { watch, chmodSync } from "node:fs"
import { join, relative } from "node:path"
import { $ } from "bun"

const kiloVscodeDir = join(import.meta.dir, "..")
const packagesDir = join(kiloVscodeDir, "..")
const opencodeDir = join(packagesDir, "opencode")
const opencodeSrcDir = join(opencodeDir, "src")
const targetBinDir = join(kiloVscodeDir, "bin")
const targetBinPath = join(targetBinDir, "kilo")

let building = false
let pending = false
let installed = false

function log(msg: string) {
  console.log(`[watch-cli] ${msg}`)
}

function sourceBinaryPath(): string {
  return join(opencodeDir, "dist", `@kilocode/cli-${process.platform}-${process.arch}`, "bin", "kilo")
}

async function rebuild() {
  if (building) {
    pending = true
    return
  }
  building = true
  pending = false

  try {
    log("Rebuilding CLI binary...")
    const start = performance.now()

    const args = installed ? ["run", "build", "--single", "--skip-install"] : ["run", "build", "--single"]
    const result = await $`bun ${args}`.cwd(opencodeDir).nothrow().quiet()
    if (result.exitCode !== 0) {
      log(`Build failed (exit ${result.exitCode}):\n${result.stderr.toString()}`)
      return
    }
    installed = true

    const source = sourceBinaryPath()
    if (!(await Bun.file(source).exists())) {
      log(`ERROR: Build completed but no binary found at ${relative(packagesDir, source)}`)
      return
    }

    await $`mkdir -p ${targetBinDir}`
    await $`cp ${source} ${targetBinPath}`
    chmodSync(targetBinPath, 0o755)

    const elapsed = ((performance.now() - start) / 1000).toFixed(1)
    log(`Binary updated (${elapsed}s): ${relative(packagesDir, source)} -> bin/kilo`)
  } catch (err) {
    log(`ERROR: ${err instanceof Error ? err.message : String(err)}`)
  } finally {
    building = false
    if (pending) rebuild()
  }
}

// Initial build
await rebuild()

// Watch for changes
log(`Watching ${relative(kiloVscodeDir, opencodeSrcDir)}/ for changes...`)

const debounce = 500
let timer: ReturnType<typeof setTimeout> | null = null

watch(opencodeSrcDir, { recursive: true }, (_event, filename) => {
  if (!filename) return
  // Skip non-source files and build-generated files
  if (filename.endsWith(".test.ts") || filename.endsWith(".test.tsx")) return
  if (filename.includes("models-snapshot")) return

  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    log(`Change detected: ${filename}`)
    rebuild()
  }, debounce)
})

log("CLI watcher running. Press Ctrl+C to stop.")
