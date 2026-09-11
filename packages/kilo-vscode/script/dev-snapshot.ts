#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"
import { rmSync, mkdirSync, existsSync } from "node:fs"
import { directories, environment } from "./response-lens-environment"

const mode = process.argv[2] ?? "build"
if (mode !== "build")
  throw new Error(
    "This Response Lens candidate is build-only. Test it in the isolated profile; working-profile installation requires separate approval.",
  )

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
const stamp = Date.now().toString()
const snapshotVersion = `${pkg.version}-snapshot.${stamp}+${sha}.${user}`
const isolated = join(root, "..", "..", ".kilo-dev", "build", stamp)
for (const dir of directories(isolated)) mkdirSync(dir, { recursive: true })
const env = environment(isolated, process.env.KILO_BUILD_BUN ?? process.execPath, snapshotVersion)

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

const outDir = join(root, "..", "..", ".kilo-dev", "artifacts")
mkdirSync(outDir, { recursive: true })

console.log("\n📦 Preparing SDK...")
await $`bun run prepare:sdk`.cwd(root).env(env)

console.log("\n🔧 Preparing CLI binary and validating extension...")
await $`bun script/local-bin.ts --compiled`.cwd(root).env(env)
await $`bun run build:check:production`.cwd(root).env(env)

console.log("\n📦 Packaging VSIX...")
const vsixPath = join(outDir, `response-lens-${pkg.version}-${stamp}.vsix`)
const { createVSIX } = await import("@vscode/vsce")
await createVSIX({
  cwd: root,
  packagePath: vsixPath,
  version: snapshotVersion,
  updatePackageJson: false,
  dependencies: false,
  skipLicense: true,
})

console.log(`\nCandidate built, NOT installed: ${vsixPath}`)
