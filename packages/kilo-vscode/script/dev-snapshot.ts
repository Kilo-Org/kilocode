#!/usr/bin/env bun
import { $ } from "bun"
import { createRequire } from "node:module"
import { join, dirname } from "node:path"
import { tmpdir } from "node:os"
import { rmSync, mkdirSync, existsSync } from "node:fs"

const mode = process.argv[2] ?? "install"
const shouldInstall = mode === "install"

const root = join(import.meta.dir, "..")
const pkgPath = join(root, "package.json")

const pkg = await Bun.file(pkgPath).json()
const sha = (await $`git rev-parse --short HEAD`.text()).trim()
const user =
  (await $`git config --get --default local user.name`.text())
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "local"
const snapshotVersion = `${pkg.version}-snapshot+${sha}.${user}`

console.log(`Building snapshot version: ${snapshotVersion}`)
console.log(`Base version: ${pkg.version}`)
console.log(`Commit: ${sha}`)
console.log(`Mode: ${mode}\n`)

console.log("🧹 Cleaning build directories...")
const dist = join(root, "dist")
if (existsSync(dist)) {
  rmSync(dist, { recursive: true, force: true })
  console.log("  ✓ Cleaned dist/")
}

const outDir = join(tmpdir(), "kilo-vscode-snapshots")
mkdirSync(outDir, { recursive: true })

console.log("\n📦 Preparing SDK...")
await $`bun run prepare:sdk`.cwd(root)

console.log("\n🔧 Preparing CLI binary and validating extension...")
await $`bun script/local-bin.ts --compiled`.cwd(root)
await $`bun run build:check:production`.cwd(root)

console.log("\n📦 Packaging VSIX...")
const vsixPath = join(outDir, `kilo-vscode-snapshot-${sha}-${user}.vsix`)
const require = createRequire(import.meta.url)
const zlib = require("node:zlib") as typeof import("node:zlib")
const DeflateRaw = zlib.DeflateRaw
if (shouldInstall) {
  // Local installs favor fast packaging and extraction over archive size.
  Object.defineProperty(zlib, "DeflateRaw", {
    value: function (options?: ConstructorParameters<typeof DeflateRaw>[0]) {
      return new DeflateRaw({ ...options, level: 0 })
    },
  })
}
const { createVSIX } = await import("@vscode/vsce")
const marker = join(root, "bin", ".cli-version")
const cache = existsSync(marker) ? await Bun.file(marker).text() : undefined
if (cache !== undefined) rmSync(marker)
try {
  await createVSIX({
    cwd: root,
    packagePath: vsixPath,
    version: snapshotVersion,
    updatePackageJson: false,
    dependencies: false,
    skipLicense: true,
  })
} finally {
  if (cache !== undefined) await Bun.write(marker, cache)
}

if (shouldInstall) {
  const execPath = process.env.VSCODE_EXEC_PATH ?? ""
  const isInsiders = execPath.toLowerCase().includes("insiders")
  const name = isInsiders ? "code-insiders" : "code"
  const winPath = process.platform === "win32" && execPath ? join(dirname(execPath), "bin", name + ".cmd") : ""
  const cli = winPath && existsSync(winPath) ? winPath : name
  console.log(`\n🚀 Installing to ${cli}...`)
  await $`${cli} --force --install-extension ${vsixPath}`

  console.log(`\n✅ Successfully installed snapshot extension!`)
  console.log(`   Version: ${snapshotVersion}`)
}
