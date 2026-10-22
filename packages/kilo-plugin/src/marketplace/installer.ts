export * as Installer from "./installer"

import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { MarketplaceMcp, McpError } from "./mcp"
import type { Entry } from "./registry"
import { Skill, SkillError } from "./skill"

export class FetchError extends Error {}
export type Failure = SkillError | McpError | FetchError
type Resource = KiloMarketplaceRpc.Resource

export interface Written {
  readonly paths: readonly string[]
  readonly config?: string
  readonly server?: string
  readonly resources?: readonly Resource[]
  readonly pending?: readonly Resource[]
}

export async function install(input: {
  entry: Entry
  skills: string
  config: string
  option?: string
  params?: Readonly<Record<string, string>>
  previous?: KiloMarketplaceRpc.Installed
  beforeWrite?: (intent: Written) => Promise<void>
}): Promise<Written> {
  const item = input.entry.item
  if (item.kind !== "skill" && item.kind !== "mcp") {
    throw new McpError("invalid_params", `Installing ${item.kind} items is not supported yet`)
  }
  const index = input.option === undefined ? 0 : item.options.findIndex((option) => option.name === input.option)
  const template = input.entry.payloads[index]
  if (item.kind === "mcp" && (index < 0 || typeof template !== "string")) {
    throw new McpError("not_found", `${item.name} has no install option ${input.option ?? ""}`.trim())
  }
  const server =
    item.kind === "mcp"
      ? MarketplaceMcp.build({
          template: template as string,
          parameters: MarketplaceMcp.parameters(item, item.options[index]),
          params: input.params ?? {},
        })
      : undefined
  if (item.kind === "skill" && !input.entry.archive) throw new SkillError("invalid", `Skill ${item.id} has no archive`)
  const skills = []
  for (const companion of item.kind === "skill"
    ? [{ id: input.entry.select ?? item.id, archive: input.entry.archive!, select: input.entry.select }]
    : (input.entry.companions ?? [])) {
    skills.push(await Skill.prepare({ root: input.skills, ...companion, archive: await download(companion.archive) }))
  }
  const resources: Resource[] = [
    ...skills.map((skill) => ({ path: skill.target, fingerprints: [skill.fingerprint] })),
    ...(server
      ? [
          {
            config: input.config,
            server: MarketplaceMcp.serverName(item.id),
            fingerprints: [MarketplaceMcp.serverFingerprint(server)],
          },
        ]
      : []),
  ]
  if (new Set(resources.map(key)).size !== resources.length)
    throw new SkillError("invalid", "Duplicate install resources")
  const prior = input.previous ? [...active(input.previous), ...(input.previous.pending ?? [])] : []
  const allowed = (resource: Resource) =>
    prior.filter((old) => key(old) === key(resource)).flatMap((old) => old.fingerprints ?? [])
  // Preparation and ownership preflight finish before the durable intent and before any target writes.
  for (const resource of resources) {
    if ("path" in resource) await Skill.preflight(resource.path, allowed(resource))
    else
      await MarketplaceMcp.preflight({ file: resource.config, name: resource.server, fingerprints: allowed(resource) })
  }
  const pending = prior.filter((old) => !resources.some((resource) => key(resource) === key(old)))
  const written: Written = {
    paths: skills.map((skill) => skill.target),
    ...(server ? { config: input.config, server: MarketplaceMcp.serverName(item.id) } : {}),
    resources,
    ...(pending.length ? { pending } : {}),
  }
  await input.beforeWrite?.({
    ...written,
    resources: resources.map((resource) => ({
      ...resource,
      fingerprints: [...new Set([...(resource.fingerprints ?? []), ...allowed(resource)])],
    })),
  })
  const created: Resource[] = []
  try {
    for (const skill of skills) {
      const resource = resources.find((resource) => "path" in resource && resource.path === skill.target)!
      const existed = (await resourceFingerprint(resource)) !== undefined
      if (!existed) created.push(resource)
      await Skill.write(skill, allowed(resource))
    }
    if (server) {
      const resource = resources[resources.length - 1]
      await MarketplaceMcp.write({
        file: input.config,
        name: MarketplaceMcp.serverName(item.id),
        server,
        replace: true,
        fingerprints: allowed(resource),
      })
    }
  } catch (error) {
    const results = await Promise.allSettled(created.map(cleanup))
    const failures = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
    if (failures.length)
      throw new AggregateError(
        [error, ...failures],
        `Install failed: ${message(error)}; rollback failed: ${failures.map(message).join("; ")}`,
        { cause: error },
      )
    throw error
  }
  return written
}

function key(resource: Resource) {
  return JSON.stringify("path" in resource ? ["path", resource.path] : ["config", resource.config, resource.server])
}

function active(record: Written & { id: string }): readonly Resource[] {
  // Legacy locations are readable, but no fingerprint means no authority to destroy existing content.
  return [
    ...record.paths.map((path) => ({ path })),
    ...(record.config
      ? [{ config: record.config, server: record.server ?? MarketplaceMcp.serverName(record.id) }]
      : []),
  ].map((resource) => record.resources?.find((owned) => key(owned) === key(resource)) ?? resource)
}

export async function resourceFingerprint(resource: Resource): Promise<string | undefined> {
  return "path" in resource
    ? Skill.fingerprint(resource.path)
    : MarketplaceMcp.fingerprint(resource.config, resource.server)
}

export async function cleanup(resource: Resource) {
  if ("path" in resource) return Skill.remove(resource.path, resource.fingerprints)
  await MarketplaceMcp.remove({ file: resource.config, name: resource.server, fingerprints: resource.fingerprints })
}

export async function uninstall(record: Written & { readonly id: string }) {
  const results = await Promise.allSettled([...active(record), ...(record.pending ?? [])].map(cleanup))
  const errors = results.flatMap((result) => (result.status === "rejected" ? [result.reason] : []))
  if (errors.length)
    throw new AggregateError(errors, `Uninstall cleanup failed: ${errors.map(message).join("; ")}`, {
      cause: errors[0],
    })
}

export async function inspect(
  record: Written & { id: string; recovering?: boolean },
): Promise<{ status: "ready" | "missing" | "modified" | "incomplete"; warnings: readonly string[] }> {
  const warnings: string[] = []
  const states = await Promise.all(
    active(record).map(async (resource) => {
      try {
        const current = await resourceFingerprint(resource)
        if (current === undefined) return "missing"
        if (resource.fingerprints?.includes(current)) return "ready"
        warnings.push(`Resource ${key(resource)} is modified or has no ownership fingerprint`)
        return "modified"
      } catch (error) {
        warnings.push(`Cannot inspect ${key(resource)}: ${message(error)}`)
        return "modified"
      }
    }),
  )
  if (record.recovering) warnings.push("Installation was interrupted and requires recovery")
  if (record.pending?.length) warnings.push("Obsolete resources are awaiting cleanup")
  return {
    status: states.includes("modified")
      ? "modified"
      : record.recovering
        ? "incomplete"
        : states.includes("missing")
          ? "missing"
          : "ready",
    warnings,
  }
}

function message(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

const MAX_DOWNLOAD = 32 * 1024 * 1024
async function download(url: string) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(60_000) })
    if (!response.ok || Number(response.headers.get("content-length")) > MAX_DOWNLOAD) {
      await response.body?.cancel().catch(() => undefined)
      throw new FetchError(!response.ok ? `HTTP ${response.status}` : "Archive exceeds the download byte limit")
    }
    if (!response.body) throw new FetchError("Archive response has no body")
    return await Skill.bounded(response.body, MAX_DOWNLOAD)
  } catch (error) {
    throw new FetchError(`Couldn't download ${url}: ${message(error)}`)
  }
}
