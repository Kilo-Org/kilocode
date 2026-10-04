#!/usr/bin/env bun

/**
 * SBOM command line used by the release workflows.
 *
 * Kept as a thin front end over `sbom/` so workflow YAML stays declarative and
 * the same validation runs locally and in CI.
 *
 *   bun script/kilocode/sbom.ts validate <sidecar...>
 *   bun script/kilocode/sbom.ts verify --manifest <file> [--dir <dir>]
 *   bun script/kilocode/sbom.ts checksums --manifest <file> [--dir <dir>] --out <file>
 *   bun script/kilocode/sbom.ts merge --into <file> --from <file>
 */

import fs from "node:fs"
import path from "node:path"
import { Manifest, Policy, validate } from "./sbom/index"

function flag(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

async function main() {
  const command = process.argv[2]

  if (command === "validate") {
    const files = process.argv.slice(3).filter((item) => !item.startsWith("--"))
    if (!files.length) throw new Error("Usage: sbom.ts validate <sidecar...>")
    const issues: string[] = []
    for (const file of files) {
      const bom = await Bun.file(file)
        .json()
        .catch((err) => {
          issues.push(`${file}: could not be parsed as JSON (${err})`)
          return undefined
        })
      if (!bom) continue
      issues.push(...(await validate(bom)).map((issue: string) => `${path.basename(file)}: ${issue}`))
    }
    Policy.gate({ label: `validate ${files.length} sidecar(s)`, issues })
    return
  }

  if (command === "verify") {
    const file = flag("manifest")
    if (!file) throw new Error("Usage: sbom.ts verify --manifest <file> [--dir <dir>]")
    const manifest = await Manifest.read(file)
    const dir = flag("dir") ?? path.dirname(file)
    const report = await Manifest.verify({ manifest, dir })
    await Policy.summary({
      product: manifest.product,
      expected: manifest.expected,
      ok: report.ok,
      missing: report.missing,
    })
    Policy.gate({ label: `${manifest.product} evidence for ${manifest.version}`, issues: report.issues })
    return
  }

  if (command === "checksums") {
    const file = flag("manifest")
    const out = flag("out")
    if (!file || !out) throw new Error("Usage: sbom.ts checksums --manifest <file> --out <file>")
    const manifest = await Manifest.read(file)
    await Bun.write(out, await Manifest.checksums({ manifest, dir: flag("dir") ?? path.dirname(file) }))
    console.log(`sbom: wrote ${out}`)
    return
  }

  if (command === "matrix") {
    const file = flag("manifest")
    if (!file) throw new Error("Usage: sbom.ts matrix --manifest <file> [--output <name>]")
    const manifest = await Manifest.read(file)
    // Only artifacts that actually have a sidecar can be attested. Publishing a
    // matrix entry without one would fail the attestation step for a problem the
    // evidence gate has already reported.
    const include = manifest.entries.flatMap((entry: Manifest.Entry) =>
      entry.sbom && !entry.error && !entry.distribution
        ? [{ artifact: entry.artifact, digest: `sha256:${entry.sha256}`, sbom: entry.sbom }]
        : [],
    )
    const value = JSON.stringify({ include })
    const name = flag("output") ?? "matrix"
    const out = process.env.GITHUB_OUTPUT
    // Appended, never rewritten: the runner owns this file and other steps in the
    // same job append to it too.
    if (out) await fs.promises.appendFile(out, `${name}=${value}\n`)
    console.log(value)
    return
  }

  if (command === "merge") {
    const into = flag("into")
    const from = flag("from")
    if (!into || !from) throw new Error("Usage: sbom.ts merge --into <file> --from <file>")
    await Manifest.write(into, Manifest.merge(await Manifest.read(into), await Manifest.read(from)))
    console.log(`sbom: merged ${from} into ${into}`)
    return
  }

  throw new Error(`Unknown command ${command ?? "<none>"}. Expected validate, verify, checksums, matrix, or merge.`)
}

if (import.meta.main) await main()
