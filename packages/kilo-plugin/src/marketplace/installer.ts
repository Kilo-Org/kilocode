export * as Installer from "./installer"

import { MarketplaceMcp, McpError } from "./mcp"
import type { Entry } from "./registry"
import { Skill, SkillError } from "./skill"

export class FetchError extends Error {}
export type Failure = SkillError | McpError | FetchError

/** An owned resource at its current absolute location; the stored record keeps only ids and server names. */
export type Resource =
  | { readonly path: string; readonly fingerprints?: readonly string[] }
  | {
      readonly config: string
      readonly server: string
      readonly target?: string
      readonly fingerprints?: readonly string[]
    }

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
  previous?: Written & { readonly id: string; readonly recovering?: boolean }
  beforeWrite?: (intent: Written) => Promise<void>
}): Promise<Written> {
  const item = input.entry.item
  const configuration = item.kind === "mcp" ? mcp(input.entry, input.option, input.params ?? {}) : undefined
  const server = configuration?.server
  if (item.kind === "skill" && !input.entry.archive) throw new SkillError("invalid", `Skill ${item.id} has no archive`)
  const skills = []
  for (const companion of item.kind === "skill"
    ? [{ id: input.entry.select ?? item.id, archive: input.entry.archive!, select: input.entry.select }]
    : (input.entry.companions ?? [])) {
    skills.push(await Skill.prepare({ root: input.skills, ...companion, archive: await download(companion.archive) }))
  }
  const config = server
    ? {
        config: input.config,
        server: MarketplaceMcp.serverName(item.id),
        target: await MarketplaceMcp.resolveFile(input.config),
        fingerprints: [MarketplaceMcp.serverFingerprint(server)],
      }
    : undefined
  const resources: Resource[] = [
    ...skills.map((skill) => ({ path: skill.target, fingerprints: [skill.fingerprint] })),
    ...(config ? [config] : []),
  ]
  if (new Set(resources.map(key)).size !== resources.length)
    throw new SkillError("invalid", "Duplicate install resources")
  const prior = input.previous ? [...active(input.previous), ...(input.previous.pending ?? [])] : []
  for (const resource of prior.filter((old) =>
    resources.some(
      (resource) =>
        key(old) === key(resource) ||
        ("config" in old && "config" in resource && old.config === resource.config && old.server === resource.server),
    ),
  ))
    await checkTarget(resource)
  const allowed = (resource: Resource) =>
    prior.filter((old) => same(old, resource)).flatMap((old) => old.fingerprints ?? [])
  // Content that already equals what this install writes is adopted: stored ownership can be lost (a reset
  // database, a renamed project), and rewriting identical content never destroys anything. Differing
  // content stays protected unless an earlier record owned it.
  const accepted = (resource: Resource) => [...new Set([...allowed(resource), ...(resource.fingerprints ?? [])])]
  // Preparation and ownership preflight finish before durable intent and target writes.
  for (const resource of resources) {
    if ("path" in resource) await Skill.preflight(resource.path, accepted(resource))
    else
      await MarketplaceMcp.preflight({ file: resource.config, name: resource.server, fingerprints: accepted(resource) })
  }
  const pending = prior.filter((old) => !resources.some((resource) => same(old, resource)))
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
      await Skill.write(skill, accepted(resource))
      // Never roll back another concurrent install's tree merely because its fingerprint matches.
      if (!existed) created.push(resource)
    }
    if (server && config) {
      await MarketplaceMcp.write({
        file: input.config,
        name: config.server,
        server,
        replace: true,
        fingerprints: accepted(config),
        secret: configuration?.parameters.some(
          (parameter) => parameter.secret && input.params?.[parameter.key]?.trim(),
        ),
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

/** Redact before interpolation, so secrets cannot reach the rendered configuration preview. */
export function preview(input: { entry: Entry; option?: string; params?: Readonly<Record<string, string>> }) {
  const index =
    input.option === undefined ? 0 : input.entry.item.options.findIndex((option) => option.name === input.option)
  const parameters = MarketplaceMcp.parameters(input.entry.item, input.entry.item.options[index])
  const secrets = parameters.filter((parameter) => parameter.secret && input.params?.[parameter.key]?.trim())
  const redacted = {
    ...input.params,
    ...Object.fromEntries(secrets.map((parameter) => [parameter.key, "[redacted]"])),
  }
  return {
    server: JSON.stringify(mcp(input.entry, input.option, redacted).server, null, 2),
    parameters: parameters.map((parameter) => `${parameter.name} (${parameter.key})`),
    secrets: secrets.map((parameter) => parameter.name),
  }
}

function mcp(entry: Entry, option: string | undefined, params: Readonly<Record<string, string>>) {
  if (entry.item.kind !== "mcp") throw new McpError("invalid_params", "Only MCP servers have a configuration preview")
  const index = option === undefined ? 0 : entry.item.options.findIndex((entry) => entry.name === option)
  const template = entry.payloads[index]
  if (index < 0 || typeof template !== "string") {
    throw new McpError("not_found", `${entry.item.name} has no install option ${option ?? ""}`.trim())
  }
  const parameters = MarketplaceMcp.parameters(entry.item, entry.item.options[index])
  return { server: MarketplaceMcp.build({ template, parameters, params }), parameters }
}

function key(resource: Resource) {
  return JSON.stringify(
    "path" in resource ? ["path", resource.path] : ["config", resource.target ?? resource.config, resource.server],
  )
}

function same(left: Resource, right: Resource) {
  return (
    key(left) === key(right) ||
    ("config" in left &&
      "config" in right &&
      (!left.target || !right.target) &&
      left.config === right.config &&
      left.server === right.server)
  )
}

function active(record: Written & { id: string }): readonly Resource[] {
  // Legacy paths without fingerprints never authorize destroying existing content.
  return [
    ...record.paths.map((path) => ({ path })),
    ...(record.config
      ? [{ config: record.config, server: record.server ?? MarketplaceMcp.serverName(record.id) }]
      : []),
  ].map(
    (resource) =>
      record.resources?.find((owned) =>
        "path" in resource
          ? "path" in owned && owned.path === resource.path
          : "config" in owned && owned.config === resource.config && owned.server === resource.server,
      ) ?? resource,
  )
}

export async function resourceFingerprint(resource: Resource): Promise<string | undefined> {
  await checkTarget(resource)
  return "path" in resource
    ? Skill.fingerprint(resource.path)
    : MarketplaceMcp.fingerprint(resource.config, resource.server)
}

export async function cleanup(resource: Resource) {
  await checkTarget(resource)
  if ("path" in resource) return Skill.remove(resource.path, resource.fingerprints)
  await MarketplaceMcp.remove({ file: resource.config, name: resource.server, fingerprints: resource.fingerprints })
}

async function checkTarget(resource: Resource) {
  if (
    "config" in resource &&
    resource.target &&
    resource.target !== (await MarketplaceMcp.resolveFile(resource.config))
  )
    throw new McpError("conflict", `MCP config target changed since installation: ${resource.config}`)
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
