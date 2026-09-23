#!/usr/bin/env bun

/**
 * SBOM generation for the Kilo JetBrains plugin.
 *
 * Two artifacts ship from one source tree and they make different claims:
 *
 * - the Marketplace ZIP contains no CLI and downloads one pinned asset at
 *   connect time, so those six CLIs are runtime-delivered;
 * - the bundled ZIP embeds all six, so the same components are contained.
 *
 * Bundled JVM libraries are taken from the physical scan of the signed ZIP,
 * which is what actually ships, and cross-checked against the pinned version
 * catalog so a silently dropped or upgraded library is visible. IntelliJ
 * platform modules and coroutines are recorded as host-provided rather than
 * claimed as part of the plugin.
 *
 * The signed ZIP is never modified: inserting an SBOM into it would invalidate
 * the JetBrains plugin signature.
 */

import fs from "node:fs"
import path from "node:path"
import { Artifact, Deps, Manifest, Policy, Scan, compose, serialize } from "../../../script/kilocode/sbom/index"
import type { Component, Gap, Manifest as ManifestType } from "../../../script/kilocode/sbom/index"
import * as Cli from "../../opencode/script/kilocode/sbom"

const root = path.resolve(import.meta.dir, "..")
const repo = path.resolve(root, "../..")

/** Must stay in sync with StageBundledCliTask.PLATFORMS and KiloCliPlatform. */
export const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-arm64", "windows-x64"]

export type Variant = "lean" | "bundled"

/** Declared shipped libraries, read from the pinned version catalog. */
export function catalog(text: string) {
  const versions = new Map<string, string>()
  const section = (name: string) => {
    const start = text.indexOf(`[${name}]`)
    if (start === -1) return ""
    const rest = text.slice(start + name.length + 2)
    const end = rest.search(/^\[/m)
    return end === -1 ? rest : rest.slice(0, end)
  }

  for (const line of section("versions").split("\n")) {
    const match = line.match(/^\s*([\w-]+)\s*=\s*"([^"]+)"/)
    if (match) versions.set(match[1], match[2])
  }

  const libraries: { group: string; name: string; version: string }[] = []
  for (const line of section("libraries").split("\n")) {
    const module = line.match(/module\s*=\s*"([^:]+):([^"]+)"/)
    if (!module) continue
    const literal = line.match(/version\s*=\s*"([^"]+)"/)
    const reference = line.match(/version\.ref\s*=\s*"([^"]+)"/)
    const version = literal?.[1] ?? (reference ? versions.get(reference[1]) : undefined)
    if (!version) continue
    libraries.push({ group: module[1], name: module[2], version })
  }
  return { versions, libraries }
}

/** Test-only fixtures and mock servers are not shipped inside the plugin. */
const EXCLUDED = /mockwebserver|junit|coroutines-test|detekt/

function declared(text: string): Component[] {
  return catalog(text)
    .libraries.filter((item) => !EXCLUDED.test(`${item.group}:${item.name}`))
    .map((item) => ({
      type: "library",
      name: item.name,
      group: item.group,
      version: item.version,
      purl: `pkg:maven/${item.group}/${item.name}@${item.version}`,
      delivery: "contained",
      properties: { origin: "gradle-version-catalog" },
    }))
}

/**
 * Host-provided runtime. Declared so the SBOM states what the plugin needs
 * without claiming the IDE's code is part of the artifact.
 */
function provided(text: string): Component[] {
  const { versions } = catalog(text)
  return [
    {
      type: "framework",
      name: "intellij-platform",
      version: versions.get("intellij-platform") ?? "unknown",
      delivery: "provided",
      supplier: "JetBrains",
      description: "IntelliJ Platform supplied by the host IDE",
    },
    {
      type: "library",
      name: "kotlinx-coroutines",
      version: versions.get("kotlinx-coroutines") ?? "unknown",
      delivery: "provided",
      supplier: "JetBrains",
      description: "Provided by the IntelliJ Platform and deliberately not bundled",
    },
  ]
}

/** `kilo-cli-checksums.properties`, generated for the runtime-download build. */
async function checksums(file?: string) {
  const candidate = file ?? path.join(root, "backend/build/generated/kilo-cli-checksums/kilo-cli-checksums.properties")
  if (!fs.existsSync(candidate)) return new Map<string, string>()
  const text = await Bun.file(candidate).text()
  const out = new Map<string, string>()
  for (const line of text.split("\n")) {
    const match = line.match(/^\s*([\w.-]+)\s*=\s*(?:sha256:)?([0-9a-f]{64})\s*$/)
    if (match) out.set(match[1].replace(/^cli\./, ""), match[2])
  }
  return out
}

/**
 * The embedded or downloadable Kilo CLI for each supported platform.
 *
 * Reuses the CLI component graphs, so the plugin cannot describe a CLI build
 * differently from the CLI release that produced it.
 */
async function clis(input: {
  variant: Variant
  version: string
  subject: string
  digests: Map<string, string>
  lock: Deps.Lock
}) {
  const delivery = input.variant === "bundled" ? ("contained" as const) : ("runtime" as const)
  const components: Component[] = []
  const dependencies: Record<string, string[]> = {}
  const gaps: Gap[] = []

  for (const platform of PLATFORMS) {
    const digest = input.digests.get(platform)
    if (!digest) {
      gaps.push({
        component: `kilo-${platform}`,
        reason: "CLI asset digest unavailable at SBOM generation time",
      })
    }
    const ref = `kilocode:cli:${platform}@${input.version}`
    components.push({
      type: "application",
      name: `kilo-cli-${platform}`,
      version: input.version,
      ref,
      purl: Deps.purl(`@kilocode/cli-${platform}`, input.version),
      platform,
      delivery,
      supplier: "Kilo Code",
      ...(digest ? { hashes: [{ alg: "SHA-256" as const, content: digest }] } : {}),
      description:
        delivery === "contained"
          ? "Kilo CLI embedded in kilo-cli.zip and extracted for the current platform"
          : "Kilo CLI release asset downloaded on first connect",
    })

    const graph = await Cli.graph({ target: Cli.target(platform), subject: ref, lock: input.lock })
    // A lean plugin does not contain these components; it causes them to be
    // installed, so the whole embedded subtree inherits runtime delivery.
    components.push(
      ...(delivery === "contained" ? graph.components : graph.components.map((item) => ({ ...item, delivery }))),
    )
    for (const [from, to] of Object.entries(graph.dependencies)) {
      dependencies[from] = [...new Set([...(dependencies[from] ?? []), ...to])]
    }
    dependencies[input.subject] = [...new Set([...(dependencies[input.subject] ?? []), ref])]
    gaps.push(...graph.gaps)
  }

  return { components, dependencies, gaps }
}

export type Options = {
  file: string
  variant: Variant
  version: string
  /** CLI version pinned by packages/kilo-jetbrains/package.json. */
  cli: string
  channel?: string
  commit?: string
  /** Immutable release tag and reviewed merge commit for JetBrains releases. */
  tag?: string
  merge?: string
  checksums?: string
}

export async function plugin(input: Options) {
  const subject = await Artifact.subject(input.file)
  const rootRef = `kilocode:artifact:${subject.name}`
  const text = await Bun.file(path.join(root, "gradle/libs.versions.toml")).text()
  const lock = await Deps.load(path.join(repo, "bun.lock"))

  const [embedded, scan] = await Promise.all([
    clis({
      variant: input.variant,
      version: input.cli,
      subject: rootRef,
      digests: await checksums(input.checksums),
      lock,
    }),
    Scan.scan(`file:${input.file}`),
  ])

  const bom = compose({
    subject,
    product: {
      name: "kilo-code-jetbrains",
      version: input.version,
      type: "application",
      description: `Kilo Code JetBrains plugin (${input.variant})`,
    },
    target: { platform: input.variant === "bundled" ? "all" : "any" },
    build: {
      channel: input.channel,
      commit: input.commit ?? process.env.GITHUB_SHA,
      workflow: process.env.GITHUB_WORKFLOW,
      run: process.env.GITHUB_RUN_ID,
      properties: {
        "build:variant": input.variant,
        "build:cli-version": input.cli,
        // The released build is the immutable tag tree with reviewed release
        // metadata overlaid, so provenance records both commits.
        ...(input.tag ? { "build:tag": input.tag } : {}),
        ...(input.merge ? { "build:metadata-commit": input.merge } : {}),
      },
    },
    tools: scan.tools,
    components: [...declared(text), ...provided(text), ...embedded.components, ...scan.components],
    dependencies: embedded.dependencies,
    gaps: [...embedded.gaps, ...scan.gaps],
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
      target: input.variant,
      sbomSha256: await Artifact.digest(out),
    } satisfies Manifest.Entry,
  }
}

export const CHECKSUMS = "kilo-jetbrains-SHA256SUMS"

/**
 * Describe one plugin ZIP and record it in the release manifest.
 *
 * The bundled workflow runs after the lean ZIP is already published, so the
 * manifest is merged rather than rewritten and the release accumulates evidence
 * for both artifacts.
 */
export async function evidence(input: Options & { expected?: number }) {
  const dir = path.dirname(input.file)
  const result = await plugin(input)
  const file = path.join(dir, Manifest.name("jetbrains"))

  const next: ManifestType.Manifest = {
    version: input.version,
    product: "jetbrains",
    generated: new Date().toISOString(),
    expected: input.expected ?? (input.variant === "bundled" ? 2 : 1),
    entries: [result.entry],
  }
  const manifest = fs.existsSync(file) ? Manifest.merge(await Manifest.read(file), next) : next
  await Manifest.write(file, manifest)
  const sums = path.join(dir, CHECKSUMS)
  await Bun.write(sums, await Manifest.checksums({ manifest, dir }))

  const report = await Manifest.verify({ manifest, dir })
  await Policy.summary({ product: "jetbrains", expected: manifest.expected, ok: report.ok, missing: report.missing })
  Policy.gate({ label: `jetbrains ${input.variant} evidence for ${input.version}`, issues: report.issues })

  return { manifest, sidecar: result.sidecar, files: [result.sidecar, file, sums] }
}

function flag(name: string) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1) return undefined
  return process.argv[index + 1]
}

if (import.meta.main) {
  const file = flag("zip")
  const version = flag("version")
  if (!file || !version) {
    throw new Error("Usage: sbom.ts --zip <plugin.zip> --version <plugin version> [--variant lean|bundled]")
  }
  const variant = (flag("variant") ?? "lean") as Variant
  if (variant !== "lean" && variant !== "bundled") throw new Error(`Unknown variant ${variant}`)

  const pkg = await Bun.file(path.join(root, "package.json")).json()
  const result = await evidence({
    file,
    variant,
    version,
    cli: flag("cli") ?? pkg.version,
    channel: flag("channel"),
    tag: flag("tag"),
    merge: flag("merge"),
    checksums: flag("checksums"),
  })
  console.log(`sbom: ${path.basename(result.sidecar)}`)
}
