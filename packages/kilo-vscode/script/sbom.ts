#!/usr/bin/env bun

/**
 * SBOM generation for Kilo VS Code artifacts.
 *
 * A VSIX is not one product: it is the extension host bundle, the webview
 * bundles, an externally copied Playwright runtime, a platform FFmpeg helper,
 * and a full Kilo CLI for one target. The CLI component graph is imported from
 * the CLI generator rather than recomputed, so a VSIX and the CLI archive that
 * contain the same binary cannot describe it differently.
 */

import fs from "node:fs"
import path from "node:path"
import { Artifact, Deps, Manifest, Policy, Scan, compose, serialize } from "../../../script/kilocode/sbom/index"
import type { Component, Manifest as ManifestType } from "../../../script/kilocode/sbom/index"
import * as Cli from "../../opencode/script/kilocode/sbom"
import { packages as ffmpeg } from "./ffmpeg-helper"

const repo = path.resolve(import.meta.dir, "../../..")

/** vsce target -> the CLI build that gets embedded, mirroring script/build.ts. */
export const TARGETS: Record<string, string> = {
  "linux-x64": "linux-x64",
  "linux-arm64": "linux-arm64",
  "alpine-x64": "linux-x64-musl",
  "alpine-arm64": "linux-arm64-musl",
  "darwin-x64": "darwin-x64",
  "darwin-arm64": "darwin-arm64",
  "win32-x64": "windows-x64",
  "win32-arm64": "windows-arm64",
}

function constraint(target: string) {
  const [os, arch] = target.split("-")
  return {
    os: os === "alpine" ? "linux" : os,
    arch,
    libc: os === "alpine" ? "musl" : os === "linux" ? "glibc" : undefined,
  }
}

/**
 * The FFmpeg helper is fetched with `npm pack` during VSIX assembly, so it is
 * outside the frozen install and has to be modelled from the pinned spec.
 * Windows ARM64 intentionally ships none and must not claim one.
 */
function helper(target: string): Component[] {
  const spec = ffmpeg[target]
  if (!spec) return []
  const at = spec.lastIndexOf("@")
  const name = spec.slice(0, at)
  const version = spec.slice(at + 1)
  return [
    {
      type: "application",
      name,
      version,
      purl: Deps.purl(name, version),
      licenses: ["LGPL-2.1-or-later"],
      delivery: "contained",
      platform: target,
      description: "Bundled FFmpeg helper used for speech input",
    },
  ]
}

export type Release = { version: string; channel?: string; commit?: string }

/** Compose the sidecar for one packaged VSIX. */
export async function vsix(input: { file: string; target: string; release: Release; lock?: Deps.Lock }) {
  const cli = TARGETS[input.target]
  if (!cli) throw new Error(`Unknown VS Code target ${input.target}`)

  const lock = input.lock ?? (await Deps.load(path.join(repo, "bun.lock")))
  const subject = await Artifact.subject(input.file)
  const rootRef = `kilocode:artifact:${subject.name}`

  const extension = Deps.closure({
    lock,
    workspace: "packages/kilo-vscode",
    platform: constraint(input.target),
    root: rootRef,
  })
  const enriched = await Deps.enrich(Cli.reclassify(extension.components), [
    path.join(repo, "node_modules"),
    path.join(repo, "packages/kilo-vscode/node_modules"),
  ])
  const [embedded, scan] = await Promise.all([
    Cli.graph({ target: Cli.target(cli), subject: rootRef, lock }),
    Scan.scan(`file:${input.file}`),
  ])

  const bom = compose({
    subject,
    product: {
      name: "kilo-code",
      version: input.release.version,
      type: "application",
      description: `Kilo Code VS Code extension for ${input.target}`,
    },
    target: { platform: input.target, ...constraint(input.target) },
    build: {
      channel: input.release.channel,
      commit: input.release.commit ?? process.env.GITHUB_SHA,
      workflow: process.env.GITHUB_WORKFLOW,
      run: process.env.GITHUB_RUN_ID,
      properties: { "embedded:cli": cli },
    },
    tools: [...embedded.tools, ...scan.tools],
    components: [...enriched.components, ...embedded.components, ...helper(input.target), ...scan.components],
    dependencies: { ...embedded.dependencies, ...extension.dependencies },
    gaps: [...extension.gaps, ...enriched.gaps, ...embedded.gaps, ...scan.gaps],
  })

  const out = Artifact.sidecar(input.file)
  await Bun.write(out, serialize(bom))
  return {
    sidecar: out,
    entry: {
      artifact: subject.name,
      sha256: subject.sha256,
      size: subject.size,
      sbom: path.basename(out),
      target: input.target,
      sbomSha256: await Artifact.digest(out),
    } satisfies Manifest.Entry,
  }
}

export const CHECKSUMS = "kilo-vscode-SHA256SUMS"

/**
 * Describe every VSIX in `dir`.
 *
 * The set is derived from the packaged files, so a target that silently stopped
 * building is reported as an evidence shortfall rather than passing unnoticed.
 */
export async function evidence(input: { dir: string; release: Release; expected?: number }) {
  const lock = await Deps.load(path.join(repo, "bun.lock"))
  const files = (await fs.promises.readdir(input.dir)).filter((file) => file.endsWith(".vsix")).sort()

  const entries: Manifest.Entry[] = []
  for (const file of files) {
    const target = file.replace(/^kilo-vscode-/, "").replace(/\.vsix$/, "")
    try {
      const result = await vsix({ file: path.join(input.dir, file), target, release: input.release, lock })
      entries.push(result.entry)
      console.log(`sbom: ${file} -> ${path.basename(result.sidecar)}`)
    } catch (err) {
      console.error(`sbom: could not describe ${file}`, err)
      entries.push({
        artifact: file,
        sha256: await Artifact.digest(path.join(input.dir, file)),
        error: `SBOM generation failed: ${err instanceof Error ? err.message : String(err)}`,
      })
    }
  }

  const manifest: ManifestType.Manifest = {
    version: input.release.version,
    product: "vscode",
    generated: new Date().toISOString(),
    expected: input.expected ?? Object.keys(TARGETS).length,
    entries,
  }
  const file = path.join(input.dir, Manifest.name("vscode"))
  await Manifest.write(file, manifest)
  const sums = path.join(input.dir, CHECKSUMS)
  await Bun.write(sums, await Manifest.checksums({ manifest, dir: input.dir }))

  const report = await Manifest.verify({ manifest, dir: input.dir })
  await Policy.summary({ product: "vscode", expected: manifest.expected, ok: report.ok, missing: report.missing })
  Policy.gate({ label: `vscode evidence for ${manifest.version}`, issues: report.issues })

  return {
    manifest,
    files: [file, sums, ...entries.flatMap((entry) => (entry.sbom ? [path.join(input.dir, entry.sbom)] : []))],
  }
}

if (import.meta.main) {
  const dir = process.argv[process.argv.indexOf("--dir") + 1] ?? path.join(import.meta.dir, "..", "out")
  const version = process.env.KILO_VERSION
  if (!version) throw new Error("KILO_VERSION is required to describe VSIX artifacts")
  await evidence({ dir, release: { version, channel: process.env.KILO_PRE_RELEASE === "true" ? "rc" : "latest" } })
}
