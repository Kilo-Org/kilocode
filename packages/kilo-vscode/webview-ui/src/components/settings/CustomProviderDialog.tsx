import { Button } from "@kilocode/kilo-ui/button"
import { useDialog } from "@kilocode/kilo-ui/context/dialog"
import { Dialog } from "@kilocode/kilo-ui/dialog"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { ProviderIcon } from "@kilocode/kilo-ui/provider-icon"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { showToast } from "@kilocode/kilo-ui/toast"
import { For, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useConfig } from "../../context/config"
import { useLanguage } from "../../context/language"
import { useProvider } from "../../context/provider"
import { useVSCode } from "../../context/vscode"
import { CUSTOM_PROVIDER_ID } from "./provider-catalog"
import {
  parseCustomProviderSecret,
  sanitizeCustomProviderConfig,
  type SanitizedProviderConfig,
  validateProviderID,
} from "../../../../src/shared/custom-provider"
import { createProviderAction } from "../../utils/provider-action"

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
  apiKey: string | undefined
  models: Array<{ id?: string; name?: string }>
  headers: Array<{ key?: string; value?: string }>
}

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
}

type ValidateResult = {
  providerID: string
  name: string
  apiKey?: string
  config: SanitizedProviderConfig
}

function validateCustomProvider(input: ValidateArgs): {
  errors: FormErrors
  result?: ValidateResult
  message?: string
} {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const secret = parseCustomProviderSecret(input.form.apiKey)
  const parsedID = providerID ? validateProviderID(providerID) : null

  const idError = !providerID
    ? input.t("provider.custom.error.providerID.required")
    : parsedID && "error" in parsedID
      ? input.t("provider.custom.error.providerID.format")
      : undefined

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const baseURLError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const disabled = input.disabledProviders.includes(providerID)
  const existsError = idError
    ? undefined
    : input.existingProviderIDs.has(providerID) && !disabled
      ? input.t("provider.custom.error.providerID.exists")
      : undefined

  const apiKeyError = "error" in secret ? secret.error : undefined
  const seenModels = new Set<string>()
  const modelErrors = input.form.models.map((model) => {
    const id = model.id.trim()
    const idError = !id
      ? input.t("provider.custom.error.required")
      : seenModels.has(id)
        ? input.t("provider.custom.error.duplicate")
        : (() => {
            seenModels.add(id)
            return undefined
          })()
    const nameError = !model.name.trim() ? input.t("provider.custom.error.required") : undefined
    return { id: idError, name: nameError }
  })

  const seenHeaders = new Set<string>()
  const headerErrors = input.form.headers.map((header) => {
    const key = header.key.trim()
    const value = header.value.trim()
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

  const errors: FormErrors = {
    providerID: idError ?? existsError,
    name: nameError,
    baseURL: baseURLError,
    apiKey: apiKeyError,
    models: modelErrors,
    headers: headerErrors,
  }

  const validModels = modelErrors.every((model) => !model.id && !model.name)
  const validHeaders = headerErrors.every((header) => !header.key && !header.value)
  const ok = !idError && !existsError && !nameError && !baseURLError && !apiKeyError && validModels && validHeaders
  if (!ok) return { errors }
  if (!parsedID || "error" in parsedID || "error" in secret) return { errors }

  const headers = Object.fromEntries(
    input.form.headers
      .map((header) => ({ key: header.key.trim(), value: header.value.trim() }))
      .filter((header) => !!header.key && !!header.value)
      .map((header) => [header.key, header.value]),
  )

  const models = Object.fromEntries(input.form.models.map((model) => [model.id.trim(), { name: model.name.trim() }]))
  const config = {
    name,
    ...(secret.value.env ? { env: [secret.value.env] } : {}),
    options: {
      baseURL,
      ...(Object.keys(headers).length ? { headers } : {}),
    },
    models,
  }
  const sanitized = sanitizeCustomProviderConfig(config)
  if ("error" in sanitized) {
    const path = sanitized.issue?.path.join(".")
    if (path === "name") {
      return { errors: { ...errors, name: sanitized.error } }
    }
    if (path === "options.baseURL") {
      return { errors: { ...errors, baseURL: sanitized.error } }
    }
    if (path === "env" || path?.startsWith("env.")) {
      return { errors: { ...errors, apiKey: sanitized.error } }
    }
    return { errors, message: sanitized.error }
  }

  return {
    errors,
    result: {
      providerID: parsedID.value,
      name,
      apiKey: secret.value.apiKey,
      config: sanitized.value,
    },
  }
}

interface CustomProviderDialogProps {
  onBack?: () => void
}

const CustomProviderDialog = (props: CustomProviderDialogProps) => {
  const dialog = useDialog()
  const { config } = useConfig()
  const provider = useProvider()
  const vscode = useVSCode()
  const language = useLanguage()
  const action = createProviderAction(vscode)

  const [form, setForm] = createStore<FormState>({
    providerID: "",
    name: "",
    baseURL: "",
    apiKey: "",
    models: [{ id: "", name: "" }],
    headers: [{ key: "", value: "" }],
    saving: false,
  })
  const [errors, setErrors] = createStore<FormErrors>({
    providerID: undefined,
    name: undefined,
    baseURL: undefined,
    apiKey: undefined,
    models: [{}],
    headers: [{}],
  })

  onCleanup(action.dispose)

  function goBack() {
    if (!props.onBack) {
      dialog.close()
      return
    }
    props.onBack()
  }

  function addModel() {
    setForm("models", (items) => [...items, { id: "", name: "" }])
    setErrors("models", (items) => [...items, {}])
  }

  function removeModel(index: number) {
    if (form.models.length <= 1) return
    setForm("models", (items) => items.filter((_, i) => i !== index))
    setErrors("models", (items) => items.filter((_, i) => i !== index))
  }

  function addHeader() {
    setForm("headers", (items) => [...items, { key: "", value: "" }])
    setErrors("headers", (items) => [...items, {}])
  }

  function removeHeader(index: number) {
    if (form.headers.length <= 1) return
    setForm("headers", (items) => items.filter((_, i) => i !== index))
    setErrors("headers", (items) => items.filter((_, i) => i !== index))
  }

  function save(event: SubmitEvent) {
    event.preventDefault()
    if (form.saving) return

    const output = validateCustomProvider({
      form,
      t: language.t,
      disabledProviders: config().disabled_providers ?? [],
      existingProviderIDs: new Set(Object.keys(provider.providers()).filter((id) => id !== CUSTOM_PROVIDER_ID)),
    })

    setErrors(output.errors)
    if (!output.result) {
      if (output.message) {
        showToast({ title: language.t("common.requestFailed"), description: output.message })
      }
      return
    }

    setForm("saving", true)
    action.send(
      {
        type: "saveCustomProvider",
        providerID: output.result.providerID,
        config: output.result.config,
        apiKey: output.result.apiKey,
      },
      {
        onConnected: () => {
          setForm("saving", false)
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("provider.connect.toast.connected.title", {
              provider: form.name.trim() || form.providerID.trim(),
            }),
            description: language.t("provider.connect.toast.connected.description", {
              provider: form.name.trim() || form.providerID.trim(),
            }),
          })
          dialog.close()
        },
        onError: (message) => {
          setForm("saving", false)
          showToast({ title: language.t("common.requestFailed"), description: message.message })
        },
      },
    )
  }

  return (
    <Dialog
      title={
        <div style={{ display: "flex", "align-items": "center", gap: "8px" }}>
          <IconButton
            tabIndex={-1}
            icon="arrow-left"
            variant="ghost"
            onClick={goBack}
            aria-label={language.t("common.goBack")}
          />
          <span>{language.t("provider.custom.title")}</span>
        </div>
      }
      fit
    >
      <div
        style={{
          display: "flex",
          "flex-direction": "column",
          gap: "16px",
          padding: "4px 8px 12px",
          "max-height": "70vh",
          overflow: "auto",
        }}
      >
        <div style={{ display: "flex", gap: "12px", "align-items": "center" }}>
          <ProviderIcon id="synthetic" width={18} height={18} />
          <span style={{ "font-size": "14px", color: "var(--vscode-descriptionForeground)" }}>
            {language.t("settings.providers.custom.note")}
          </span>
        </div>

        <div style={{ "font-size": "13px", color: "var(--vscode-descriptionForeground)" }}>
          {language.t("provider.custom.description.prefix")}
          <a
            href="https://kilo.ai/docs/providers/#custom-provider"
            onClick={(event) => {
              event.preventDefault()
              vscode.postMessage({ type: "openExternal", url: "https://kilo.ai/docs/providers/#custom-provider" })
            }}
          >
            {language.t("provider.custom.description.link")}
          </a>
          {language.t("provider.custom.description.suffix")}
        </div>

        <form style={{ display: "flex", "flex-direction": "column", gap: "16px" }} onSubmit={save}>
          <TextField
            autofocus
            label={language.t("provider.custom.field.providerID.label")}
            placeholder={language.t("provider.custom.field.providerID.placeholder")}
            description={language.t("provider.custom.field.providerID.description")}
            value={form.providerID}
            onChange={(value) => setForm("providerID", value)}
            validationState={errors.providerID ? "invalid" : undefined}
            error={errors.providerID}
          />
          <TextField
            label={language.t("provider.custom.field.name.label")}
            placeholder={language.t("provider.custom.field.name.placeholder")}
            value={form.name}
            onChange={(value) => setForm("name", value)}
            validationState={errors.name ? "invalid" : undefined}
            error={errors.name}
          />
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
            onChange={(value) => setForm("apiKey", value)}
            validationState={errors.apiKey ? "invalid" : undefined}
            error={errors.apiKey}
          />

          <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
            <label style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
              {language.t("provider.custom.models.label")}
            </label>
            <For each={form.models}>
              {(model, index) => (
                <div style={{ display: "flex", gap: "8px", "align-items": "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("provider.custom.models.id.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.id.placeholder")}
                      value={model.id}
                      onChange={(value) => setForm("models", index(), "id", value)}
                      validationState={errors.models[index()]?.id ? "invalid" : undefined}
                      error={errors.models[index()]?.id}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("provider.custom.models.name.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.models.name.placeholder")}
                      value={model.name}
                      onChange={(value) => setForm("models", index(), "name", value)}
                      validationState={errors.models[index()]?.name ? "invalid" : undefined}
                      error={errors.models[index()]?.name}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    onClick={() => removeModel(index())}
                    disabled={form.models.length <= 1}
                    aria-label={language.t("provider.custom.models.remove")}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" onClick={addModel}>
              {language.t("provider.custom.models.add")}
            </Button>
          </div>

          <div style={{ display: "flex", "flex-direction": "column", gap: "10px" }}>
            <label style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)" }}>
              {language.t("provider.custom.headers.label")}
            </label>
            <For each={form.headers}>
              {(header, index) => (
                <div style={{ display: "flex", gap: "8px", "align-items": "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("provider.custom.headers.key.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.key.placeholder")}
                      value={header.key}
                      onChange={(value) => setForm("headers", index(), "key", value)}
                      validationState={errors.headers[index()]?.key ? "invalid" : undefined}
                      error={errors.headers[index()]?.key}
                    />
                  </div>
                  <div style={{ flex: 1 }}>
                    <TextField
                      label={language.t("provider.custom.headers.value.label")}
                      hideLabel
                      placeholder={language.t("provider.custom.headers.value.placeholder")}
                      value={header.value}
                      onChange={(value) => setForm("headers", index(), "value", value)}
                      validationState={errors.headers[index()]?.value ? "invalid" : undefined}
                      error={errors.headers[index()]?.value}
                    />
                  </div>
                  <IconButton
                    type="button"
                    icon="trash"
                    variant="ghost"
                    onClick={() => removeHeader(index())}
                    disabled={form.headers.length <= 1}
                    aria-label={language.t("provider.custom.headers.remove")}
                  />
                </div>
              )}
            </For>
            <Button type="button" size="small" variant="ghost" onClick={addHeader}>
              {language.t("provider.custom.headers.add")}
            </Button>
          </div>

          <div class="dialog-confirm-actions">
            <Button type="button" variant="ghost" size="large" onClick={() => dialog.close()} disabled={form.saving}>
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="large" disabled={form.saving}>
              {language.t("common.submit")}
            </Button>
          </div>
        </form>
      </div>
    </Dialog>
  )
}

export default CustomProviderDialog
