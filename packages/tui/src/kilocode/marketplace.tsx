// The server owns catalogs, installation and files, including when this TUI connects remotely.
import { Plugin } from "@opencode/plugin/tui"
import { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import type { LocationRef } from "@opencode/client"
import { TextAttributes } from "@opentui/core"
import { useTerminalDimensions } from "@opentui/solid"
import { createEffect, createMemo, createSignal, For, on, onCleanup, Show } from "solid-js"
import { useLocation } from "../context/location"
import { useTheme } from "../context/theme"
import { DialogIntegration } from "../component/dialog-integration"
import { DialogHeader, DialogLayout, useDialog } from "../ui/dialog"
import { DialogSelect, type DialogSelectOption, type DialogSelectRef } from "../ui/dialog-select"
import { DialogMarketplaceSecret } from "./dialog-marketplace-secret"
import { DialogMarketplaceInstall } from "./dialog-marketplace-install"

type Item = KiloMarketplaceRpc.Item
type Installed = KiloMarketplaceRpc.Installed
type Action = { type: "install" | "uninstall" | "details" | "auth"; scope: KiloMarketplaceRpc.Scope }
type Context = Plugin.Context & {
  target: LocationRef
  signal: AbortSignal
  cancel: () => void
  signIn: (id: string) => Promise<void>
}
type Tab = "all" | "installed" | "skills" | "mcps"
type BrowserState = { tab: Tab; query: string; selected?: string }
type Entry = { item?: Item; record?: Installed }
type Choice = Entry & { details: boolean; records: readonly Installed[] }

const tabs: { id: Tab; title: string }[] = [
  { id: "all", title: "All" },
  { id: "installed", title: "Installed" },
  { id: "skills", title: "Skills" },
  { id: "mcps", title: "MCPs" },
]

const kinds = [
  { kind: "skill", title: "Skills" },
  { kind: "mcp", title: "MCPs" },
] as const

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
            active = undefined
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
              description: "Browse and install skills and MCP servers",
              group: "Kilo",
              palette: true,
              slash: { name: "marketplace" },
              run: async () => {
                if (active) return
                const controller = new AbortController()
                active = controller
                await marketplace({
                  ...context,
                  target: location.ref ?? context.data.location.default(),
                  signal: controller.signal,
                  cancel: () => {
                    controller.abort()
                    if (active === controller) active = undefined
                  },
                  signIn: (integrationID) =>
                    new Promise<void>((resolve) => {
                      dismissed = resolve
                      context.ui.dialog.show(() => <DialogIntegration integrationID={integrationID} autoConnect />)
                    }),
                }).finally(() => {
                  if (active === controller) active = undefined
                })
              },
            },
          ],
        }))
        return null
      },
    })
  },
})

function connect(context: Pick<Context, "client" | "target" | "signal">) {
  return {
    rpc: context.client.rpc(KiloMarketplaceRpc.Definition),
    options: { location: context.target, signal: context.signal },
  }
}

async function marketplace(context: Context) {
  const state: BrowserState = { tab: "all", query: "" }
  while (!context.signal.aborted) {
    const choice = await new Promise<Choice | undefined>((resolve) => {
      context.ui.dialog.show(
        () => <DialogMarketplace context={context} state={state} onChoose={resolve} />,
        () => resolve(undefined),
      )
    })
    if (!choice || context.signal.aborted) return
    if (choice.details) {
      await new Promise<void>((resolve) => {
        context.ui.dialog.show(() => <MarketplaceDetails entry={choice} records={choice.records} />, resolve)
      })
      continue
    }
    if (choice.record) {
      const record = choice.record
      const action = await context.ui.dialog.select<"details" | "uninstall" | "auth">({
        title: `${record.id} (${record.registry}, ${record.scope})`,
        options: [
          { title: "Details", value: "details" },
          ...(record.kind === "mcp" && record.server && record.config
            ? [{ title: "Sign In / Manage Authentication", value: "auth" as const }]
            : []),
          { title: "Uninstall", value: "uninstall", description: "Remove owned resources; retain shared sign-in" },
        ],
      })
      if (context.signal.aborted) return
      if (action === "details")
        await new Promise<void>((resolve) => {
          context.ui.dialog.show(() => <MarketplaceDetails entry={choice} records={choice.records} />, resolve)
        })
      if (action === "auth") await mcpInstalled(context, record)
      if (action === "uninstall") await uninstall(context, record, record.id)
      continue
    }
    if (choice.item) await act(context, choice.item, choice.records)
  }
}

/** The production grouped browser; values are stable identities rather than mutable catalog objects. */
export function DialogMarketplace(props: {
  context: Pick<Context, "client" | "target" | "signal">
  state: BrowserState
  onChoose: (choice: Choice) => void
}) {
  const dialog = useDialog()
  const dimensions = useTerminalDimensions()
  const theme = useTheme().surface("dialog")
  const wide = () => dimensions().width >= 108
  const [tab, setTab] = createSignal(props.state.tab)
  const [query, setQuery] = createSignal(props.state.query)
  const [selected, setSelected] = createSignal(props.state.selected)
  const [items, setItems] = createSignal<readonly Item[]>([])
  const [records, setRecords] = createSignal<readonly Installed[]>([])
  const [loading, setLoading] = createSignal(true)
  const [inventoryLoading, setInventoryLoading] = createSignal(true)
  const [errors, setErrors] = createSignal<string[]>([])
  const [inventoryError, setInventoryError] = createSignal("")
  let request: AbortController | undefined
  let select: DialogSelectRef<string> | undefined
  const mounted = new AbortController()
  onCleanup(() => {
    mounted.abort()
    request?.abort()
  })
  createEffect(() => dialog.setSize(wide() ? "xlarge" : "large"))

  async function load(refresh = false) {
    request?.abort()
    const current = new AbortController()
    request = current
    const { rpc, options } = connect(props.context)
    const signal = AbortSignal.any([options.signal, mounted.signal, current.signal])
    setLoading(true)
    setInventoryLoading(true)
    setErrors([])
    setInventoryError("")
    // Inventory is a separate recovery boundary, not contingent on a responding catalog.
    void rpc.installed({}, { ...options, signal }).then(
      (value) => {
        if (signal.aborted) return
        setRecords(value)
        setInventoryLoading(false)
      },
      (error: Error) => {
        if (signal.aborted) return
        setInventoryError(`Couldn't load installations: ${error.message}. Refresh to retry.`)
        setInventoryLoading(false)
      },
    )
    const listed = await Promise.all(
      kinds.map(async ({ kind, title }) => {
        const result = await rpc.list({ kind, refresh }, { ...options, signal }).catch((error: Error) => {
          if (!signal.aborted) setErrors((values) => [...values, `${title}: ${error.message}`])
          return undefined
        })
        if (!signal.aborted && result?.failures.length)
          setErrors((values) => [...values, ...result.failures.map((failure) => `${title}: ${failure.message}`)])
        return result?.items ?? []
      }),
    )
    if (signal.aborted) return
    setItems(listed.flat())
    setLoading(false)
  }
  void load()

  const visibleKinds = () =>
    kinds.filter(
      ({ kind }) =>
        tab() === "all" || tab() === "installed" || (tab() === "skills" ? kind === "skill" : kind === "mcp"),
    )
  const entries = createMemo(() => {
    const text = query().trim().toLowerCase()
    const matches = (values: (string | undefined)[]) => values.some((value) => value?.toLowerCase().includes(text))
    return visibleKinds().flatMap(({ kind, title }) => {
      const rows: (DialogSelectOption<string> & { entry: Entry })[] =
        tab() === "installed"
          ? records()
              .filter((record) => record.kind === kind)
              .map((record) => ({
                record,
                item: items().find(
                  (item) => item.registry === record.registry && item.kind === record.kind && item.id === record.id,
                ),
              }))
              .filter(({ record, item }) =>
                matches([
                  record.id,
                  record.kind,
                  record.registry,
                  record.scope,
                  record.status,
                  record.project,
                  record.config,
                  record.server,
                  ...record.paths,
                  ...recordNotes(record),
                  item?.name,
                  item?.description,
                  item?.author,
                  item?.url,
                  ...(item?.tags ?? []),
                ]),
              )
              .map(({ record, item }) => ({
                title: record.id,
                value: identity(record),
                category: title,
                entry: { record },
              }))
          : items()
              .filter((item) => item.kind === kind)
              .filter((item) =>
                matches([item.id, item.name, item.description, item.author, item.registry, item.url, ...item.tags]),
              )
              .map((item) => ({
                title: item.name,
                value: identity(item),
                category: title,
                entry: { item },
              }))
      return rows.length
        ? rows
        : [
            {
              title:
                tab() !== "installed" && loading()
                  ? `Loading ${title.toLowerCase()}...`
                  : tab() === "installed"
                    ? `No installed ${title.toLowerCase()}${text ? " match" : ""}`
                    : `No ${title.toLowerCase()}${text ? " match" : " available"}`,
              value: `empty:${kind}`,
              category: title,
              entry: { item: undefined, record: undefined },
            },
          ]
    })
  })
  const options = createMemo<DialogSelectOption<string>[]>(() => entries())
  const entry = createMemo(() => entries().find((row) => row.value === selected())?.entry)
  const actionable = () => !!(entry()?.item || entry()?.record)
  createEffect(
    on([entries, loading, inventoryLoading], () => {
      if (loading() || inventoryLoading()) return
      const value = selected()
      const next =
        value && entries().some((row) => row.value === value && (row.entry.item || row.entry.record))
          ? value
          : entries().find((row) => row.entry.item || row.entry.record)?.value
      if (!next) return
      props.state.selected = next
      setSelected(next)
      queueMicrotask(() => {
        if (!mounted.signal.aborted) select?.moveTo(next)
      })
    }),
  )
  function moveTab(delta: number) {
    const ids = tabs.map((item) => item.id)
    const next = ids[Math.min(ids.length - 1, Math.max(0, ids.indexOf(tab()) + delta))]!
    props.state.tab = next
    setTab(next)
  }
  function choose(value: string, details = false) {
    const entry = entries().find((row) => row.value === value)?.entry
    if (!entry?.item && !entry?.record) return
    props.onChoose({ ...entry, details, records: records() })
  }

  return (
    <box flexDirection="row">
      <box flexGrow={1} flexShrink={1} minWidth={0}>
        <DialogSelect
          title={tab() === "installed" ? "Marketplace: Installed" : "Marketplace"}
          titleView={
            <box flexDirection="row" gap={2}>
              <For each={tabs}>
                {(item) => (
                  <Show when={tab() === item.id} fallback={<text fg={theme.text.muted}>{item.title}</text>}>
                    <text fg={theme.text.formfield.selected} attributes={TextAttributes.BOLD}>
                      {item.title}
                    </text>
                  </Show>
                )}
              </For>
            </box>
          }
          placeholder="Search skills and MCPs..."
          options={options()}
          skipFilter
          preserveSelection
          focusTarget={props.state.selected}
          ref={(value) => {
            select = value
            if (props.state.query) value.setFilter(props.state.query)
          }}
          onFilter={(value) => {
            const previous = selected()
            props.state.query = value
            setQuery(value)
            // DialogSelect normally resets to its first row on search; retain the highlighted identity if possible.
            queueMicrotask(() => {
              if (mounted.signal.aborted) return
              const target =
                entries().find((row) => row.value === previous && (row.entry.item || row.entry.record)) ??
                entries().find((row) => row.entry.item || row.entry.record)
              if (target) select?.moveTo(target.value)
            })
          }}
          onMove={(option) => {
            if (!entries().some((row) => row.value === option.value && (row.entry.item || row.entry.record))) return
            props.state.selected = option.value
            setSelected(option.value)
          }}
          onSelect={(option) => choose(option.value)}
          actions={[
            {
              command: "marketplace.details",
              title: "details",
              bind: "ctrl+d",
              disabled: () => !actionable(),
              onTrigger: (option) => choose(option.value, true),
            },
            {
              command: "marketplace.refresh",
              title: "refresh",
              bind: "ctrl+r",
              selection: "none",
              onTrigger: () => void load(true),
            },
          ]}
          footerHints={[
            { title: "tabs", label: "←/→" },
            { title: "actions / filter", label: "enter" },
          ]}
          bindings={[
            { bind: "left", title: "Previous tab", group: "Marketplace", run: () => moveTab(-1) },
            { bind: "right", title: "Next tab", group: "Marketplace", run: () => moveTab(1) },
          ]}
          footer={
            <box>
              <Show when={inventoryLoading()}>
                <text fg={theme.text.muted}>Loading installed items...</text>
              </Show>
              <Show when={tab() !== "installed" && errors().length}>
                <text fg={theme.text.feedback.error.base}>{errors().join("\n")}</text>
              </Show>
              <Show when={inventoryError()}>
                <text fg={theme.text.feedback.error.base}>{inventoryError()}</text>
              </Show>
              <Show
                when={
                  !(tab() === "installed" ? inventoryLoading() : loading()) &&
                  !entries().some((row) => row.entry.item || row.entry.record)
                }
              >
                <text fg={theme.text.muted}>
                  {query()
                    ? "No results. Clear search to see all items."
                    : tab() === "installed"
                      ? "Nothing installed from the marketplace."
                      : "No catalog items available. Refresh to retry."}
                </text>
              </Show>
            </box>
          }
        />
      </box>
      <Show when={wide()}>
        <box
          width={36}
          flexShrink={0}
          border={["left"]}
          borderColor={theme.border.base}
          paddingLeft={2}
          paddingRight={2}
        >
          <scrollbox id="marketplace-details" maxHeight={Math.max(1, Math.floor(dimensions().height / 2) - 3)}>
            <text fg={theme.text.base}>
              {entry()
                ? entryDetails(entry()!, records())
                : "Select a skill or MCP to review details. Enter opens explicit install or removal actions. Installed contains marketplace-managed records only."}
            </text>
          </scrollbox>
        </box>
      </Show>
    </box>
  )
}

function MarketplaceDetails(props: { entry: Entry; records: readonly Installed[] }) {
  const dimensions = useTerminalDimensions()
  return (
    <DialogLayout header={<DialogHeader title="Marketplace details" closeLabel="esc back" />}>
      <scrollbox focused maxHeight={Math.max(1, Math.floor(dimensions().height * 0.75) - 7)}>
        <text>{entryDetails(props.entry, props.records)}</text>
      </scrollbox>
    </DialogLayout>
  )
}

function identity(value: Item | Installed) {
  return JSON.stringify([value.registry, value.kind, value.id, "scope" in value ? value.scope : null])
}

function entryDetails(entry: Entry, records: readonly Installed[]) {
  const item = entry.item
  const installed = entry.record
    ? [entry.record]
    : records.filter(
        (record) => item && record.registry === item.registry && record.kind === item.kind && record.id === item.id,
      )
  return [
    ...(item
      ? [
          item.name,
          `Kind: ${item.kind}`,
          `ID: ${item.id}`,
          `Source: ${item.registry}`,
          item.description,
          item.author ? `Author: ${item.author}` : undefined,
          item.url ? `URL: ${item.url}` : undefined,
          item.tags.length ? `Tags: ${item.tags.join(", ")}` : undefined,
          ...item.prerequisites.map((value) => `Prerequisite: ${value}`),
          ...item.options.map(
            (option) =>
              `Install option: ${option.name}${option.description ? ` - ${option.description}` : ""}${option.prerequisites.length ? ` (needs ${option.prerequisites.join(", ")})` : ""}`,
          ),
        ]
      : []),
    ...(item && !installed.length ? ["Status: not installed"] : []),
    ...installed.flatMap((record) => [
      `Kind: ${record.kind}`,
      `ID: ${record.id}`,
      `Source: ${record.registry}`,
      `Scope: ${record.scope}`,
      `Status: ${record.status ?? (record.recovering ? "incomplete" : "installed")}`,
      ...(record.project ? [`Project: ${record.project}`] : []),
      ...record.paths.map((path) => `Path: ${path}`),
      ...(record.config ? [`Config: ${record.config}`] : []),
      ...(record.server ? [`MCP server: ${record.server}`] : []),
      ...recordNotes(record),
      ...(record.status === "modified"
        ? ["Local changes are retained. Reinstall and removal refuse modified resources."]
        : []),
    ]),
    "Enter: install / remove actions. ctrl+d: full details.",
  ]
    .filter((value) => value !== undefined)
    .join("\n")
}

async function act(context: Context, item: Item, installed: readonly Installed[]) {
  const { rpc, options } = connect(context)
  const ref = { registry: item.registry, kind: item.kind, id: item.id }
  const records = installed.filter(
    (record) => record.registry === item.registry && record.kind === item.kind && record.id === item.id,
  )
  const actions = [
    ...records.flatMap((record) =>
      item.kind === "mcp"
        ? [
            {
              title: `Sign In / Manage Authentication (${record.scope})`,
              value: { type: "auth" as const, scope: record.scope },
            },
          ]
        : [],
    ),
    ...(["global", "project"] as const).flatMap((scope) => {
      const record = records.find((entry) => entry.scope === scope)
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
              : "Use this project's configured destination",
        },
      ]
    }),
    ...records.map((record) => ({
      title: `Uninstall (${record.scope})`,
      value: { type: "uninstall" as const, scope: record.scope },
      description:
        item.kind === "mcp" ? "Keeps sign-in; use /mcps to sign out first" : "Remove owned installation files",
    })),
    { title: "Details", value: { type: "details" as const, scope: "global" as const }, description: undefined },
  ]
  const choice = await context.ui.dialog.select<Action>({ title: item.name, options: actions })
  if (!choice || context.signal.aborted) return
  if (choice.type === "auth") {
    const record = records.find((record) => record.scope === choice.scope)
    if (record) await mcpInstalled(context, record)
    return
  }
  if (choice.type === "details")
    return new Promise<void>((resolve) => {
      context.ui.dialog.show(() => <MarketplaceDetails entry={{ item }} records={records} />, resolve)
    })
  if (choice.type === "uninstall") return uninstall(context, { ...ref, scope: choice.scope }, item.name)

  const answers = await ask(context, item)
  if (!answers || context.signal.aborted) return
  if (item.kind === "mcp") {
    const prepared = busy(context, `Preparing ${item.name} preview...`)
    const preview = await rpc.preview({ ...ref, scope: choice.scope, ...answers }, options).catch((error: Error) => {
      if (!context.signal.aborted)
        context.ui.toast.show({ variant: "error", message: error.message || "Couldn't preview installation" })
      return undefined
    })
    prepared()
    if (!preview || context.signal.aborted) return
    const message = [
      "This configuration will be activated immediately. Local commands run with your user permissions.",
      `Config file: ${preview.config}`,
      ...(preview.secrets.length
        ? [
            `WARNING: Secrets (${preview.secrets.join(", ")}) will be stored in plaintext in this ${choice.scope} config.`,
            ...(choice.scope === "project"
              ? ["Do not commit this file. Ensure it is gitignored, or cancel and install globally instead."]
              : ["Global configuration is not encrypted. Protect access to this file."]),
          ]
        : []),
      `Parameters: ${preview.parameters.join(", ") || "none"}`,
      preview.server,
    ].join("\n")
    const confirmed = await new Promise<boolean>((resolve) => {
      context.ui.dialog.show(
        () => (
          <DialogMarketplaceInstall
            title={`Review ${item.name} installation`}
            message={message}
            onChoose={(confirmed) => {
              resolve(confirmed)
              context.ui.dialog.clear()
            }}
          />
        ),
        () => resolve(false),
      )
    })
    if (!confirmed || context.signal.aborted) return
  }
  if (item.kind === "skill") {
    const confirmed = await context.ui.dialog.confirm({
      title: `Install ${item.name} (${choice.scope})?`,
      message:
        "Skills contain instructions and supporting files. Review the source before installing. Reinstall replaces owned content with the current catalog entry; it is not version management.",
      label: { confirm: "Install" },
    })
    if (!confirmed || context.signal.aborted) return
  }
  const complete = busy(context, `Installing ${item.name}...`)
  const result = await rpc.install({ ...ref, scope: choice.scope, ...answers }, options).catch((error: Error) => {
    if (!context.signal.aborted) context.ui.toast.show({ variant: "error", message: error.message || "Unknown error" })
    return undefined
  })
  complete()
  if (!result || context.signal.aborted) return
  const notes = recordNotes(result)
  if (notes.length) {
    await context.ui.dialog.alert({
      title: `Installed ${item.name} (${choice.scope})`,
      message: [...(result.status === "ready" ? ["Status: ready"] : []), ...notes].join("\n"),
    })
    if (context.signal.aborted) return
  }
  if (item.kind === "mcp") return mcpInstalled(context, result)
  context.ui.toast.show({ variant: "success", message: `Installed ${item.name} (${choice.scope})` })
}

function busy(context: Context, title: string) {
  let loading = true
  context.ui.dialog.show(
    () => (
      <DialogLayout header={<DialogHeader title="Marketplace" closeLabel="esc cancel" />}>
        <text>{title}</text>
      </DialogLayout>
    ),
    () => {
      if (loading) context.cancel()
    },
  )
  return () => {
    loading = false
  }
}

async function uninstall(
  context: Context,
  record: Pick<Installed, "registry" | "kind" | "id" | "scope">,
  name: string,
) {
  const confirmed = await context.ui.dialog.confirm({
    title: `Uninstall ${name} (${record.scope})?`,
    message: `Remove only resources owned by this marketplace installation.${record.kind === "mcp" ? " Sign-in is retained because it may be shared. Use /mcps to sign out before removal." : " Local modifications are protected."}`,
    label: { confirm: "Uninstall" },
  })
  if (!confirmed || context.signal.aborted) return
  const { rpc, options } = connect(context)
  const complete = busy(context, `Removing ${name}...`)
  const result = await rpc
    .uninstall({ registry: record.registry, kind: record.kind, id: record.id, scope: record.scope }, options)
    .then(
      () => undefined,
      (error: Error) => error.message || "Unknown error",
    )
  complete()
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
    .get({ integrationID: server.integrationID, location: context.target }, { signal: context.signal })
    .catch(() => undefined)
  if (context.signal.aborted) return
  return mcpInstalled(
    context,
    record,
    integration?.data.connections.some((connection) => connection.type === "credential" && !connection.status),
  )
}

/** Option parameters win over shared parameters, matching the server. */
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
              [option.description, option.prerequisites.length ? `Needs ${option.prerequisites.join(", ")}` : undefined]
                .filter(Boolean)
                .join(" / ") || undefined,
          })),
        })
      : item.options[0]
  if (!option || context.signal.aborted) return undefined
  const declared = [
    ...item.parameters.filter((parameter) => !option.parameters.some((own) => own.key === parameter.key)),
    ...option.parameters,
  ]
  const params: Record<string, string> = {}
  for (const parameter of declared) {
    const prompt = {
      title: parameter.name,
      description: parameter.optional ? "Optional. Leave empty to skip." : `Required by ${item.name}.`,
      placeholder: parameter.placeholder,
    }
    const value = parameter.secret
      ? await new Promise<string | undefined>((resolve) => {
          context.ui.dialog.show(
            () => (
              <DialogMarketplaceSecret
                {...prompt}
                onConfirm={(value) => {
                  resolve(value)
                  context.ui.dialog.clear()
                }}
              />
            ),
            () => resolve(undefined),
          )
        })
      : await context.ui.dialog.prompt(prompt)
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
