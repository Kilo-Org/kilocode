// The Marketplace catalog and installed records over the server RPC. Kept free of JSX and webview contexts, so the
// extension tests can load it with a fake RPC.
import type { KiloMarketplaceRpc } from "@opencode/schema/kilocode/marketplace"
import { createSignal } from "solid-js"
import { message } from "./scope"

export type MarketplaceItem = KiloMarketplaceRpc.Item
export type MarketplaceRecord = KiloMarketplaceRpc.Installed
export type MarketplaceKind = KiloMarketplaceRpc.Kind
export type MarketplaceScope = KiloMarketplaceRpc.Scope
export type MarketplaceParameter = KiloMarketplaceRpc.Parameter
export type MarketplaceOption = KiloMarketplaceRpc.InstallOption

export const KINDS: readonly MarketplaceKind[] = ["agent", "skill", "mcp"]

type Location = { directory: string }
type CallOptions = { location: Location }

export interface MarketplaceRpc {
  list(
    input: { kind: MarketplaceKind; refresh?: boolean; query?: string },
    options: CallOptions,
  ): Promise<{ items: readonly MarketplaceItem[]; failures: readonly { registry: string; message: string }[] }>
  installed(input: Record<string, never>, options: CallOptions): Promise<readonly MarketplaceRecord[]>
  preview(
    input: {
      registry: string
      kind: MarketplaceKind
      id: string
      scope: MarketplaceScope
      option?: string
      params?: Record<string, string>
    },
    options: CallOptions,
  ): Promise<{ config: string; server: string; parameters: readonly string[]; secrets: readonly string[] }>
  install(
    input: {
      registry: string
      kind: MarketplaceKind
      id: string
      scope: MarketplaceScope
      option?: string
      params?: Record<string, string>
    },
    options: CallOptions,
  ): Promise<MarketplaceRecord>
  uninstall(
    input: { registry: string; kind: MarketplaceKind; id: string; scope: MarketplaceScope },
    options: CallOptions,
  ): Promise<unknown>
}

export type InstallInput = { scope: MarketplaceScope; option?: string; params?: Record<string, string> }

export function createMarketplaceData(input: { directory: string; rpc: MarketplaceRpc }) {
  const [items, setItems] = createSignal<MarketplaceItem[]>([])
  const [records, setRecords] = createSignal<MarketplaceRecord[]>([])
  const [fetching, setFetching] = createSignal(true)
  const [installedFetching, setInstalledFetching] = createSignal(true)
  const [errors, setErrors] = createSignal<string[]>([])
  const [installedError, setInstalledError] = createSignal<string>()
  const location: Location = { directory: input.directory }
  let token = 0

  async function load(refresh = false) {
    const current = ++token
    setFetching(true)
    const results = await Promise.allSettled(
      KINDS.map((kind) => input.rpc.list({ kind, refresh }, { location })),
    )
    if (current !== token) return
    const next: MarketplaceItem[] = []
    const problems: string[] = []
    results.forEach((result, index) => {
      if (result.status === "rejected") {
        problems.push(`${KINDS[index]}: ${message(result.reason)}`)
        return
      }
      next.push(...result.value.items)
      for (const failure of result.value.failures) problems.push(`${failure.registry}: ${failure.message}`)
    })
    setItems(next)
    setErrors(problems)
    setFetching(false)
  }

  async function refreshInstalled() {
    setInstalledFetching(true)
    try {
      setRecords([...(await input.rpc.installed({}, { location }))])
      setInstalledError(undefined)
    } catch (error) {
      setInstalledError(message(error))
    } finally {
      setInstalledFetching(false)
    }
  }

  async function refresh() {
    await Promise.all([load(true), refreshInstalled()])
  }

  async function preview(item: MarketplaceItem, options: InstallInput) {
    return input.rpc.preview({ registry: item.registry, kind: item.kind, id: item.id, ...options }, { location })
  }

  async function install(item: MarketplaceItem, options: InstallInput) {
    const record = await input.rpc.install({ registry: item.registry, kind: item.kind, id: item.id, ...options }, { location })
    await refreshInstalled()
    return record
  }

  async function uninstall(record: MarketplaceRecord) {
    await input.rpc.uninstall(
      { registry: record.registry, kind: record.kind, id: record.id, scope: record.scope },
      { location },
    )
    await refreshInstalled()
  }

  return {
    items,
    records,
    fetching,
    installedFetching,
    errors,
    installedError,
    load,
    refreshInstalled,
    refresh,
    preview,
    install,
    uninstall,
    dismissError(index: number) {
      setErrors((current) => current.filter((_, position) => position !== index))
    },
    dismissInstalledError() {
      setInstalledError(undefined)
    },
  }
}

export function entryKey(entry: { registry: string; kind: MarketplaceKind; id: string }) {
  return `${entry.registry}\u0000${entry.kind}\u0000${entry.id}`
}

export function recordsFor(records: readonly MarketplaceRecord[], item: MarketplaceItem) {
  const key = entryKey(item)
  return records.filter((record) => entryKey(record) === key)
}

export function needsRepair(record: MarketplaceRecord) {
  return record.recovering === true || (record.status !== undefined && record.status !== "ready")
}

export function retain<T>(selected: T[], available: readonly T[]): T[] {
  const values = new Set(available)
  const next = selected.filter((value) => values.has(value))
  return next.length === selected.length ? selected : next
}

/** Installed records whose catalog item is missing, so they stay manageable after a failed catalog load. */
export function orphanRecords(records: readonly MarketplaceRecord[], items: readonly MarketplaceItem[]) {
  const catalog = new Set(items.map(entryKey))
  return records.filter((record) => !catalog.has(entryKey(record)))
}

export function mergeParameters(item: MarketplaceItem, option?: MarketplaceOption): MarketplaceParameter[] {
  if (!option) return [...item.parameters]
  const merged = new Map(item.parameters.map((parameter) => [parameter.key, parameter]))
  for (const parameter of option.parameters) merged.set(parameter.key, parameter)
  return [...merged.values()]
}

export function optionFor(item: MarketplaceItem, name?: string) {
  return item.options.find((option) => option.name === name) ?? item.options[0]
}

export function prerequisitesFor(item: MarketplaceItem, option?: MarketplaceOption) {
  if (option?.prerequisites.length) return option.prerequisites
  return item.prerequisites
}

export function matchesSearch(item: MarketplaceItem, query: string, labels: Record<MarketplaceKind, string>) {
  const value = query.trim().toLowerCase()
  if (!value) return true
  return (
    item.id.toLowerCase().includes(value) ||
    item.name.toLowerCase().includes(value) ||
    item.description.toLowerCase().includes(value) ||
    (item.category?.replaceAll("-", " ").toLowerCase().includes(value) ?? false) ||
    item.kind.includes(value) ||
    item.registry.toLowerCase().includes(value) ||
    labels[item.kind].toLowerCase().includes(value) ||
    (item.author?.toLowerCase().includes(value) ?? false) ||
    item.tags.some((tag) => tag.toLowerCase().includes(value))
  )
}

export function filterItems(
  items: readonly MarketplaceItem[],
  records: readonly MarketplaceRecord[],
  search: string,
  status: string,
  categories: readonly string[],
  kinds: readonly MarketplaceKind[],
  labels: Record<MarketplaceKind, string>,
) {
  return items
    .filter((item) => {
      const scopes = recordsFor(records, item)
      if (status === "installed" && scopes.length === 0) return false
      if (status === "notInstalled" && scopes.length > 0) return false
      if (kinds.length > 0 && !kinds.includes(item.kind)) return false
      if (categories.length > 0 && (!item.category || !categories.includes(item.category))) return false
      return matchesSearch(item, search, labels)
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function filterOrphans(
  records: readonly MarketplaceRecord[],
  items: readonly MarketplaceItem[],
  search: string,
  status: string,
  kinds: readonly MarketplaceKind[],
) {
  if (status === "notInstalled") return []
  const value = search.trim().toLowerCase()
  return orphanRecords(records, items)
    .filter((record) => kinds.length === 0 || kinds.includes(record.kind))
    .filter((record) => !value || record.id.toLowerCase().includes(value) || record.registry.toLowerCase().includes(value))
    .sort((a, b) => a.id.localeCompare(b.id))
}
