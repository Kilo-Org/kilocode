#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { Script } from "@opencode-ai/script"

const prerelease = process.env.KILO_PRE_RELEASE === "true"

console.log(`Publishing VSCode extension for ${prerelease ? "pre-release" : "release"}: v${Script.version}`)

const outDir = process.env.VSIX_DIR || join(import.meta.dir, "..", "out")

console.log(`Using VSIX directory: ${outDir}`)

if (!existsSync(outDir)) {
  throw new Error(`VSIX directory not found: ${outDir}`)
}

const targets = [
  "linux-x64",
  "linux-arm64",
  "alpine-x64",
  "alpine-arm64",
  "darwin-x64",
  "darwin-arm64",
  "win32-x64",
  "win32-arm64",
]

const vsixFiles: string[] = []
for (const target of targets) {
  const vsixPath = join(outDir, `kilo-vscode-${target}.vsix`)
  if (!existsSync(vsixPath)) {
    throw new Error(`VSIX file not found: ${vsixPath}`)
  }
  vsixFiles.push(vsixPath)
}

console.log(`\nFound ${vsixFiles.length} VSIX files`)

const flag = prerelease ? ["--pre-release"] : []

for (const target of targets) {
  const vsixPath = join(outDir, `kilo-vscode-${target}.vsix`)
  console.log(`\n🚀 Publishing ${target} to VS Code Marketplace${prerelease ? " (pre-release)" : ""}...`)
  await $`vsce publish ${flag} --packagePath ${vsixPath}`
  console.log(`  ✅ Published ${target} to VS Code Marketplace`)

  console.log(`\n📤 Publishing ${target} to Open VSX${prerelease ? " (pre-release)" : ""}...`)
  await retry(() => $`npx ovsx publish ${flag} --pat ${process.env.OPENVSX_TOKEN} --packagePath ${vsixPath}`, {
    attempts: 3,
    delay: 10_000,
    label: `ovsx publish ${target}`,
  })
  console.log(`  ✅ Published ${target} to Open VSX`)
}

if (Script.release) {
  console.log(`\n📤 Uploading VSIX files to GitHub release v${Script.version}...`)
  await $`gh release upload v${Script.version} ${vsixFiles} --clobber`
  console.log(`  ✅ Uploaded all VSIX files to GitHub release`)
}

console.log("\n✨ All targets published successfully!")

async function retry<T>(fn: () => Promise<T>, opts: { attempts: number; delay: number; label: string }): Promise<T> {
  for (let i = 1; i <= opts.attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === opts.attempts) throw err
      console.warn(`  ⚠️  ${opts.label} failed (attempt ${i}/${opts.attempts}), retrying in ${opts.delay / 1000}s...`)
      await new Promise((r) => setTimeout(r, opts.delay))
    }
  }
  throw new Error("unreachable")
}
