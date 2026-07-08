import { createHash } from "node:crypto"
import { Schema } from "effect"
import type { Item, Manifest, McpMethod, Parameter, ParameterValue } from "../marketplace/schema"
import { Stack } from "./schema"

export namespace Planner {
  export type Platform = McpMethod["platforms"][number]

  export interface Inventory {
    readonly project: Readonly<Record<string, Stack.Digest>>
    readonly inherited: ReadonlyArray<Stack.ResourceRef>
  }

  export interface Input {
    readonly catalog: Stack.Catalog
    readonly marketplace?: Manifest
    readonly draft: Stack.Draft
    readonly inventory: Inventory
    readonly receipts: Readonly<Record<string, Stack.Receipt>>
    readonly config_revision: Stack.Digest
    readonly platform: Platform
  }

  export interface ResolvedResource {
    readonly ref: Stack.ResourceRef
    readonly default: boolean
    readonly enabled: boolean
    readonly technologies: ReadonlyArray<Stack.TechnologyID>
    readonly warnings: ReadonlyArray<string>
    readonly override?: Stack.Override
  }

  export interface Resolution {
    readonly draft: Stack.Draft
    readonly technologies: ReadonlyArray<Stack.TechnologyID>
    readonly resources: ReadonlyArray<ResolvedResource>
    readonly conflicts: ReadonlyArray<Stack.Conflict>
  }

  interface Group {
    readonly technologies: Set<Stack.TechnologyID>
    readonly warnings: Set<string>
    default: boolean
  }

  export interface Validation {
    readonly blocked?: string
    readonly fingerprint?: Stack.Digest
    readonly warnings: ReadonlyArray<string>
    readonly prerequisites: ReadonlyArray<string>
  }

  function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value)
  }

  function compare(left: string, right: string) {
    if (left < right) return -1
    if (left > right) return 1
    return 0
  }

  export function canonical(value: unknown): string {
    if (value === null || value === undefined) return "null"
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
    if (record(value)) {
      return `{${Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .toSorted()
        .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
        .join(",")}}`
    }
    return JSON.stringify(value) ?? "null"
  }

  export function hash(value: unknown): Stack.Digest {
    return Stack.Digest.make(`sha256:${createHash("sha256").update(canonical(value)).digest("hex")}`)
  }

  export function fingerprintMcp(value: unknown): Stack.Digest {
    if (!record(value)) return hash(value)
    return hash(Object.fromEntries(Object.entries(value).filter(([key]) => key !== "enabled")))
  }

  export function normalize(draft: Stack.Draft): Stack.Draft {
    const verticals = Object.fromEntries(
      Object.entries(draft.verticals)
        .toSorted(([left], [right]) => compare(left, right))
        .map(([id, value]) => [id, { technologies: [...new Set(value.technologies)].toSorted() }]),
    )
    const resources = Object.fromEntries(
      Object.entries(draft.resources)
        .toSorted(([left], [right]) => compare(left, right))
        .map(([ref, value]) => {
          const parameters = Object.entries(value.parameters ?? {}).toSorted(([left], [right]) => compare(left, right))
          return [
            ref,
            {
              enabled: value.enabled,
              ...(value.method === undefined ? {} : { method: value.method }),
              ...(parameters.length === 0 ? {} : { parameters: Object.fromEntries(parameters) }),
            },
          ]
        }),
    )
    return Schema.decodeUnknownSync(Stack.Draft)({ verticals, resources })
  }

  function order(conflicts: ReadonlyArray<Stack.Conflict>) {
    return [...conflicts].toSorted((left, right) =>
      compare(
        [left.resource ?? "", left.code, left.action ?? "", left.message].join("\u0000"),
        [right.resource ?? "", right.code, right.action ?? "", right.message].join("\u0000"),
      ),
    )
  }

  export function resolve(catalog: Stack.Catalog, input: Stack.Draft): Resolution {
    const draft = normalize(input)
    const conflicts: Stack.Conflict[] = []
    const selected = new Map<Stack.TechnologyID, Stack.Technology>()
    const verticals = new Map(catalog.verticals.map((vertical) => [vertical.id, vertical]))

    for (const [id, value] of Object.entries(draft.verticals)) {
      const vertical = verticals.get(Stack.VerticalID.make(id))
      if (!vertical) {
        conflicts.push({ code: "invalid_draft", message: `Unknown vertical ${id}.` })
        continue
      }
      const technologies = new Map(vertical.technologies.map((technology) => [technology.id, technology]))
      for (const technology of value.technologies) {
        const item = technologies.get(Stack.TechnologyID.make(technology))
        if (!item) {
          conflicts.push({
            code: "invalid_draft",
            message: `Technology ${technology} does not belong to vertical ${id}.`,
          })
          continue
        }
        selected.set(item.id, item)
      }
    }

    const groups = new Map<Stack.ResourceRef, Group>()
    for (const technology of [...selected.values()].toSorted((left, right) => compare(left.id, right.id))) {
      for (const association of technology.resources) {
        const group = groups.get(association.ref) ?? {
          default: false,
          technologies: new Set<Stack.TechnologyID>(),
          warnings: new Set<string>(),
        }
        // Only Kilo-curated associations may promote a resource to default.
        // Advisory (publisher-supplied) associations surface the resource as a candidate but never set default.
        if (association.curated === true) group.default = group.default || association.default
        group.technologies.add(technology.id)
        association.warnings.forEach((warning) => group.warnings.add(warning))
        groups.set(association.ref, group)
      }
    }

    for (const ref of Object.keys(draft.resources)) {
      if (groups.has(Stack.ResourceRef.make(ref))) continue
      conflicts.push({
        code: "invalid_draft",
        message: `Resource override ${ref} is not associated with a selected technology.`,
        resource: Stack.ResourceRef.make(ref),
      })
    }

    const resources = [...groups.entries()]
      .map(([ref, group]): ResolvedResource => {
        const override = draft.resources[ref]
        return {
          ref,
          default: group.default,
          enabled: override?.enabled ?? group.default,
          technologies: [...group.technologies].toSorted(),
          warnings: [...group.warnings].toSorted(),
          ...(override === undefined ? {} : { override }),
        }
      })
      .toSorted((left, right) => compare(left.ref, right.ref))

    return {
      draft,
      technologies: [...selected.keys()].toSorted(),
      resources,
      conflicts: order(conflicts),
    }
  }

  function secure(value: string) {
    if (!URL.canParse(value)) return false
    const url = new URL(value)
    if (url.username || url.password) return false
    return url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost"].includes(url.hostname))
  }

  function valid(definition: Parameter, value: ParameterValue) {
    const typed = (() => {
      if (definition.type === "integer") return typeof value === "number" && Number.isInteger(value)
      if (definition.type === "boolean") return typeof value === "boolean"
      if (
        typeof value !== "string" ||
        value.length > 2_048 ||
        (definition.required && value.length === 0) ||
        /[\u0000-\u001f\u007f{}]/.test(value)
      ) {
        return false
      }
      if (definition.type === "path") {
        return !/^(?:[A-Za-z]:[\\/]|[\\/])/.test(value) && !value.split(/[\\/]/).includes("..")
      }
      if (definition.type !== "url") return true
      return secure(value)
    })()
    if (!typed) return false
    return !definition.allowed_values || definition.allowed_values.some((allowed) => allowed === value)
  }

  function render(value: string, values: ReadonlyMap<string, ParameterValue>) {
    const result = [...values].reduce((text, [key, next]) => text.split(`{param:${key}}`).join(String(next)), value)
    return /\{param:[^}]*\}/.test(result) ? undefined : result
  }

  export function validate(
    item: Item,
    override: Stack.Override | undefined,
    platform: Platform,
    enabled = true,
  ): Validation {
    const base = { warnings: [] as string[], prerequisites: [] as string[] }
    if (item.kind === "skill") {
      if (override?.method !== undefined || Object.keys(override?.parameters ?? {}).length > 0) {
        return { ...base, blocked: "Skill resources do not accept methods or parameters." }
      }
      return base
    }
    if (!override?.method) {
      if (!enabled && Object.keys(override?.parameters ?? {}).length === 0) return base
      return { ...base, blocked: "Select an installation method." }
    }
    const method = item.methods.find((candidate) => String(candidate.id) === String(override.method))
    if (!method) return { ...base, blocked: `Installation method ${override.method} is unavailable.` }
    if (!method.platforms.includes(platform)) {
      return { ...base, blocked: `Installation method ${override.method} does not support ${platform}.` }
    }

    const definitions = new Map(method.parameters.map((definition) => [String(definition.id), definition]))
    const values = new Map<string, ParameterValue>()
    for (const [key, value] of Object.entries(override.parameters ?? {})) {
      const definition = definitions.get(key)
      if (!definition) return { ...base, blocked: `Parameter ${key} is not supported by ${override.method}.` }
      if (definition.sensitive)
        return { ...base, blocked: `Sensitive parameter ${key} must use its environment reference.` }
      if (!valid(definition, value)) return { ...base, blocked: `Parameter ${key} is invalid.` }
      values.set(key, value)
    }
    if (!enabled) return base
    for (const definition of method.parameters) {
      if (definition.sensitive) {
        if (!definition.environment) {
          return { ...base, blocked: `Sensitive parameter ${definition.id} has no environment reference.` }
        }
        base.prerequisites.push(`Set environment variable ${definition.environment}.`)
        continue
      }
      if (!values.has(definition.id) && definition.default !== undefined) values.set(definition.id, definition.default)
      if (definition.required && !values.has(definition.id)) {
        return { ...base, blocked: `Required parameter ${definition.id} is missing.` }
      }
    }
    for (const name of method.auth.environment ?? []) base.prerequisites.push(`Set environment variable ${name}.`)
    base.prerequisites.push(...method.prerequisites)
    if (method.auth.mode === "oauth") base.prerequisites.push("Complete OAuth authentication after installation.")
    if (method.warnings.writes) base.warnings.push(method.warnings.text ?? "This MCP can perform write operations.")

    const template = method.template
    const config = (() => {
      if (template.type === "local") {
        const command = template.command.map((value) => render(value, values))
        if (command.some((value) => value === undefined)) return undefined
        const environment = Object.entries(template.environment ?? {}).map(([key, value]) => [
          key,
          render(value, values),
        ])
        if (environment.some(([, value]) => value === undefined)) return undefined
        return {
          type: "local",
          command,
          ...(environment.length === 0 ? {} : { environment: Object.fromEntries(environment) }),
          ...(template.timeout === undefined ? {} : { timeout: template.timeout }),
        }
      }
      const url = render(template.url, values)
      const headers = Object.entries(template.headers ?? {}).map(([key, value]) => [key, render(value, values)])
      if (url === undefined || !secure(url) || headers.some(([, value]) => value === undefined)) return undefined
      const oauth = (() => {
        if (!template.oauth) return template.oauth
        const entries = Object.entries(template.oauth).map(([key, value]) => [
          key,
          typeof value === "string" ? render(value, values) : value,
        ])
        if (entries.some(([, value]) => value === undefined)) return undefined
        return Object.fromEntries(entries)
      })()
      if (template.oauth && oauth === undefined) return undefined
      return {
        type: "remote",
        url,
        ...(headers.length === 0 ? {} : { headers: Object.fromEntries(headers) }),
        ...(oauth === undefined ? {} : { oauth }),
        ...(template.timeout === undefined ? {} : { timeout: template.timeout }),
      }
    })()
    if (!config) return { ...base, blocked: `Installation method ${override.method} has unresolved parameters.` }
    return {
      fingerprint: fingerprintMcp(config),
      warnings: [...new Set(base.warnings)].toSorted(),
      prerequisites: [...new Set(base.prerequisites)].toSorted(),
    }
  }

  export function digest(item: Item): Stack.Digest | undefined {
    if (item.kind === "skill") return item.artifact ? Stack.Digest.make(item.artifact.digest) : undefined
    return hash(item)
  }

  function unavailable(item: Item) {
    if (!item.installability.installable)
      return item.installability.reason ?? "Marketplace resource is not installable."
    if (item.kind === "skill" && !item.artifact) return "Marketplace Skill has no installable artifact."
    if (item.kind === "mcp" && item.methods.length === 0) return "Marketplace MCP has no installation methods."
    return undefined
  }

  function action(input: {
    readonly action: Stack.ActionKind
    readonly resource: Stack.ResourceRef
    readonly technologies: ReadonlyArray<Stack.TechnologyID>
    readonly reason: string
    readonly warnings?: ReadonlyArray<string>
    readonly prerequisites?: ReadonlyArray<string>
  }): Stack.Action {
    return {
      action: input.action,
      resource: input.resource,
      technologies: [...input.technologies].toSorted(),
      reason: input.reason,
      warnings: [...new Set(input.warnings ?? [])].toSorted(),
      prerequisites: [...new Set(input.prerequisites ?? [])].toSorted(),
    }
  }

  export function plan(input: Input): Stack.Plan {
    const resolution = resolve(input.catalog, input.draft)
    const conflicts = [...resolution.conflicts]
    if (!input.marketplace) {
      conflicts.push({ code: "marketplace_unavailable", message: "Marketplace manifest is unavailable." })
    }

    const catalog = new Map(input.catalog.resources.map((resource) => [resource.ref, resource]))
    const marketplace = new Map<string, Item>(
      (input.marketplace?.items ?? []).map((item) => [`${item.kind}:${item.id}`, item]),
    )
    const desired = new Map(
      resolution.resources.filter((resource) => resource.enabled).map((resource) => [resource.ref, resource]),
    )
    const receipts = new Map<Stack.ResourceRef, Stack.Receipt>()
    for (const [key, receipt] of Object.entries(input.receipts).toSorted(([left], [right]) => compare(left, right))) {
      const ref = Stack.ResourceRef.make(key)
      if (key.slice(key.indexOf(":") + 1) !== receipt.marketplace_id) {
        conflicts.push({
          code: "invalid_config",
          message: `Management receipt ${key} does not match Marketplace ID ${receipt.marketplace_id}.`,
          resource: ref,
        })
        continue
      }
      receipts.set(ref, receipt)
    }

    const inherited = new Set(input.inventory.inherited)
    const overrides: Record<string, Stack.Override> = Object.fromEntries(
      Object.entries(resolution.draft.resources).map(([ref, override]) => [ref, { enabled: override.enabled }]),
    )
    const validations = new Map<Stack.ResourceRef, Validation>()
    for (const resource of resolution.resources) {
      const override = resource.override
      const current = input.inventory.project[resource.ref]
      const receipt = receipts.get(resource.ref)
      const item = marketplace.get(resource.ref)
      const supplied = override?.method !== undefined || Object.keys(override?.parameters ?? {}).length > 0
      const preserved =
        (current !== undefined && (!receipt || current !== receipt.fingerprint)) ||
        (current === undefined && inherited.has(resource.ref))
      if (!input.marketplace) continue
      if (!item) {
        if (resource.enabled || supplied) {
          if (preserved) {
            validations.set(resource.ref, {
              warnings: [`Marketplace resource ${resource.ref} is missing; the existing resource remains unmanaged.`],
              prerequisites: [],
            })
          } else {
            conflicts.push({
              code: "missing_marketplace_resource",
              message: `Marketplace resource ${resource.ref} is missing.`,
              resource: resource.ref,
              action: "missing",
            })
          }
        }
        continue
      }
      const reason = unavailable(item)
      if (reason) {
        if (resource.enabled || supplied) {
          if (preserved) {
            validations.set(resource.ref, {
              warnings: [`Marketplace resource ${resource.ref} is unavailable; the existing resource was preserved.`],
              prerequisites: [],
            })
          } else {
            conflicts.push({
              code: "marketplace_unavailable",
              message: `Marketplace resource ${resource.ref} is unavailable: ${reason}`,
              resource: resource.ref,
              action: "blocked",
            })
          }
        }
        continue
      }
      if (preserved) continue

      const prepared = validate(item, override, input.platform, resource.enabled)
      validations.set(resource.ref, prepared)
      if (!prepared.blocked && override) overrides[resource.ref] = override
      if (prepared.blocked) {
        conflicts.push({
          code: "invalid_draft",
          message: prepared.blocked,
          resource: resource.ref,
          action: "blocked",
        })
      }
    }
    const draft = normalize({ verticals: resolution.draft.verticals, resources: overrides })
    const refs = new Set<Stack.ResourceRef>([
      ...desired.keys(),
      ...Object.keys(input.receipts).map((key) => Stack.ResourceRef.make(key)),
    ])
    const actions: Stack.Action[] = []
    for (const ref of [...refs].toSorted()) {
      const resolved = desired.get(ref)
      const receipt = receipts.get(ref)
      const current = input.inventory.project[ref]
      const resource = catalog.get(ref)
      const warnings = [...new Set([...(resource?.warnings ?? []), ...(resolved?.warnings ?? [])])]
      const technologies = resolved?.technologies ?? []
      const prepared = validations.get(ref) ?? { warnings: [], prerequisites: [] }
      const details = {
        warnings: [...warnings, ...prepared.warnings],
        prerequisites: prepared.prerequisites,
      }

      if (!resolved) {
        if (!receipt) continue
        if (current === undefined) {
          actions.push(
            action({
              action: "remove",
              resource: ref,
              technologies,
              reason: "Managed resource is already missing; remove its receipt.",
              warnings,
            }),
          )
          continue
        }
        if (current !== receipt.fingerprint) {
          actions.push(
            action({
              action: "relinquish_modified",
              resource: ref,
              technologies,
              reason: "Managed resource was modified; preserve it and relinquish ownership.",
              warnings,
            }),
          )
          continue
        }
        actions.push(
          action({
            action: "remove",
            resource: ref,
            technologies,
            reason: "Resource is no longer desired and still matches its receipt.",
            warnings,
          }),
        )
        continue
      }

      if (!resource) {
        conflicts.push({ code: "invalid_config", message: `Catalog resource ${ref} is missing.`, resource: ref })
        actions.push(
          action({
            action: "missing",
            resource: ref,
            technologies,
            reason: "Resource is absent from the Stack catalog.",
            warnings,
          }),
        )
        continue
      }
      if (current !== undefined && !receipt) {
        actions.push(
          action({
            action: "already_available_unmanaged",
            resource: ref,
            technologies,
            reason: "Resource is already available in the project and is not managed by Stack.",
            ...details,
          }),
        )
        continue
      }
      if (current !== undefined && receipt && current !== receipt.fingerprint) {
        actions.push(
          action({
            action: "relinquish_modified",
            resource: ref,
            technologies,
            reason: "Managed resource was modified; preserve it and relinquish ownership.",
            ...details,
          }),
        )
        continue
      }
      if (current === undefined && inherited.has(ref)) {
        actions.push(
          action({
            action: "already_available_unmanaged",
            resource: ref,
            technologies,
            reason: receipt
              ? "Managed project resource is missing, but an inherited unmanaged resource is available; relinquish the stale receipt."
              : "Resource is inherited and remains outside Stack management.",
            ...details,
          }),
        )
        continue
      }
      if (prepared.blocked) {
        actions.push(
          action({
            action: "blocked",
            resource: ref,
            technologies,
            reason: prepared.blocked,
            ...details,
          }),
        )
        continue
      }
      if (!input.marketplace) {
        actions.push(
          action({
            action: "blocked",
            resource: ref,
            technologies,
            reason: "Marketplace manifest is unavailable.",
            ...details,
          }),
        )
        continue
      }
      const item = marketplace.get(ref)
      if (!item) {
        actions.push(
          action({
            action: "missing",
            resource: ref,
            technologies,
            reason: "Resource is absent from Marketplace.",
            warnings,
          }),
        )
        continue
      }
      if (current !== undefined && receipt) {
        const changed =
          (item.version !== undefined && receipt.version !== item.version) ||
          receipt.digest !== digest(item) ||
          (item.kind === "mcp" && prepared.fingerprint !== receipt.fingerprint)
        if (!changed) {
          actions.push(
            action({
              action: "keep",
              resource: ref,
              technologies,
              reason: "Managed resource matches its desired state and receipt.",
              ...details,
            }),
          )
          continue
        }
        const blocked = unavailable(item)
        if (blocked) {
          actions.push(action({ action: "blocked", resource: ref, technologies, reason: blocked, ...details }))
          continue
        }
        actions.push(
          action({
            action: "install",
            resource: ref,
            technologies,
            reason: "Managed resource requires an update to match desired state.",
            ...details,
          }),
        )
        continue
      }

      const blocked = unavailable(item)
      if (blocked) {
        actions.push(action({ action: "blocked", resource: ref, technologies, reason: blocked, ...details }))
        continue
      }
      actions.push(
        action({
          action: "install",
          resource: ref,
          technologies,
          reason: receipt
            ? "Managed resource is missing and must be reinstalled."
            : "Desired resource is not available in the project.",
          ...details,
        }),
      )
    }

    const sorted = actions.toSorted((left, right) => compare(left.resource, right.resource))
    const issues = order(conflicts)
    const warnings = [...new Set(sorted.flatMap((item) => item.warnings))].toSorted()
    const prerequisites = [...new Set(sorted.flatMap((item) => item.prerequisites))].toSorted()
    const relevant = new Set(refs)
    const inventory = {
      project: Object.fromEntries(
        Object.entries(input.inventory.project)
          .filter(([ref]) => relevant.has(Stack.ResourceRef.make(ref)))
          .toSorted(([left], [right]) => compare(left, right)),
      ),
      inherited: [...new Set(input.inventory.inherited.filter((ref) => relevant.has(ref)))].toSorted(),
    }
    const base = {
      draft,
      actions: sorted,
      conflicts: issues,
      warnings,
      prerequisites,
      config_revision: input.config_revision,
      catalog_revision: input.catalog.revision,
    }
    const plan_hash = hash({
      version: 1,
      ...base,
      marketplace_revision: input.marketplace?.revision ?? null,
      platform: input.platform,
      inventory,
      receipts: Object.fromEntries(Object.entries(input.receipts).toSorted(([left], [right]) => compare(left, right))),
    })
    return { ...base, plan_hash }
  }
}
