// The custom provider dialog: provider ID, name, package, base URL, API key, models and headers. The config draft
// goes through `useSettingsConfig` (the host owns the file) and the key is a v2 credential (`settings.connectKey`),
// because the config provider registers a key method for every configured provider. Fetch models asks the host to
// list the base URL's models (`fetchCustomProviderModels`), so a stored key never reaches the webview.
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Select } from "@kilocode/kilo-ui/select"
import { Spinner } from "@kilocode/kilo-ui/spinner"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { For, Show, createEffect, createMemo, createSignal, on, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "../../context/language"
import { getVSCodeAPI, useVSCode } from "../../context/vscode"
import type { ToHost, ToWebview } from "../../../../src/protocol"
import type { SettingsData } from "../../v2/settings"
import { useSettingsConfig, type SettingsScope } from "../../v2/settings-config"
import { ModelCard } from "./CustomProviderModelCard"
import {
  MASKED_CUSTOM_PROVIDER_KEY,
  addFetchedModels,
  canFetchModels,
  createFetchGate,
  emptyModel,
  fetchKey,
  freshModels,
  initApiKey,
  initBaseURL,
  initHeaders,
  initModels,
  keyChanged,
  mergeProviderConfig,
  repairFromRaw,
  unmaskKey,
  validateCustomProvider,
  type CustomProviderConfigValue,
  type FetchedModel,
  type RawRepairFields,
} from "./CustomProviderValidation"
import {
  CUSTOM_PROVIDER_PACKAGE,
  CUSTOM_PROVIDER_PACKAGES,
  disabledProviderIds,
  enableProviderInConfig,
  isCustomProviderPackage,
  type CustomProviderPackage,
} from "./provider-visibility"
import { credentials } from "./provider-catalog"

export { MASKED_CUSTOM_PROVIDER_KEY }

const DEBOUNCE_MS = 500
const SEARCH_DEBOUNCE_MS = 150

const PACKAGE_OPTIONS: Array<{ value: CustomProviderPackage; label: string }> = [
  { value: CUSTOM_PROVIDER_PACKAGES[0], label: "OpenAI Compatible" },
  { value: CUSTOM_PROVIDER_PACKAGES[1], label: "OpenAI Responses" },
  { value: CUSTOM_PROVIDER_PACKAGES[2], label: "Anthropic Messages" },
]

/** Subsequence fuzzy match: "gpt4o" matches "gpt-4o-mini". */
function fuzzy(query: string, target: string) {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  let qi = 0
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++
  }
  return qi === q.length
}

export interface CustomProviderDialogProps {
  settings: SettingsData
  onBack?: () => void
  /** When set, the dialog opens in edit mode with pre-filled values. */
  existing?: { providerID: string; name: string; config: CustomProviderConfigValue }
}

const CustomProviderDialog = (props: CustomProviderDialogProps) => {
  const dialog = useDialog()
  const config = useSettingsConfig()
  const language = useLanguage()
  const vscode = useVSCode()

  /**
   * The provider's value in the config file that owns it. It keeps `{env:NAME}` and `{file:...}` references, which
   * the server's merged config has already substituted, so a save never writes a resolved secret into the file. The
   * merged value is the fallback, for example for the legacy `provider.<id>` spelling.
   */
  function rawProvider(providerID: string): unknown {
    const source = config.source(["providers", providerID])
    const scopes: SettingsScope[] = source === "global" ? ["global", "project"] : ["project", "global"]
    return scopes
      .map((scope) => {
        const providers = config.raw(scope).providers
        return providers && typeof providers === "object" ? (providers as Record<string, unknown>)[providerID] : undefined
      })
      .find((value) => value && typeof value === "object" && !Array.isArray(value))
  }

  function storedConfig(providerID: string): unknown {
    return rawProvider(providerID) ?? config.value(["providers", providerID])
  }

  const editing = () => !!props.existing
  const existingKey = () => {
    const integration = props.existing ? props.settings.integration(props.existing.providerID) : undefined
    if (!integration) return false
    return credentials(integration).some((credential) => credential.method === "key")
  }

  function nameOf(value: unknown, fallback: string | undefined) {
    const name = (value as { name?: unknown } | undefined)?.name
    return typeof name === "string" && name.trim() ? name : (fallback ?? "")
  }

  function packageOf(value: unknown): CustomProviderPackage {
    const pkg = (value as { package?: unknown } | undefined)?.package
    return isCustomProviderPackage(pkg) ? pkg : CUSTOM_PROVIDER_PACKAGE
  }

  /** The env vars of the provider's config, kept when an untouched key field is saved. */
  function existingEnv(): string[] | undefined {
    if (!props.existing) return
    const env = (storedConfig(props.existing.providerID) as { env?: unknown } | undefined)?.env
    return Array.isArray(env) ? env.filter((item): item is string => typeof item === "string") : undefined
  }

  const initial = props.existing ? (storedConfig(props.existing.providerID) ?? props.existing.config) : undefined

  const [form, setForm] = createStore({
    providerID: props.existing?.providerID ?? "",
    name: nameOf(initial, props.existing?.name),
    package: packageOf(initial),
    baseURL: initBaseURL(initial),
    apiKey: props.existing ? initApiKey(initial, existingKey()) : "",
    models: initModels(initial),
    headers: initHeaders(initial),
    saving: false,
  })

  const [errors, setErrors] = createStore<{
    providerID: string | undefined
    name: string | undefined
    baseURL: string | undefined
    models: Array<{ id?: string; name?: string }>
    headers: Array<{ key?: string; value?: string }>
  }>({
    providerID: undefined,
    name: undefined,
    baseURL: undefined,
    models: form.models.map(() => ({})),
    headers: form.headers.map(() => ({})),
  })

  let apiTouched = false

  // ── Fetch models state ──────────────────────────────────────────────

  const [fetching, setFetching] = createSignal(false)
  const [fetchError, setFetchError] = createSignal<string>()
  const [fetchedModels, setFetchedModels] = createSignal<FetchedModel[]>()
  const [selected, setSelected] = createSignal<Set<string>>(new Set())
  const [fetchStatus, setFetchStatus] = createSignal<string>()

  const [search, setSearch] = createSignal("")
  const [debouncedSearch, setDebouncedSearch] = createSignal("")

  createEffect(() => {
    const query = search()
    const timer = setTimeout(() => setDebouncedSearch(query), SEARCH_DEBOUNCE_MS)
    onCleanup(() => clearTimeout(timer))
  })

  const filtered = createMemo(() => {
    const models = fetchedModels()
    if (!models) return []
    const query = debouncedSearch()
    if (!query) return models
    return models.filter((model) => fuzzy(query, model.id) || fuzzy(query, model.name))
  })

  // Dedicated signals drive the auto-fetch. An effect that read the form store would also rerun on unrelated store
  // writes, such as an added model row, and clear the picker.
  const [fetchPackage, setFetchPackage] = createSignal(form.package)
  const [fetchURL, setFetchURL] = createSignal(form.baseURL)
  const [fetchKeyValue, setFetchKeyValue] = createSignal(form.apiKey)
  const gate = createFetchGate()
  let unsubscribe: (() => void) | undefined
  onCleanup(() => unsubscribe?.())

  function clearFetch() {
    unsubscribe?.()
    unsubscribe = undefined
    setFetching(false)
    setFetchedModels(undefined)
    setFetchError(undefined)
    setFetchStatus(undefined)
    setSearch("")
  }

  createEffect(() => {
    const pkg = fetchPackage()
    const url = fetchURL()
    fetchKeyValue()
    // A change of the URL, key or package drops the shown result and any reply still in flight, manual ones included.
    gate.next()
    clearFetch()
    if (!canFetchModels(pkg, url)) return
    const token = gate.next()
    const timer = setTimeout(() => {
      if (gate.current(token)) doFetch()
    }, DEBOUNCE_MS)
    onCleanup(() => clearTimeout(timer))
  })

  // `config.raw` is empty until the host's configRead reply lands. A dialog opened before that starts from the merged
  // config, where `{env:...}` is already substituted; re-read the raw value as soon as it arrives so Submit cannot
  // write the resolved secret back. Fields edited in that window keep their value. `on` runs its callback once on the
  // initial effect run, hence `defer` and the value guard: only a real value may end the repair.
  const initialFields: RawRepairFields = {
    name: form.name,
    package: form.package,
    baseURL: form.baseURL,
    apiKey: form.apiKey,
    models: form.models.map((model) => ({ ...model })),
    headers: form.headers.map((header) => ({ ...header })),
  }
  const rawValue = createMemo(() => (props.existing ? rawProvider(props.existing.providerID) : undefined))
  let fromRaw = !props.existing || rawValue() !== undefined

  createEffect(
    on(
      rawValue,
      (value) => {
        if (!props.existing || fromRaw || !value) return
        fromRaw = true
        const patch = repairFromRaw({
          current: {
            name: form.name,
            package: form.package,
            baseURL: form.baseURL,
            apiKey: form.apiKey,
            models: form.models.map((model) => ({ ...model })),
            headers: form.headers.map((header) => ({ ...header })),
          },
          initial: initialFields,
          raw: {
            name: nameOf(value, props.existing.name),
            package: packageOf(value),
            baseURL: initBaseURL(value),
            apiKey: initApiKey(value, existingKey()),
            models: initModels(value),
            headers: initHeaders(value),
          },
          apiKeyTouched: apiTouched,
        })
        if (Object.keys(patch).length === 0) return
        setForm(patch)
        if (patch.models) setErrors("models", patch.models.map(() => ({})))
        if (patch.headers) setErrors("headers", patch.headers.map(() => ({})))
        // The auto-fetch reads these signals, so a repaired URL or key restarts it.
        setFetchPackage(patch.package ?? form.package)
        setFetchURL(patch.baseURL ?? form.baseURL)
        setFetchKeyValue(patch.apiKey ?? form.apiKey)
      },
      { defer: true },
    ),
  )

  function doFetch() {
    // Read every value before the request, so the reply handler does not subscribe to the store.
    const url = fetchURL().trim()
    const key = fetchKey({ apiKey: form.apiKey, touched: apiTouched, providerID: props.existing?.providerID })
    const rows = form.headers
      .map((header) => ({ key: header.key.trim(), value: header.value.trim() }))
      .filter((header) => header.key && header.value)
    const headers = rows.length ? Object.fromEntries(rows.map((header) => [header.key, header.value])) : undefined
    const models = form.models.map((model) => ({ ...model }))
    // The host resolves `{file:...}` from the config file of this scope; the dialog never sends a path.
    const scope = config.source(props.existing ? ["providers", props.existing.providerID] : ["providers"]) ?? "global"

    const token = gate.next()
    clearFetch()
    setFetching(true)

    const requestId = crypto.randomUUID()
    const stop = vscode.onMessage((raw) => {
      const message = raw as unknown as ToWebview
      if (message.type !== "customProviderModelsFetched" || message.requestId !== requestId) return
      stop()
      if (unsubscribe === stop) unsubscribe = undefined
      if (!gate.current(token)) return
      setFetching(false)

      if (message.error) {
        setFetchError(message.auth ? language.t("provider.custom.models.fetch.authError") : message.error)
        return
      }
      const fetched = message.models ?? []
      if (fetched.length === 0) {
        setFetchError(language.t("provider.custom.models.fetch.empty"))
        return
      }
      const fresh = freshModels(fetched, models)
      if (fresh.length === 0) {
        setFetchStatus(language.t("provider.custom.models.fetch.allExist"))
        return
      }
      setSelected(new Set(fresh.map((model) => model.id)))
      setFetchedModels(fresh)
    })
    unsubscribe = stop

    getVSCodeAPI().postMessage({
      type: "fetchCustomProviderModels",
      requestId,
      baseURL: url,
      ...key,
      headers,
      scope,
    } satisfies ToHost as never)
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
    for (const model of filtered()) next.add(model.id)
    setSelected(next)
  }

  function deselectAll() {
    const next = new Set(selected())
    for (const model of filtered()) next.delete(model.id)
    setSelected(next)
  }

  function addSelected() {
    const models = fetchedModels()
    if (!models) return
    const picked = models.filter((model) => selected().has(model.id))
    if (picked.length === 0) return

    const result = addFetchedModels(form.models, picked)
    if (result.added > 0) {
      setForm("models", result.models)
      setErrors(
        "models",
        result.models.map(() => ({})),
      )
    }

    // Keep the picker open with the models that were not picked. Every picked model leaves the picker, including one
    // skipped as a duplicate, so the user is not asked again.
    const remaining = models.filter((model) => !picked.includes(model))
    if (result.added > 0)
      setFetchStatus(language.t("provider.custom.models.fetch.added", { count: String(result.added) }))
    else if (remaining.length === 0) setFetchStatus(language.t("provider.custom.models.fetch.allExist"))
    else setFetchStatus(undefined)

    if (remaining.length === 0) {
      setFetchedModels(undefined)
      setSearch("")
      return
    }
    setFetchedModels(remaining)
    setSelected(new Set<string>())
  }

  function cancelFetch() {
    setFetchedModels(undefined)
    setSearch("")
  }

  // ── Form helpers ────────────────────────────────────────────────────

  function validate() {
    const output = validateCustomProvider({
      form,
      t: language.t,
      editing: editing(),
      apiKeyTouched: apiTouched,
      disabledProviders: disabledIds(),
      existingProviderIDs: new Set(props.settings.integrations().map((item) => item.id)),
      existingEnv: existingEnv(),
    })
    setErrors("providerID", output.errors.providerID)
    setErrors("name", output.errors.name)
    setErrors("baseURL", output.errors.baseURL)
    setErrors("models", output.errors.models)
    setErrors("headers", output.errors.headers)
    if (output.errors.apiKey)
      showToast({ title: language.t("common.requestFailed"), description: output.errors.apiKey })
    return output.result
  }

  function disabledIds(): string[] {
    return disabledProviderIds(config.value(["policies"]))
  }

  function goBack() {
    if (props.onBack) {
      props.onBack()
      return
    }
    dialog.close()
  }

  function addModel() {
    setForm("models", (v) => [...v, emptyModel()])
    setErrors("models", (v) => [...v, {}])
  }

  function removeModel(index: number) {
    if (form.models.length <= 1) return
    setForm("models", (v) => v.filter((_, i) => i !== index))
    setErrors("models", (v) => v.filter((_, i) => i !== index))
  }

  function toggleAllReasoning() {
    const all = form.models.length > 0 && form.models.every((m) => m.reasoning)
    form.models.forEach((_, i) => setForm("models", i, "reasoning", !all))
  }

  function toggleAllImages() {
    const all = form.models.length > 0 && form.models.every((m) => m.supportsImages)
    form.models.forEach((_, i) => setForm("models", i, "supportsImages", !all))
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

  async function waitForIntegration(providerID: string) {
    for (let attempt = 0; attempt < 20; attempt++) {
      if (props.settings.integration(providerID)) return
      await new Promise((resolve) => window.setTimeout(resolve, 150))
    }
  }

  /** The provider's key is a credential; an empty key clears the stored ones. */
  async function applyKey(providerID: string, key: string | undefined) {
    await waitForIntegration(providerID)
    if (key) {
      await props.settings.connectKey(providerID, key)
      return
    }
    const integration = props.settings.integration(providerID)
    if (integration) await props.settings.disconnect(integration)
  }

  async function save(e: SubmitEvent) {
    e.preventDefault()
    if (form.saving) return

    const result = validate()
    if (!result) return

    // Without the provider's value from a writable config file, the form can only come from the merged config, where
    // `{env:...}` and `{file:...}` are already substituted. Saving that would persist a secret, so refuse instead.
    if (props.existing && !rawProvider(props.existing.providerID)) {
      showToast({ variant: "error", title: language.t("settings.saveBar.saveFailed") })
      return
    }

    setForm("saving", true)
    const scope: SettingsScope =
      config.source(props.existing ? ["providers", result.providerID] : ["providers"]) ?? "global"
    const value = mergeProviderConfig(storedConfig(result.providerID) ?? props.existing?.config, result.config)
    const ok = await config.set(["providers", result.providerID], value, scope)
    if (!ok) {
      setForm("saving", false)
      return
    }

    // Saving enables the provider even when a wildcard policy denies it.
    if (!(await enableProviderInConfig(config, result.providerID))) {
      setForm("saving", false)
      return
    }

    try {
      // A field back at the mask keeps the stored key; disconnecting here would clear it.
      if (keyChanged(form.apiKey, apiTouched)) await applyKey(result.providerID, result.key)
    } catch (err) {
      setForm("saving", false)
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : String(err),
      })
      return
    }

    setForm("saving", false)
    dialog.close()
    showToast({
      variant: "success",
      icon: "circle-check",
      title: language.t("provider.connect.toast.connected.title", { provider: result.name }),
      description: language.t("provider.connect.toast.connected.description", { provider: result.name }),
    })
  }

  function openAdvanced() {
    const scope: SettingsScope = config.source(["providers", form.providerID]) ?? "global"
    const path = config.path(scope)
    if (!path) return
    getVSCodeAPI().postMessage({ type: "openFile", path } satisfies ToHost as never)
  }

  return (
    <Dialog
      size="large"
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
          gap: "20px",
          padding: "0 16px 16px 16px",
          "overflow-y": "auto",
          flex: 1,
          width: "100%",
          "box-sizing": "border-box",
        }}
      >
        <div style={{ display: "flex", gap: "16px", "align-items": "center" }}>
          <ProviderIcon id="synthetic" width={20} height={20} />
          <div
            style={{
              "font-size": "var(--kilo-font-size-16)",
              "font-weight": "500",
              color: "var(--vscode-foreground)",
            }}
          >
            {editing() ? language.t("provider.custom.edit.title") : language.t("provider.custom.title")}
          </div>
        </div>

        <form onSubmit={save} style={{ display: "flex", "flex-direction": "column", gap: "20px" }}>
          <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
            <div style={{ "font-size": "var(--kilo-font-size-14)", color: "var(--text-base)" }}>
              {language.t("provider.custom.description.prefix")}
              <a
                href="https://kilo.ai/docs/ai-providers#custom-provider"
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  props.settings.open("https://kilo.ai/docs/ai-providers#custom-provider")
                }}
              >
                {language.t("provider.custom.description.link")}
              </a>
              {language.t("provider.custom.description.suffix")}
            </div>
            <Show when={editing()}>
              <div>
                <Button type="button" variant="secondary" size="small" icon="edit" onClick={openAdvanced}>
                  {language.t("provider.custom.edit.advanced")}
                </Button>
              </div>
            </Show>
          </div>

          <div style={{ display: "flex", "flex-direction": "column", gap: "16px" }}>
            <TextField
              autofocus={!editing()}
              label={language.t("provider.custom.field.providerID.label")}
              placeholder={language.t("provider.custom.field.providerID.placeholder")}
              description={language.t("provider.custom.field.providerID.description")}
              value={form.providerID}
              onChange={(value) => setForm("providerID", value)}
              validationState={errors.providerID ? "invalid" : undefined}
              error={errors.providerID}
              disabled={editing()}
            />
            <TextField
              label={language.t("provider.custom.field.name.label")}
              placeholder={language.t("provider.custom.field.name.placeholder")}
              value={form.name}
              onChange={(value) => setForm("name", value)}
              validationState={errors.name ? "invalid" : undefined}
              error={errors.name}
            />
            <div style={{ display: "flex", "flex-direction": "column", gap: "4px" }}>
              <label
                style={{
                  "font-size": "var(--kilo-font-size-12)",
                  "font-weight": "500",
                  color: "var(--text-weak-base)",
                }}
              >
                {language.t("provider.custom.field.package.label")}
              </label>
              <Select
                options={PACKAGE_OPTIONS}
                current={PACKAGE_OPTIONS.find((option) => option.value === form.package)}
                value={(option) => option.value}
                label={(option) => option.label}
                onSelect={(option) => {
                  if (!option) return
                  setForm("package", option.value)
                  setFetchPackage(option.value)
                }}
                variant="secondary"
                triggerVariant="settings"
              />
            </div>
            <TextField
              label={language.t("provider.custom.field.baseURL.label")}
              placeholder={language.t("provider.custom.field.baseURL.placeholder")}
              value={form.baseURL}
              onChange={(value) => {
                setForm("baseURL", value)
                setFetchURL(value)
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
              onChange={(value) => {
                // The field shows the mask until the first edit.
                const next =
                  !apiTouched && form.apiKey === MASKED_CUSTOM_PROVIDER_KEY
                    ? unmaskKey(value, MASKED_CUSTOM_PROVIDER_KEY)
                    : value
                apiTouched = true
                setForm("apiKey", next)
                setFetchKeyValue(next)
              }}
            />
          </div>

          {/* Models */}
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <div
              style={{
                display: "flex",
                "justify-content": "space-between",
                "align-items": "center",
                "flex-wrap": "wrap",
                gap: "8px",
              }}
            >
              <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
                <label
                  style={{
                    "font-size": "var(--kilo-font-size-12)",
                    "font-weight": "500",
                    color: "var(--text-weak-base)",
                  }}
                >
                  {language.t("provider.custom.models.label")}
                </label>
                <Show when={fetching()}>
                  <Spinner style={{ width: "12px", height: "12px" }} />
                </Show>
              </div>
              <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  icon="reset"
                  onClick={doFetch}
                  disabled={fetching() || !canFetchModels(form.package, form.baseURL)}
                >
                  {language.t("provider.custom.models.fetch.button")}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  onClick={toggleAllReasoning}
                  disabled={form.models.length === 0}
                >
                  {language.t("provider.custom.models.toggleReasoning")}
                </Button>
                <Button
                  type="button"
                  size="small"
                  variant="ghost"
                  onClick={toggleAllImages}
                  disabled={form.models.length === 0}
                >
                  {language.t("provider.custom.models.toggleImages")}
                </Button>
              </div>
            </div>
            <For each={form.models}>
              {(m, i) => (
                <ModelCard
                  m={m}
                  errors={errors.models[i()] ?? {}}
                  t={language.t}
                  canRemove={form.models.length > 1}
                  onChangeId={(value) => setForm("models", i(), "id", value)}
                  onChangeName={(value) => setForm("models", i(), "name", value)}
                  onChangeReasoning={(value) => setForm("models", i(), "reasoning", value)}
                  onChangeSupportsImages={(value) => setForm("models", i(), "supportsImages", value)}
                  onRemove={() => removeModel(i())}
                />
              )}
            </For>
            <Button type="button" size="small" variant="ghost" icon="plus-small" onClick={addModel}>
              {language.t("provider.custom.models.add")}
            </Button>

            <Show when={fetchError()}>
              {(err) => (
                <span
                  data-slot="custom-provider-fetch-error"
                  style={{ "font-size": "var(--kilo-font-size-12)", color: "var(--vscode-errorForeground, #f14c4c)" }}
                >
                  {err()}
                </span>
              )}
            </Show>

            <Show when={!fetchError() && fetchStatus()}>
              {(status) => (
                <span
                  data-slot="custom-provider-fetch-status"
                  style={{
                    "font-size": "var(--kilo-font-size-12)",
                    color: "var(--text-weak-base, var(--vscode-descriptionForeground))",
                  }}
                >
                  {status()}
                </span>
              )}
            </Show>

            <Show when={fetchedModels()}>
              {(models) => (
                <div
                  data-slot="custom-provider-fetch-picker"
                  style={{
                    border: "1px solid var(--border-weak-base, var(--vscode-panel-border))",
                    "border-radius": "6px",
                    padding: "12px",
                    display: "flex",
                    "flex-direction": "column",
                    gap: "8px",
                  }}
                >
                  <div style={{ display: "flex", "justify-content": "space-between", "align-items": "center" }}>
                    <span
                      style={{
                        "font-size": "var(--kilo-font-size-12)",
                        "font-weight": "500",
                        color: "var(--text-weak-base)",
                      }}
                    >
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

                  <Show when={models().length > 10 || debouncedSearch().length > 0}>
                    <TextField
                      label={language.t("provider.custom.models.fetch.search")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.fetch.search")}
                      value={search()}
                      onChange={setSearch}
                    />
                  </Show>

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
                      {(model) => (
                        <label
                          style={{
                            display: "flex",
                            "align-items": "center",
                            gap: "8px",
                            padding: "4px 2px",
                            cursor: "pointer",
                            "font-size": "var(--kilo-font-size-13)",
                            color: "var(--text-base, var(--vscode-foreground))",
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={selected().has(model.id)}
                            onChange={() => toggleModel(model.id)}
                            style={{ cursor: "pointer" }}
                          />
                          {model.id}
                        </label>
                      )}
                    </For>
                  </div>

                  <div style={{ display: "flex", gap: "8px", "margin-top": "4px" }}>
                    <Button
                      type="button"
                      size="small"
                      variant="primary"
                      onClick={addSelected}
                      disabled={selected().size === 0}
                    >
                      {language.t("provider.custom.models.fetch.add", { count: String(selected().size) })}
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
            <label
              style={{ "font-size": "var(--kilo-font-size-12)", "font-weight": "500", color: "var(--text-weak-base)" }}
            >
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
                      onChange={(value) => setForm("headers", i(), "key", value)}
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
                      onChange={(value) => setForm("headers", i(), "value", value)}
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
