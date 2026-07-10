export * as ConfigMigrateV1 from "./migrate"

import { ConfigV1 } from "./config"
import { ConfigAgentV1 } from "./agent"
import { ConfigMCPV1 } from "./mcp"
import { ConfigPermissionV1 } from "./permission"
import { ConfigProviderV1 } from "./provider"
import { ConfigProviderOptionsV1 } from "./provider-options"

const keys = new Set([
  "logLevel",
  "server",
  "command",
  "reference",
  "snapshot",
  "plugin",
  "autoshare",
  "disabled_providers",
  "enabled_providers",
  "small_model",
  "mode",
  "agent",
  "provider",
  "permission",
  "tools",
  "attachment",
  "layout",
])

export function isV1(input: unknown) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return false
  return Object.keys(input).some((key) => keys.has(key))
}

export function migrate(info: typeof ConfigV1.Info.Type) {
  return {
    $schema: info.$schema,
    shell: info.shell,
    model: info.model,
    default_agent: info.default_agent,
    autoupdate: info.autoupdate,
    share: info.share ?? (info.autoshare ? "auto" : undefined),
    enterprise: info.enterprise,
    username: info.username,
    permissions: permissions(info.permission, info.tools),
    agents: agents(info),
    snapshots: info.snapshot,
    watcher: info.watcher,
    formatter: info.formatter,
    lsp: info.lsp,
    attachments: info.attachment,
    tool_output: info.tool_output,
    mcp: mcp(info),
    compaction: info.compaction && {
      auto: info.compaction.auto,
      prune: info.compaction.prune,
      keep: {
        turns: info.compaction.tail_turns,
        tokens: info.compaction.preserve_recent_tokens,
      },
      buffer: info.compaction.reserved,
    },
    skills: info.skills && [...(info.skills.paths ?? []), ...(info.skills.urls ?? [])],
    commands: info.command,
    instructions: info.instructions,
    references: info.reference,
    plugins: info.plugin?.map((plugin) =>
      typeof plugin === "string" ? plugin : { package: plugin[0], options: plugin[1] },
    ),
    experimental: info.experimental?.policies && { policies: info.experimental.policies },
    providers: providers(info.provider),
  }
}

function permissions(info?: ConfigPermissionV1.Info, tools?: Readonly<Record<string, boolean>>) {
  const rules: Array<{ action: string; resource: string; effect: "allow" | "ask" | "deny" }> = Object.entries(
    tools ?? {},
  ).map(([action, enabled]) => ({
    action: normalizeAction(action),
    resource: "*",
    effect: enabled ? ("allow" as const) : ("deny" as const),
  }))
  for (const [action, rule] of Object.entries(info ?? {})) {
    if (!rule) continue
    if (typeof rule === "string") {
      rules.push({ action, resource: "*", effect: rule })
      continue
    }
    // kilocode_change - per-resource effect may also be null (delete sentinel); skip those entries
    rules.push(
      ...Object.entries(rule)
        .filter((entry): entry is [string, "allow" | "ask" | "deny"] => entry[1] !== null)
        .map(([resource, effect]) => ({ action, resource, effect })),
    )
  }
  return rules.length ? rules : undefined
}

function normalizeAction(action: string) {
  return action === "write" || action === "patch" ? "edit" : action
}

function agents(info: typeof ConfigV1.Info.Type) {
  const entries = [
    ...Object.entries(info.agent ?? {}),
    ...Object.entries(info.mode ?? {}).map(([name, agent]) => [name, { ...agent, mode: "primary" as const }] as const),
  ]
  if (!entries.length) return undefined
  return Object.fromEntries(entries.flatMap(([name, agent]) => (agent ? [[name, migrateAgent(agent)]] : [])))
}

// kilocode_change - v1 fields are nullable (delete sentinel); the v2 format has no such concept, so null collapses to undefined
export function migrateAgent(info: ConfigAgentV1.Info) {
  const body = {
    ...info.options,
    ...(info.temperature === undefined || info.temperature === null ? {} : { temperature: info.temperature }),
    ...(info.top_p === undefined || info.top_p === null ? {} : { top_p: info.top_p }),
  }
  return {
    model: info.model ?? undefined,
    variant: info.variant ?? undefined,
    request: Object.keys(body).length ? { body } : undefined,
    system: info.prompt ?? undefined,
    description: info.description ?? undefined,
    mode: info.mode,
    hidden: info.hidden,
    color: info.color,
    steps: info.steps ?? undefined,
    disabled: info.disable,
    permissions: permissions(info.permission),
  }
}

function mcp(info: typeof ConfigV1.Info.Type) {
  const servers = Object.fromEntries(
    Object.entries(info.mcp ?? {}).flatMap(([name, server]) =>
      "type" in server ? [[name, migrateMcp(server)] as const] : [],
    ),
  )
  const timeout = info.experimental?.mcp_timeout
  if (!timeout && !Object.keys(servers).length) return undefined
  return { timeout, servers }
}

function migrateMcp(info: ConfigMCPV1.Info) {
  const disabled = info.enabled === undefined ? undefined : !info.enabled
  if (info.type === "local")
    return { type: info.type, command: info.command, environment: info.environment, disabled, timeout: info.timeout }
  return {
    type: info.type,
    url: info.url,
    headers: info.headers,
    oauth: info.oauth && {
      client_id: info.oauth.clientId,
      client_secret: info.oauth.clientSecret,
      scope: info.oauth.scope,
      callback_port: info.oauth.callbackPort,
      redirect_uri: info.oauth.redirectUri,
    },
    disabled,
    timeout: info.timeout,
  }
}

function providers(info?: Readonly<Record<string, ConfigProviderV1.Info | null>>) {
  if (!info) return undefined
  // kilocode_change - provider entries may be null (delete sentinel); migration has nothing to convert for those
  return Object.fromEntries(
    Object.entries(info)
      .filter((entry): entry is [string, ConfigProviderV1.Info] => entry[1] !== null)
      .map(([name, provider]) => [name, migrateProvider(provider)]),
  )
}

function migrateProvider(info: ConfigProviderV1.Info) {
  const lowerer = ConfigProviderOptionsV1.get(info.npm)
  const options = lowerer.provider(info.options ?? {})
  return {
    name: info.name,
    env: info.env,
    api: info.npm
      ? {
          type: "aisdk" as const,
          package: info.npm,
          url: info.api ?? options.url,
          settings: options.settings ?? {},
        }
      : undefined,
    request: info.options && { headers: options.headers, body: options.body },
    // kilocode_change - model entries may be null (delete sentinel); migration has nothing to convert for those
    models:
      info.models &&
      Object.fromEntries(
        Object.entries(info.models)
          .filter((entry): entry is [string, typeof ConfigProviderV1.Model.Type] => entry[1] !== null)
          .map(([name, model]) => [name, migrateModel(model, info.npm)]),
      ),
  }
}

function migrateModel(info: typeof ConfigProviderV1.Model.Type, packageName?: string) {
  const costs = info.cost && [
    {
      input: info.cost.input,
      output: info.cost.output,
      cache: { read: info.cost.cache_read, write: info.cost.cache_write },
    },
    ...(info.cost.context_over_200k
      ? [
          {
            tier: { type: "context" as const, size: 200_000 },
            input: info.cost.context_over_200k.input,
            output: info.cost.context_over_200k.output,
            cache: { read: info.cost.context_over_200k.cache_read, write: info.cost.context_over_200k.cache_write },
          },
        ]
      : []),
  ]
  const capabilities =
    info.tool_call !== undefined || info.modalities?.input !== undefined || info.modalities?.output !== undefined
      ? { tools: info.tool_call ?? false, input: info.modalities?.input ?? [], output: info.modalities?.output ?? [] }
      : undefined
  const lowerer = ConfigProviderOptionsV1.get(info.provider?.npm ?? packageName)
  return {
    family: info.family,
    name: info.name,
    api: info.provider?.npm
      ? {
          ...(info.id === undefined ? {} : { id: info.id }),
          type: "aisdk" as const,
          package: info.provider.npm,
          url: info.provider.api,
          settings: {},
        }
      : info.id === undefined
        ? undefined
        : { id: info.id },
    capabilities,
    request: (info.headers || info.options) && {
      headers: info.headers,
      body: info.options && lowerer.request(info.options),
    },
    // kilocode_change - variant entries may be null (delete sentinel); migration has nothing to convert for those
    variants:
      info.variants &&
      Object.entries(info.variants)
        .filter((entry): entry is [string, NonNullable<(typeof info.variants)[string]>] => entry[1] !== null)
        .map(([id, options]) => ({ id, body: lowerer.request(options) })),
    cost: costs,
    disabled: info.status === "deprecated" ? true : undefined,
    limit: info.limit && {
      context: int(info.limit.context),
      input: info.limit.input === undefined ? undefined : int(info.limit.input),
      output: int(info.limit.output),
    },
  }
}

function int(value: number) {
  return Math.max(Number.MIN_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, Math.trunc(value)))
}
