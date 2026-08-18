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
import { DEFAULT_VECTOR_STORE, isFileExtension, parseFileExtensions } from "@kilocode/kilo-indexing/config"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { createEffect, createMemo, createResource, createSignal, Show } from "solid-js"
import { reconcile } from "solid-js/store"
import type { IndexingConfig, Config } from "@kilocode/sdk/v2"
import * as Log from "@opencode-ai/core/util/log"
import { hasKiloIndexingAuth, resolveKiloIndexingAuth, shouldDefaultIndexingToKilo } from "../indexing-auth"
import {
  createIndexingDialogState,
  currentKiloModel,
  indexingInheritance,
  indexingPatch,
  indexingScopeConfig,
  inheritedDescription,
  kiloModelOptions,
  loadKiloEmbeddingModels,
  mergeIndexingConfig,
  type IndexingScope,
} from "./indexing-dialog-state"

// These types are OpenCode-internal and imported at runtime
type UseSDK = any
type SDK = any

type EmbeddingProvider = NonNullable<IndexingConfig["provider"]>

const log = Log.create({ service: "indexing-model-select" })

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
    { key: "apiKey", label: "API Key (optional)", placeholder: "sk-...", sensitive: true },
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
  lancedb: "LanceDB (default)",
  qdrant: "Qdrant",
}

function maskSecret(value: string | undefined): string {
  if (!value) return "not set"
  if (value.length <= 6) return "***"
  return value.slice(0, 3) + "..." + value.slice(-3)
}

function scopedIndexing(data: Config | undefined): IndexingConfig {
  return data?.indexing ?? {}
}

function hasKiloAuth(sync: ReturnType<typeof useSync>, scope: IndexingScope, indexing: IndexingConfig): boolean {
  const provider = sync.data.provider_next.all.find((item) => item.id === "kilo")
  const config = indexingScopeConfig(scope, sync.data.config, sync.data.globalConfig, indexing)
  return hasKiloIndexingAuth({ config, provider })
}

function defaultIndexing(
  sync: ReturnType<typeof useSync>,
  scope: IndexingScope,
  indexing: IndexingConfig,
  global?: IndexingConfig,
): IndexingConfig {
  const provider = sync.data.provider_next.all.find((item) => item.id === "kilo")
  const config = indexingScopeConfig(scope, sync.data.config, sync.data.globalConfig, indexing)
  const auth = resolveKiloIndexingAuth({ config, provider })
  if (!shouldDefaultIndexingToKilo({ ...global, ...indexing }, auth)) return indexing
  return { ...indexing, provider: "kilo", model: null, dimension: null }
}

async function saveScopedIndexing(
  sdk: SDK,
  sync: ReturnType<typeof useSync>,
  scope: IndexingScope,
  before: IndexingConfig,
  indexing: IndexingConfig,
  toast: ReturnType<typeof useToast>,
): Promise<boolean> {
  const patch = indexingPatch(before, indexing)
  const response = await sdk.client.config.overlayUpdate({
    scope,
    set: { indexing: patch.indexing },
    unset: patch.unset,
  })
  if (response.error) {
    toast.show({ message: "Failed to save indexing config", variant: "error" })
    return false
  }
  const [configResponse, globalResponse] = await Promise.all([
    sdk.client.config.get({}),
    sdk.client.global.config.get({}),
  ])
  if (configResponse.data) sync.set("config", reconcile(configResponse.data))
  if (globalResponse.data) sync.set("globalConfig", reconcile(globalResponse.data))
  toast.show({ message: "Indexing config saved", variant: "success" })
  return true
}

function providerSettingsDescription(indexing: IndexingConfig, provider: EmbeddingProvider): string {
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
  scope: IndexingScope
  indexing: IndexingConfig
  raw: IndexingConfig
  global?: IndexingConfig
}

function ProviderSelect(props: SubDialogProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = props.useSDK()
  const toast = useToast()
  const indexing = props.indexing

  const options: DialogSelectOption<EmbeddingProvider>[] = (
    Object.entries(PROVIDER_LABELS) as [EmbeddingProvider, string][]
  )
    .filter(([value]) => value !== "kilo" || hasKiloAuth(sync, props.scope, indexing) || indexing.provider === "kilo")
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
        const updated: IndexingConfig = {
          ...props.raw,
          provider,
          model: null,
          dimension: null,
        }
        const saved = await saveScopedIndexing(sdk, sync, props.scope, props.raw, updated, toast)
        if (!saved) {
          dialog.clear()
          return
        }
        showProviderSettings(dialog, sync, sdk, toast, provider, props.useSDK, props.scope, updated, updated)
      }}
    />
  )
}

function KiloModelSelect(props: SubDialogProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = props.useSDK()
  const toast = useToast()
  const indexing = props.indexing
  const [error, setError] = createSignal<string>()
  const [catalog] = createResource(() => loadKiloEmbeddingModels(setError))
  const seen = { error: undefined as string | undefined, state: "" }
  createEffect(() => {
    const message = error()
    if (!message || seen.error === message) return
    seen.error = message
    toast.show({
      title: "Code Indexing Error",
      message,
      variant: "error",
      duration: 10000,
    })
  })
  createEffect(() => {
    const cfg = catalog()
    const state = `${catalog.state}:${cfg?.models.length ?? 0}`
    if (seen.state === state) return
    seen.state = state
    log.info("Kilo embedding model resource changed", {
      state: catalog.state,
      models: cfg?.models.length ?? 0,
      current: currentKiloModel(cfg, indexing.model),
      defaultModel: cfg?.defaultModel || undefined,
      scope: props.scope,
    })
  })
  const options = createMemo(() => kiloModelOptions(catalog()))
  const current = createMemo(() => currentKiloModel(catalog(), indexing.model))

  return (
    <DialogSelect
      title="Kilo Embedding Model"
      options={options()}
      current={current()}
      renderFilter={(catalog()?.models.length ?? 0) > 0}
      onSelect={async (option) => {
        if (!option.value || !catalog()?.models.some((model) => model.id === option.value)) return
        log.info("selected Kilo embedding model", { model: option.value, scope: props.scope })
        await saveScopedIndexing(
          sdk,
          sync,
          props.scope,
          props.raw,
          { ...props.raw, model: option.value, dimension: null },
          toast,
        )
        dialog.replace(() => <DialogIndexing useSDK={props.useSDK} scope={props.scope} />)
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
  scope: IndexingScope,
  indexing: IndexingConfig,
  raw: IndexingConfig,
) {
  const fields = PROVIDER_FIELDS[provider]
  if (fields.length === 0) {
    dialog.replace(() => <DialogIndexing useSDK={useSDK} scope={scope} />)
    return
  }
  const currentSettings = (indexing[provider] as Record<string, string | undefined>) ?? {}
  const newSettings: Record<string, string | undefined> = { ...currentSettings }

  for (const field of fields) {
    const currentValue = currentSettings[field.key] ?? ""
    const result = await DialogPrompt.show(dialog, `${PROVIDER_LABELS[provider]} — ${field.label}`, {
      value: currentValue,
      placeholder: field.placeholder,
    })
    if (result === null) {
      dialog.replace(() => <DialogIndexing useSDK={useSDK} scope={scope} />)
      return
    }
    newSettings[field.key] = result.trim() || undefined
  }

  const updated = { ...raw, [provider]: newSettings }
  await saveScopedIndexing(sdk, sync, scope, raw, updated, toast)
  dialog.replace(() => <DialogIndexing useSDK={useSDK} scope={scope} />)
}

function VectorStoreSelect(props: SubDialogProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = props.useSDK()
  const toast = useToast()
  const indexing = props.indexing

  const options: DialogSelectOption<string>[] = Object.entries(VECTOR_STORE_LABELS).map(([value, title]) => ({
    value,
    title,
    description: value === (indexing.vectorStore ?? DEFAULT_VECTOR_STORE) ? "(current)" : undefined,
  }))

  return (
    <DialogSelect
      title="Vector Store"
      options={options}
      current={indexing.vectorStore ?? DEFAULT_VECTOR_STORE}
      onSelect={async (option) => {
        const store = option.value as "lancedb" | "qdrant"
        if (store === "lancedb") {
          await showLancedbSettings(dialog, sync, sdk, toast, props.useSDK, props.scope, indexing, props.raw)
        } else {
          await showQdrantSettings(dialog, sync, sdk, toast, props.useSDK, props.scope, indexing, props.raw)
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
  scope: IndexingScope,
  indexing: IndexingConfig,
  raw: IndexingConfig,
) {
  const result = await DialogPrompt.show(dialog, "LanceDB — Directory", {
    value: indexing.lancedb?.directory ?? "",
    placeholder: "Leave empty for default",
  })
  if (result === null) {
    dialog.replace(() => <DialogIndexing useSDK={useSDK} scope={scope} />)
    return
  }
  const updated: IndexingConfig = {
    ...raw,
    vectorStore: "lancedb",
    lancedb: { directory: result.trim() || undefined },
  }
  await saveScopedIndexing(sdk, sync, scope, raw, updated, toast)
  dialog.replace(() => <DialogIndexing useSDK={useSDK} scope={scope} />)
}

async function showQdrantSettings(
  dialog: ReturnType<typeof useDialog>,
  sync: ReturnType<typeof useSync>,
  sdk: SDK,
  toast: ReturnType<typeof useToast>,
  useSDK: () => UseSDK,
  scope: IndexingScope,
  indexing: IndexingConfig,
  raw: IndexingConfig,
) {
  const currentSettings = indexing.qdrant ?? {}

  const url = await DialogPrompt.show(dialog, "Qdrant — URL", {
    value: currentSettings.url ?? "",
    placeholder: "http://localhost:6333",
  })
  if (url === null) {
    dialog.replace(() => <DialogIndexing useSDK={useSDK} scope={scope} />)
    return
  }

  const apiKey = await DialogPrompt.show(dialog, "Qdrant — API Key", {
    value: currentSettings.apiKey ?? "",
    placeholder: "Optional API key",
  })
  if (apiKey === null) {
    dialog.replace(() => <DialogIndexing useSDK={useSDK} scope={scope} />)
    return
  }

  const updated: IndexingConfig = {
    ...raw,
    vectorStore: "qdrant",
    qdrant: {
      url: url.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
    },
  }
  await saveScopedIndexing(sdk, sync, scope, raw, updated, toast)
  dialog.replace(() => <DialogIndexing useSDK={useSDK} scope={scope} />)
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
  const indexing = props.indexing

  const options: DialogSelectOption<string>[] = TUNING_PARAMS.map((param) => {
    const value = indexing[param.key]
    const description = value !== undefined ? String(value) : `default (${param.defaultValue})`
    const inheritance = indexingInheritance(props.scope, props.global ?? {}, props.raw, [[param.key]])
    return {
      value: param.key,
      title: param.label,
      description: inheritedDescription(description, inheritance),
    }
  })

  return (
    <DialogSelect
      title="Tuning Parameters"
      options={options}
      onSelect={async (option) => {
        const param = TUNING_PARAMS.find((p) => p.key === option.value)!
        const currentValue = indexing[param.key]
        const result = await DialogPrompt.show(dialog, param.label, {
          value: currentValue !== undefined ? String(currentValue) : "",
          placeholder: `Default: ${param.defaultValue}`,
        })
        if (result === null) {
          dialog.replace(() => (
            <TuningMenu
              useSDK={props.useSDK}
              scope={props.scope}
              indexing={indexing}
              raw={props.raw}
              global={props.global}
            />
          ))
          return
        }
        const trimmed = result.trim()
        const num = trimmed ? Number(trimmed) : undefined
        if (trimmed && isNaN(num!)) {
          toast.show({ message: `Invalid number: "${trimmed}"`, variant: "error" })
          dialog.replace(() => (
            <TuningMenu
              useSDK={props.useSDK}
              scope={props.scope}
              indexing={indexing}
              raw={props.raw}
              global={props.global}
            />
          ))
          return
        }
        const updated = { ...props.raw, [param.key]: num }
        await saveScopedIndexing(sdk, sync, props.scope, props.raw, updated, toast)
        const effective = props.scope === "project" ? mergeIndexingConfig(props.global ?? {}, updated) : updated
        dialog.replace(() => (
          <TuningMenu
            useSDK={props.useSDK}
            scope={props.scope}
            indexing={effective}
            raw={updated}
            global={props.global}
          />
        ))
      }}
    />
  )
}

// --- Main Dialog ---

interface DialogIndexingProps {
  useSDK: () => UseSDK
  scope?: IndexingScope
}

function ScopeSelect(props: DialogIndexingProps & { scope: IndexingScope }) {
  const dialog = useDialog()
  const options: DialogSelectOption<IndexingScope>[] = [
    { value: "global", title: "Global", description: "Stored in the user config directory" },
    { value: "project", title: "Project", description: "Stored in this repo's .kilo config" },
  ]

  return (
    <DialogSelect
      title="Indexing Scope"
      options={options}
      current={props.scope}
      onSelect={(option) => {
        dialog.replace(() => <DialogIndexing useSDK={props.useSDK} scope={option.value} />)
      }}
    />
  )
}

export function DialogIndexing(props: DialogIndexingProps) {
  const dialog = useDialog()
  const sync = useSync()
  const sdk = props.useSDK()
  const toast = useToast()
  const scope = () => props.scope ?? "global"
  const [overlay] = createResource(async () => (await sdk.client.config.overlay({ scope: "project" })).data)
  const globalCfg = () => scopedIndexing((overlay()?.global as Config | undefined) ?? sync.data.globalConfig)
  const projectCfg = () => scopedIndexing(overlay()?.project as Config | undefined)
  const state = createIndexingDialogState({
    scope,
    global: globalCfg,
    project: projectCfg,
    resolve: (current, global) => defaultIndexing(sync, scope(), current, global),
  })
  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const indexing = state.config()
    const provider = indexing.provider ? PROVIDER_LABELS[indexing.provider] : "not set"
    const store = indexing.vectorStore ?? DEFAULT_VECTOR_STORE
    const storeLabel = VECTOR_STORE_LABELS[store] ?? store
    const mark = (value: string, paths: readonly (readonly string[])[]) =>
      inheritedDescription(value, state.inherited(paths))
    const count = TUNING_PARAMS.filter((param) => indexing[param.key] !== undefined).length
    const tuning = count > 0 ? `${count} customized` : "defaults"
    const tuningPaths = TUNING_PARAMS.map((param) => [param.key])
    const result: DialogSelectOption<string>[] = [
      {
        value: "scope",
        title: "Configuration Scope",
        category: "General",
        description: scope(),
      },
      {
        value: "enabled",
        title: "Indexing",
        category: "General",
        description: mark(state.enabled() ? "enabled" : "disabled", [["enabled"]]),
      },
      {
        value: "provider",
        title: "Embedding Provider",
        category: "Embedding",
        description: mark(provider, [["provider"]]),
      },
      {
        value: "model",
        title: "Embedding Model",
        category: "Embedding",
        description: mark(
          indexing.provider === "kilo" ? (indexing.model ?? "Kilo catalog") : (indexing.model ?? "default"),
          [["model"]],
        ),
      },
      {
        value: "dimension",
        title: "Vector Dimension",
        category: "Embedding",
        description:
          indexing.provider === "kilo"
            ? "provided by Kilo"
            : mark(indexing.dimension ? String(indexing.dimension) : "auto", [["dimension"]]),
        disabled: indexing.provider === "kilo",
      },
      {
        value: "vectorStore",
        title: "Vector Store",
        category: "Storage",
        description: mark(storeLabel, [["vectorStore"]]),
      },
      {
        value: "fileExtensions",
        title: "File Extensions",
        category: "Advanced",
        description: mark(indexing.fileExtensions?.join(", ") ?? "built-in defaults", [["fileExtensions"]]),
      },
      {
        value: "tuning",
        title: "Tuning Parameters",
        category: "Advanced",
        description: mark(tuning, tuningPaths),
      },
    ]

    if (indexing.provider && PROVIDER_FIELDS[indexing.provider].length > 0) {
      result.splice(3, 0, {
        value: "providerSettings",
        title: `${PROVIDER_LABELS[indexing.provider]} Settings`,
        category: "Embedding",
        description: mark(
          providerSettingsDescription(indexing, indexing.provider),
          PROVIDER_FIELDS[indexing.provider].map((field) => [indexing.provider!, field.key]),
        ),
      })
    }
    return result
  })

  return (
    <DialogSelect
      title="Indexing Configuration"
      options={options()}
      skipFilter
      onSelect={async (option) => {
        const indexing = state.config()
        const raw = state.raw()
        switch (option.value) {
          case "scope":
            dialog.replace(() => <ScopeSelect useSDK={props.useSDK} scope={scope()} />)
            break
          case "enabled":
            await saveScopedIndexing(sdk, sync, scope(), raw, { ...raw, enabled: !state.enabled() }, toast)
            dialog.replace(() => <DialogIndexing useSDK={props.useSDK} scope={scope()} />)
            break
          case "provider":
            dialog.replace(() => <ProviderSelect useSDK={props.useSDK} scope={scope()} indexing={indexing} raw={raw} />)
            break
          case "providerSettings":
            if (indexing.provider) {
              await showProviderSettings(
                dialog,
                sync,
                sdk,
                toast,
                indexing.provider,
                props.useSDK,
                scope(),
                indexing,
                raw,
              )
            }
            break
          case "model": {
            if (indexing.provider === "kilo") {
              dialog.replace(() => (
                <KiloModelSelect useSDK={props.useSDK} scope={scope()} indexing={indexing} raw={raw} />
              ))
              break
            }
            const result = await DialogPrompt.show(dialog, "Embedding Model", {
              value: indexing.model ?? "",
              placeholder: "Enter model ID",
            })
            if (result !== null) {
              const trimmed = result.trim()
              await saveScopedIndexing(sdk, sync, scope(), raw, { ...raw, model: trimmed || null }, toast)
            }
            dialog.replace(() => <DialogIndexing useSDK={props.useSDK} scope={scope()} />)
            break
          }
          case "dimension": {
            if (indexing.provider === "kilo") break
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
                  dialog.replace(() => <DialogIndexing useSDK={props.useSDK} scope={scope()} />)
                  break
                }
              }
              await saveScopedIndexing(sdk, sync, scope(), raw, { ...raw, dimension: dim ?? null }, toast)
            }
            dialog.replace(() => <DialogIndexing useSDK={props.useSDK} scope={scope()} />)
            break
          }
          case "vectorStore":
            dialog.replace(() => (
              <VectorStoreSelect useSDK={props.useSDK} scope={scope()} indexing={indexing} raw={raw} />
            ))
            break
          case "fileExtensions": {
            const result = await DialogPrompt.show(dialog, "File Extensions", {
              value: indexing.fileExtensions?.join(", ") ?? "",
              placeholder: ".php, .js, .css (empty uses built-in defaults)",
            })
            if (result !== null) {
              const values = result
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
              const invalid = values.find((item) => !isFileExtension(item))
              if (invalid) {
                toast.show({ message: `Invalid file extension: "${invalid}"`, variant: "error" })
              } else {
                await saveScopedIndexing(
                  sdk,
                  sync,
                  scope(),
                  raw,
                  { ...raw, fileExtensions: parseFileExtensions(result) },
                  toast,
                )
              }
            }
            dialog.replace(() => <DialogIndexing useSDK={props.useSDK} scope={scope()} />)
            break
          }
          case "tuning":
            dialog.replace(() => (
              <TuningMenu useSDK={props.useSDK} scope={scope()} indexing={indexing} raw={raw} global={globalCfg()} />
            ))
            break
        }
      }}
    />
  )
}
