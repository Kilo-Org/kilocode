import { Component, For, Show, createMemo, createSignal } from "solid-js"
import { Card } from "@kilocode/kilo-ui/card"
import {
  formatKiloEmbeddingModelLabel,
  getKiloEmbeddingModel,
  normalizeKiloEmbeddingModelId,
} from "@kilocode/kilo-indexing/embedding-models"
import { Select } from "@kilocode/kilo-ui/select"
import { Switch } from "@kilocode/kilo-ui/switch"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Tooltip } from "@kilocode/kilo-ui/tooltip"
import { useConfig } from "../../context/config"
import { formatIndexingLabel, useIndexing } from "../../context/indexing"
import { useKiloEmbeddingModels } from "../../context/kilo-embedding-models"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useServer } from "../../context/server"
import type { IndexingConfig, IndexingProvider as ProviderId } from "../../types/messages"
import { KILO_PROVIDER_ID } from "../../../../src/shared/provider-model"
import SettingsRow from "./SettingsRow"

type Option = { value: string; label: string }
type TuningKey = "searchMinScore" | "searchMaxResults" | "embeddingBatchSize" | "scannerMaxBatchRetries"

const allProviders: { value: ProviderId; label: string }[] = [
  { value: "kilo", label: "Kilo" },
  { value: "openai", label: "OpenAI" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai-compatible", label: "OpenAI-Compatible" },
  { value: "gemini", label: "Gemini" },
  { value: "mistral", label: "Mistral" },
  { value: "vercel-ai-gateway", label: "Vercel AI Gateway" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "voyage", label: "Voyage" },
]

const stores: Option[] = [
  { value: "qdrant", label: "Qdrant (default)" },
  { value: "lancedb", label: "LanceDB" },
]

const tuning: Array<{ key: TuningKey; label: string; placeholder: string }> = [
  { key: "searchMinScore", label: "Search Min Score", placeholder: "0.4" },
  { key: "searchMaxResults", label: "Search Max Results", placeholder: "50" },
  { key: "embeddingBatchSize", label: "Embedding Batch Size", placeholder: "60" },
  { key: "scannerMaxBatchRetries", label: "Scanner Max Batch Retries", placeholder: "3" },
]

function providerFields(provider: ProviderId | undefined): Array<{ key: string; label: string; placeholder: string }> {
  if (provider === "kilo") return []
  if (provider === "openai") return [{ key: "apiKey", label: "API Key", placeholder: "sk-..." }]
  if (provider === "ollama") return [{ key: "baseUrl", label: "Base URL", placeholder: "http://localhost:11434" }]
  if (provider === "openai-compatible") {
    return [
      { key: "baseUrl", label: "Base URL", placeholder: "https://api.example.com/v1" },
      { key: "apiKey", label: "API Key", placeholder: "sk-..." },
    ]
  }
  if (provider === "gemini") return [{ key: "apiKey", label: "API Key", placeholder: "AI..." }]
  if (provider === "mistral") return [{ key: "apiKey", label: "API Key", placeholder: "..." }]
  if (provider === "vercel-ai-gateway") return [{ key: "apiKey", label: "API Key", placeholder: "..." }]
  if (provider === "bedrock") {
    return [
      { key: "region", label: "AWS Region", placeholder: "us-east-1" },
      { key: "profile", label: "AWS Profile", placeholder: "default" },
    ]
  }
  if (provider === "openrouter") {
    return [
      { key: "apiKey", label: "API Key", placeholder: "sk-or-..." },
      { key: "specificProvider", label: "Specific Provider", placeholder: "optional" },
    ]
  }
  if (provider === "voyage") return [{ key: "apiKey", label: "API Key", placeholder: "pa-..." }]
  return []
}

const IndexingTab: Component = () => {
  const { config, globalConfig, updateConfig, updateGlobalConfig } = useConfig()
  const indexing = useIndexing()
  const embeds = useKiloEmbeddingModels()
  const language = useLanguage()
  const provider = useProvider()
  const server = useServer()
  const [providerDrafts, setProviderDrafts] = createSignal<Record<string, string>>({})
  const [storeDrafts, setStoreDrafts] = createSignal<Record<string, string>>({})
  const [tuningDrafts, setTuningDrafts] = createSignal<Record<string, string>>({})

  const cfg = createMemo<IndexingConfig>(() => config().indexing ?? {})
  const globalCfg = createMemo<IndexingConfig>(() => globalConfig().indexing ?? {})
  const globalOn = createMemo(() => globalCfg().enabled === true)

  const updateIndexing = (partial: IndexingConfig) => {
    updateConfig({ indexing: { ...cfg(), ...partial } })
  }

  const vectorStore = () => cfg().vectorStore ?? "qdrant"
  const kiloDefault = () => embeds.catalog().defaultModel
  const kiloModels = createMemo(() =>
    embeds.catalog().models.map((model) => ({
      value: model.id,
      label: formatKiloEmbeddingModelLabel(model),
    })),
  )
  const knownKiloModel = (model: string | undefined) => getKiloEmbeddingModel(model, embeds.catalog())?.id
  const kiloAvailable = () => !!server.profileData() || provider.authStates()[KILO_PROVIDER_ID] !== undefined
  const selectedProvider = () => cfg().provider ?? (kiloAvailable() ? "kilo" : undefined)
  const providers = createMemo(() =>
    allProviders.filter((item) => item.value !== "kilo" || kiloAvailable() || selectedProvider() === "kilo"),
  )
  const fields = createMemo(() => providerFields(selectedProvider()))

  const saveProvider = (next: ProviderId | undefined) => {
    if (next === "kilo") {
      const model = knownKiloModel(cfg().model) ?? (kiloDefault() || undefined)
      updateIndexing({
        provider: next,
        model,
        dimension: undefined,
      })
      return
    }
    updateIndexing({ provider: next, model: undefined, dimension: undefined })
  }

  const saveEnabled = (enabled: boolean) => {
    if (enabled && !cfg().provider && kiloAvailable()) {
      updateIndexing({
        enabled,
        provider: "kilo",
        model: knownKiloModel(cfg().model) ?? kiloDefault(),
      })
      return
    }
    updateIndexing({ enabled })
  }

  const saveGlobalEnabled = (enabled: boolean) => {
    if (enabled && !globalCfg().provider && !cfg().provider && kiloAvailable()) {
      updateGlobalConfig({
        indexing: {
          enabled,
          provider: "kilo",
          model: knownKiloModel(cfg().model) ?? kiloDefault(),
        },
      })
      return
    }
    updateGlobalConfig({ indexing: { enabled } })
  }

  const saveModel = (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      updateIndexing({ model: undefined })
      return
    }
    updateIndexing({
      model:
        selectedProvider() === "kilo" ? (normalizeKiloEmbeddingModelId(trimmed, embeds.catalog()) ?? trimmed) : trimmed,
    })
  }

  const providerValue = (group: string, key: string) => {
    const draftKey = `${group}.${key}`
    const draft = providerDrafts()[draftKey]
    if (draft !== undefined) return draft
    const value = (cfg()[group as keyof IndexingConfig] as Record<string, string | undefined> | undefined)?.[key]
    return value ?? ""
  }

  const storeValue = (group: "qdrant" | "lancedb", key: string) => {
    const draftKey = `${group}.${key}`
    const draft = storeDrafts()[draftKey]
    if (draft !== undefined) return draft
    const value = (cfg()[group] as Record<string, string | undefined> | undefined)?.[key]
    return value ?? ""
  }

  const saveProviderField = (group: ProviderId, key: string, value: string) => {
    const current = (cfg()[group] as Record<string, string | undefined> | undefined) ?? {}
    updateIndexing({ [group]: { ...current, [key]: value.trim() || undefined } })
  }

  const saveStoreField = (group: "qdrant" | "lancedb", key: string, value: string) => {
    const current = (cfg()[group] as Record<string, string | undefined> | undefined) ?? {}
    updateIndexing({ [group]: { ...current, [key]: value.trim() || undefined } })
  }

  const saveNumber = (
    key: keyof IndexingConfig,
    value: string,
    options?: { integer?: boolean; min?: number; max?: number },
  ) => {
    const trimmed = value.trim()
    if (!trimmed) {
      updateIndexing({ [key]: undefined })
      return
    }

    const num = Number(trimmed)
    if (Number.isNaN(num)) return
    if (options?.integer && !Number.isInteger(num)) return
    if (options?.min !== undefined && num < options.min) return
    if (options?.max !== undefined && num > options.max) return
    updateIndexing({ [key]: num })
  }

  const tuningValue = (key: TuningKey) => {
    const draft = tuningDrafts()[key]
    if (draft !== undefined) return draft
    const value = cfg()[key]
    return value === undefined ? "" : String(value)
  }

  return (
    <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
      <Card>
        <SettingsRow title={language.t("settings.indexing.status.title")} description={indexing.status().message}>
          <span class={`indexing-status-badge indexing-status-badge--${indexing.tone()}`}>
            {formatIndexingLabel(indexing.status())}
          </span>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.globalEnable.title")}
          description={language.t("settings.indexing.globalEnable.description")}
        >
          <Switch checked={globalCfg().enabled ?? false} onChange={saveGlobalEnabled} hideLabel>
            {language.t("settings.indexing.globalEnable.title")}
          </Switch>
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.projectEnable.title")}
          description={language.t("settings.indexing.projectEnable.description")}
          last
        >
          <Tooltip
            value={language.t("settings.indexing.projectEnable.disabledTooltip")}
            placement="top"
            inactive={!globalOn()}
          >
            <Switch checked={cfg().enabled === true} onChange={saveEnabled} disabled={globalOn()} hideLabel>
              {language.t("settings.indexing.projectEnable.title")}
            </Switch>
          </Tooltip>
        </SettingsRow>
      </Card>

      <Card>
        <SettingsRow
          title={language.t("settings.indexing.provider.title")}
          description={language.t("settings.indexing.provider.description")}
        >
          <Select
            options={providers()}
            current={providers().find((item) => item.value === selectedProvider())}
            value={(item) => item.value}
            label={(item) => item.label}
            onSelect={(item) => saveProvider(item?.value as ProviderId | undefined)}
            variant="secondary"
            size="small"
            triggerVariant="settings"
            placeholder={language.t("settings.providers.notSet")}
          />
        </SettingsRow>
        <Show when={selectedProvider() === "kilo"}>
          <Show when={kiloModels().length > 0}>
            <SettingsRow
              title={language.t("settings.indexing.kiloModel.title")}
              description={language.t("settings.indexing.kiloModel.description")}
            >
              <Select
                options={kiloModels()}
                current={kiloModels().find((item) => item.value === knownKiloModel(cfg().model))}
                value={(item) => item.value}
                label={(item) => item.label}
                onSelect={(item) => updateIndexing({ model: item?.value ?? kiloDefault(), dimension: undefined })}
                variant="secondary"
                size="small"
                triggerVariant="settings"
                placeholder="Custom model"
              />
            </SettingsRow>
          </Show>
        </Show>
        <SettingsRow
          title={language.t("settings.indexing.model.title")}
          description={language.t("settings.indexing.model.description")}
        >
          <TextField
            value={cfg().model ?? ""}
            placeholder={selectedProvider() === "kilo" ? kiloDefault() || "provider/model" : "text-embedding-3-small"}
            onChange={saveModel}
          />
        </SettingsRow>
        <SettingsRow
          title={language.t("settings.indexing.dimension.title")}
          description={language.t("settings.indexing.dimension.description")}
          last={!selectedProvider() || (fields().length === 0 && !(selectedProvider() === "kilo" && !kiloAvailable()))}
        >
          <TextField
            value={cfg().dimension === undefined ? "" : String(cfg().dimension)}
            placeholder={language.t("settings.indexing.dimension.placeholder")}
            onChange={(value) => saveNumber("dimension", value, { integer: true, min: 1 })}
          />
        </SettingsRow>
        <Show when={selectedProvider() === "kilo" && !kiloAvailable()}>
          <SettingsRow
            title={language.t("settings.indexing.kiloSignIn.title")}
            description={language.t("settings.indexing.kiloSignIn.description")}
            last
          >
            <span />
          </SettingsRow>
        </Show>
        <Show when={fields().length > 0 ? selectedProvider() : undefined} keyed>
          {(group) => {
            const fields = providerFields(group)
            const label = allProviders.find((item) => item.value === group)?.label ?? group
            return (
              <For each={fields}>
                {(field, index) => (
                  <SettingsRow
                    title={`${label} ${field.label}`}
                    description={language.t("settings.indexing.providerField.description")}
                    last={index() === fields.length - 1}
                  >
                    <TextField
                      type={field.key === "apiKey" ? "password" : undefined}
                      value={providerValue(group, field.key)}
                      placeholder={field.placeholder}
                      onInput={(e: InputEvent) => {
                        const target = e.currentTarget as HTMLInputElement
                        setProviderDrafts((prev) => ({ ...prev, [`${group}.${field.key}`]: target.value }))
                      }}
                      onBlur={(e: FocusEvent) => {
                        const target = e.currentTarget as HTMLInputElement
                        saveProviderField(group, field.key, target.value)
                      }}
                    />
                  </SettingsRow>
                )}
              </For>
            )
          }}
        </Show>
      </Card>

      <Card>
        <SettingsRow
          title={language.t("settings.indexing.vectorStore.title")}
          description={language.t("settings.indexing.vectorStore.description")}
        >
          <Select
            options={stores}
            current={stores.find((item) => item.value === vectorStore())}
            value={(item) => item.value}
            label={(item) => item.label}
            onSelect={(item) => updateIndexing({ vectorStore: item?.value as "lancedb" | "qdrant" | undefined })}
            variant="secondary"
            size="small"
            triggerVariant="settings"
          />
        </SettingsRow>
        <Show
          when={vectorStore() === "qdrant"}
          fallback={
            <SettingsRow
              title={language.t("settings.indexing.lancedbDirectory.title")}
              description={language.t("settings.indexing.lancedbDirectory.description")}
              last
            >
              <TextField
                value={storeValue("lancedb", "directory")}
                placeholder={language.t("settings.indexing.lancedbDirectory.placeholder")}
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setStoreDrafts((prev) => ({ ...prev, "lancedb.directory": target.value }))
                }}
                onBlur={(e: FocusEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  saveStoreField("lancedb", "directory", target.value)
                }}
              />
            </SettingsRow>
          }
        >
          <>
            <SettingsRow
              title={language.t("settings.indexing.qdrantUrl.title")}
              description={language.t("settings.indexing.qdrantUrl.description")}
            >
              <TextField
                value={storeValue("qdrant", "url")}
                placeholder="http://localhost:6333"
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setStoreDrafts((prev) => ({ ...prev, "qdrant.url": target.value }))
                }}
                onBlur={(e: FocusEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  saveStoreField("qdrant", "url", target.value)
                }}
              />
            </SettingsRow>
            <SettingsRow
              title={language.t("settings.indexing.qdrantApiKey.title")}
              description={language.t("settings.indexing.qdrantApiKey.description")}
              last
            >
              <TextField
                type="password"
                value={storeValue("qdrant", "apiKey")}
                placeholder={language.t("settings.indexing.qdrantApiKey.placeholder")}
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setStoreDrafts((prev) => ({ ...prev, "qdrant.apiKey": target.value }))
                }}
                onBlur={(e: FocusEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  saveStoreField("qdrant", "apiKey", target.value)
                }}
              />
            </SettingsRow>
          </>
        </Show>
      </Card>

      <Card>
        <For each={tuning}>
          {(item, index) => (
            <SettingsRow
              title={item.label}
              description={language.t("settings.indexing.tuning.description")}
              last={index() === tuning.length - 1}
            >
              <TextField
                value={tuningValue(item.key)}
                placeholder={item.placeholder}
                onInput={(e: InputEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  setTuningDrafts((prev) => ({ ...prev, [item.key]: target.value }))
                }}
                onBlur={(e: FocusEvent) => {
                  const target = e.currentTarget as HTMLInputElement
                  const integer = item.key !== "searchMinScore"
                  const max = item.key === "searchMinScore" ? 1 : undefined
                  saveNumber(item.key, target.value, { integer, min: 0, max })
                }}
              />
            </SettingsRow>
          )}
        </For>
      </Card>
    </div>
  )
}

export default IndexingTab
