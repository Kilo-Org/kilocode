/**
 * Indexing Configuration Dialog
 *
 * Menu-driven dialog for configuring codebase indexing settings.
 * Allows toggling indexing, selecting embedding providers, configuring
 * vector stores, and adjusting tuning parameters.
 */

import type { LocationRef, OpenCodeClient } from "@opencode/client"
import type { RpcClient } from "@opencode/client/promise/api"
import type { Plugin } from "@opencode/plugin/tui"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import { createEffect, createMemo, createResource, createSignal, Show } from "solid-js"
import type { KeymapCommand } from "../../context/keymap"
import { useTheme } from "../../context/theme"
import { DialogPrompt } from "../../ui/dialog-prompt"
import { DialogSelect, type DialogSelectOption } from "../../ui/dialog-select"
import { useDialog, type DialogContext } from "../../ui/dialog"
import { useToast } from "../../ui/toast"
import {
  createIndexingDialogState,
  currentKiloModel,
  indexingInheritance,
  indexingPatch,
  inheritedDescription,
  kiloModelOptions,
  loadKiloEmbeddingModels,
  mergeIndexingConfig,
  shouldDefaultIndexingToKilo,
  type IndexingConfig,
  type IndexingScope,
} from "../indexing-dialog-state"

type EmbeddingProvider = NonNullable<IndexingConfig["provider"]>

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

const DEFAULT_VECTOR_STORE = "lancedb"

const FILE_EXTENSION_PATTERN = /^\.?[A-Za-z0-9][A-Za-z0-9_+-]*$/

function isFileExtension(input: string) {
  return FILE_EXTENSION_PATTERN.test(input.trim())
}

function parseFileExtensions(input: string) {
  const values = new Set<string>()
  for (const raw of input.split(",")) {
    const item = raw.trim().toLowerCase()
    if (!item) continue
    values.add(item.startsWith(".") ? item : `.${item}`)
  }
  return values.size > 0 ? [...values].sort() : undefined
}

function maskSecret(value: string | undefined): string {
  if (!value) return "not set"
  if (value.length <= 6) return "***"
  return value.slice(0, 3) + "..." + value.slice(-3)
}

function defaultIndexing(kilo: boolean, indexing: IndexingConfig, global: IndexingConfig): IndexingConfig {
  if (!shouldDefaultIndexingToKilo(mergeIndexingConfig(global, indexing), kilo)) return indexing
  return { ...indexing, provider: "kilo", model: null, dimension: null }
}

async function saveScopedIndexing(
  rpc: RpcClient<typeof KiloIndexingRpc.Definition>,
  location: LocationRef,
  scope: IndexingScope,
  before: IndexingConfig,
  indexing: IndexingConfig,
  toast: ReturnType<typeof useToast>,
): Promise<boolean> {
  const patch = indexingPatch(before, indexing)
  const saved = await rpc["config.update"](
    { scope, config: patch.indexing },
    { location: { directory: location.directory } },
  ).then(
    () => true,
    () => false,
  )
  if (!saved) {
    toast.show({ message: "Failed to save indexing config", variant: "error" })
    return false
  }
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

function ask(dialog: DialogContext, title: string, options: { value?: string; placeholder?: string }) {
  return new Promise<string | undefined>((resolve) => {
    let settled = false
    const finish = (value: string | undefined) => {
      if (settled) return
      settled = true
      resolve(value)
    }
    dialog.replace(
      () => (
        <DialogPrompt
          title={title}
          value={options.value}
          placeholder={options.placeholder}
          onConfirm={finish}
        />
      ),
      () => finish(undefined),
    )
  })
}

// --- Sub-dialogs ---

interface SubDialogProps {
  client: OpenCodeClient
  location: LocationRef
  kilo: boolean
  scope: IndexingScope
  indexing: IndexingConfig
  raw: IndexingConfig
  global?: IndexingConfig
}

function ProviderSelect(props: SubDialogProps) {
  const dialog = useDialog()
  const toast = useToast()
  const rpc = props.client.rpc(KiloIndexingRpc.Definition)
  const indexing = props.indexing

  const options: DialogSelectOption<EmbeddingProvider>[] = (
    Object.entries(PROVIDER_LABELS) as [EmbeddingProvider, string][]
  )
    .filter(([value]) => value !== "kilo" || props.kilo || indexing.provider === "kilo")
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
        const saved = await saveScopedIndexing(
          rpc,
          props.location,
          props.scope,
          props.raw,
          updated,
          toast,
        )
        if (!saved) {
          dialog.clear()
          return
        }
        await showProviderSettings(dialog, toast, props, provider, updated, updated)
      }}
    />
  )
}

function KiloModelSelect(props: SubDialogProps) {
  const dialog = useDialog()
  const toast = useToast()
  const gateway = props.client.rpc(KiloGatewayRpc.Definition)
  const indexing = props.indexing
  const [error, setError] = createSignal<string>()
  const [catalog] = createResource(() =>
    loadKiloEmbeddingModels(
      () =>
        gateway["models.embeddings"](
          {},
          { location: { directory: props.location.directory } },
        ),
      setError,
    ),
  )
  const seen = { error: undefined as string | undefined }
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
        await saveScopedIndexing(
          props.client.rpc(KiloIndexingRpc.Definition),
          props.location,
          props.scope,
          props.raw,
          { ...props.raw, model: option.value, dimension: null },
          toast,
        )
        dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={props.scope} />)
      }}
    />
  )
}

async function showProviderSettings(
  dialog: DialogContext,
  toast: ReturnType<typeof useToast>,
  props: SubDialogProps,
  provider: EmbeddingProvider,
  indexing: IndexingConfig,
  raw: IndexingConfig,
) {
  const fields = PROVIDER_FIELDS[provider]
  if (fields.length === 0) {
    dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={props.scope} />)
    return
  }
  const currentSettings = (indexing[provider] as Record<string, string | undefined>) ?? {}
  const newSettings: Record<string, string | undefined> = { ...currentSettings }

  for (const field of fields) {
    const currentValue = currentSettings[field.key] ?? ""
    const result = await ask(dialog, `${PROVIDER_LABELS[provider]} - ${field.label}`, {
      value: currentValue,
      placeholder: field.placeholder,
    })
    if (result === undefined) {
      dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={props.scope} />)
      return
    }
    newSettings[field.key] = result.trim() || undefined
  }

  const updated = { ...raw, [provider]: newSettings }
  await saveScopedIndexing(
    props.client.rpc(KiloIndexingRpc.Definition),
    props.location,
    props.scope,
    raw,
    updated,
    toast,
  )
  dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={props.scope} />)
}

function VectorStoreSelect(props: SubDialogProps) {
  const dialog = useDialog()
  const toast = useToast()
  const rpc = props.client.rpc(KiloIndexingRpc.Definition)
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
        if (option.value === "lancedb") {
          await showLancedbSettings(dialog, toast, rpc, props, indexing)
          return
        }
        await showQdrantSettings(dialog, toast, rpc, props, indexing)
      }}
    />
  )
}

async function showLancedbSettings(
  dialog: DialogContext,
  toast: ReturnType<typeof useToast>,
  rpc: RpcClient<typeof KiloIndexingRpc.Definition>,
  props: SubDialogProps,
  indexing: IndexingConfig,
) {
  const result = await ask(dialog, "LanceDB - Directory", {
    value: indexing.lancedb?.directory ?? "",
    placeholder: "Leave empty for default",
  })
  if (result === undefined) {
    dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={props.scope} />)
    return
  }
  const updated: IndexingConfig = {
    ...props.raw,
    vectorStore: "lancedb",
    lancedb: { directory: result.trim() || undefined },
  }
  await saveScopedIndexing(rpc, props.location, props.scope, props.raw, updated, toast)
  dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={props.scope} />)
}

async function showQdrantSettings(
  dialog: DialogContext,
  toast: ReturnType<typeof useToast>,
  rpc: RpcClient<typeof KiloIndexingRpc.Definition>,
  props: SubDialogProps,
  indexing: IndexingConfig,
) {
  const currentSettings = indexing.qdrant ?? {}

  const url = await ask(dialog, "Qdrant - URL", {
    value: currentSettings.url ?? "",
    placeholder: "http://localhost:6333",
  })
  if (url === undefined) {
    dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={props.scope} />)
    return
  }

  const apiKey = await ask(dialog, "Qdrant - API Key", {
    value: currentSettings.apiKey ?? "",
    placeholder: "Optional API key",
  })
  if (apiKey === undefined) {
    dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={props.scope} />)
    return
  }

  const updated: IndexingConfig = {
    ...props.raw,
    vectorStore: "qdrant",
    qdrant: {
      url: url.trim() || undefined,
      apiKey: apiKey.trim() || undefined,
    },
  }
  await saveScopedIndexing(rpc, props.location, props.scope, props.raw, updated, toast)
  dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={props.scope} />)
}

type TuningKey = keyof Pick<
  IndexingConfig,
  "searchMinScore" | "searchMaxResults" | "embeddingBatchSize" | "scannerMaxBatchRetries"
>

interface TuningParam {
  key: TuningKey
  label: string
  defaultValue: number
}

/** The server bounds: a similarity in 0..1, and a positive whole number for the rest. */
export function tuningProblem(key: TuningKey, text: string, value: number | undefined) {
  if (!text) return undefined
  if (value === undefined || !Number.isFinite(value)) return `Invalid number: "${text}"`
  if (key === "searchMinScore") {
    return value < 0 || value > 1 ? "Search Min Score must be between 0 and 1" : undefined
  }
  return Number.isInteger(value) && value > 0 ? undefined : "Enter a positive whole number"
}

const TUNING_PARAMS: TuningParam[] = [
  { key: "searchMinScore", label: "Search Min Score", defaultValue: 0.4 },
  { key: "searchMaxResults", label: "Search Max Results", defaultValue: 50 },
  { key: "embeddingBatchSize", label: "Embedding Batch Size", defaultValue: 60 },
  { key: "scannerMaxBatchRetries", label: "Scanner Max Batch Retries", defaultValue: 3 },
]

function TuningMenu(props: SubDialogProps) {
  const dialog = useDialog()
  const toast = useToast()
  const rpc = props.client.rpc(KiloIndexingRpc.Definition)
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

  const restore = (value: IndexingConfig) => {
    const effective = props.scope === "project" ? mergeIndexingConfig(props.global ?? {}, value) : value
    dialog.replace(() => (
      <TuningMenu
        client={props.client}
        location={props.location}
        kilo={props.kilo}
        scope={props.scope}
        indexing={effective}
        raw={value}
        global={props.global}
      />
    ))
  }

  return (
    <DialogSelect
      title="Tuning Parameters"
      options={options}
      onSelect={async (option) => {
        const param = TUNING_PARAMS.find((p) => p.key === option.value)
        if (!param) return
        const currentValue = indexing[param.key]
        const result = await ask(dialog, param.label, {
          value: currentValue !== undefined ? String(currentValue) : "",
          placeholder: `Default: ${param.defaultValue}`,
        })
        if (result === undefined) {
          restore(props.raw)
          return
        }
        const trimmed = result.trim()
        const num = trimmed ? Number(trimmed) : undefined
        const problem = tuningProblem(param.key, trimmed, num)
        if (problem) {
          toast.show({ message: problem, variant: "error" })
          restore(props.raw)
          return
        }
        const updated = { ...props.raw, [param.key]: num }
        // Keep the old value on a rejected save: the server validates the same bounds.
        if (await saveScopedIndexing(rpc, props.location, props.scope, props.raw, updated, toast)) restore(updated)
        else restore(props.raw)
      }}
    />
  )
}

// --- Main Dialog ---

interface DialogIndexingProps {
  client: OpenCodeClient
  location: LocationRef
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
        dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={option.value} />)
      }}
    />
  )
}

export function DialogIndexing(props: DialogIndexingProps) {  const dialog = useDialog()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const rpc = props.client.rpc(KiloIndexingRpc.Definition)
  const scope = () => props.scope ?? "global"
  const [settings] = createResource(() =>
    rpc
      .config({}, { location: { directory: props.location.directory } })
      .catch(() => undefined),
  )
  const globalCfg = () => settings()?.global ?? {}
  const projectCfg = () => settings()?.project ?? {}
  const kilo = () => settings()?.kilo === true
  const state = createIndexingDialogState({
    scope,
    global: globalCfg,
    project: projectCfg,
    resolve: (current, global) => defaultIndexing(kilo(), current, global),
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

  const sub = (): SubDialogProps => ({
    client: props.client,
    location: props.location,
    kilo: kilo(),
    scope: scope(),
    indexing: state.config(),
    raw: state.raw(),
    global: globalCfg(),
  })
  const reopen = () =>
    dialog.replace(() => <DialogIndexing client={props.client} location={props.location} scope={scope()} />)

  return (
    <Show
      when={settings()}
      fallback={
        <box paddingLeft={3} paddingRight={3} paddingBottom={1}>
          <text fg={theme.text.muted}>
            {settings.loading ? "Loading indexing configuration..." : "Could not load indexing configuration"}
          </text>
        </box>
      }
    >
      <DialogSelect
        title="Indexing Configuration"
        options={options()}
        skipFilter
        onSelect={async (option) => {
          const indexing = state.config()
          const raw = state.raw()
          switch (option.value) {
            case "scope":
              dialog.replace(() => <ScopeSelect client={props.client} location={props.location} scope={scope()} />)
              break
            case "enabled":
              await saveScopedIndexing(
                rpc,
                props.location,
                scope(),
                raw,
                { ...raw, enabled: !state.enabled() },
                toast,
              )
              reopen()
              break
            case "provider":
              dialog.replace(() => <ProviderSelect {...sub()} />)
              break
            case "providerSettings":
              if (indexing.provider) {
                await showProviderSettings(dialog, toast, sub(), indexing.provider, indexing, raw)
              }
              break
            case "model": {
              if (indexing.provider === "kilo") {
                dialog.replace(() => <KiloModelSelect {...sub()} />)
                break
              }
              const result = await ask(dialog, "Embedding Model", {
                value: indexing.model ?? "",
                placeholder: "Enter model ID",
              })
              if (result !== undefined) {
                const trimmed = result.trim()
                await saveScopedIndexing(
                  rpc,
                  props.location,
                  scope(),
                  raw,
                  { ...raw, model: trimmed || null },
                  toast,
                )
              }
              reopen()
              break
            }
            case "dimension": {
              if (indexing.provider === "kilo") break
              const result = await ask(dialog, "Vector Dimension", {
                value: indexing.dimension ? String(indexing.dimension) : "",
                placeholder: "Leave empty for auto-detection",
              })
              if (result !== undefined) {
                const trimmed = result.trim()
                let dim: number | undefined
                if (trimmed) {
                  dim = Number(trimmed)
                  if (isNaN(dim) || dim <= 0 || !Number.isInteger(dim)) {
                    toast.show({ message: `Invalid dimension: "${trimmed}"`, variant: "error" })
                    reopen()
                    break
                  }
                }
                await saveScopedIndexing(
                  rpc,
                  props.location,
                  scope(),
                  raw,
                  { ...raw, dimension: dim ?? null },
                  toast,
                )
              }
              reopen()
              break
            }
            case "vectorStore":
              dialog.replace(() => <VectorStoreSelect {...sub()} />)
              break
            case "fileExtensions": {
              const result = await ask(dialog, "File Extensions", {
                value: indexing.fileExtensions?.join(", ") ?? "",
                placeholder: ".php, .js, .css (empty uses built-in defaults)",
              })
              if (result !== undefined) {
                const values = result
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean)
                const invalid = values.find((item) => !isFileExtension(item))
                if (invalid) {
                  toast.show({ message: `Invalid file extension: "${invalid}"`, variant: "error" })
                } else {
                  await saveScopedIndexing(
                    rpc,
                    props.location,
                    scope(),
                    raw,
                    { ...raw, fileExtensions: parseFileExtensions(result) },
                    toast,
                  )
                }
              }
              reopen()
              break
            }
            case "tuning":
              dialog.replace(() => <TuningMenu {...sub()} />)
              break
          }
        }}
      />
    </Show>
  )
}

// Registered by the Kilo command host (`kilocode.teams`) so `/indexing` shares that plugin's row. A separate builtin
// row would sort before `opencode.diffs` in the plugin list and push it out of the /plugins viewport.
export function indexingCommand(context: Plugin.Context): KeymapCommand {
  return {
    id: "kilo.indexing",
    title: "Indexing",
    description: "Configure codebase indexing",
    group: "Kilo",
    palette: true,
    slash: { name: "indexing", aliases: ["index", "embedding"] },
    run: () => {
      const location = context.location ?? context.data.location.default()
      context.ui.dialog.show(() => <DialogIndexing client={context.client} location={location} />)
    },
  }
}
