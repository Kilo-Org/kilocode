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
import { createProviderAction } from "../../utils/provider-action"

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

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

type ValidateArgs = {
  form: FormState
  t: Translator
  disabledProviders: string[]
  existingProviderIDs: Set<string>
}

function validateCustomProvider(input: ValidateArgs) {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const env = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
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
        ...(env ? { env: [env] } : {}),
        options,
        models,
      },
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
  const language = useLanguage()
  const vscode = useVSCode()
  const action = createProviderAction(vscode)
  onCleanup(action.dispose)

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
    models: [{}],
    headers: [{}],
  })

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
      disabledProviders: config().disabled_providers ?? [],
      existingProviderIDs: new Set(Object.keys(provider.providers())),
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
            {language.t("provider.custom.title")}
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
              autofocus
              label={language.t("provider.custom.field.providerID.label")}
              placeholder={language.t("provider.custom.field.providerID.placeholder")}
              description={language.t("provider.custom.field.providerID.description")}
              value={form.providerID}
              onChange={(v) => setForm("providerID", v)}
              validationState={errors.providerID ? "invalid" : undefined}
              error={errors.providerID}
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
              onChange={(v) => setForm("baseURL", v)}
              validationState={errors.baseURL ? "invalid" : undefined}
              error={errors.baseURL}
            />
            <TextField
              type="password"
              label={language.t("provider.custom.field.apiKey.label")}
              placeholder={language.t("provider.custom.field.apiKey.placeholder")}
              description={language.t("provider.custom.field.apiKey.description")}
              value={form.apiKey}
              onChange={(v) => setForm("apiKey", v)}
            />
          </div>

          {/* Models */}
          <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
            <label style={{ "font-size": "12px", "font-weight": "500", color: "var(--text-weak-base)" }}>
              {language.t("provider.custom.models.label")}
            </label>
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
