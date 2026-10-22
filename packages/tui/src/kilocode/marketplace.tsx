// `/marketplace`: browse marketplaces and install or remove items. The `kilocode.marketplace` server plugin does the
// work (catalogs, downloads, file writes); this plugin only drives dialogs over its RPC, so it also works against a
// remote server.
//
// Several registries: the curated Kilo marketplace is on by default, community registries (skills.sh, the MCP
// registry) are turned on under "Registries". Lists merge every enabled registry; items outside Kilo carry a
// registry badge, and installing one asks for confirmation because nobody at Kilo reviewed it.
import { Plugin } from "@opencode/plugin/tui"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import type { LocationRef } from "@opencode/client"
import { createEffect, onCleanup } from "solid-js"
import { useLocation } from "../context/location"
import { DialogIntegration } from "../component/dialog-integration"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"

type Kind = KiloMarketplaceRpc.Kind
type Item = KiloMarketplaceRpc.Item
type Installed = KiloMarketplaceRpc.Installed
type RegistryInfo = KiloMarketplaceRpc.RegistryInfo
type Action = { type: "install" | "uninstall" | "details" | "auth"; scope: KiloMarketplaceRpc.Scope }
type Choice = { type: "item"; item: Item } | { type: "search" }
type Context = Plugin.Context & { target: LocationRef; signal: AbortSignal; signIn: (id: string) => Promise<void> }

const kinds: { kind: Kind; title: string; description: string }[] = [
  { kind: "skill", title: "Skills", description: "Instructions and resources the agent loads on demand" },
  { kind: "mcp", title: "MCP Servers", description: "Tools from Model Context Protocol servers" },
  { kind: "agent", title: "Agents", description: "Custom agents" },
]

/** Item kinds the server can install today. The others are listed for discovery. */
const installable = new Set<Kind>(["skill", "mcp"])

export default Plugin.define({
  id: "kilocode.marketplace",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        const location = useLocation()
        const dialog = useDialog()
        let active: AbortController | undefined
        let dismissed: (() => void) | undefined
        // Native auth replaces several dialogs. Observe final dismissal from this persistent app slot.
        createEffect(() => {
          if (dialog.stack.length > 0) return
          dismissed?.()
          dismissed = undefined
        })
        createEffect(() => {
          location.ref
          onCleanup(() => {
            if (!active) return
            active.abort()
            dismissed?.()
            dismissed = undefined
            context.ui.dialog.clear()
          })
        })
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "kilo.marketplace",
              title: "Marketplace",
              description: "Browse and install skills, MCP servers and agents",
              group: "Kilo",
              palette: true,
              slash: { name: "marketplace" },
              run: async () => {
                if (active) return
                active = new AbortController()
                await marketplace({
                  ...context,
                  target: location.ref ?? context.data.location.default(),
                  signal: active.signal,
                  signIn: (integrationID) =>
                    new Promise<void>((resolve) => {
                      dismissed = resolve
                      context.ui.dialog.show(() => <DialogIntegration integrationID={integrationID} autoConnect />)
                    }),
                }).finally(() => (active = undefined))
              },
            },
          ],
        }))
        return null
      },
    })
  },
})

function connect(context: Context) {
  return {
    rpc: context.client.rpc(KiloMarketplaceRpc.Definition),
    options: { location: context.target },
  }
}

async function marketplace(context: Context): Promise<void> {
  if (context.signal.aborted) return
  const choice = await context.ui.dialog.select<Kind | "registries" | "installed">({
    title: "Marketplace",
    options: [
      ...kinds.map((entry) => ({ title: entry.title, value: entry.kind, description: entry.description })),
      {
        title: "Installed",
        value: "installed" as const,
        description: "Manage installations even when catalogs are unavailable",
      },
      { title: "Registries", value: "registries" as const, description: "Choose which marketplaces to browse" },
    ],
  })
  if (!choice || context.signal.aborted) return
  if (choice === "installed") {
    await installed(context)
    return marketplace(context)
  }
  if (choice === "registries") {
    await registries(context)
    return marketplace(context)
  }
  return browse(context, choice)
}

async function installed(context: Context): Promise<void> {
  if (context.signal.aborted) return
  const { rpc, options } = connect(context)
  const cancelled = new AbortController()
  context.ui.dialog.show(
    () => (
      <DialogLayout header={<DialogHeader title="Installed" closeLabel="esc cancel" />}>
        <text>Loading installed items...</text>
      </DialogLayout>
    ),
    () => cancelled.abort(),
  )
  const records = await rpc
    .installed({}, { ...options, signal: AbortSignal.any([context.signal, cancelled.signal]) })
    .catch((error: Error) => {
      if (!context.signal.aborted && !cancelled.signal.aborted)
        context.ui.toast.show({
          variant: "error",
          message: `Couldn't load installations: ${error.message}. Reopen Installed to retry.`,
        })
      return undefined
    })
  if (context.signal.aborted || cancelled.signal.aborted) return
  context.ui.dialog.clear()
  if (!records) return
  if (records.length === 0)
    return context.ui.dialog.alert({ title: "Installed", message: "Nothing installed from marketplaces." })
  const record = await context.ui.dialog.select<Installed>({
    title: "Marketplace: Installed",
    placeholder: "Filter by item, kind, registry or scope",
    options: records.map((record) => ({
      title: `${record.id} (${record.kind}, ${record.registry}, ${record.scope})`,
      value: record,
      description: [record.status ?? (record.recovering ? "incomplete" : "installed"), ...recordNotes(record)].join(
        " · ",
      ),
    })),
    search: (query, choices) =>
      choices.filter((choice) =>
        [
          choice.value.id,
          choice.value.kind,
          choice.value.registry,
          choice.value.scope,
          choice.value.status ?? "installed",
          ...recordNotes(choice.value),
        ].some((value) => value.toLowerCase().includes(query.trim().toLowerCase())),
      ),
  })
  if (!record || context.signal.aborted) return
  const action = await context.ui.dialog.select<"details" | "uninstall" | "auth">({
    title: `${record.id} (${record.registry}, ${record.scope})`,
    options: [
      { title: "Details", value: "details" },
      ...(record.kind === "mcp" && record.server && record.config
        ? [{ title: "Sign In / Manage Authentication", value: "auth" as const }]
        : []),
      {
        title: "Uninstall",
        value: "uninstall",
        description: record.kind === "mcp" ? "Keeps sign-in; /mcps first" : "Remove owned installation files",
      },
    ],
  })
  if (!action || context.signal.aborted) return installed(context)
  if (action === "details")
    await context.ui.dialog.alert({
      title: `${record.id} (${record.registry}, ${record.scope})`,
      message: [
        `Kind: ${record.kind}`,
        `Registry: ${record.registry}`,
        `Scope: ${record.scope}`,
        ...(record.project ? [`Project: ${record.project}`] : []),
        ...record.paths.map((path) => `Path: ${path}`),
        ...(record.config ? [`Config: ${record.config}`] : []),
        ...(record.server ? [`MCP server: ${record.server}`] : []),
        ...(record.status === "ready" ? ["Status: ready"] : []),
        ...recordNotes(record),
        ...(record.status === "modified"
          ? ["Local changes are retained. Uninstall refuses to remove modified resources."]
          : []),
      ].join("\n"),
    })
  if (action === "auth") await mcpInstalled(context, record)
  if (action === "uninstall") await uninstall(context, record, record.id)
  return installed(context)
}

async function registries(context: Context): Promise<void> {
  if (context.signal.aborted) return
  const { rpc, options } = connect(context)
  const list = await rpc.registries({}, options).catch((error: Error) => {
    context.ui.toast.show({ variant: "error", message: error.message || "Couldn't load registries" })
    return undefined
  })
  if (!list || context.signal.aborted) return
  const registry = await context.ui.dialog.select({
    title: "Registries",
    options: list.map((registry) => ({
      title: `${registry.enabled ? "[on] " : "[off]"} ${registry.name}`,
      value: registry,
      description: registry.description,
      category: registry.curated ? "Reviewed by Kilo" : "Community",
    })),
  })
  if (!registry || context.signal.aborted) return
  if (!registry.enabled && !registry.curated) {
    const confirmed = await context.ui.dialog.confirm({
      title: `Enable ${registry.name}?`,
      message: `${registry.description}. Skills and MCP servers can run code and read your files; check an item's source before you install it.`,
      label: { confirm: "Enable" },
    })
    if (!confirmed || context.signal.aborted) return registries(context)
  }
  await rpc["registries.set"]({ id: registry.id, enabled: !registry.enabled }, options).catch((error: Error) =>
    context.ui.toast.show({ variant: "error", message: error.message || "Couldn't change the registry" }),
  )
  return registries(context)
}

async function browse(context: Context, kind: Kind, query?: string): Promise<void> {
  if (context.signal.aborted) return
  const { rpc, options } = connect(context)
  context.ui.toast.show({ variant: "info", message: query ? `Searching for "${query}"...` : "Loading marketplace..." })
  const loaded = await Promise.all([
    rpc.list({ kind, query }, options),
    rpc.installed({}, options),
    rpc.registries({}, options),
  ]).catch((error: Error) => {
    context.ui.toast.show({ variant: "error", message: error.message || "Couldn't load the marketplace" })
    return undefined
  })
  if (!loaded || context.signal.aborted) return
  const [listed, installed, sources] = loaded
  const items = listed.items
  // Keep diagnostics together so a later toast cannot hide a failed source or pending cleanup.
  const warnings = [
    ...listed.failures.map((failure) => `${failure.registry}: ${failure.message}`),
    ...installed
      .filter((record) => record.kind === kind)
      .flatMap((record) => recordNotes(record).map((note) => `${record.id} (${record.scope}): ${note}`)),
  ]
  if (warnings.length > 0 || items.length === 0) {
    context.ui.toast.show({
      variant: warnings.length > 0 ? "warning" : "info",
      message: [
        ...warnings,
        ...(items.length === 0
          ? [
              "No items found in the enabled registries that responded.",
              ...sources
                .filter((source) => !source.enabled && source.kinds.includes(kind))
                .map((source) => `${source.name} is disabled; enable it under Marketplace > Registries.`),
            ]
          : []),
      ].join("\n"),
    })
  }
  const searchable = sources.filter((source) => source.enabled && source.searchable && source.kinds.includes(kind))
  const label = kinds.find((entry) => entry.kind === kind)?.title ?? kind
  const choice = await context.ui.dialog.select<Choice>({
    title: query ? `Marketplace: ${label} matching "${query}"` : `Marketplace: ${label}`,
    placeholder: "Filter",
    options: [
      ...(searchable.length > 0
        ? [
            {
              title: "Search enabled registries...",
              value: { type: "search" as const },
              description: `Search the full catalogs of ${searchable.map((source) => source.name).join(", ")}`,
            },
          ]
        : []),
      ...items.map((item) => {
        const scopes = scopesOf(installed, item)
        const source = sources.find((entry) => entry.id === item.registry)
        // Items with the same name in other registries, so a user sees the alternatives side by side.
        const twins = items
          .filter((other) => other !== item && other.name === item.name && other.registry !== item.registry)
          .map((other) => nameOf(sources, other.registry))
        return {
          title: item.name,
          value: { type: "item" as const, item },
          description: oneLine(item.description),
          category: scopes.length > 0 ? "Installed" : source?.curated ? (item.category ?? "Other") : source?.name,
          footer:
            [
              scopes.length > 0
                ? installed
                    .filter(
                      (record) =>
                        record.registry === item.registry && record.kind === item.kind && record.id === item.id,
                    )
                    .map(
                      (record) =>
                        `${record.scope}: ${record.status ?? (record.recovering ? "incomplete" : "installed")}${recordNotes(record).length ? " (see details)" : ""}`,
                    )
                    .join(", ")
                : undefined,
              source && !source.curated ? source.name : undefined,
              twins.length > 0 ? `also in ${twins.join(", ")}` : undefined,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        }
      }),
    ],
    search: (needle, options) => {
      const text = needle.trim().toLowerCase()
      if (!text) return options
      return options.filter(
        (option) =>
          option.value.type === "search" ||
          [
            option.value.item.id,
            option.value.item.name,
            option.value.item.description,
            option.value.item.category,
            ...option.value.item.tags,
          ]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(text)),
      )
    },
  })
  if (!choice || context.signal.aborted) return
  if (choice.type === "search") {
    const next = await context.ui.dialog.prompt({ title: `Search ${label}`, placeholder: "for example: pdf, github" })
    if (!next?.trim()) return browse(context, kind, query)
    return browse(context, kind, next.trim())
  }
  await act(context, choice.item, installed, sources)
  return browse(context, kind, query)
}

async function act(context: Context, item: Item, installed: readonly Installed[], sources: readonly RegistryInfo[]) {
  const { rpc, options } = connect(context)
  const ref = { registry: item.registry, kind: item.kind, id: item.id }
  const scopes = scopesOf(installed, item)
  const actions = [
    ...scopes.flatMap((scope) =>
      item.kind === "mcp"
        ? [{ title: `Sign In / Manage Authentication (${scope})`, value: { type: "auth" as const, scope } }]
        : [],
    ),
    ...(installable.has(item.kind)
      ? (["global", "project"] as const).flatMap((scope) => {
          const record = installed.find(
            (entry) =>
              entry.registry === item.registry &&
              entry.kind === item.kind &&
              entry.id === item.id &&
              entry.scope === scope,
          )
          if (record?.status === "modified") return []
          const repair = record?.status === "missing" || record?.status === "incomplete" || record?.recovering
          return [
            {
              title: record
                ? `${repair ? "Repair / reinstall" : "Reinstall"} (${scope})`
                : scope === "global"
                  ? "Install globally"
                  : "Install in this project",
              value: { type: "install" as const, scope },
              description: record
                ? "Install the current catalog entry again; this is not version management"
                : scope === "global"
                  ? "Available in every project"
                  : "Only in this project's .kilo2 directory",
            },
          ]
        })
      : []),
    ...scopes.map((scope) => ({
      title: `Uninstall (${scope})`,
      value: { type: "uninstall" as const, scope },
      description: item.kind === "mcp" ? "Keeps sign-in; /mcps first" : "Remove the files the marketplace installed",
    })),
    { title: "Details", value: { type: "details" as const, scope: "global" as const }, description: undefined },
  ]
  const choice = await context.ui.dialog.select<Action>({ title: item.name, options: actions })
  if (!choice || context.signal.aborted) return
  if (choice.type === "auth") {
    const record = installed.find(
      (entry) =>
        entry.registry === item.registry &&
        entry.kind === item.kind &&
        entry.id === item.id &&
        entry.scope === choice.scope,
    )
    if (record) await mcpInstalled(context, record)
    return
  }
  const source = sources.find((entry) => entry.id === item.registry)
  if (choice.type === "details")
    return context.ui.dialog.alert({
      title: item.name,
      message: [
        details(item, source),
        ...installed
          .filter((entry) => entry.registry === item.registry && entry.kind === item.kind && entry.id === item.id)
          .flatMap((record) => [
            `Installed (${record.scope})${record.status === "ready" ? ": ready" : ""}`,
            ...recordNotes(record),
            ...(record.status === "modified"
              ? ["Local changes are retained. Review them before reinstalling or uninstalling."]
              : []),
          ]),
      ].join("\n"),
    })
  if (choice.type === "install") {
    if (source && !source.curated) {
      const confirmed = await context.ui.dialog.confirm({
        title: `Install from ${source.name}?`,
        message: `${item.name} comes from ${source.name} and was not reviewed by Kilo.${item.url ? `\nSource: ${item.url}` : ""}`,
        label: { confirm: "Install" },
      })
      if (!confirmed || context.signal.aborted) return
    }
    const answers = await ask(context, item)
    if (!answers || context.signal.aborted) return
    const result = await rpc.install({ ...ref, scope: choice.scope, ...answers }, options).catch((error: Error) => {
      context.ui.toast.show({ variant: "error", message: error.message || "Unknown error" })
      return undefined
    })
    if (!result || context.signal.aborted) return
    const notes = recordNotes(result)
    if (notes.length > 0) {
      await context.ui.dialog.alert({
        title: `Installed ${item.name} (${choice.scope})`,
        message: [...(result.status === "ready" ? ["Status: ready"] : []), ...notes].join("\n"),
      })
      if (item.kind !== "mcp" || context.signal.aborted) return
    }
    if (item.kind === "mcp") return mcpInstalled(context, result)
    return context.ui.toast.show({
      variant: "success",
      message: `Installed ${item.name} (${choice.scope})`,
    })
  }
  return uninstall(context, { ...ref, scope: choice.scope }, item.name)
}

async function uninstall(
  context: Context,
  record: Pick<Installed, "registry" | "kind" | "id" | "scope">,
  name: string,
) {
  const { rpc, options } = connect(context)
  const result = await rpc
    .uninstall({ registry: record.registry, kind: record.kind, id: record.id, scope: record.scope }, options)
    .then(
      () => undefined,
      (error: Error) => error.message || "Unknown error",
    )
  if (context.signal.aborted) return
  if (result) return context.ui.toast.show({ variant: "error", message: result })
  context.ui.toast.show({
    variant: "success",
    message: `Uninstalled ${name}${record.kind === "mcp" ? ". Sign-in retained because it may be shared with other installations." : ""}`,
  })
}

async function mcpInstalled(context: Context, record: Installed, signedIn = false): Promise<void> {
  if (context.signal.aborted) return
  const cancelled = new AbortController()
  const signal = AbortSignal.any([context.signal, cancelled.signal, AbortSignal.timeout(15_000)])
  context.ui.dialog.show(
    () => (
      <DialogLayout header={<DialogHeader title={`Installed ${record.server ?? record.id}`} closeLabel="esc skip" />}>
        <text>Checking MCP connection status...</text>
      </DialogLayout>
    ),
    () => cancelled.abort(),
  )
  const state = await (async () => {
    if (!record.server || !record.config) return { message: "Cannot identify the installed MCP configuration." }
    while (!signal.aborted) {
      const entries = await context.client.config.get({ location: context.target }, { signal })
      // The API orders documents by precedence. Never authenticate a project override of this installation.
      const effective = entries.findLast(
        (entry) => entry.type === "document" && Object.hasOwn(entry.info.mcp?.servers ?? {}, record.server!),
      )
      if (effective?.type === "document" && effective.path !== record.config)
        return {
          overridden: true,
          message: "This installation is overridden in this project. Manage the effective server with /mcps.",
        }
      if (effective) {
        const servers = await context.client.mcp.list({ location: context.target }, { signal })
        const server = servers.data.find((server) => server.name === record.server)
        if (server && server.status.status !== "pending") return { server }
      }
      await new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer)
          signal.removeEventListener("abort", done)
          resolve()
        }
        const timer = setTimeout(done, 250)
        signal.addEventListener("abort", done, { once: true })
      })
    }
    return { message: "Connection status is not ready yet." }
  })().catch(() => ({ message: "Connection status is not ready yet." }))
  if (context.signal.aborted || cancelled.signal.aborted) return
  context.ui.dialog.clear()
  const server = "server" in state ? state.server : undefined
  if (server?.status.status === "connected")
    return context.ui.dialog.alert({
      title: `Installed ${record.server} and connected`,
      message: "The MCP server is ready to use.",
    })
  if (server?.status.status === "disabled")
    return context.ui.dialog.alert({
      title: `Installed ${record.server}`,
      message: "This MCP server is disabled. Use /mcps to manage it.",
    })
  if ("overridden" in state && state.message)
    return context.ui.dialog.alert({ title: `Installed ${record.server}`, message: state.message })
  if (server?.status.status === "failed") {
    await context.ui.dialog.alert({
      title: `Installed ${record.server}${signedIn ? ": signed in" : ""}; connection failed`,
      message: server.status.error,
    })
    if (context.signal.aborted) return
  }
  const needsAuth = server?.status.status === "needs_auth" && !!server.integrationID
  const choice = await context.ui.dialog.select({
    title: `Installed ${record.server ?? record.id}${signedIn ? ": signed in" : ""}`,
    options: [
      {
        title: needsAuth ? "Sign In" : "Check Again",
        value: "retry",
        description: needsAuth
          ? "This server needs sign-in. OAuth on a remote server requires a browser on that machine or callback forwarding."
          : server?.status.status === "failed"
            ? "Connection failed. Use /mcps to investigate."
            : "message" in state
              ? state.message
              : "Sign-in is still required. Use /mcps to manage it.",
      },
      {
        title: needsAuth ? "Skip" : "Later",
        value: "later",
        description: "Installation is kept. Use /mcps to check status or sign in.",
      },
    ],
  })
  if (choice !== "retry" || context.signal.aborted) return
  if (!needsAuth || !server?.integrationID) return mcpInstalled(context, record, signedIn)
  await context.data.location.integration.sync(context.target).catch(() => undefined)
  if (context.signal.aborted) return
  if (!context.data.location.integration.list(context.target)?.some((entry) => entry.id === server.integrationID))
    return context.ui.dialog.alert({
      title: "Sign-in not ready",
      message: "Could not load this integration. Use /mcps to retry; installation is kept.",
    })
  if (context.target.workspaceID) {
    await context.ui.dialog.alert({
      title: "Sign-in deferred",
      message: "Manage authentication with /mcps in this workspace.",
    })
    return
  }
  await context.signIn(server.integrationID)
  if (context.signal.aborted) return
  const integration = await context.client.integration
    .get({ integrationID: server.integrationID, location: context.target })
    .catch(() => undefined)
  if (context.signal.aborted) return
  return mcpInstalled(
    context,
    record,
    integration?.data.connections.some((connection) => connection.type === "credential" && !connection.status),
  )
}

/** Asks for the install option and the parameter values of an MCP server. `undefined` when the user cancels. */
async function ask(context: Context, item: Item) {
  if (item.kind !== "mcp") return {}
  const option =
    item.options.length > 1
      ? await context.ui.dialog.select({
          title: `${item.name}: install method`,
          options: item.options.map((option) => ({
            title: option.name,
            value: option,
            description:
              [
                option.description,
                option.prerequisites.length > 0 ? `Needs ${option.prerequisites.join(", ")}` : undefined,
              ]
                .filter(Boolean)
                .join(" · ") || undefined,
          })),
        })
      : item.options[0]
  if (!option || context.signal.aborted) return undefined
  // The option's parameters win over the item's on the same key, as on the server.
  const declared = [
    ...item.parameters.filter((parameter) => !option.parameters.some((own) => own.key === parameter.key)),
    ...option.parameters,
  ]
  const params: Record<string, string> = {}
  for (const parameter of declared) {
    const value = await context.ui.dialog.prompt({
      title: parameter.name,
      description: parameter.optional ? "Optional. Leave empty to skip." : `Required by ${item.name}.`,
      placeholder: parameter.placeholder,
    })
    if (value === undefined || context.signal.aborted) return undefined
    if (!parameter.optional && !value.trim()) {
      context.ui.toast.show({ variant: "error", message: `${parameter.name} is required` })
      return undefined
    }
    params[parameter.key] = value.trim()
  }
  return { option: option.name, params }
}

function recordNotes(record: Installed) {
  return [
    ...(record.status && record.status !== "ready" ? [`Status: ${record.status}`] : []),
    ...(record.recovering ? ["Installation is incomplete; reinstall to repair it."] : []),
    ...(record.warnings?.length
      ? record.warnings
      : (record.pending ?? []).map((resource) =>
          "path" in resource
            ? `Pending cleanup: ${resource.path}`
            : `Pending cleanup: ${resource.config} (MCP server ${resource.server})`,
        )),
  ]
}

function scopesOf(installed: readonly Installed[], item: Item) {
  return installed
    .filter((entry) => entry.registry === item.registry && entry.kind === item.kind && entry.id === item.id)
    .map((entry) => entry.scope)
}

function nameOf(sources: readonly RegistryInfo[], id: string) {
  return sources.find((source) => source.id === id)?.name ?? id
}

function details(item: Item, source: RegistryInfo | undefined) {
  return [
    item.description,
    "",
    `Registry: ${source?.name ?? item.registry}${source && !source.curated ? " (community, not reviewed by Kilo)" : ""}`,
    item.author ? `Author: ${item.author}` : undefined,
    item.category ? `Category: ${item.category}` : undefined,
    item.url ? `Source: ${item.url}` : undefined,
    item.prerequisites.length > 0 ? `Prerequisites: ${item.prerequisites.join(", ")}` : undefined,
    item.options.length > 0 ? `Install options: ${item.options.map((option) => option.name).join(", ")}` : undefined,
    installable.has(item.kind) ? undefined : `Installing ${item.kind} items from the marketplace is coming soon.`,
  ]
    .filter((line) => line !== undefined)
    .join("\n")
}

function oneLine(text: string) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > 100 ? `${flat.slice(0, 97)}...` : flat
}
