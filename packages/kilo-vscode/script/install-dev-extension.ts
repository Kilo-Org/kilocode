#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"
import { rmSync, mkdirSync, existsSync, statSync } from "node:fs"

const root = join(import.meta.dir, "..")
const outDir = join(root, "out")
const pkgPath = join(root, "package.json")

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true })
}
mkdirSync(outDir, { recursive: true })

const pkg = await Bun.file(pkgPath).json()
const sha = (await $`git rev-parse --short HEAD`.text()).trim()
const devVersion = `${pkg.version}-dev+${sha}`

await Bun.write(pkgPath, JSON.stringify({ ...pkg, version: devVersion }, null, 2) + "\n")

try {
  await $`bun script/local-bin.ts`.cwd(root)
  await $`bun run check-types`.cwd(root)
  await $`bun run lint`.cwd(root)
  await $`node ${join(root, "esbuild.js")} --production`.cwd(root)
  await $`bunx vsce package --no-dependencies --skip-license -o ${outDir}/`.cwd(root)
} finally {
  await Bun.write(pkgPath, JSON.stringify(pkg, null, 2) + "\n")
}

const vsix = (await $`ls -1v ${outDir}/*.vsix`.text()).trim().split("\n").at(-1)!
const execPath = process.env.VSCODE_EXEC_PATH ?? ""
const cli = execPath.toLowerCase().includes("insiders") ? "code-insiders" : "code"
console.log(`Installing into: ${cli} (VSCODE_EXEC_PATH=${execPath || "<not set>"})`)
await $`${cli} --force --install-extension ${vsix}`
