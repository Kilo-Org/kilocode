/**
 * Indexing Configuration Dialog
 *
 * Menu-driven dialog for configuring codebase indexing settings.
 * Allows toggling indexing, selecting embedding providers, configuring
 * vector stores, and adjusting tuning parameters.
 */

import { useDialog } from "@tui/ui/dialog"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { DialogPrompt } from "@tui/ui/dialog-prompt"
import {
  getKiloEmbeddingModel,
  normalizeKiloEmbeddingModelId,
} from "@kilocode/kilo-indexing/embedding-models"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { createResource } from "solid-js"
import { reconcile } from "solid-js/store"
import type { IndexingConfig, Config } from "@kilocode/sdk/v2"
import { hasKiloIndexingAuth, resolveKiloIndexingAuth, shouldDefaultIndexingToKilo } from "../indexing-auth"

// These types are OpenCode-internal and imported at runtime
type UseSDK = any
type SDK = any

type EmbeddingProvider = NonNullable<IndexingConfig["provider"]>

function kiloModel(model: string | undefined): string | undefined {
  return getKiloEmbeddingModel(model)?.id
}

const PROVIDER_LABELS: Record<EmbeddingProvider, string> = {
  kilo: "Kilo",
  openai: "OpenAI",
  ollama: "Ollama (local)",
  "openai-compatible": "OpenAI-Compatible",
  gemini: "Gemini",
  mistral: "Mistral",
  "vercel-ai-gateway": "Vercel AI Gateway",
  bedrock: "AWS Bedrock",
  openrouter: "OpenRouter",
  voyage: "Voyage",
}

type ProviderFieldDef = { key: string; label: string; placeholder: string; sensitive?: boolean }

const PROVIDER_FIELDS: Record<EmbeddingProvider, ProviderFieldDef[]> = {
  kilo: [],
  openai: [{ key: "apiKey", label: "API Key", placeholder: "sk-...", sensitive: true }],
  ollama: [{ key: "baseUrl", label: "Base URL", placeholder: "http://localhost:11434" }],
  "openai-compatible": [
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.example.com/v1" },
    { key: "apiKey", label: "API Key", placeholder: "sk-...", sensitive: true },
  ],
  gemini: [{ key: "apiKey", label: "API Key", placeholder: "AI...", sensitive: true }],
  mistral: [{ key: "apiKey", label: "API Key", placeholder: "...", sensitive: true }],
  "vercel-ai-gateway": [{ key: "apiKey", label: "API Key", placeholder: "...", sensitive: true }],
  bedrock: [
    { key: "region", label: "AWS Region", placeholder: "us-east-1" },
    { key: "profile", label: "AWS Profile", placeholder: "default" },
  ],
  openrouter: [
    { key: "apiKey", label: "API Key", placeholder: "sk-or-...", sensitive: true },
    { key: "specificProvider", label: "Specific Provider", placeholder: "optional" },
  ],
  voyage: [{ key: "apiKey", label: "API Key", placeholder: "pa-...", sensitive: true }],
}

const VECTOR_STORE_LABELS: Record<string, string> = {
  qdrant: "Qdrant (default)",
  lancedb: "LanceDB",
}

function maskSecret(value: string | undefined): string {
  if (!value) return "not set"
  if (value.length <= 6) return "***"
  return value.slice(0, 3) + "..." + value.slice(-3)
}

function getIndexing(sync: ReturnType<typeof useSync>): IndexingConfig {
  return (sync.data.config as Config & { indexing?: IndexingConfig }).indexing ?? {}
}

function globalIndexing(data: Config | undefined): IndexingConfig {
  return data?.indexing ?? {}
}

function hasKiloAuth(sync: ReturnType<typeof useSync>): boolean {
  const provider = sync.data.provider_next.all.find((item) => item.id === "kilo")
  return hasKiloIndexingAuth({ config: sync.data.config, provider })
}

function defaultIndexing(sync: ReturnType<typeof useSync>, global?: IndexingConfig): IndexingConfig {
  const indexing = getIndexing(sync)
  const provider = sync.data.provider_next.all.find((item) => item.id === "kilo")
  const auth = resolveKiloIndexingAuth({ config: sync.data.config, provider })
  if (!shouldDefaultIndexingToKilo({ ...global, ...indexing }, auth)) return indexing
  return { ...indexing, provider: "kilo", model: kiloModel(indexing.model) }
}

async function saveIndexing(
  sdk: SDK,
  sync: ReturnType<typeof useSync>,
  indexing: IndexingConfig,
  toast: ReturnType<typeof useToast>,
): Promise<boolean> {
  const global = { ...indexing }
  delete global.enabled
  const responses = await Promise.all([
    ...(Object.keys(global).length > 0 ? [sdk.client.global.config.update({ config: { indexing: global } })] : []),
    ...(indexing.enabled !== undefined
      ? [sdk.client.config.update({ config: { indexing: { enabled: indexing.enabled } } })]
      : []),
  ])
  if (responses.some((response) => response.error)) {
    toast.show({ message: "Failed to save indexing config", variant: "error" })
    return false
  }
  const configResponse = await sdk.client.config.get({})
  if (configResponse.data) {
    sync.set("config", reconcile(configResponse.data))
  }
  toast.show({ message: "Indexing config saved", variant: "success" })
  return true
}

async function saveGlobalIndexing(
  sdk: SDK,
  sync: ReturnType<typeof useSync>,
  indexing: IndexingConfig,
  toast: ReturnType<typeof useToast>,
): Promise<boolean> {
  const response = await sdk.client.global.config.update({ config: { indexing } })
  if (response.error) {
    toast.show({ message: "Failed to save indexing config", variant: "error" })
    return false
  }
  const merged = await sdk.client.config.get({})
  if (merged.data) sync.set("config", reconcile(merged.data))
  toast.show({ message: "Indexing config saved", variant: "success" })
  return true
}

async function saveProjectIndexing(
  sdk: SDK,
  sync: ReturnType<typeof useSync>,
  indexing: IndexingConfig,
  toast: ReturnType<typeof useToast>,
): Promise<boolean> {
  const response = await sdk.client.config.update({ config: { indexing: { enabled: indexing.enabled } } })
  if (response.error) {
    toast.show({ message: "Failed to save indexing config", variant: "error" })
    return false
  }
  const configResponse = await sdk.client.config.get({})
  if (configResponse.data) sync.set("config", reconcile(configResponse.data))
  toast.show({ message: "Indexing config saved", variant: "success" })
  return true
}

function providerSettingsDescription(
  sync: ReturnType<typeof useSync>,
  indexing: IndexingConfig,
  provider: EmbeddingProvider,
): string {
  if (provider === "kilo") return hasKiloAuth(sync) ? "uses Kilo account" : "sign in to Kilo"
  const fields = PROVIDER_FIELDS[provider]
  const settings = indexing[provider] as Record<string, string | undefined> | undefined
  if (!settings) return "not configured"
  const parts = fields.map((f) => {
    const val = settings[f.key]
    if (!val) return `${f.label}: not set`
    return `${f.label}: ${f.sensitive ? maskSecret(val) : val}`
  })
  return parts.join(", ")
}

// --- Sub-dialogs ---

interface SubDialogProps {
  useSDK: () => UseSDK
}

function ProviderSelect(props: SubDialogProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = props.useSDK()
  const toast = useToast()
  const indexing = defaultIndexing(sync)

  const options: DialogSelectOption<EmbeddingProvider>[] = (
    Object.entries(PROVIDER_LABELS) as [EmbeddingProvider, string][]
  )
    .filter(([value]) => value !== "kilo" || hasKiloAuth(sync) || indexing.provider === "kilo")
    .map(([value, title]) => ({
      value,
      title,
      description: value === indexing.provider ? "(current)" : undefined,
    }))

  return (
    <DialogSelect
      title="Embedding Provider"
      options={options}
      current={indexing.provider}
      onSelect={async (option) => {
        const provider = option.value
        const current = getIndexing(sync)
        const updated: IndexingConfig =
          provider === "kilo"
            ? {
                ...current,
                provider,
                model: kiloModel(current.model),
                dimension: undefined,
              }
            : {
                ...current,
                provider,
                model: undefined,
                dimension: undefined,
              }
        const saved = await saveIndexing(sdk, sync, updated, toast)
        if (!saved) {
          dialog.clear()
          return
        }
        showProviderSettings(dialog, sync, sdk, toast, provider, props.useSDK)
      }}
    />
  )
}

async function showProviderSettings(
  dialog: ReturnType<typeof useDialog>,
  sync: ReturnType<typeof useSync>,
  sdk: SDK,
  toast: ReturnType<typeof useToast>,
  provider: EmbeddingProvider,
  useSDK: () => UseSDK,
) {
  const fields = PROVIDER_FIELDS[provider]
  if (fields.length === 0) {
    dialog.replace(() => <DialogIndexing useSDK={useSDK} />)
    return
  }
  const indexing = defaultIndexing(sync)
  const currentSettings = (indexing[provider] as Record<string, string | undefined>) ?? {}
  const newSettings: Record<string, string | undefined> = { ...currentSettings }

  for (const field of fields) {
    const currentValue = currentSettings[field.key] ?? ""
    const result = await DialogPrompt.show(dialog, `${PROVIDER_LABELS[provider]} — ${field.label}`, {
      value: currentValue,
      placeholder: field.placeholder,
    })
    if (result === null) {
      dialog.replace(() => <DialogIndexing useSDK={useSDK} />)
      return
    }
    newSettings[field.key] = result.trim() || undefined
  }

  const updated = { ...getIndexing(sync), [provider]: newSettings }
  await saveIndexing(sdk, sync, updated, toast)
  dialog.replace(() => <DialogIndexing useSDK={useSDK} />)
}

function VectorStoreSelect(props: SubDialogProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = props.useSDK()
  const toast = useToast()
  const indexing = defaultIndexing(sync)

  const options: DialogSelectOption<string>[] = Object.entries(VECTOR_STORE_LABELS).map(([value, title]) => ({
    value,
    title,
    description: value === (indexing.vectorStore ?? "qdrant") ? "(current)" : undefined,
  }))

  return (
    <DialogSelect
      title="Vector Store"
      options={options}
      current={indexing.vectorStore ?? "qdrant"}
      onSelect={async (option) => {
        const store = option.value as "lancedb" | "qdrant"
        if (store === "lancedb") {
          await showLancedbSettings(dialog, sync, sdk, toast, props.useSDK)
        } else {
          await showQdrantSettings(dialog, sync, sdk, toast, props.useSDK)
        }
      }}
    />
  )
}

async function showLancedbSettings(
  dialog: ReturnType<typeof useDialog>,
  sync: ReturnType<typeof useSync>,
  sdk: SDK,
  toast: ReturnType<typeof useToast>,
  useSDK: () => UseSDK,
) {
  const indexing = getIndexing(sync)
  const result = await DialogPrompt.show(dialog, "LanceDB — Directory", {
    value: indexing.lancedb?.directory ?? "",
    placeholder: "Leave empty for default",
  })
  if (result === null) {
    dialog.replace(() => <DialogIndexing useSDK={useSDK} />)
    return
  }
  const updated: IndexingConfig = {
    ...getIndexing(sync),
    vectorStore: "lancedb",
    lancedb: { directory: result.trim() || undefined },
  }
  await saveIndexing(sdk, sync, updated, toast)
  dialog.replace(() => <DialogIndexing useSDK={useSDK} />)
}

async function showQdrantSettings(
  dialog: ReturnType<typeof useDialog>,
  sync: ReturnType<typeof useSync>,
  sdk: SDK,
  toast: ReturnType<typeof useToast>,
  useSDK: () => UseSDK,
) {
  const indexing = getIndexing(sync)
  const currentSettings = indexing.qdrant ?? {}

  const url = await DialogPrompt.show(dialog, "Qdrant — URL", {
    value: currentSettings.url ?? "",
    placeholder: "http://localhost:6333",
  })
  if (url === null) {
    dialog.replace(() => <DialogIndexing useSDK={useSDK} />)
    return
  }

  const apiKey = await DialogPrompt.show(dialog, "Qdrant — API Key", {
    value: currentSettings.apiKey ?? "",
    placeholder: "Optional API key",
  })
  if (apiKey === null) {
    dialog.replace(() => <DialogIndexing useSDK={useSDK} />)
    return
  }

  const updated: IndexingConfig = {
    ...getIndexing(sync),
    vectorStore: "qdrant",
    qdrant: {
      url: url.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
    },
  }
  await saveIndexing(sdk, sync, updated, toast)
  dialog.replace(() => <DialogIndexing useSDK={useSDK} />)
}

interface TuningParam {
  key: keyof Pick<
    IndexingConfig,
    "searchMinScore" | "searchMaxResults" | "embeddingBatchSize" | "scannerMaxBatchRetries"
  >
  label: string
  defaultValue: number
}

const TUNING_PARAMS: TuningParam[] = [
  { key: "searchMinScore", label: "Search Min Score", defaultValue: 0.4 },
  { key: "searchMaxResults", label: "Search Max Results", defaultValue: 50 },
  { key: "embeddingBatchSize", label: "Embedding Batch Size", defaultValue: 60 },
  { key: "scannerMaxBatchRetries", label: "Scanner Max Batch Retries", defaultValue: 3 },
]

function TuningMenu(props: SubDialogProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = props.useSDK()
  const toast = useToast()
  const indexing = getIndexing(sync)

  const options: DialogSelectOption<string>[] = TUNING_PARAMS.map((param) => {
    const value = indexing[param.key]
    return {
      value: param.key,
      title: param.label,
      description: value !== undefined ? String(value) : `default (${param.defaultValue})`,
    }
  })

  return (
    <DialogSelect
      title="Tuning Parameters"
      options={options}
      onSelect={async (option) => {
        const param = TUNING_PARAMS.find((p) => p.key === option.value)!
        const currentIndexing = getIndexing(sync)
        const currentValue = currentIndexing[param.key]
        const result = await DialogPrompt.show(dialog, param.label, {
          value: currentValue !== undefined ? String(currentValue) : "",
          placeholder: `Default: ${param.defaultValue}`,
        })
        if (result === null) {
          dialog.replace(() => <TuningMenu useSDK={props.useSDK} />)
          return
        }
        const trimmed = result.trim()
        const num = trimmed ? Number(trimmed) : undefined
        if (trimmed && isNaN(num!)) {
          toast.show({ message: `Invalid number: "${trimmed}"`, variant: "error" })
          dialog.replace(() => <TuningMenu useSDK={props.useSDK} />)
          return
        }
        const updated = { ...getIndexing(sync), [param.key]: num }
        await saveIndexing(sdk, sync, updated, toast)
        dialog.replace(() => <TuningMenu useSDK={props.useSDK} />)
      }}
    />
  )
}

// --- Main Dialog ---

interface DialogIndexingProps {
  useSDK: () => UseSDK
}

export function DialogIndexing(props: DialogIndexingProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = props.useSDK()
  const toast = useToast()
  const [global] = createResource(async () => (await sdk.client.global.config.get({})).data as Config | undefined)
  const globalCfg = () => globalIndexing(global())
  const indexing = defaultIndexing(sync, globalCfg())

  const providerLabel = indexing.provider ? PROVIDER_LABELS[indexing.provider] : "not set"
  const storeLabel = indexing.vectorStore
    ? (VECTOR_STORE_LABELS[indexing.vectorStore] ?? indexing.vectorStore)
    : "Qdrant (default)"

  const tuningCount = TUNING_PARAMS.filter((p) => indexing[p.key] !== undefined).length
  const tuningDesc = tuningCount > 0 ? `${tuningCount} customized` : "defaults"

  const options: DialogSelectOption<string>[] = [
    {
      value: "globalToggle",
      title: "Indexing (Global)",
      category: "General",
      description: global.loading ? "loading" : globalCfg().enabled ? "enabled" : "disabled",
    },
    {
      value: "projectToggle",
      title: "Indexing (Project)",
      category: "General",
      description: globalCfg().enabled ? "controlled by global" : indexing.enabled ? "enabled" : "disabled",
    },
    {
      value: "provider",
      title: "Embedding Provider",
      category: "Embedding",
      description: providerLabel,
    },
    {
      value: "model",
      title: "Embedding Model",
      category: "Embedding",
      description: indexing.model ?? "default",
    },
    {
      value: "dimension",
      title: "Vector Dimension",
      category: "Embedding",
      description: indexing.dimension ? String(indexing.dimension) : "auto",
    },
    {
      value: "vectorStore",
      title: "Vector Store",
      category: "Storage",
      description: storeLabel,
    },
    {
      value: "tuning",
      title: "Tuning Parameters",
      category: "Advanced",
      description: tuningDesc,
    },
  ]

  if (indexing.provider) {
    const settingsDesc = providerSettingsDescription(sync, indexing, indexing.provider)
    options.splice(2, 0, {
      value: "providerSettings",
      title: `${PROVIDER_LABELS[indexing.provider]} Settings`,
      category: "Embedding",
      description: settingsDesc,
    })
  }

  return (
    <DialogSelect
      title="Indexing Configuration"
      options={options}
      skipFilter
      onSelect={async (option) => {
        switch (option.value) {
          case "globalToggle": {
            const enabled = !globalCfg().enabled
            const updated =
              enabled && !globalCfg().provider && !getIndexing(sync).provider && hasKiloAuth(sync)
                ? { ...defaultIndexing(sync, globalCfg()), enabled }
                : { enabled }
            await saveGlobalIndexing(sdk, sync, updated, toast)
            dialog.replace(() => <DialogIndexing useSDK={props.useSDK} />)
            break
          }
          case "projectToggle": {
            if (globalCfg().enabled) {
              toast.show({ message: "Global indexing is enabled, so this project is already covered.", variant: "info" })
              dialog.replace(() => <DialogIndexing useSDK={props.useSDK} />)
              break
            }
            const current = getIndexing(sync)
            const enabled = !indexing.enabled
            const updated = enabled && !current.provider && hasKiloAuth(sync) ? { ...defaultIndexing(sync), enabled } : { enabled }
            await saveProjectIndexing(sdk, sync, updated, toast)
            dialog.replace(() => <DialogIndexing useSDK={props.useSDK} />)
            break
          }
          case "provider":
            dialog.replace(() => <ProviderSelect useSDK={props.useSDK} />)
            break
          case "providerSettings":
            if (indexing.provider) {
              await showProviderSettings(dialog, sync, sdk, toast, indexing.provider, props.useSDK)
            }
            break
          case "model": {
            const result = await DialogPrompt.show(dialog, "Embedding Model", {
              value: indexing.model ?? "",
              placeholder: indexing.provider === "kilo" ? "provider/model" : "e.g. text-embedding-3-small",
            })
            if (result !== null) {
              const trimmed = result.trim()
              const updated = {
                ...getIndexing(sync),
                model: trimmed
                  ? indexing.provider === "kilo"
                    ? (normalizeKiloEmbeddingModelId(trimmed) ?? trimmed)
                    : trimmed
                  : undefined,
              }
              await saveIndexing(sdk, sync, updated, toast)
            }
            dialog.replace(() => <DialogIndexing useSDK={props.useSDK} />)
            break
          }
          case "dimension": {
            const result = await DialogPrompt.show(dialog, "Vector Dimension", {
              value: indexing.dimension ? String(indexing.dimension) : "",
              placeholder: "Leave empty for auto-detection",
            })
            if (result !== null) {
              const trimmed = result.trim()
              let dim: number | undefined
              if (trimmed) {
                dim = Number(trimmed)
                if (isNaN(dim) || dim <= 0 || !Number.isInteger(dim)) {
                  toast.show({ message: `Invalid dimension: "${trimmed}"`, variant: "error" })
                  dialog.replace(() => <DialogIndexing useSDK={props.useSDK} />)
                  break
                }
              }
              const updated = { ...getIndexing(sync), dimension: dim }
              await saveIndexing(sdk, sync, updated, toast)
            }
            dialog.replace(() => <DialogIndexing useSDK={props.useSDK} />)
            break
          }
          case "vectorStore":
            dialog.replace(() => <VectorStoreSelect useSDK={props.useSDK} />)
            break
          case "tuning":
            dialog.replace(() => <TuningMenu useSDK={props.useSDK} />)
            break
        }
      }}
    />
  )
}
