export * as Installer from "./installer"

import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import path from "node:path"
import { McpError, build, parameters, remove as removeServer, serverName, write as writeServer } from "./mcp"
import type { Entry } from "./registry"
import { SkillError, install as installSkill, remove as removeSkill } from "./skill"

// Install and uninstall of one marketplace entry, as plain file operations. The plugin decides the target
// directories and records the result; uninstall gets back exactly the paths and config entry that install reports.

export class FetchError extends Error {}

export type Failure = SkillError | McpError | FetchError

/** What an install wrote: the directories it created and the config file that holds the MCP entry. */
export interface Written {
  readonly paths: readonly string[]
  readonly config?: string
  /** The `mcp.servers` key that holds the MCP entry. */
  readonly server?: string
  readonly pending?: KiloMarketplaceRpc.Installed["pending"]
}

export async function install(input: {
  entry: Entry
  /** The `skills` directory of the target scope. */
  skills: string
  /** The config file of the target scope, for MCP servers. */
  config: string
  option?: string
  params?: Readonly<Record<string, string>>
  /** The previous install of the same item and scope, whose files this install may replace. */
  previous?: KiloMarketplaceRpc.Installed
}): Promise<Written> {
  const item = input.entry.item
  if (item.kind === "skill") {
    if (!input.entry.archive) throw new SkillError("invalid", `Skill ${item.id} has no archive`)
    const target = await installSkill({
      root: input.skills,
      // A registry id can have slashes (`owner/repo/skill`); the directory is named after the skill itself.
      id: input.entry.select ?? item.id,
      archive: await download(input.entry.archive),
      replace:
        (input.previous?.paths.includes(path.join(input.skills, input.entry.select ?? item.id)) ?? false) ||
        (input.previous?.pending?.some(
          (resource) => "path" in resource && resource.path === path.join(input.skills, input.entry.select ?? item.id),
        ) ??
          false),
      select: input.entry.select,
    })
    return withPending({ paths: [target] }, input.previous)
  }
  if (item.kind === "mcp") return installMcp(input)
  throw new McpError("invalid_params", `Installing ${item.kind} items is not supported yet`)
}

async function installMcp(input: Parameters<typeof install>[0]): Promise<Written> {
  const item = input.entry.item
  const index = input.option === undefined ? 0 : item.options.findIndex((option) => option.name === input.option)
  const template = input.entry.payloads[index]
  if (index < 0 || typeof template !== "string") {
    throw new McpError("not_found", `${item.name} has no install option ${input.option ?? ""}`.trim())
  }
  // Build before any write, so invalid parameters leave nothing behind.
  const server = build({ template, parameters: parameters(item, item.options[index]), params: input.params ?? {} })
  const owned = new Set([
    ...(input.previous?.paths ?? []),
    ...(input.previous?.pending?.flatMap((resource) => ("path" in resource ? [resource.path] : [])) ?? []),
  ])
  const created: string[] = []
  try {
    for (const companion of input.entry.companions ?? []) {
      const target = path.join(input.skills, companion.id)
      created.push(
        await installSkill({
          root: input.skills,
          id: companion.id,
          archive: await download(companion.archive),
          replace: owned.has(target),
        }),
      )
    }
    await writeServer({
      file: input.config,
      name: serverName(item.id),
      server,
      replace:
        (input.previous?.config === input.config &&
          (input.previous.server ?? serverName(item.id)) === serverName(item.id)) ||
        (input.previous?.pending?.some(
          (resource) =>
            "config" in resource && resource.config === input.config && resource.server === serverName(item.id),
        ) ??
          false),
    })
  } catch (error) {
    // Roll back the companion skills this install created. Skills of a previous install are not touched.
    await Promise.all(created.filter((target) => !owned.has(target)).map((target) => removeSkill(target)))
    throw error
  }
  const name = serverName(item.id)
  return withPending({ paths: created, config: input.config, server: name }, input.previous)
}

// Cleanup runs only after the plugin durably records both the new install and its obsolete resources.
function withPending(written: Written, previous: KiloMarketplaceRpc.Installed | undefined): Written {
  if (!previous) return written
  const resources = [
    ...(previous.pending ?? []),
    ...previous.paths.map((target) => ({ path: target })),
    ...(previous.config ? [{ config: previous.config, server: previous.server ?? serverName(previous.id) }] : []),
  ].filter((resource) =>
    "path" in resource
      ? !written.paths.includes(resource.path)
      : resource.config !== written.config || resource.server !== written.server,
  )
  const pending = [...new Map(resources.map((resource) => [JSON.stringify(resource), resource])).values()]
  return { ...written, ...(pending.length > 0 ? { pending } : {}) }
}

export async function cleanup(resource: NonNullable<Written["pending"]>[number]) {
  if ("path" in resource) return removeSkill(resource.path)
  await removeServer({ file: resource.config, name: resource.server })
}

export async function uninstall(record: Written & { readonly id: string }) {
  if (record.config) await removeServer({ file: record.config, name: record.server ?? serverName(record.id) })
  for (const target of record.paths) await removeSkill(target)
  for (const resource of record.pending ?? []) await cleanup(resource)
}

async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch((error: Error) => {
    throw new FetchError(`Couldn't download ${url}: ${error.message}`)
  })
  if (!response.ok) throw new FetchError(`Couldn't download ${url}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}
