// The custom provider dialog: provider ID, name, package, base URL, API key, models and headers. The config draft
// goes through `useSettingsConfig` (the host owns the file) and the key is a v2 credential (`settings.connectKey`),
// because the config provider registers a key method for every configured provider.
import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { Select } from "@kilocode/kilo-ui/select"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { For, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "../../context/language"
import { getVSCodeAPI } from "../../context/vscode"
import type { ToHost } from "../../../../src/protocol"
import type { SettingsData } from "../../v2/settings"
import { useSettingsConfig, type SettingsScope } from "../../v2/settings-config"
import { ModelCard } from "./CustomProviderModelCard"
import {
  mergeProviderConfig,
  validateCustomProvider,
  type CustomProviderConfigValue,
  type HeaderRow,
  type ModelEntry,
} from "./CustomProviderValidation"
import {
  CUSTOM_PROVIDER_PACKAGE,
  CUSTOM_PROVIDER_PACKAGES,
  disabledProviderIds,
  isCustomProviderPackage,
  withDisabledProviders,
  type CustomProviderPackage,
  type ProviderPolicy,
} from "./provider-visibility"
import { credentials } from "./provider-catalog"

/** The API key field shows this instead of the stored credential; the dialog cannot read the secret. */
export const MASKED_CUSTOM_PROVIDER_KEY = "********"

const PACKAGE_OPTIONS: Array<{ value: CustomProviderPackage; label: string }> = [
  { value: CUSTOM_PROVIDER_PACKAGES[0], label: "OpenAI Compatible" },
  { value: CUSTOM_PROVIDER_PACKAGES[1], label: "OpenAI Responses" },
  { value: CUSTOM_PROVIDER_PACKAGES[2], label: "Anthropic Messages" },
]

const EMPTY_MODEL: ModelEntry = { id: "", name: "", reasoning: false, supportsImages: false }

export interface CustomProviderDialogProps {
  settings: SettingsData
  onBack?: () => void
  /** When set, the dialog opens in edit mode with pre-filled values. */
  existing?: { providerID: string; name: string; config: CustomProviderConfigValue }
}

function initModels(config: CustomProviderConfigValue | undefined): ModelEntry[] {
  if (!config?.models || typeof config.models !== "object") return [{ ...EMPTY_MODEL }]
  const entries = Object.entries(config.models)
  if (entries.length === 0) return [{ ...EMPTY_MODEL }]
  return entries.map(([id, model]) => {
    const input = model.capabilities?.input ?? []
    return {
      id,
      name: model.name ?? id,
      reasoning: model.capabilities?.reasoning?.supported === true,
      supportsImages: input.includes("image"),
      variants: model.variants,
    }
  })
}

function initHeaders(config: CustomProviderConfigValue | undefined): HeaderRow[] {
  const headers = config?.headers
  if (!headers || typeof headers !== "object") return [{ key: "", value: "" }]
  const entries = Object.entries(headers)
  if (entries.length === 0) return [{ key: "", value: "" }]
  return entries.map(([key, value]) => ({ key, value }))
}

const CustomProviderDialog = (props: CustomProviderDialogProps) => {
  const dialog = useDialog()
  const config = useSettingsConfig()
  const language = useLanguage()

  const editing = () => !!props.existing
  const existingKey = () => {
    const integration = props.existing ? props.settings.integration(props.existing.providerID) : undefined
    if (!integration) return false
    return credentials(integration).some((credential) => credential.method === "key")
  }

  const [form, setForm] = createStore({
    providerID: props.existing?.providerID ?? "",
    name: props.existing?.name ?? "",
    package: (isCustomProviderPackage(props.existing?.config?.package)
      ? props.existing!.config.package
      : CUSTOM_PROVIDER_PACKAGE) as CustomProviderPackage,
    baseURL: (props.existing?.config?.settings as { baseURL?: string } | undefined)?.baseURL ?? "",
    apiKey: existingKey() ? MASKED_CUSTOM_PROVIDER_KEY : "",
    models: initModels(props.existing?.config),
    headers: initHeaders(props.existing?.config),
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

  function validate() {
    const output = validateCustomProvider({
      form,
      t: language.t,
      editing: editing(),
      apiKeyTouched: apiTouched,
      disabledProviders: disabledIds(),
      existingProviderIDs: new Set(props.settings.integrations().map((item) => item.id)),
      existingEnv: props.existing?.config.env,
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
    setForm("models", (v) => [...v, { ...EMPTY_MODEL }])
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

    setForm("saving", true)
    const scope: SettingsScope = props.existing
      ? (config.source(["providers", result.providerID]) ?? "global")
      : "global"
    const value = mergeProviderConfig(
      config.value(["providers", result.providerID]) ?? props.existing?.config,
      result.config,
    )
    const ok = await config.set(["providers", result.providerID], value, scope)
    if (!ok) {
      setForm("saving", false)
      return
    }

    // Reusing a disabled provider's id is allowed, so saving re-enables it; otherwise it would stay hidden.
    const policies = config.value(["policies"])
    const disabled = disabledProviderIds(policies)
    if (disabled.includes(result.providerID)) {
      const policyScope: SettingsScope = config.source(["policies"]) ?? "global"
      const next = withDisabledProviders(
        (Array.isArray(policies) ? policies : []) as ProviderPolicy[],
        disabled.filter((id) => id !== result.providerID),
      )
      const written =
        next.length === 0
          ? await config.unset(["policies"], policyScope)
          : await config.set(["policies"], next, policyScope)
      if (!written) {
        setForm("saving", false)
        return
      }
    }

    try {
      if (apiTouched) await applyKey(result.providerID, result.key)
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
                }}
                variant="secondary"
                triggerVariant="settings"
              />
            </div>
            <TextField
              label={language.t("provider.custom.field.baseURL.label")}
              placeholder={language.t("provider.custom.field.baseURL.placeholder")}
              value={form.baseURL}
              onChange={(value) => setForm("baseURL", value)}
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
                // The field shows the mask until the first edit. Strip the mask characters wherever they are, so an
                // edit in the middle of the masked value cannot persist stray asterisks as part of the key.
                const next =
                  !apiTouched && form.apiKey === MASKED_CUSTOM_PROVIDER_KEY ? value.replace(/\*/g, "") : value
                apiTouched = true
                setForm("apiKey", next)
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
              <label
                style={{
                  "font-size": "var(--kilo-font-size-12)",
                  "font-weight": "500",
                  color: "var(--text-weak-base)",
                }}
              >
                {language.t("provider.custom.models.label")}
              </label>
              <div style={{ display: "flex", gap: "8px", "align-items": "center", "flex-wrap": "wrap" }}>
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
