#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { Script } from "@opencode-ai/script"

console.log(`Publishing VSCode extension for release: v${Script.version}`)

const outDir = process.env.VSIX_DIR || join(import.meta.dir, "..", "out")
console.log(`Using VSIX directory: ${outDir}`)

if (!existsSync(outDir)) {
  throw new Error(`VSIX directory not found: ${outDir}`)
}

const targets = ["linux-x64", "linux-arm64", "alpine-x64", "alpine-arm64", "darwin-x64", "darwin-arm64", "win32-x64"]

const vsixFiles: string[] = []
for (const target of targets) {
  const vsixPath = join(outDir, `kilo-vscode-${target}.vsix`)
  if (!existsSync(vsixPath)) {
    throw new Error(`VSIX file not found: ${vsixPath}`)
  }
  vsixFiles.push(vsixPath)
}

console.log(`\nFound ${vsixFiles.length} VSIX files`)

for (const target of targets) {
  const vsixPath = join(outDir, `kilo-vscode-${target}.vsix`)

  console.log(`\n🚀 Publishing ${target} to VS Code Marketplace...`)
  await $`vsce publish --pre-release --packagePath ${vsixPath}`
  console.log(`  ✅ Published ${target} to VS Code Marketplace`)

  // Note: Open VSX publishing is commented out as it doesn't support prereleases
  // console.log(`\n📤 Publishing ${target} to Open VSX...`)
  // await $`npx ovsx publish ${vsixPath} --target ${target} -p ${process.env.OPENVSX_TOKEN}`
  // console.log(`  ✅ Published ${target} to Open VSX`)
}

if (Script.release) {
  console.log(`\n📤 Uploading VSIX files to GitHub release v${Script.version}...`)
  await $`gh release upload v${Script.version} ${vsixFiles} --clobber`
  console.log(`  ✅ Uploaded all VSIX files to GitHub release`)
}

console.log("\n✨ All targets published successfully!")
