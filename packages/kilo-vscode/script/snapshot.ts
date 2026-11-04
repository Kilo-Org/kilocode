#!/usr/bin/env bun
// Builds and optionally installs a VSIX stamped with the current commit and Git user.
// Usage: bun run snapshot:build | bun run snapshot:install
import { $ } from "bun"
import { existsSync, mkdirSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import path from "node:path"
import { binary, prepare, resolveTarget, root } from "./package"

const mode = Bun.argv[2] ?? "install"
if (mode !== "build" && mode !== "install") throw new Error(`Unknown mode ${mode}. Use build or install.`)

const pkg = (await Bun.file(path.join(root, "package.json")).json()) as { version: string }
const sha = (await $`git rev-parse --short HEAD`.text()).trim()
const user =
  (await $`git config --get --default local user.name`.text())
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "local"
const version = `${pkg.version}-snapshot+${sha}.${user}`
const target = resolveTarget()
const out = path.join(tmpdir(), "kilo-vscode-snapshots")

console.log(`Snapshot version: ${version}`)
console.log(`Commit: ${sha}`)
console.log(`Mode: ${mode}\n`)

const cli = path.resolve(root, "..", "kilo-cli")
if (!existsSync(binary(target))) {
  console.log("Building the Kilo host CLI")
  const build = Bun.spawn([process.execPath, path.join(cli, "script", "build.ts"), "--single", "--skip-web-ui"], {
    cwd: cli,
    stdout: "inherit",
    stderr: "inherit",
  })
  if ((await build.exited) !== 0) throw new Error("CLI build failed")
}

await prepare(target)
mkdirSync(out, { recursive: true })
const vsix = path.join(out, `kilo-vscode-snapshot-${sha}-${user}.vsix`)

if (mode === "install") {
  // Local installs favor fast packaging and extraction over archive size.
  const vsce = createRequire(createRequire(import.meta.url).resolve("@vscode/vsce"))
  type Options = Record<string, unknown>
  type Zip = {
    addFile(path: string, name: string, options?: Options): void
    addBuffer(data: Uint8Array, name: string, options?: Options): void
  }
  const zip = (vsce("yazl") as { ZipFile: { prototype: Zip } }).ZipFile.prototype
  const file = zip.addFile
  const buffer = zip.addBuffer
  zip.addFile = function (this: Zip, filePath, name, options) {
    return file.call(this, filePath, name, { ...options, compress: false })
  }
  zip.addBuffer = function (this: Zip, data, name, options) {
    return buffer.call(this, data, name, { ...options, compress: false })
  }
}

const { createVSIX } = await import("@vscode/vsce")
await createVSIX({
  cwd: root,
  packagePath: vsix,
  version,
  updatePackageJson: false,
  dependencies: false,
  skipLicense: true,
  allowMissingRepository: true,
})
console.log(`Packaged ${vsix}`)

async function install(file: string) {
  const execPath = process.env.VSCODE_EXEC_PATH ?? ""
  const name = execPath.toLowerCase().includes("insiders") ? "code-insiders" : "code"
  const win = process.platform === "win32" && execPath ? path.join(path.dirname(execPath), "bin", `${name}.cmd`) : ""
  const cli = win && existsSync(win) ? win : name
  console.log(`Installing to ${cli}`)
  const child = Bun.spawn([cli, "--force", "--install-extension", file], { stdout: "inherit", stderr: "inherit" })
  if ((await child.exited) !== 0) throw new Error("Extension install failed")
}

if (mode === "install") await install(vsix)
