#!/usr/bin/env bun
import { $ } from "bun"
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
for (const dir of ["bin", "dist"]) {
  const dirPath = join(root, dir)
  if (existsSync(dirPath)) {
    rmSync(dirPath, { recursive: true, force: true })
    console.log(`  ✓ Cleaned ${dir}/`)
  }
}

const outDir = join(tmpdir(), "kilo-vscode-snapshots")
mkdirSync(outDir, { recursive: true })

console.log("\n📦 Rebuilding SDK...")
await $`bun run --cwd ../sdk/js build`.cwd(root)

console.log("\n🔧 Preparing CLI binary...")
await $`bun script/local-bin.ts`.cwd(root)

console.log("\n✅ Type-checking...")
await $`bun run typecheck`.cwd(root)

console.log("\n🔍 Linting...")
await $`bun run lint`.cwd(root)

console.log("\n🏗️  Building extension...")
await $`node ${join(root, "esbuild.js")} --production`.cwd(root)

console.log("\n📦 Packaging VSIX...")
const vsixPath = join(outDir, `kilo-vscode-snapshot-${sha}-${user}.vsix`)
await $`bunx vsce package ${snapshotVersion} --no-update-package-json --no-dependencies --skip-license -o ${vsixPath}`.cwd(
  root,
)

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
