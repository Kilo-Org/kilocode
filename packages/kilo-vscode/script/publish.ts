#!/usr/bin/env bun
import { $ } from "bun"
import { join } from "node:path"
import { existsSync } from "node:fs"
import { Script } from "@opencode-ai/script"
import { Manifest, Policy } from "../../../script/kilocode/sbom/index"

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

// CRA evidence is checked before the first irreversible Marketplace upload, not
// after. Marketplace and Open VSX still receive only the VSIX; the publish job
// put the VSIX files and their sidecars on the draft GitHub release, which is
// Kilo's SBOM record, before this script runs.
await verifyEvidence()

const flag = prerelease ? ["--pre-release"] : []

// Resolved from the checkout so the Open VSX client comes from bun.lock.
const ovsx = join(import.meta.dir, "..", "node_modules", ".bin", "ovsx")

if (!existsSync(ovsx)) {
  throw new Error(`Open VSX client not found: ${ovsx}`)
}

for (const target of targets) {
  const vsixPath = join(outDir, `kilo-vscode-${target}.vsix`)
  console.log(`\n🚀 Publishing ${target} to VS Code Marketplace${prerelease ? " (pre-release)" : ""}...`)
  await retry(() => $`vsce publish --oidc ${flag} --skip-duplicate --packagePath ${vsixPath}`, {
    attempts: 3,
    delay: 30_000,
    label: `vsce publish ${target}`,
  })
  console.log(`  ✅ Published ${target} to VS Code Marketplace`)

  console.log(`\n📤 Publishing ${target} to Open VSX${prerelease ? " (pre-release)" : ""}...`)
  await retry(() => $`${ovsx} publish --trusted-publishing ${flag} --skip-duplicate --packagePath ${vsixPath}`, {
    attempts: 3,
    delay: 30_000,
    label: `ovsx publish ${target}`,
  })
  console.log(`  ✅ Published ${target} to Open VSX`)
}

console.log("\n✨ All targets published successfully!")

async function verifyEvidence() {
  const file = join(outDir, Manifest.name("vscode"))
  if (!existsSync(file)) {
    Policy.block({ label: "vscode evidence", issues: [`${file} is missing, so no SBOM evidence was produced`] })
    return
  }
  const manifest = await Manifest.read(file)
  const report = await Manifest.verify({ manifest, dir: outDir })
  await Policy.summary({ product: "vscode", expected: manifest.expected, ok: report.ok, missing: report.missing })
  Policy.block({ label: `vscode evidence for ${manifest.version}`, issues: report.issues })
}

async function retry<T>(fn: () => Promise<T>, opts: { attempts: number; delay: number; label: string }): Promise<T> {
  for (let i = 1; i <= opts.attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      if (i === opts.attempts) throw err
      const delay = opts.delay * 2 ** (i - 1)
      console.warn(`  ⚠️  ${opts.label} failed (attempt ${i}/${opts.attempts}), retrying in ${delay / 1000}s...`)
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw new Error("unreachable")
}
