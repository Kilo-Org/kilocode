import { Button } from "@kilocode/kilo-web-ui/button"
import { Card } from "@kilocode/kilo-web-ui/card"
import type { IndexingConfig } from "@kilocode/sdk/v2/client"
import { For, Show, createEffect, createMemo, createResource, createSignal, type JSX } from "solid-js"
import { CustomSelect, type SelectOption } from "../../components/CustomSelect"
import { loadEmbeddingModels } from "../../client"
import { useConfig } from "../../context/config"
import { ConfigPage, ConfigTag as Tag, SourceBadge } from "./ConfigPage"
import {
  clean,
  clone,
  merge,
  parseFileExtensions,
  providerPatch,
  removed,
  shouldSync,
  validate,
} from "./state/indexing"

type Provider = NonNullable<IndexingConfig["provider"]>
type ProviderValue = Provider | ""
type Store = NonNullable<IndexingConfig["vectorStore"]>
type Field = { key: string; label: string; placeholder: string; secret?: boolean }

const providers = [
  { value: "", label: "Automatic" },
  { value: "kilo", label: "Kilo" },
  { value: "openai", label: "OpenAI" },
  { value: "ollama", label: "Ollama (local)" },
  { value: "openai-compatible", label: "OpenAI-compatible" },
  { value: "gemini", label: "Gemini" },
  { value: "mistral", label: "Mistral" },
  { value: "vercel-ai-gateway", label: "Vercel AI Gateway" },
  { value: "bedrock", label: "AWS Bedrock" },
  { value: "openrouter", label: "OpenRouter" },
  { value: "voyage", label: "Voyage" },
] satisfies SelectOption<ProviderValue>[]

const stores = [
  { value: "lancedb", label: "LanceDB (default)" },
  { value: "qdrant", label: "Qdrant" },
] satisfies SelectOption<Store>[]

const fields: Record<Provider, Field[]> = {
  kilo: [],
  openai: [{ key: "apiKey", label: "API key", placeholder: "sk-...", secret: true }],
  ollama: [{ key: "baseUrl", label: "Base URL", placeholder: "http://localhost:11434" }],
  "openai-compatible": [
    { key: "baseUrl", label: "Base URL", placeholder: "https://api.example.com/v1" },
    { key: "apiKey", label: "API key", placeholder: "sk-...", secret: true },
  ],
  gemini: [{ key: "apiKey", label: "API key", placeholder: "AI...", secret: true }],
  mistral: [{ key: "apiKey", label: "API key", placeholder: "...", secret: true }],
  "vercel-ai-gateway": [{ key: "apiKey", label: "API key", placeholder: "...", secret: true }],
  bedrock: [
    { key: "region", label: "AWS region", placeholder: "us-east-1" },
    { key: "profile", label: "AWS profile", placeholder: "default" },
  ],
  openrouter: [
    { key: "apiKey", label: "API key", placeholder: "sk-or-...", secret: true },
    { key: "specificProvider", label: "Specific provider", placeholder: "Optional routing provider" },
  ],
  voyage: [{ key: "apiKey", label: "API key", placeholder: "pa-...", secret: true }],
}

function options(input: IndexingConfig, provider: Provider) {
  const value = input[provider]
  if (!value || typeof value !== "object") return {}
  return value as Record<string, string | undefined>
}

function FieldCard(props: { label: string; description?: string; actions?: JSX.Element; children: JSX.Element }) {
  return (
    <div class="ui-field agent-builder-field">
      <div class="agent-builder-field-head">
        <div>
          <span>{props.label}</span>
          <Show when={props.description}>{(description) => <small>{description()}</small>}</Show>
        </div>
        <Show when={props.actions}>{(actions) => <div class="agent-builder-field-actions">{actions()}</div>}</Show>
      </div>
      <div class="agent-builder-control">{props.children}</div>
    </div>
  )
}

function Toggle(props: {
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  source?: string
  inherited?: boolean
  overridden?: boolean
  onChange: () => void
}) {
  return (
    <button
      class="ui-toggle"
      classList={{ selected: props.checked }}
      type="button"
      aria-pressed={props.checked}
      disabled={props.disabled}
      onClick={props.onChange}
    >
      <span>
        <strong>{props.label}</strong>
        <small>{props.description}</small>
      </span>
      <span class="indexing-toggle-tags">
        <SourceBadge source={props.source} inherited={props.inherited} overridden={props.overridden} />
        <Tag tone={props.checked ? "success" : "neutral"}>{props.checked ? "On" : "Off"}</Tag>
      </span>
    </button>
  )
}

export function IndexingRoute() {
  const ctx = useConfig()
  const [draft, setDraft] = createSignal<IndexingConfig>({})
  const [source, setSource] = createSignal("")
  const [dirty, setDirty] = createSignal(false)
  const [extensionText, setExtensionText] = createSignal("")
  const scope = () => ctx.query()?.scope ?? "global"
  const [selected, setSelected] = createSignal(scope())
  const project = () => scope() === "project"
  const global = createMemo(() => ctx.data()?.overlay.global.indexing ?? {})
  const local = createMemo(() => {
    const overlay = ctx.data()?.overlay
    if (!overlay) return {}
    return (project() ? overlay.project.indexing : overlay.global.indexing) ?? {}
  })
  const view = createMemo(() => (project() ? merge(global(), draft()) : draft()))
  const provider = createMemo(() => view().provider)
  const store = createMemo<Store>(() => view().vectorStore ?? "lancedb")
  const [catalog] = createResource(ctx.query, loadEmbeddingModels)
  const kiloModels = createMemo<SelectOption<string>[]>(() => {
    const models = catalog()?.models ?? []
    if (models.length === 0) return [{ value: "", label: "No Kilo embedding models available", disabled: true }]
    return models.map((model) => ({
      value: model.id,
      label: `${model.name} (${model.note ? `${model.note}, ` : ""}${model.dimension}d)`,
    }))
  })
  const kiloModel = createMemo(() => {
    const data = catalog()
    if (!data) return ""
    const model = view().model ?? data.defaultModel
    return data.aliases[model] ?? model
  })
  const errors = createMemo(() => validate(clean(draft())))
  const overridden = createMemo(() => Object.keys(local()).length > 0)

  createEffect(() => {
    const current = scope()
    const next = local()
    const key = JSON.stringify(next)
    if (!shouldSync(selected(), current, dirty(), source(), key)) return
    setSelected(current)
    setSource(key)
    setDraft(clone(next))
    const extensions = project() ? merge(global(), next).fileExtensions : next.fileExtensions
    setExtensionText(extensions?.join(", ") ?? "")
    setDirty(false)
  })

  function field(path: string) {
    return ctx.data()?.overlay.fields[`indexing.${path}`]
  }

  function update(patch: IndexingConfig) {
    setDraft((current) => merge(current, patch))
    setDirty(true)
  }

  function text(key: keyof IndexingConfig, value: string) {
    update({ [key]: value || undefined })
  }

  function number(key: keyof IndexingConfig, value: string) {
    update({ [key]: value ? Number(value) : undefined })
  }

  function providerField(group: Provider, key: string, value: string) {
    update({ [group]: { ...options(draft(), group), [key]: value || undefined } })
  }

  function selectProvider(value: ProviderValue) {
    update(providerPatch(value, catalog()?.defaultModel))
  }

  function save() {
    const next = clean(draft())
    const unset = removed(local(), next)
    ctx.patch({ indexing: next }, unset.length ? unset : undefined)
    setDraft(next)
    setSource(JSON.stringify(next))
    setDirty(false)
  }

  function reset() {
    ctx.unset([["indexing"]])
    setDraft({})
    setSource("{}")
    setDirty(false)
  }

  return (
    <ConfigPage
      title="Code Indexing"
      description={
        project()
          ? "Configure semantic code search for this project. Unchanged values inherit from global settings."
          : "Configure semantic code search defaults for every project."
      }
      actions={
        <>
          <Show when={overridden()}>
            <Button variant="secondary" disabled={Boolean(ctx.saving())} onClick={reset}>
              {project() ? "Use global settings" : "Clear settings"}
            </Button>
          </Show>
          <Button variant="primary" disabled={Boolean(ctx.saving()) || !dirty() || errors().length > 0} onClick={save}>
            Save
          </Button>
        </>
      }
    >
      <div class="builder indexing-builder">
        <section class="builder-form agent-builder-stack">
          <Card class="ui-card agent-builder-card" padding={0}>
            <header class="ui-card-header">
              <div>
                <h2>Indexing</h2>
                <p>Build and maintain an embedding index used by semantic search.</p>
              </div>
              <Tag>{project() ? "Project" : "Global"}</Tag>
            </header>
            <div class="ui-form agent-builder-form">
              <Toggle
                label="Enable indexing"
                description={
                  project() && draft().enabled === undefined
                    ? `Inherited from global settings (${global().enabled ? "on" : "off"}).`
                    : "Scan source files and keep their semantic index up to date."
                }
                checked={view().enabled ?? false}
                disabled={Boolean(ctx.saving())}
                source={field("enabled")?.source}
                inherited={field("enabled")?.inherited}
                overridden={field("enabled")?.overridden}
                onChange={() => update({ enabled: !(view().enabled ?? false) })}
              />
            </div>
          </Card>

          <Card class="ui-card agent-builder-card" padding={0}>
            <header class="ui-card-header">
              <div>
                <h2>Embeddings</h2>
                <p>Select the provider and model used to turn code into searchable vectors.</p>
              </div>
            </header>
            <div class="ui-form agent-builder-form">
              <FieldCard
                label="Provider"
                description="Automatic uses Kilo when signed in, otherwise the provider runtime default."
                actions={
                  <SourceBadge
                    source={field("provider")?.source}
                    inherited={field("provider")?.inherited}
                    overridden={field("provider")?.overridden}
                  />
                }
              >
                <CustomSelect
                  class="indexing-select"
                  label="Embedding provider"
                  value={provider() ?? ""}
                  options={providers}
                  disabled={Boolean(ctx.saving())}
                  onSelect={selectProvider}
                />
              </FieldCard>

              <FieldCard
                label="Model"
                description={
                  provider() === "kilo"
                    ? "Select a Kilo-hosted embedding model."
                    : "Leave empty to use the provider's default embedding model."
                }
                actions={
                  <SourceBadge
                    source={field("model")?.source}
                    inherited={field("model")?.inherited}
                    overridden={field("model")?.overridden}
                  />
                }
              >
                <Show
                  when={provider() === "kilo"}
                  fallback={
                    <input
                      value={view().model ?? ""}
                      placeholder="Provider default"
                      disabled={Boolean(ctx.saving())}
                      onInput={(event) => text("model", event.currentTarget.value)}
                    />
                  }
                >
                  <CustomSelect
                    class="indexing-select"
                    label="Kilo embedding model"
                    value={kiloModel()}
                    options={kiloModels()}
                    disabled={Boolean(ctx.saving()) || !catalog()?.models.length}
                    onSelect={(value) => update({ model: value, dimension: undefined })}
                  />
                </Show>
              </FieldCard>

              <FieldCard
                label="Vector dimension"
                description="Leave empty to derive the dimension from known model metadata."
                actions={
                  <SourceBadge
                    source={field("dimension")?.source}
                    inherited={field("dimension")?.inherited}
                    overridden={field("dimension")?.overridden}
                  />
                }
              >
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={view().dimension ?? ""}
                  placeholder="Auto-detect"
                  disabled={Boolean(ctx.saving()) || provider() === "kilo"}
                  onInput={(event) => number("dimension", event.currentTarget.value)}
                />
              </FieldCard>

              <Show when={provider() === "kilo"}>
                <div class="indexing-note">
                  Kilo embeddings use the account currently signed in to this Kilo server. Model dimensions are supplied
                  by the catalog.
                </div>
              </Show>

              <Show when={provider()} keyed>
                {(group) => (
                  <For each={fields[group]}>
                    {(item) => {
                      const meta = () => field(`${group}.${item.key}`)
                      return (
                        <FieldCard
                          label={item.label}
                          description="Provider-specific connection setting."
                          actions={
                            <SourceBadge
                              source={meta()?.source}
                              inherited={meta()?.inherited}
                              overridden={meta()?.overridden}
                            />
                          }
                        >
                          <input
                            type={item.secret ? "password" : "text"}
                            value={options(view(), group)[item.key] ?? ""}
                            placeholder={item.placeholder}
                            spellcheck={false}
                            disabled={Boolean(ctx.saving())}
                            onInput={(event) => providerField(group, item.key, event.currentTarget.value)}
                          />
                        </FieldCard>
                      )
                    }}
                  </For>
                )}
              </Show>
            </div>
          </Card>

          <Card class="ui-card agent-builder-card" padding={0}>
            <header class="ui-card-header">
              <div>
                <h2>Vector Store</h2>
                <p>Choose where indexed embeddings and metadata are stored.</p>
              </div>
            </header>
            <div class="ui-form agent-builder-form">
              <FieldCard
                label="Backend"
                description="LanceDB stores vectors locally by default. Qdrant connects to an external service."
                actions={
                  <SourceBadge
                    source={field("vectorStore")?.source}
                    inherited={field("vectorStore")?.inherited}
                    overridden={field("vectorStore")?.overridden}
                  />
                }
              >
                <CustomSelect
                  class="indexing-select"
                  label="Vector store"
                  value={store()}
                  options={stores}
                  disabled={Boolean(ctx.saving())}
                  onSelect={(value) => update({ vectorStore: value })}
                />
              </FieldCard>

              <Show
                when={store() === "qdrant"}
                fallback={
                  <FieldCard
                    label="LanceDB directory"
                    description="Optional directory for local LanceDB storage."
                    actions={
                      <SourceBadge
                        source={field("lancedb.directory")?.source}
                        inherited={field("lancedb.directory")?.inherited}
                        overridden={field("lancedb.directory")?.overridden}
                      />
                    }
                  >
                    <input
                      value={view().lancedb?.directory ?? ""}
                      placeholder="Default Kilo state directory"
                      disabled={Boolean(ctx.saving())}
                      onInput={(event) =>
                        update({ lancedb: { ...draft().lancedb, directory: event.currentTarget.value || undefined } })
                      }
                    />
                  </FieldCard>
                }
              >
                <FieldCard
                  label="Qdrant URL"
                  description="Server URL for the Qdrant instance."
                  actions={
                    <SourceBadge
                      source={field("qdrant.url")?.source}
                      inherited={field("qdrant.url")?.inherited}
                      overridden={field("qdrant.url")?.overridden}
                    />
                  }
                >
                  <input
                    value={view().qdrant?.url ?? ""}
                    placeholder="http://localhost:6333"
                    disabled={Boolean(ctx.saving())}
                    onInput={(event) =>
                      update({ qdrant: { ...draft().qdrant, url: event.currentTarget.value || undefined } })
                    }
                  />
                </FieldCard>
                <FieldCard
                  label="Qdrant API key"
                  description="Optional API key for authenticated Qdrant instances."
                  actions={
                    <SourceBadge
                      source={field("qdrant.apiKey")?.source}
                      inherited={field("qdrant.apiKey")?.inherited}
                      overridden={field("qdrant.apiKey")?.overridden}
                    />
                  }
                >
                  <input
                    type="password"
                    value={view().qdrant?.apiKey ?? ""}
                    placeholder="Optional API key"
                    disabled={Boolean(ctx.saving())}
                    onInput={(event) =>
                      update({ qdrant: { ...draft().qdrant, apiKey: event.currentTarget.value || undefined } })
                    }
                  />
                </FieldCard>
              </Show>
            </div>
          </Card>

          <Card class="ui-card agent-builder-card" padding={0}>
            <header class="ui-card-header">
              <div>
                <h2>Search and Scanning</h2>
                <p>Tune result filtering, batching, and retries.</p>
              </div>
            </header>
            <div class="ui-form agent-builder-form">
              <FieldCard
                label="File extensions"
                description="Comma-separated allowlist. Leave empty to use the built-in defaults."
                actions={
                  <SourceBadge
                    source={field("fileExtensions")?.source}
                    inherited={field("fileExtensions")?.inherited}
                    overridden={field("fileExtensions")?.overridden}
                  />
                }
              >
                <input
                  value={extensionText()}
                  placeholder=".php, .js, .css"
                  disabled={Boolean(ctx.saving())}
                  onInput={(event) => {
                    const value = event.currentTarget.value
                    setExtensionText(value)
                    update({ fileExtensions: parseFileExtensions(value) })
                  }}
                />
              </FieldCard>
              <FieldCard
                label="Minimum search score"
                description="Similarity threshold from 0 to 1. Default is model-specific or 0.4."
              >
                <input
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  value={view().searchMinScore ?? ""}
                  placeholder="0.4"
                  disabled={Boolean(ctx.saving())}
                  onInput={(event) => number("searchMinScore", event.currentTarget.value)}
                />
              </FieldCard>
              <FieldCard
                label="Maximum search results"
                description="Maximum number of semantic matches returned per search."
              >
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={view().searchMaxResults ?? ""}
                  placeholder="50"
                  disabled={Boolean(ctx.saving())}
                  onInput={(event) => number("searchMaxResults", event.currentTarget.value)}
                />
              </FieldCard>
              <FieldCard
                label="Embedding batch size"
                description="Number of code segments sent in each embedding batch."
              >
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={view().embeddingBatchSize ?? ""}
                  placeholder="60"
                  disabled={Boolean(ctx.saving())}
                  onInput={(event) => number("embeddingBatchSize", event.currentTarget.value)}
                />
              </FieldCard>
              <FieldCard label="Scanner retry limit" description="Maximum retry attempts for a failed embedding batch.">
                <input
                  type="number"
                  min="1"
                  step="1"
                  value={view().scannerMaxBatchRetries ?? ""}
                  placeholder="3"
                  disabled={Boolean(ctx.saving())}
                  onInput={(event) => number("scannerMaxBatchRetries", event.currentTarget.value)}
                />
              </FieldCard>
            </div>
            <Show when={errors().length > 0}>
              <footer class="indexing-errors">
                <For each={errors()}>{(error) => <span>{error}</span>}</For>
              </footer>
            </Show>
          </Card>
        </section>
      </div>
    </ConfigPage>
  )
}
