/**
 * Release evidence manifest.
 *
 * GitHub Releases is Kilo's chosen long-term SBOM record, so the release itself
 * has to state what evidence is supposed to exist. Counting "some SBOMs were
 * uploaded" is not enough: the manifest pins the exact artifact set, its
 * digests, and its sidecars, which is what turns a missing or stale sidecar into
 * a detectable failure instead of a silent compliance gap.
 */

import fs from "node:fs"
import path from "node:path"
import { digest } from "./artifact"
import { validate } from "./validate"

export type Entry = {
  /** Release asset filename. */
  artifact: string
  sha256: string
  size?: number
  /** Sidecar asset filename, omitted when generation failed. */
  sbom?: string
  sbomSha256?: string
  target?: string
  /** Set when the artifact is not published as a release asset (npm, OCI). */
  distribution?: string
  error?: string
}

export type Manifest = {
  version: string
  product: string
  generated: string
  /** How many artifacts this product must publish, used as the coverage gate. */
  expected: number
  entries: Entry[]
}

export const FILENAME = "sbom-evidence.json"

export function name(product: string) {
  return `${product}-${FILENAME}`
}

export async function write(file: string, manifest: Manifest) {
  await fs.promises.mkdir(path.dirname(file), { recursive: true })
  const sorted = { ...manifest, entries: [...manifest.entries].sort((a, b) => a.artifact.localeCompare(b.artifact)) }
  await Bun.write(file, `${JSON.stringify(sorted, null, 2)}\n`)
  return file
}

export async function read(file: string) {
  return (await Bun.file(file).json()) as Manifest
}

/**
 * Merge a later stage's entries into an existing manifest.
 *
 * The JetBrains bundled ZIP is produced by a separate workflow after the lean
 * ZIP is already published, so evidence for one release accumulates across runs
 * rather than being written once.
 */
export function merge(base: Manifest, next: Manifest): Manifest {
  if (base.version !== next.version) {
    throw new Error(`Cannot merge evidence for ${base.version} with evidence for ${next.version}`)
  }
  const entries = new Map(base.entries.map((entry) => [entry.artifact, entry]))
  for (const entry of next.entries) {
    const previous = entries.get(entry.artifact)
    // Republishing the identical bytes is a retry and is allowed. Different
    // bytes under the same asset name would silently invalidate the published
    // sidecar, so it has to surface.
    if (previous && previous.sha256 !== entry.sha256) {
      throw new Error(
        `Evidence conflict for ${entry.artifact}: ${previous.sha256} is already recorded, refusing to overwrite with ${entry.sha256}`,
      )
    }
    entries.set(entry.artifact, { ...previous, ...entry })
  }
  return { ...base, expected: Math.max(base.expected, next.expected), entries: [...entries.values()] }
}

export type Report = { issues: string[]; ok: number; missing: number }

/**
 * Coverage check: every expected artifact has exactly one sidecar, the sidecar
 * validates, and it names the artifact digest actually produced.
 */
export async function verify(input: { manifest: Manifest; dir: string }): Promise<Report> {
  const issues: string[] = []
  let ok = 0
  let missing = 0

  const seen = new Set<string>()
  for (const entry of input.manifest.entries) {
    if (seen.has(entry.artifact)) issues.push(`duplicate manifest entry for ${entry.artifact}`)
    seen.add(entry.artifact)

    if (entry.error) {
      issues.push(`${entry.artifact}: ${entry.error}`)
      missing++
      continue
    }
    if (!entry.sbom) {
      issues.push(`${entry.artifact}: no SBOM was generated`)
      missing++
      continue
    }

    const file = path.join(input.dir, entry.sbom)
    if (!fs.existsSync(file)) {
      issues.push(`${entry.artifact}: sidecar ${entry.sbom} is missing from ${input.dir}`)
      missing++
      continue
    }

    const bom = await Bun.file(file)
      .json()
      .catch(() => undefined)
    if (!bom) {
      issues.push(`${entry.artifact}: sidecar ${entry.sbom} is not valid JSON`)
      missing++
      continue
    }

    const problems = validate(bom)
    if (problems.length) {
      issues.push(...problems.map((problem) => `${entry.sbom}: ${problem}`))
      missing++
      continue
    }

    const declared = (bom.metadata?.properties ?? []).find(
      (item: { name?: string }) => item?.name === "kilocode:subject:sha256",
    )?.value
    if (declared !== entry.sha256) {
      issues.push(`${entry.sbom}: declares digest ${declared} but ${entry.artifact} is ${entry.sha256}`)
      missing++
      continue
    }

    const subject = (bom.metadata?.properties ?? []).find(
      (item: { name?: string }) => item?.name === "kilocode:subject:name",
    )?.value
    if (subject !== entry.artifact) {
      issues.push(`${entry.sbom}: declares subject ${subject} but is recorded for ${entry.artifact}`)
      missing++
      continue
    }

    ok++
  }

  if (input.manifest.entries.length !== input.manifest.expected) {
    issues.push(
      `${input.manifest.product}: expected ${input.manifest.expected} artifacts, manifest records ${input.manifest.entries.length}`,
    )
  }

  return { issues, ok, missing }
}

/** `SHA256SUMS`-style text covering artifacts and their sidecars. */
export async function checksums(input: { manifest: Manifest; dir: string }) {
  const lines: string[] = []
  for (const entry of [...input.manifest.entries].sort((a, b) => a.artifact.localeCompare(b.artifact))) {
    lines.push(`${entry.sha256}  ${entry.artifact}`)
    if (!entry.sbom) continue
    const file = path.join(input.dir, entry.sbom)
    const sha = entry.sbomSha256 ?? (fs.existsSync(file) ? await digest(file) : undefined)
    if (sha) lines.push(`${sha}  ${entry.sbom}`)
  }
  return `${lines.join("\n")}\n`
}
