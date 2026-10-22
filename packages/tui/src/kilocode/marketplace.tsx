// `/marketplace`: browse marketplaces and install or remove items. The `kilocode.marketplace` server plugin does the
// work (catalogs, downloads, file writes); this plugin only drives dialogs over its RPC, so it also works against a
// remote server.
//
// Several registries: the curated Kilo marketplace is on by default, community registries (skills.sh, the MCP
// registry) are turned on under "Registries". Lists merge every enabled registry; items outside Kilo carry a
// registry badge, and installing one asks for confirmation because nobody at Kilo reviewed it.
import { Plugin } from "@opencode/plugin/tui"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"

type Kind = KiloMarketplaceRpc.Kind
type Item = KiloMarketplaceRpc.Item
type Installed = KiloMarketplaceRpc.Installed
type RegistryInfo = KiloMarketplaceRpc.RegistryInfo
type Action = { type: "install" | "uninstall" | "details"; scope: KiloMarketplaceRpc.Scope }
type Choice = { type: "item"; item: Item } | { type: "search" }

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
              run: () => marketplace(context),
            },
          ],
        }))
        return null
      },
    })
  },
})

function connect(context: Plugin.Context) {
  return {
    rpc: context.client.rpc(KiloMarketplaceRpc.Definition),
    options: { location: { directory: (context.location ?? context.data.location.default()).directory } },
  }
}

async function marketplace(context: Plugin.Context): Promise<void> {
  const choice = await context.ui.dialog.select<Kind | "registries">({
    title: "Marketplace",
    options: [
      ...kinds.map((entry) => ({ title: entry.title, value: entry.kind, description: entry.description })),
      { title: "Registries", value: "registries" as const, description: "Choose which marketplaces to browse" },
    ],
  })
  if (!choice) return
  if (choice === "registries") {
    await registries(context)
    return marketplace(context)
  }
  return browse(context, choice)
}

async function registries(context: Plugin.Context): Promise<void> {
  const { rpc, options } = connect(context)
  const list = await rpc.registries({}, options).catch((error: Error) => {
    context.ui.toast.show({ variant: "error", message: error.message || "Couldn't load registries" })
    return undefined
  })
  if (!list) return
  const registry = await context.ui.dialog.select({
    title: "Registries",
    options: list.map((registry) => ({
      title: `${registry.enabled ? "[on] " : "[off]"} ${registry.name}`,
      value: registry,
      description: registry.description,
      category: registry.curated ? "Reviewed by Kilo" : "Community",
    })),
  })
  if (!registry) return
  if (!registry.enabled && !registry.curated) {
    const confirmed = await context.ui.dialog.confirm({
      title: `Enable ${registry.name}?`,
      message: `${registry.description}. Skills and MCP servers can run code and read your files; check an item's source before you install it.`,
      label: { confirm: "Enable" },
    })
    if (!confirmed) return registries(context)
  }
  await rpc["registries.set"]({ id: registry.id, enabled: !registry.enabled }, options).catch((error: Error) =>
    context.ui.toast.show({ variant: "error", message: error.message || "Couldn't change the registry" }),
  )
  return registries(context)
}

async function browse(context: Plugin.Context, kind: Kind, query?: string): Promise<void> {
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
  if (!loaded) return
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
  if (!choice) return
  if (choice.type === "search") {
    const next = await context.ui.dialog.prompt({ title: `Search ${label}`, placeholder: "for example: pdf, github" })
    if (!next?.trim()) return browse(context, kind, query)
    return browse(context, kind, next.trim())
  }
  await act(context, choice.item, installed, sources)
  return browse(context, kind, query)
}

async function act(
  context: Plugin.Context,
  item: Item,
  installed: readonly Installed[],
  sources: readonly RegistryInfo[],
) {
  const { rpc, options } = connect(context)
  const ref = { registry: item.registry, kind: item.kind, id: item.id }
  const scopes = scopesOf(installed, item)
  const actions = [
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
  if (!choice) return
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
      if (!confirmed) return
    }
    const answers = await ask(context, item)
    if (!answers) return
    const result = await rpc.install({ ...ref, scope: choice.scope, ...answers }, options).catch((error: Error) => {
      context.ui.toast.show({ variant: "error", message: error.message || "Unknown error" })
      return undefined
    })
    if (!result) return
    const notes = recordNotes(result)
    if (notes.length > 0)
      return context.ui.dialog.alert({
        title: `Installed ${item.name} (${choice.scope})`,
        message: [...(result.status === "ready" ? ["Status: ready"] : []), ...notes].join("\n"),
      })
    return context.ui.toast.show({
      variant: "success",
      message:
        item.kind === "mcp"
          ? `Installed ${item.name} (${choice.scope}). Use /mcps to check its status or sign in.`
          : `Installed ${item.name} (${choice.scope})`,
    })
  }
  const result = await rpc.uninstall({ ...ref, scope: choice.scope }, options).then(
    () => undefined,
    (error: Error) => error.message || "Unknown error",
  )
  if (result) return context.ui.toast.show({ variant: "error", message: result })
  context.ui.toast.show({
    variant: "success",
    message: `Uninstalled ${item.name}${item.kind === "mcp" ? ". Sign-in retained because it may be shared with other installations." : ""}`,
  })
}

/** Asks for the install option and the parameter values of an MCP server. `undefined` when the user cancels. */
async function ask(context: Plugin.Context, item: Item) {
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
  if (!option) return undefined
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
    if (value === undefined) return undefined
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
