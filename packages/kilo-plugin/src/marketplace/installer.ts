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
      replace: input.previous !== undefined,
      select: input.entry.select,
    })
    return { paths: [target] }
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
  const owned = new Set(input.previous?.paths ?? [])
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
      replace: input.previous?.config === input.config,
    })
  } catch (error) {
    // Roll back the companion skills this install created. Skills of a previous install are not touched.
    await Promise.all(created.filter((target) => !owned.has(target)).map((target) => removeSkill(target)))
    throw error
  }
  const name = serverName(item.id)
  const previous = input.previous
  if (previous) {
    // Drop what the previous install owned that this one no longer covers: companions the catalog dropped, and the
    // server entry when the config file or key changed. Runs only after success, so a failed reinstall keeps it.
    const kept = new Set(created)
    await Promise.all(previous.paths.filter((target) => !kept.has(target)).map((target) => removeSkill(target)))
    const server = previous.server ?? name
    if (previous.config && (previous.config !== input.config || server !== name)) {
      await removeServer({ file: previous.config, name: server })
    }
  }
  return { paths: created, config: input.config, server: name }
}

export async function uninstall(record: Written & { readonly id: string }) {
  if (record.config) await removeServer({ file: record.config, name: record.server ?? serverName(record.id) })
  for (const target of record.paths) await removeSkill(target)
}

async function download(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(60_000) }).catch((error: Error) => {
    throw new FetchError(`Couldn't download ${url}: ${error.message}`)
  })
  if (!response.ok) throw new FetchError(`Couldn't download ${url}: HTTP ${response.status}`)
  return new Uint8Array(await response.arrayBuffer())
}
