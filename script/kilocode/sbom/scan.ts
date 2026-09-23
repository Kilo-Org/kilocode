/**
 * Physical artifact scan.
 *
 * The lockfile closure covers code compiled into bundles; this covers everything
 * that exists as a file in the shipped artifact: JARs, copied npm packages,
 * native helpers, WASM, licences, and OS packages in container images. Both
 * halves are required, because neither one alone describes a Kilo artifact.
 *
 * Syft is optional at runtime. When it is unavailable the scan degrades to a
 * recorded coverage gap rather than pretending the artifact has no file-level
 * components.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import type { Component, Gap, Tool } from "./model"

export type Scan = { components: Component[]; gaps: Gap[]; tools: Tool[] }

const SKIP = new Set(["operating-system"])

function licenses(input: any[] | undefined) {
  const values = (input ?? []).flatMap((item) => {
    const id = item?.license?.id ?? item?.license?.name ?? item?.expression
    return id ? [String(id)] : []
  })
  return values.length ? [...new Set(values)] : undefined
}

function version(binary: string) {
  const result = Bun.spawnSync([binary, "version", "-o", "text"], { stderr: "pipe" })
  if (result.exitCode !== 0) return undefined
  return result.stdout.toString().match(/Version:\s*(\S+)/)?.[1]
}

/**
 * Convert a Syft CycloneDX document into Kilo components.
 *
 * Syft's own root component describes the scan target, which Kilo replaces with
 * its own product root, so it is dropped here.
 */
export function convert(document: any, delivery: Component["delivery"] = "contained"): Component[] {
  const root = document?.metadata?.component?.["bom-ref"]
  return ((document?.components ?? []) as any[]).flatMap((item) => {
    if (!item?.name || item["bom-ref"] === root) return []
    if (SKIP.has(item.type) && !item.version) return []
    const properties = Object.fromEntries(
      ((item.properties ?? []) as any[]).flatMap((entry) =>
        typeof entry?.name === "string" && entry.name.startsWith("syft:") && typeof entry.value === "string"
          ? [[entry.name.replace(/^syft:/, "syft."), entry.value]]
          : [],
      ),
    )
    return [
      {
        type: (item.type ?? "library") as Component["type"],
        name: String(item.name),
        ...(item.version ? { version: String(item.version) } : {}),
        ...(item.group ? { group: String(item.group) } : {}),
        ...(item.purl ? { purl: String(item.purl) } : {}),
        ...(item.publisher || item.author ? { author: String(item.publisher ?? item.author) } : {}),
        ...(licenses(item.licenses) ? { licenses: licenses(item.licenses) } : {}),
        ...(item.hashes?.length ? { hashes: item.hashes } : {}),
        delivery,
        properties: { source: "syft", ...properties },
      } satisfies Component,
    ]
  })
}

/**
 * Scan a file, directory, archive, or image reference.
 *
 * `target` uses Syft scheme syntax, e.g. `file:dist/kilo-linux-x64.tar.gz` or
 * `registry:ghcr.io/kilo-org/kilocode@sha256:...`.
 */
export async function scan(target: string): Promise<Scan> {
  const binary = process.env.SYFT ?? Bun.which("syft")
  if (!binary) {
    return {
      components: [],
      gaps: [{ component: target, reason: "file-level inventory unavailable: syft is not installed" }],
      tools: [],
    }
  }

  const out = path.join(await fs.promises.mkdtemp(path.join(os.tmpdir(), "kilo-sbom-")), "syft.cdx.json")
  const proc = Bun.spawn([binary, "scan", target, "-o", `cyclonedx-json=${out}`, "-q"], {
    stdout: "inherit",
    stderr: "inherit",
    env: { ...process.env, SYFT_CHECK_FOR_APP_UPDATE: "false" },
  })
  const code = await proc.exited
  try {
    if (code !== 0) {
      return {
        components: [],
        gaps: [{ component: target, reason: `file-level inventory unavailable: syft exited with ${code}` }],
        tools: [],
      }
    }
    const document = await Bun.file(out).json()
    return { components: convert(document), gaps: [], tools: [{ name: "syft", version: version(binary) }] }
  } finally {
    await fs.promises
      .rm(path.dirname(out), { recursive: true, force: true })
      .catch((err) => console.warn(`Could not remove syft scratch directory ${path.dirname(out)}`, err))
  }
}
