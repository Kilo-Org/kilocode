export * as Install from "./install"

import { randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import type { Diagnostic } from "./diagnostic"
import { Paths } from "./paths"
import { AgentPlugin } from "./plugin"

export class InstallError extends Error {
  constructor(
    readonly reason: "not_found" | "invalid" | "conflict" | "fetch_failed" | "write_failed",
    message: string,
  ) {
    super(message)
  }
}

export type Source =
  | { readonly type: "path"; readonly path: string }
  | { readonly type: "archive"; readonly url: string; readonly subdirectory?: string }

const MAX_DOWNLOAD = 64 * 1024 * 1024
const MAX_EXPANDED = 256 * 1024 * 1024
const STAGING = ".agent-plugins-staging"
// Windows reserves these device names for directories; a plugin directory cannot use one.
const RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

/**
 * Installs a plugin into `<root>/plugins/<name>`, where `root` is a Kilo config directory. The plugin is staged
 * outside `plugins/` first, so discovery never sees a partial copy, then validated with the loader and moved into
 * place in one rename. Replacing a plugin keeps its `PLUGIN_DATA`, which is keyed by the unchanged root path.
 */
export async function install(input: { source: Source; root: string; replace: boolean }) {
  const staging = path.join(input.root, STAGING, randomUUID())
  const stage = path.join(staging, "plugin")
  try {
    await fs.mkdir(staging, { recursive: true })
    if (input.source.type === "path") await copy(input.source.path, stage)
    else await unpack(await download(input.source.url), staging, stage, input.source.subdirectory)
    // Validation gets a throwaway data root, so it never creates PLUGIN_DATA for the real plugin instance.
    const loaded = await AgentPlugin.load(stage, { dataRoot: path.join(staging, "data") })
    if (loaded.status === "rejected" || !loaded.manifest)
      throw new InstallError(
        "invalid",
        `Not a valid Agent Plugin: ${loaded.diagnostics
          .filter((item) => item.severity === "error")
          .map((item) => item.message)
          .join("; ")}`,
      )
    const name = loaded.manifest.name
    if (RESERVED.test(name)) throw new InstallError("invalid", `The plugin name "${name}" is reserved on Windows`)
    const plugins = path.join(input.root, "plugins")
    const target = path.join(plugins, name)
    await fs.mkdir(plugins, { recursive: true })
    const existing = await fs.lstat(target).catch(() => undefined)
    if (existing && !input.replace)
      throw new InstallError("conflict", `A plugin named "${name}" is already installed at ${target}`)
    if (existing) {
      const previous = path.join(staging, "previous")
      await fs.rename(target, previous)
      await fs.rename(stage, target).catch(async (error: unknown) => {
        await fs.rename(previous, target).catch(() => undefined)
        throw error
      })
    } else await fs.rename(stage, target)
    return { name, target, diagnostics: loaded.diagnostics as readonly Diagnostic.Info[] }
  } catch (error) {
    if (error instanceof InstallError) throw error
    throw new InstallError("write_failed", `Couldn't install the plugin: ${message(error)}`)
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
    await fs.rmdir(path.dirname(staging)).catch(() => undefined)
  }
}

/**
 * Removes every plugin named `name` from `<root>/plugins`. A linked plugin directory only loses its link, so the
 * target the user linked is never deleted. `PLUGIN_DATA` is removed only on request (spec §9.1 makes it optional).
 */
export async function uninstall(input: { root: string; name: string; dataRoot: string; removeData: boolean }) {
  const plugins = path.join(input.root, "plugins")
  const children = await fs.readdir(plugins).catch(() => [] as string[])
  const matches = (
    await Promise.all(
      children.map(async (child) => {
        const target = path.join(plugins, child)
        const inspected = await AgentPlugin.inspect(target)
        return inspected.manifest?.name === input.name && inspected.root ? { target, root: inspected.root } : undefined
      }),
    )
  ).filter((item) => item !== undefined)
  if (!matches.length) throw new InstallError("not_found", `No plugin named "${input.name}" in ${plugins}`)
  try {
    for (const match of matches) {
      const data = AgentPlugin.directory(input.dataRoot, input.name, match.root)
      if ((await fs.lstat(match.target)).isSymbolicLink()) await fs.unlink(match.target)
      else {
        // Moving out of plugins/ first makes the removal atomic for discovery.
        const trash = path.join(input.root, STAGING, randomUUID())
        await fs.mkdir(path.dirname(trash), { recursive: true })
        await fs.rename(match.target, trash)
        await fs.rm(trash, { recursive: true, force: true })
        await fs.rmdir(path.dirname(trash)).catch(() => undefined)
      }
      if (input.removeData) await fs.rm(data, { recursive: true, force: true })
    }
  } catch (error) {
    throw new InstallError("write_failed", `Couldn't uninstall "${input.name}": ${message(error)}`)
  }
}

async function copy(source: string, stage: string) {
  if ((await Paths.kind(source)) !== "directory")
    throw new InstallError("not_found", `${source} is not a plugin directory`)
  // Links are copied as links; the loader then refuses any that resolve outside the installed plugin.
  await fs.cp(source, stage, {
    recursive: true,
    verbatimSymlinks: true,
    filter: (item) => path.basename(item) !== ".git",
  })
}

async function download(url: string) {
  if (!URL.canParse(url) || !["https:", "http:"].includes(new URL(url).protocol))
    throw new InstallError("invalid", `${url} is not an HTTP or HTTPS URL`)
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok || !response.body) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error(`HTTP ${response.status}`)
    }
    return await bounded(response.body, MAX_DOWNLOAD)
  } catch (error) {
    if (error instanceof InstallError) throw error
    throw new InstallError("fetch_failed", `Couldn't download ${url}: ${message(error)}`)
  }
}

/**
 * Extracts a tar or tar.gz archive and picks the plugin root: the archive root when it holds `plugin.json`, else
 * its single top-level directory (as in GitHub archives), then `subdirectory` below that.
 */
async function unpack(archive: Uint8Array, staging: string, stage: string, subdirectory?: string) {
  const tar =
    archive[0] === 0x1f && archive[1] === 0x8b
      ? await bounded(
          new Blob([new Uint8Array(archive)]).stream().pipeThrough(new DecompressionStream("gzip")),
          MAX_EXPANDED,
        )
      : archive
  const extracted = path.join(staging, "extract")
  // Bun's extractor keeps file modes (executable servers) and confines entries to the target directory.
  await new Bun.Archive(tar).extract(extracted).catch((error: unknown) => {
    throw new InstallError("invalid", `Couldn't read the archive: ${message(error)}`)
  })
  const top = await fs.readdir(extracted).catch(() => [] as string[])
  // Resolved, because containment below compares resolved paths (temporary directories are often links).
  const base = await fs.realpath(
    !top.includes("plugin.json") &&
      top.length === 1 &&
      (await Paths.kind(path.join(extracted, top[0]!))) === "directory"
      ? path.join(extracted, top[0]!)
      : extracted,
  )
  const root = subdirectory ? await Paths.inside(base, path.resolve(base, subdirectory)) : base
  if (!root || subdirectory?.startsWith("/"))
    throw new InstallError("invalid", `The subdirectory ${subdirectory} is outside the archive`)
  if ((await Paths.kind(path.join(root, "plugin.json"))) !== "file")
    throw new InstallError(
      "invalid",
      `The archive has no plugin.json${subdirectory ? ` in ${subdirectory}` : " at its root"}; pass the plugin's subdirectory`,
    )
  await fs.rename(root, stage)
}

async function bounded(stream: ReadableStream<Uint8Array>, limit: number) {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      size += next.value.byteLength
      if (size > limit) throw new InstallError("invalid", "The archive exceeds the size limit")
      chunks.push(next.value)
    }
    return new Uint8Array(Buffer.concat(chunks, size))
  } finally {
    await reader.cancel().catch(() => undefined)
    reader.releaseLock()
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}
