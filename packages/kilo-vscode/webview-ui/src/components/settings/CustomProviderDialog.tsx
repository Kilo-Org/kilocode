import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage, ProviderConfig } from "../../types/messages"
import { createProviderAction } from "../../utils/provider-action"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"
const DEBOUNCE_MS = 500
const SEARCH_DEBOUNCE_MS = 150

/** Subsequence fuzzy match — "gpt4o" matches "gpt-4o-mini". */
function fuzzy(query: string, target: string) {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

type Translator = ReturnType<typeof useLanguage>["t"]

type ModelRow = {
  id: string
  name: string
}

type HeaderRow = {
  key: string
  value: string
}

type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelRow[]
  headers: HeaderRow[]
  saving: boolean
}

type FormErrors = {
  providerID: string | undefined
  name: string | undefined
  baseURL: string | undefined
  models: Array<{ id?: string; name?: string }>
  headers: Array<{ key?: string; value?: string }>
}

type FetchedModel = { id: string; name: string }

type ValidateArgs = {
  form: FormState
  t: Translator
  editing: boolean
  disabledProviders: string[]
  existingProviderIDs: Set<string>
  /** Preserved env vars from the existing provider config (edit mode only) */
  existingEnv?: string[]
}

function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  // When editing and apiKey is empty, preserve existing env from the original config
  const existingEnv = input.editing && !apiKey ? input.existingEnv : undefined
  const key = apiKey && !env ? apiKey : undefined

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(providerID)
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.editing
      ? undefined
      : input.existingProviderIDs.has(providerID) && !disabled
        ? input.t("provider.custom.error.providerID.exists")
        : undefined

  const seenModels = new Set<string>()
  const modelErrors = input.form.models.map((m) => {
    const id = m.id.trim()
    const modelIdError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
    const modelNameError = !m.name.trim() ? input.t("provider.custom.error.required") : undefined
    return { id: modelIdError, name: modelNameError }
  })
  const modelsValid = modelErrors.every((m) => !m.id && !m.name)
  const models = Object.fromEntries(input.form.models.map((m) => [m.id.trim(), { name: m.name.trim() }]))

  const seenHeaders = new Set<string>()
  const headerErrors = input.form.headers.map((h) => {
    const key = h.key.trim()
    const value = h.value.trim()

    if (!key && !value) return {}
    const keyError = !key
      ? input.t("provider.custom.error.required")
      : seenHeaders.has(key.toLowerCase())
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenHeaders.add(key.toLowerCase())
            return undefined
          })()
    const valueError = !value ? input.t("provider.custom.error.required") : undefined
    return { key: keyError, value: valueError }
  })
  const headersValid = headerErrors.every((h) => !h.key && !h.value)
  const headers = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

  const errors: FormErrors = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: urlError,
    models: modelErrors,
    headers: headerErrors,
  }

  const ok = !idError && !existsError && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { errors }

  const options = {
    baseURL,
    ...(Object.keys(headers).length ? { headers } : {}),
  }

  return {
    errors,
    result: {
      providerID,
      name,
      key,
      config: {
        npm: OPENAI_COMPATIBLE,
        name,
        ...(env ? { env: [env] } : existingEnv ? { env: existingEnv } : {}),
        options,
        models,
      },
    },
  }
}

export interface CustomProviderDialogProps {
  onBack?: () => void
  /** When set, the dialog opens in edit mode with pre-filled values. */
  existing?: {
    providerID: string
    name: string
    config: ProviderConfig
  }
}

const CustomProviderDialog = (props: CustomProviderDialogProps) => {
  const dialog = useDialog()
  const { config } = useConfig()
  const provider = useProvider()
  const language = useLanguage()
  const vscode = useVSCode()
  const action = createProviderAction(vscode)
  onCleanup(action.dispose)

  const editing = () => !!props.existing

  function initModels(): ModelRow[] {
    const cfg = props.existing?.config
    if (!cfg?.models || typeof cfg.models !== "object") return [{ id: "", name: "" }]
    const entries = Object.entries(cfg.models)
    if (entries.length === 0) return [{ id: "", name: "" }]
    return entries.map(([id, m]) => ({ id, name: (m as { name?: string })?.name ?? id }))
  }

  function initHeaders(): HeaderRow[] {
    const opts = props.existing?.config?.options as { headers?: Record<string, string> } | undefined
    const headers = opts?.headers
    if (!headers || typeof headers !== "object") return [{ key: "", value: "" }]
    const entries = Object.entries(headers)
    if (entries.length === 0) return [{ key: "", value: "" }]
    return entries.map(([key, value]) => ({ key, value }))
  }

  const [form, setForm] = createStore<FormState>({
    providerID: props.existing?.providerID ?? "",
    name: props.existing?.name ?? "",
    baseURL: (props.existing?.config?.options as { baseURL?: string } | undefined)?.baseURL ?? "",
    apiKey: "",
    models: initModels(),
    headers: initHeaders(),
    saving: false,
  })

  const [errors, setErrors] = createStore<FormErrors>({
    providerID: undefined,
    name: undefined,
    baseURL: undefined,
    models: form.models.map(() => ({})),
    headers: form.headers.map(() => ({})),
  })

  // ── Fetch models state ──────────────────────────────────────────────

  const [fetching, setFetching] = createSignal(false)
  const [fetchError, setFetchError] = createSignal<string>()
  const [fetchedModels, setFetchedModels] = createSignal<FetchedModel[]>()
  const [selected, setSelected] = createSignal<Set<string>>(new Set())
  const [fetchStatus, setFetchStatus] = createSignal<string>()

  // Search within fetched models
  const [search, setSearch] = createSignal("")
  const [debouncedSearch, setDebouncedSearch] = createSignal("")

  createEffect(() => {
    const q = search()
    const timer = setTimeout(() => setDebouncedSearch(q), SEARCH_DEBOUNCE_MS)
    onCleanup(() => clearTimeout(timer))
  })

  const filtered = createMemo(() => {
    const models = fetchedModels()
    if (!models) return []
    const q = debouncedSearch()
    if (!q) return models
    return models.filter((m) => fuzzy(q, m.id) || fuzzy(q, m.name))
  })

  // ── Auto-fetch on debounce ──────────────────────────────────────────

  // Dedicated signals for the URL and API key drive the auto-fetch effect.
  // We avoid reading form.baseURL / form.apiKey inside createEffect because
  // SolidJS store proxies track at the property level — any store write
  // (including setForm("models", ...)) invalidates effects that read from
  // the same store, causing unwanted re-runs that wipe the model picker.
  const [fetchURL, setFetchURL] = createSignal(form.baseURL)
  const [fetchKey, setFetchKey] = createSignal(form.apiKey)
  let fetchVersion = 0

  createEffect(() => {
    const url = fetchURL()
    const key = fetchKey()
    void key // subscribe to key changes without using the value here

    // Clear previous results whenever URL or key changes
    setFetchedModels(undefined)
    setFetchError(undefined)
    setFetchStatus(undefined)
    setSearch("")

    if (!/^https?:\/\//.test(url.trim())) return

    fetchVersion++
    const version = fetchVersion
    const timer = setTimeout(() => {
      if (version === fetchVersion) doFetch()
    }, DEBOUNCE_MS)
    onCleanup(() => clearTimeout(timer))
  })

  // ── Core fetch logic ────────────────────────────────────────────────

  function doFetch() {
    // Snapshot all values from signals/store before entering async.
    // This avoids reading the store proxy inside callbacks, which could
    // subscribe to unrelated store properties and cause re-render loops.
    const url = fetchURL().trim()
    const raw = fetchKey().trim()
    const env = raw.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
    const apiKey = raw && !env ? raw : undefined
    const existing = new Set(form.models.map((m) => m.id.trim()).filter(Boolean))

    const hdrs = form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
    const headers = hdrs.length > 0 ? Object.fromEntries(hdrs.map((h) => [h.key, h.value])) : undefined

    // Bump version so any in-flight response from a previous fetch is ignored
    fetchVersion++
    const version = fetchVersion

    setFetching(true)
    setFetchError(undefined)
    setFetchedModels(undefined)
    setFetchStatus(undefined)
    setSearch("")

    const rid = crypto.randomUUID()

    const unsub = vscode.onMessage((msg: ExtensionMessage) => {
      if (msg.type !== "customProviderModelsFetched") return
      if (!("requestId" in msg) || msg.requestId !== rid) return
      unsub()

      // Stale response — a newer fetch was triggered while this one was in-flight
      if (version !== fetchVersion) return

      setFetching(false)

      if (msg.error) {
        setFetchError(msg.auth ? language.t("provider.custom.models.fetch.authError") : msg.error)
        return
      }

      const models = msg.models ?? []
      if (models.length === 0) {
        setFetchError(language.t("provider.custom.models.fetch.empty"))
        return
      }

      // Filter using the snapshot taken at fetch time
      const fresh = models.filter((m) => !existing.has(m.id))

      if (fresh.length === 0) {
        setFetchStatus(language.t("provider.custom.models.fetch.allExist"))
        return
      }

      // Pre-select all and show the picker
      setSelected(new Set(fresh.map((m) => m.id)))
      setFetchedModels(fresh)
    })

    vscode.postMessage({
      type: "fetchCustomProviderModels",
      requestId: rid,
      baseURL: url,
      apiKey,
      headers,
    })
  }

  // ── Model picker actions ────────────────────────────────────────────

  function toggleModel(id: string) {
    const next = new Set(selected())
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  function selectAll() {
    const next = new Set(selected())
    for (const m of filtered()) next.add(m.id)
    setSelected(next)
  }

  function deselectAll() {
    const next = new Set(selected())
    for (const m of filtered()) next.delete(m.id)
    setSelected(next)
  }

  function count() {
    return selected().size
  }

  function addSelected() {
    const models = fetchedModels()
    if (!models) return
    const sel = selected()
    const picked = models.filter((m) => sel.has(m.id))
    if (picked.length === 0) return

    // Replace the single empty row or append
    const empty = form.models.length === 1 && !form.models[0].id.trim() && !form.models[0].name.trim()
    const merged = empty ? picked : [...form.models, ...picked]

    setForm("models", merged)
    setErrors(
      "models",
      merged.map(() => ({})),
    )
    setFetchStatus(language.t("provider.custom.models.fetch.added", { count: String(picked.length) }))
    setFetchedModels(undefined)
    setSearch("")
  }

  function cancelFetch() {
    setFetchedModels(undefined)
    setSearch("")
  }

  // ── Form helpers ────────────────────────────────────────────────────

  function goBack() {
    if (props.onBack) {
      props.onBack()
      return
    }
    dialog.close()
  }

  function addModel() {
    setForm("models", (v) => [...v, { id: "", name: "" }])
    setErrors("models", (v) => [...v, {}])
  }

  function removeModel(index: number) {
    if (form.models.length <= 1) return
    setForm("models", (v) => v.filter((_, i) => i !== index))
    setErrors("models", (v) => v.filter((_, i) => i !== index))
  }

  function addHeader() {
    setForm("headers", (v) => [...v, { key: "", value: "" }])
    setErrors("headers", (v) => [...v, {}])
  }

  function removeHeader(index: number) {
    if (form.headers.length <= 1) return
    setForm("headers", (v) => v.filter((_, i) => i !== index))
    setErrors("headers", (v) => v.filter((_, i) => i !== index))
  }

  function validate() {
    const output = validateCustomProvider({
      form,
      t: language.t,
      editing: editing(),
      disabledProviders: config().disabled_providers ?? [],
      existingProviderIDs: new Set(Object.keys(provider.providers())),
      existingEnv: props.existing?.config?.env,
    })
    setErrors(output.errors)
    return output.result
  }

  function save(e: SubmitEvent) {
    e.preventDefault()
    if (form.saving) return

    const result = validate()
    if (!result) return

    setForm("saving", true)

    action.send(
      {
        type: "saveCustomProvider",
        providerID: result.providerID,
        config: result.config,
        apiKey: result.key,
      },
      {
        onConnected: () => {
          setForm("saving", false)
          dialog.close()
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
            description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
          })
        },
        onError: (message) => {
          setForm("saving", false)
          showToast({ title: language.t("common.requestFailed"), description: message.message })
        },
      },
    )
  }

  // ── Render ──────────────────────────────────────────────────────────

  return (
    <Dialog
      title={
        <IconButton
          tabIndex={-1}
          icon="arrow-left"
          variant="ghost"
          onClick={goBack}
          aria-label={language.t("common.goBack")}
        />
      }
      transition
    >
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "24px",
          padding: "0 10px 12px 10px",
          "overflow-y": "auto",
          "max-height": "60vh",
        }}
      >
        <div style={{ padding: "0 10px", display: "flex", gap: "16px", "align-items": "center" }}>
          <ProviderIcon id="synthetic" width={20} height={20} />
          <div style={{ "font-size": "16px", "font-weight": "500", color: "var(--vscode-foreground)" }}>
            {editing() ? language.t("provider.custom.edit.title") : language.t("provider.custom.title")}
          </div>
        </div>

        <form
          onSubmit={save}
          style={{ padding: "0 10px 24px 10px", display: "flex", "flex-direction": "column", gap: "24px" }}
        >
          <div style={{ "font-size": "14px", color: "var(--text-base)" }}>
            {language.t("provider.custom.description.prefix")}
            <a
              href="https://kilo.ai/docs/providers/#custom-provider"
              onClick={(e) => {
                e.preventDefault()
                vscode.postMessage({
                  type: "openExternal",
                  url: "https://kilo.ai/docs/providers/#custom-provider",
                })
              }}
            >
              {language.t("provider.custom.description.link")}
            </a>
            {language.t("provider.custom.description.suffix")}
          </div>

          <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
            <TextField
              autofocus={!editing()}
              label={language.t("provider.custom.field.providerID.label")}
              placeholder={language.t("provider.custom.field.providerID.placeholder")}
              description={language.t("provider.custom.field.providerID.description")}
              value={form.providerID}
              onChange={(v) => setForm("providerID", v)}
              validationState={errors.providerID ? "invalid" : undefined}
              error={errors.providerID}
              disabled={editing()}
            />
            <TextField
              label={language.t("provider.custom.field.name.label")}
              placeholder={language.t("provider.custom.field.name.placeholder")}
              value={form.name}
              onChange={(v) => setForm("name", v)}
              validationState={errors.name ? "invalid" : undefined}
              error={errors.name}
            />
            <TextField
              label={language.t("provider.custom.field.baseURL.label")}
              placeholder={language.t("provider.custom.field.baseURL.placeholder")}
              value={form.baseURL}
              onChange={(v) => {
                setForm("baseURL", v)
                setFetchURL(v)
              }}
              validationState={errors.baseURL ? "invalid" : undefined}
              error={errors.baseURL}
            />
            <TextField
              type="password"
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={language.t("provider.custom.field.apiKey.placeholder")}
              description={language.t("provider.custom.field.apiKey.description")}
              value={form.apiKey}
              onChange={(v) => {
                setForm("apiKey", v)
                setFetchKey(v)
              }}
            />
          </div>

          {/* Models */}
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
              <label style={{ "font-size": "12px", "font-weight": "500", color: "var(--text-weak-base)" }}>
                {language.t("provider.custom.models.label")}
              </label>
              <Show when={fetching()}>
                <Spinner style={{ width: "12px", height: "12px" }} />
              </Show>
            </div>
            <For each={form.models}>
              {(m, i) => (
                <div style={{ display: "flex", gap: "8px", "align-items": "start" }}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("provider.custom.models.id.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.id.placeholder")}
                      value={m.id}
                      onChange={(v) => setForm("models", i(), "id", v)}
                      validationState={errors.models[i()]?.id ? "invalid" : undefined}
                      error={errors.models[i()]?.id}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("provider.custom.models.name.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.name.placeholder")}
                      value={m.name}
                      onChange={(v) => setForm("models", i(), "name", v)}
                      validationState={errors.models[i()]?.name ? "invalid" : undefined}
                      error={errors.models[i()]?.name}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    onClick={() => removeModel(i())}
                    disabled={form.models.length <= 1}
                    aria-label={language.t("provider.custom.models.remove")}
                    style={{ "margin-top": "6px" }}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel}>
              {language.t("provider.custom.models.add")}
            </Button>

            {/* Fetch error */}
            <Show when={fetchError()}>
              {(err) => (
                <span style={{ "font-size": "12px", color: "var(--vscode-errorForeground, #f14c4c)" }}>{err()}</span>
              )}
            </Show>

            {/* Fetch status (success/info messages) */}
            <Show when={!fetchError() && fetchStatus()}>
              {(status) => (
                <span
                  style={{
                    "font-size": "12px",
                    color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                  }}
                >
                  {status()}
                </span>
              )}
            </Show>

            {/* Model selection picker */}
            <Show when={fetchedModels()}>
              {(models) => (
                <div
                  style={{
                    border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
                    "border-radius": "6px",
                    padding: "12px",
                    display: "flex",
                    "flex-direction": "column",
                    gap: "8px",
                  }}
                >
                  {/* Header with count + toggle */}
                  <div
                    style={{
                      display: "flex",
                      "justify-content": "space-between",
                      "align-items": "center",
                    }}
                  >
                    <span style={{ "font-size": "12px", "font-weight": "500", color: "var(--text-weak-base)" }}>
                      <Show
                        when={debouncedSearch()}
                        fallback={language.t("provider.custom.models.fetch.found", {
                          count: String(models().length),
                        })}
                      >
                        {language.t("provider.custom.models.fetch.showing", {
                          shown: String(filtered().length),
                          total: String(models().length),
                        })}
                      </Show>
                    </span>
                    <div style={{ display: "flex", gap: "8px" }}>
                      <Button type="button" size="small" variant="ghost" onClick={selectAll}>
                        {language.t("provider.custom.models.fetch.selectAll")}
                      </Button>
                      <Button type="button" size="small" variant="ghost" onClick={deselectAll}>
                        {language.t("provider.custom.models.fetch.deselectAll")}
                      </Button>
                    </div>
                  </div>

                  {/* Search */}
                  <Show when={models().length > 10}>
                    <TextField
                      label={language.t("provider.custom.models.fetch.search")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.fetch.search")}
                      value={search()}
                      onChange={setSearch}
                    />
                  </Show>

                  {/* Model list */}
                  <div
                    style={{
                      "max-height": "200px",
                      "overflow-y": "auto",
                      display: "flex",
                      "flex-direction": "column",
                      gap: "2px",
                    }}
                  >
                    <For each={filtered()}>
                      {(m) => (
                        <label
                          style={{
                            display: "flex",
                            "align-items": "center",
                            gap: "8px",
                            padding: "4px 2px",
                            cursor: "pointer",
                            "font-size": "13px",
                            color: "var(--text-base, var(--vscode-foreground))",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected().has(m.id)}
                            onChange={() => toggleModel(m.id)}
                            style={{ cursor: "pointer" }}
                          />
                          {m.id}
                        </label>
                      )}
                    </For>
                  </div>

                  {/* Actions */}
                  <div style={{ display: "flex", gap: "8px", "margin-top": "4px" }}>
                    <Button type="button" size="small" variant="primary" onClick={addSelected} disabled={count() === 0}>
                      {language.t("provider.custom.models.fetch.add", { count: String(count()) })}
                    </Button>
                    <Button type="button" size="small" variant="ghost" onClick={cancelFetch}>
                      {language.t("common.cancel")}
                    </Button>
                  </div>
                </div>
              )}
            </Show>
          </div>

          {/* Headers */}
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <label style={{ "font-size": "12px", "font-weight": "500", color: "var(--text-weak-base)" }}>
              {language.t("provider.custom.headers.label")}
            </label>
            <For each={form.headers}>
              {(h, i) => (
                <div style={{ display: "flex", gap: "8px", "align-items": "start" }}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("provider.custom.headers.key.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.key.placeholder")}
                      value={h.key}
                      onChange={(v) => setForm("headers", i(), "key", v)}
                      validationState={errors.headers[i()]?.key ? "invalid" : undefined}
                      error={errors.headers[i()]?.key}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("provider.custom.headers.value.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.value.placeholder")}
                      value={h.value}
                      onChange={(v) => setForm("headers", i(), "value", v)}
                      validationState={errors.headers[i()]?.value ? "invalid" : undefined}
                      error={errors.headers[i()]?.value}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    onClick={() => removeHeader(i())}
                    disabled={form.headers.length <= 1}
                    aria-label={language.t("provider.custom.headers.remove")}
                    style={{ "margin-top": "6px" }}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addHeader}>
              {language.t("provider.custom.headers.add")}
            </Button>
          </div>

          <Button type="submit" size="large" variant="primary" disabled={form.saving}>
            {form.saving ? language.t("common.saving") : language.t("common.submit")}
          </Button>
        </form>
      </div>
    </Dialog>
  )
}

export default CustomProviderDialog
