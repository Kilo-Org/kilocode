/**
 * SBOM generation for Kilo CLI artifacts.
 *
 * The CLI is a Bun single-file executable plus a set of staged native and
 * static resources, so neither the lockfile nor a scan of the archive describes
 * it on its own:
 *
 * - `bun.lock` is the only record of the npm packages compiled into the binary.
 * - Syft is the only thing that sees what is physically staged in `bin/`.
 * - Bubblewrap, the Bun runtime, and the runtime-downloaded components exist in
 *   neither and are modelled explicitly here.
 *
 * The same per-target graph is reused for the release archive, the npm binary
 * package, and the VS Code and JetBrains artifacts that embed this CLI, so one
 * component set cannot drift between products that ship identical bytes.
 */

import fs from "node:fs"
import path from "node:path"
import { Artifact, Deps, Manifest, Policy, Scan, compose, serialize } from "../../../../script/kilocode/sbom/index"
import type { Component, Gap, Tool } from "../../../../script/kilocode/sbom/index"
import { LanceDBRuntime } from "../../src/kilocode/lancedb"

const root = path.resolve(import.meta.dir, "../..")
const repo = path.resolve(root, "../..")

/** Pinned, runtime-downloaded search binary. Not in any lockfile or archive. */
const RIPGREP = "15.1.0"
/** Must track `packages/opencode/script/kilocode/bubblewrap.ts`. */
const BUBBLEWRAP = "0.11.2"

export type Target = {
  /** npm package name, e.g. `@kilocode/cli-linux-x64-musl`. */
  name: string
  os: string
  arch: string
  abi?: string
  baseline: boolean
}

export type Graph = { components: Component[]; dependencies: Record<string, string[]>; gaps: Gap[]; tools: Tool[] }

/**
 * Parse a platform slug (`linux-x64`) or npm package name back into its target.
 *
 * `name` is always normalized to the real npm package name, so a release
 * archive and the npm package carrying the same binary share one product
 * identity instead of the archive claiming a nonexistent `pkg:npm/linux-x64`.
 */
export function target(input: string): Target {
  const slug = input.replace(/^@kilocode\/cli-/, "")
  const parts = slug.split("-")
  const os = parts[0] === "windows" ? "win32" : parts[0]
  return {
    name: `@kilocode/cli-${slug}`,
    os,
    arch: parts[1],
    abi: parts.includes("musl") ? "musl" : undefined,
    baseline: parts.includes("baseline"),
  }
}

function platform(input: Target) {
  return [input.os === "win32" ? "windows" : input.os, input.arch, input.baseline ? "baseline" : undefined, input.abi]
    .filter(Boolean)
    .join("-")
}

/**
 * Components the CLI delivers but which no generator can discover.
 *
 * LanceDB is reclassified rather than dropped: it is a real lockfile dependency,
 * but the build externalizes it and installs it on demand, so claiming it is
 * inside the artifact would be wrong in the other direction.
 */
function explicit(input: Target): Component[] {
  const linux = input.os === "linux"
  return [
    {
      type: "framework",
      name: "bun",
      version: Bun.version,
      purl: `pkg:generic/bun@${Bun.version}`,
      supplier: "Oven",
      licenses: ["MIT"],
      delivery: "contained",
      description: "Bun runtime compiled into the Kilo CLI executable",
    },
    ...(linux
      ? [
          {
            type: "application" as const,
            name: "bubblewrap",
            version: BUBBLEWRAP,
            purl: `pkg:generic/bubblewrap@${BUBBLEWRAP}`,
            supplier: "containers",
            licenses: ["LGPL-2.0-or-later"],
            delivery: "contained" as const,
            platform: platform(input),
            description: "Statically linked sandbox helper staged as bin/bwrap",
            properties: { "source:archive": `bubblewrap-${BUBBLEWRAP}.tar.gz` },
          },
        ]
      : []),
    {
      type: "application",
      name: "ripgrep",
      version: RIPGREP,
      purl: `pkg:generic/ripgrep@${RIPGREP}`,
      supplier: "BurntSushi",
      licenses: ["MIT OR Unlicense"],
      delivery: "runtime",
      description: "Resolved from PATH or downloaded at runtime; not shipped in the artifact",
    },
    {
      type: "library",
      name: LanceDBRuntime.pkg,
      version: LanceDBRuntime.version,
      purl: Deps.purl(LanceDBRuntime.pkg, LanceDBRuntime.version),
      delivery: "runtime",
      description: "Externalized from the bundle and installed on demand when indexing is enabled",
    },
  ]
}

const RUNTIME: ReadonlySet<string> = new Set<string>(LanceDBRuntime.external)

/**
 * Reclassify packages the build externalizes.
 *
 * Exported because the VS Code extension resolves the same packages through its
 * own dependency closure. Without this, one artifact would describe LanceDB as
 * both compiled in and installed on demand.
 */
export function reclassify(components: Component[]) {
  return components.map((item) => (RUNTIME.has(item.name) ? { ...item, delivery: "runtime" as const } : item))
}

/**
 * Compiled-in dependency closure plus explicitly modelled components.
 *
 * `subject` is the artifact root ref the graph should hang from, so the same
 * target graph can be reused by every artifact that embeds this CLI.
 */
export async function graph(input: { target: Target; subject: string; lock?: Deps.Lock }): Promise<Graph> {
  const lock = input.lock ?? (await Deps.load(path.join(repo, "bun.lock")))
  const constraint = { os: input.target.os, arch: input.target.arch, libc: input.target.abi ?? "glibc" }

  const cli = Deps.closure({ lock, workspace: "packages/opencode", platform: constraint, root: input.subject })
  // The Kilo Console ships as static assets under bin/console and is not a
  // dependency of the CLI package, so its own closure has to be added.
  const console_ = Deps.closure({ lock, workspace: "packages/kilo-console", platform: constraint, root: input.subject })

  const enriched = await Deps.enrich(
    [...cli.components, ...console_.components],
    [
      path.join(repo, "node_modules"),
      path.join(root, "node_modules"),
      path.join(repo, "packages/kilo-console/node_modules"),
    ],
  )

  // Anything the build externalizes is delivered later, not contained.
  const components = reclassify(enriched.components)

  return {
    components: [...components, ...explicit(input.target)],
    dependencies: mergeEdges(cli.dependencies, console_.dependencies),
    gaps: [...cli.gaps, ...console_.gaps, ...enriched.gaps],
    tools: [{ name: "bun", version: Bun.version }],
  }
}

function mergeEdges(...input: Record<string, string[]>[]) {
  const merged = new Map<string, Set<string>>()
  for (const edges of input) {
    for (const [from, to] of Object.entries(edges)) {
      const existing = merged.get(from) ?? new Set<string>()
      for (const item of to) existing.add(item)
      merged.set(from, existing)
    }
  }
  return Object.fromEntries([...merged].map(([key, value]) => [key, [...value]]))
}

export type Release = { version: string; channel?: string; commit?: string; workflow?: string; run?: string }

function build(input: Release) {
  return {
    channel: input.channel,
    commit: input.commit ?? process.env.GITHUB_SHA,
    workflow: input.workflow ?? process.env.GITHUB_WORKFLOW,
    run: input.run ?? process.env.GITHUB_RUN_ID,
  }
}

/**
 * Compose the sidecar for one final CLI archive.
 *
 * Runs against the archive bytes that were actually produced, so the recorded
 * digest is the one users download rather than a staging tree that may differ.
 */
export async function archive(input: { file: string; target: Target; release: Release; lock?: Deps.Lock }) {
  const subject = await Artifact.subject(input.file)
  const rootRef = `kilocode:artifact:${subject.name}`
  const [component, scan] = await Promise.all([
    graph({ target: input.target, subject: rootRef, lock: input.lock }),
    Scan.scan(`file:${input.file}`),
  ])

  const bom = compose({
    subject,
    product: {
      name: input.target.name,
      version: input.release.version,
      type: "application",
      purl: Deps.purl(input.target.name, input.release.version),
      description: `Kilo CLI for ${platform(input.target)}`,
    },
    target: {
      platform: platform(input.target),
      os: input.target.os,
      arch: input.target.arch,
      abi: input.target.abi,
      baseline: input.target.baseline,
    },
    build: build(input.release),
    tools: [...component.tools, ...scan.tools],
    components: [...component.components, ...scan.components],
    dependencies: component.dependencies,
    gaps: [...component.gaps, ...scan.gaps],
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
      target: platform(input.target),
      sbomSha256: await Artifact.digest(out),
    } satisfies Manifest.Entry,
  }
}

/**
 * Generate sidecars for every produced archive.
 *
 * The target list is derived from the archives on disk rather than a duplicated
 * matrix, so a build that silently stops emitting a platform shows up as an
 * evidence gap instead of passing unnoticed.
 */
export async function archives(input: { dir: string; release: Release; expected: number }) {
  const lock = await Deps.load(path.join(repo, "bun.lock"))
  const files = (await fs.promises.readdir(input.dir)).filter((file) => /^kilo-.*\.(?:tar\.gz|zip)$/.test(file)).sort()

  const entries: Manifest.Entry[] = []
  for (const file of files) {
    const name = file.replace(/\.(?:tar\.gz|zip)$/, "").replace(/^kilo-/, "")
    try {
      const result = await archive({
        file: path.join(input.dir, file),
        target: target(name),
        release: input.release,
        lock,
      })
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

  const manifest: Manifest.Manifest = {
    version: input.release.version,
    product: "cli",
    generated: new Date().toISOString(),
    expected: input.expected,
    entries,
  }
  await Manifest.write(path.join(input.dir, Manifest.name("cli")), manifest)
  return manifest
}

/**
 * Describe one packed npm tarball.
 *
 * Runs against the exact `.tgz` that will be uploaded, because the published
 * tarball is a different artifact from the release archive: it adds package
 * metadata and, for the wrapper package, contains no binary at all.
 */
export async function npmPackage(input: {
  file: string
  name: string
  release: Release
  lock?: Deps.Lock
  /** Where the sidecar is written; defaults to the tarball's directory. */
  out?: string
}) {
  const subject = await Artifact.subject(input.file)
  const rootRef = `kilocode:artifact:${subject.name}`
  const binary = input.name.startsWith("@kilocode/cli-")

  const [component, scan] = await Promise.all([
    binary
      ? graph({ target: target(input.name), subject: rootRef, lock: input.lock })
      : wrapper({ version: input.release.version, subject: rootRef }),
    Scan.scan(`file:${input.file}`),
  ])

  const bom = compose({
    subject,
    product: {
      name: input.name,
      version: input.release.version,
      type: "application",
      purl: Deps.purl(input.name, input.release.version),
      description: binary ? `Kilo CLI npm package for ${platform(target(input.name))}` : "Kilo CLI launcher package",
    },
    ...(binary
      ? {
          target: {
            platform: platform(target(input.name)),
            os: target(input.name).os,
            arch: target(input.name).arch,
            abi: target(input.name).abi,
            baseline: target(input.name).baseline,
          },
        }
      : {}),
    build: { ...build(input.release), properties: { distribution: "npm" } },
    tools: [...(component.tools ?? []), ...scan.tools],
    components: [...component.components, ...scan.components],
    dependencies: component.dependencies,
    gaps: [...component.gaps, ...scan.gaps],
  })

  const out = input.out ? path.join(input.out, `${path.basename(input.file)}.cdx.json`) : Artifact.sidecar(input.file)
  await Bun.write(out, serialize(bom))
  return {
    sidecar: out,
    entry: {
      artifact: subject.name,
      sha256: subject.sha256,
      size: subject.size,
      sbom: path.basename(out),
      distribution: "npm",
      ...(binary ? { target: platform(target(input.name)) } : {}),
      sbomSha256: await Artifact.digest(out),
    } satisfies Manifest.Entry,
  }
}

/**
 * The wrapper package ships a Node launcher and resolves one platform package
 * through optionalDependencies, so those binaries are installed by npm rather
 * than contained in this tarball.
 */
async function wrapper(input: { version: string; subject: string }): Promise<Graph> {
  const names = [
    "linux-arm64",
    "linux-x64",
    "linux-x64-baseline",
    "linux-arm64-musl",
    "linux-x64-musl",
    "linux-x64-baseline-musl",
    "darwin-arm64",
    "darwin-x64",
    "darwin-x64-baseline",
    "windows-arm64",
    "windows-x64",
    "windows-x64-baseline",
  ].map((item) => `@kilocode/cli-${item}`)

  return {
    components: names.map((name) => ({
      type: "application",
      name,
      version: input.version,
      purl: Deps.purl(name, input.version),
      supplier: "Kilo Code",
      delivery: "runtime",
      description: "Platform binary resolved through optionalDependencies at install time",
    })),
    dependencies: { [input.subject]: names.map((name) => Deps.purl(name, input.version)) },
    gaps: [],
    tools: [],
  }
}

/**
 * Evidence name for an image manifest. Shared with the publish script so a
 * failed description is recorded under the same name a success would use.
 */
export function ociName(digest: string, platform?: string) {
  const label = platform ? platform.replace("/", "-") : "index"
  return `kilo-oci-${label}@${digest.replace(/^sha256:/, "").slice(0, 12)}`
}

/**
 * Describe a pushed container image by digest.
 *
 * The image is not an unpacked release archive: it has a floating Alpine base,
 * installs OS packages, and copies only a subset of the CLI resources, so its
 * inventory has to come from the image itself.
 */
export async function ociImage(input: {
  reference: string
  digest: string
  release: Release
  platform?: string
  out: string
}) {
  const name = ociName(input.digest, input.platform)
  const scan = await Scan.scan(`registry:${input.reference}`)
  const subject = { name, sha256: input.digest.replace(/^sha256:/, "") }

  const bom = compose({
    subject,
    product: {
      name: "ghcr.io/kilo-org/kilocode",
      version: input.release.version,
      type: "container",
      purl: `pkg:oci/kilocode@${input.digest}`,
      description: `Kilo CLI container image (${input.platform ?? "multi-arch index"})`,
    },
    ...(input.platform ? { target: { platform: input.platform } } : {}),
    build: { ...build(input.release), properties: { "oci:reference": input.reference, distribution: "oci" } },
    tools: scan.tools,
    components: scan.components,
    gaps: [
      ...scan.gaps,
      ...(scan.components.length
        ? []
        : [{ component: input.reference, reason: "image inventory unavailable at generation time" }]),
    ],
  })

  const out = path.join(input.out, `${name}.cdx.json`)
  await Bun.write(out, serialize(bom))
  return {
    sidecar: out,
    entry: {
      artifact: name,
      sha256: subject.sha256,
      sbom: path.basename(out),
      distribution: "oci",
      ...(input.platform ? { target: input.platform } : {}),
      sbomSha256: await Artifact.digest(out),
      // An image SBOM has no lockfile half to fall back on: without a scan it
      // lists nothing, and that must not verify as valid evidence.
      ...(scan.components.length
        ? {}
        : {
            error: `image inventory is empty: ${scan.gaps.map((gap) => gap.reason).join("; ") || "no components found"}`,
          }),
    } satisfies Manifest.Entry,
  }
}

export const DISTRIBUTION_CHECKSUMS = "kilo-cli-distribution-SHA256SUMS"

/**
 * Record evidence for the npm and container distributions of a release.
 *
 * Kept separate from the archive manifest because these artifacts are produced
 * in the publish job, are not GitHub release assets themselves, and are signed
 * by npm provenance and OCI attestations rather than by a release attestation.
 */
export async function distribution(input: {
  dir: string
  release: Release
  entries: Manifest.Entry[]
  expected: number
}) {
  const manifest: Manifest.Manifest = {
    version: input.release.version,
    product: "cli-distribution",
    generated: new Date().toISOString(),
    expected: input.expected,
    entries: input.entries,
  }
  const file = path.join(input.dir, Manifest.name("cli-distribution"))
  await Manifest.write(file, manifest)
  const sums = path.join(input.dir, DISTRIBUTION_CHECKSUMS)
  await Bun.write(sums, await Manifest.checksums({ manifest, dir: input.dir }))

  const report = await Manifest.verify({ manifest, dir: input.dir })
  await Policy.summary({
    product: "cli-distribution",
    expected: manifest.expected,
    ok: report.ok,
    missing: report.missing,
  })
  Policy.gate({ label: `cli distribution evidence for ${manifest.version}`, issues: report.issues })

  return {
    manifest,
    files: [file, sums, ...input.entries.flatMap((entry) => (entry.sbom ? [path.join(input.dir, entry.sbom)] : []))],
  }
}

export const CHECKSUMS = "kilo-cli-SHA256SUMS"

/**
 * Produce the full evidence set for a CLI release and report its completeness.
 *
 * Returns the files to publish alongside the archives. Failures are reported
 * through the shared policy so they annotate the run while SBOM enforcement is
 * still advisory, and block the release once `SBOM_ENFORCE` is set.
 */
export async function evidence(input: { dir: string; release: Release; expected: number }) {
  const manifest = await archives(input)
  const sums = path.join(input.dir, CHECKSUMS)
  await Bun.write(sums, await Manifest.checksums({ manifest, dir: input.dir }))

  const report = await Manifest.verify({ manifest, dir: input.dir })
  await Policy.summary({ product: "cli", expected: manifest.expected, ok: report.ok, missing: report.missing })
  Policy.gate({ label: `cli evidence for ${manifest.version}`, issues: report.issues })

  return {
    manifest,
    files: [
      path.join(input.dir, Manifest.name("cli")),
      sums,
      ...manifest.entries.flatMap((entry) => (entry.sbom ? [path.join(input.dir, entry.sbom)] : [])),
    ],
  }
}
