import {
  createContext,
  useContext,
  createSignal,
  createEffect,
  createMemo,
  type ParentProps,
  type Accessor,
} from "solid-js"
import { useServer } from "./server"
import type { ProviderListResponse } from "../sdk"

export interface SelectedModel {
  providerID: string
  modelID: string
}

type ProviderData = ProviderListResponse["all"][number]
type ModelData = ProviderData["models"][string]

export interface ModelItem extends ModelData {
  providerID: string
  providerName: string
  latest: boolean
  free: boolean
}

export const popularProviders = [
  "kilo",
  "opencode",
  "anthropic",
  "github-copilot",
  "openai",
  "google",
  "openrouter",
  "vercel",
]

export interface ProviderContextValue {
  providers: Accessor<ProviderData[]>
  connected: Accessor<string[]>
  defaults: Accessor<Record<string, string>>
  selected: Accessor<SelectedModel | null>
  setSelected: (model: SelectedModel | null) => void
  models: Accessor<ModelItem[]>
  selectedModel: Accessor<ModelItem | null>
  loading: Accessor<boolean>
  refresh: () => Promise<void>
}

const ProviderContext = createContext<ProviderContextValue>()

export function useProvider() {
  const ctx = useContext(ProviderContext)
  if (!ctx) throw new Error("useProvider must be used within ProviderProvider")
  return ctx
}

function isWithinMonths(dateStr: string, months: number): boolean {
  if (!dateStr) return false
  const date = new Date(dateStr)
  if (isNaN(date.getTime())) return false
  const now = new Date()
  const diff = Math.abs(now.getTime() - date.getTime())
  const diffMonths = diff / (1000 * 60 * 60 * 24 * 30)
  return diffMonths < months
}

export function ProviderProvider(props: ParentProps) {
  const { client, status, savedModel, saveModel } = useServer()

  const [providers, setProviders] = createSignal<ProviderData[]>([])
  const [connected, setConnected] = createSignal<string[]>([])
  const [defaults, setDefaults] = createSignal<Record<string, string>>({})
  const [selected, setSelectedInternal] = createSignal<SelectedModel | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [initialized, setInitialized] = createSignal(false)

  function setSelected(model: SelectedModel | null) {
    setSelectedInternal(model)
    saveModel(model)
  }

  // Compute latest models per provider/family
  const latestSet = createMemo(() => {
    const set = new Set<string>()
    const providersList = providers()

    for (const provider of providersList) {
      // Group models by family
      const families: Record<string, Array<{ id: string; date: string }>> = {}

      for (const model of Object.values(provider.models)) {
        if (!isWithinMonths(model.release_date, 6)) continue

        const family = model.family ?? model.id
        if (!families[family]) families[family] = []
        families[family].push({ id: model.id, date: model.release_date })
      }

      // Get the most recent model from each family
      for (const models of Object.values(families)) {
        const sorted = models.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        if (sorted[0]) {
          set.add(`${provider.id}:${sorted[0].id}`)
        }
      }
    }

    return set
  })

  const models = createMemo(() => {
    const connectedIds = connected()
    const latest = latestSet()
    const result: ModelItem[] = []

    for (const provider of providers()) {
      if (!connectedIds.includes(provider.id)) continue

      for (const model of Object.values(provider.models)) {
        const key = `${provider.id}:${model.id}`
        const isFree = provider.id === "opencode" && (!model.cost || model.cost.input === 0)
        const isLatest = latest.has(key)

        result.push({
          ...model,
          providerID: provider.id,
          providerName: provider.name,
          latest: isLatest,
          free: isFree,
        })
      }
    }

    return result
  })

  const selectedModel = createMemo(() => {
    const sel = selected()
    if (!sel) return null
    return models().find((m) => m.providerID === sel.providerID && m.id === sel.modelID) ?? null
  })

  async function refresh() {
    const c = client()
    if (!c) return

    setLoading(true)
    try {
      const result = await c.provider.list()
      if (result.data) {
        setProviders(result.data.all)
        setConnected(result.data.connected)
        setDefaults(result.data.default)

        // Only set default if no saved model and no current selection
        if (!initialized() && !selected()) {
          const saved = savedModel()
          // Check if saved model is still valid (provider connected and model exists)
          if (saved && result.data.connected.includes(saved.providerID)) {
            const provider = result.data.all.find((p) => p.id === saved.providerID)
            if (provider && provider.models[saved.modelID]) {
              setSelectedInternal(saved)
              setInitialized(true)
              return
            }
          }

          // Fall back to first connected provider's default model
          if (result.data.connected.length > 0) {
            const firstConnected = result.data.connected[0]
            const defaultModelID = result.data.default[firstConnected]
            if (defaultModelID) {
              setSelectedInternal({ providerID: firstConnected, modelID: defaultModelID })
            }
          }
          setInitialized(true)
        }
      }
    } catch (err) {
      console.error("[provider] Failed to fetch providers:", err)
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    if (status() !== "connected" || !client()) return
    refresh()
  })

  return (
    <ProviderContext.Provider
      value={{
        providers,
        connected,
        defaults,
        selected,
        setSelected,
        models,
        selectedModel,
        loading,
        refresh,
      }}
    >
      {props.children}
    </ProviderContext.Provider>
  )
}
