/**
 * Dialog for adding a custom OpenAI-compatible provider.
 * Ported from packages/app/src/components/dialog-custom-provider.tsx
 */
import { Component, For, createSignal, Show } from "solid-js"
import { TextField } from "@kilocode/kilo-ui/text-field"
import { Button } from "@kilocode/kilo-ui/button"
import { IconButton } from "@kilocode/kilo-ui/icon-button"
import { Card } from "@kilocode/kilo-ui/card"
import { useConfig } from "../../context/config"
import { useProvider } from "../../context/provider"
import { useLanguage } from "../../context/language"
import { useVSCode } from "../../context/vscode"
import type { ExtensionMessage } from "../../types/messages"

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE_NPM = "@ai-sdk/openai-compatible"

type ModelRow = { id: string; name: string }
type HeaderRow = { key: string; value: string }
type FormErrors = {
  providerID?: string
  name?: string
  baseURL?: string
  models: Array<{ id?: string; name?: string }>
  headers: Array<{ key?: string; value?: string }>
}

interface Props {
  onClose: () => void
}

export const CustomProviderDialog: Component<Props> = (props) => {
  const vscode = useVSCode()
  const { config, updateConfig } = useConfig()
  const provider = useProvider()
  const language = useLanguage()

  const [providerID, setProviderID] = createSignal("")
  const [name, setName] = createSignal("")
  const [baseURL, setBaseURL] = createSignal("")
  const [apiKey, setApiKey] = createSignal("")
  const [models, setModels] = createSignal<ModelRow[]>([{ id: "", name: "" }])
  const [headers, setHeaders] = createSignal<HeaderRow[]>([{ key: "", value: "" }])
  const [errors, setErrors] = createSignal<FormErrors>({ models: [{}], headers: [{}] })
  const [saving, setSaving] = createSignal(false)
  const [saveError, setSaveError] = createSignal<string | undefined>()

  const addModel = () => setModels((prev) => [...prev, { id: "", name: "" }])
  const removeModel = (i: number) => {
    if (models().length <= 1) return
    setModels((prev) => prev.filter((_, idx) => idx !== i))
    setErrors((prev) => ({ ...prev, models: prev.models.filter((_, idx) => idx !== i) }))
  }

  const updateModel = (i: number, field: "id" | "name", val: string) => {
    setModels((prev) => prev.map((m, idx) => (idx === i ? { ...m, [field]: val } : m)))
  }

  const addHeader = () => setHeaders((prev) => [...prev, { key: "", value: "" }])
  const removeHeader = (i: number) => {
    if (headers().length <= 1) return
    setHeaders((prev) => prev.filter((_, idx) => idx !== i))
    setErrors((prev) => ({ ...prev, headers: prev.headers.filter((_, idx) => idx !== i) }))
  }

  const updateHeader = (i: number, field: "key" | "value", val: string) => {
    setHeaders((prev) => prev.map((h, idx) => (idx === i ? { ...h, [field]: val } : h)))
  }

  function validate(): { ok: boolean; errors: FormErrors } {
    const id = providerID().trim()
    const n = name().trim()
    const url = baseURL().trim()

    const idError = !id
      ? language.t("provider.custom.error.providerID.required")
      : !PROVIDER_ID_PATTERN.test(id)
        ? language.t("provider.custom.error.providerID.format")
        : undefined

    const existingIDs = new Set(Object.keys(provider.providers()))
    const disabledProviders = config().disabled_providers ?? []
    const isDisabled = disabledProviders.includes(id)
    const existsError =
      !idError && existingIDs.has(id) && !isDisabled ? language.t("provider.custom.error.providerID.exists") : undefined

    const nameError = !n ? language.t("provider.custom.error.name.required") : undefined
    const urlError = !url
      ? language.t("provider.custom.error.baseURL.required")
      : !/^https?:\/\//.test(url)
        ? language.t("provider.custom.error.baseURL.format")
        : undefined

    const seenModels = new Set<string>()
    const modelErrors = models().map((m) => {
      const mid = m.id.trim()
      const idErr = !mid
        ? language.t("provider.custom.error.required")
        : seenModels.has(mid)
          ? language.t("provider.custom.error.duplicate")
          : undefined
      seenModels.add(mid)
      const nameErr = !m.name.trim() ? language.t("provider.custom.error.required") : undefined
      return { id: idErr, name: nameErr }
    })

    const seenHeaders = new Set<string>()
    const headerErrors = headers().map((h) => {
      const k = h.key.trim()
      const v = h.value.trim()
      if (!k && !v) return {}
      const keyErr = !k
        ? language.t("provider.custom.error.required")
        : seenHeaders.has(k.toLowerCase())
          ? language.t("provider.custom.error.duplicate")
          : undefined
      seenHeaders.add(k.toLowerCase())
      const valErr = !v ? language.t("provider.custom.error.required") : undefined
      return { key: keyErr, value: valErr }
    })

    const result: FormErrors = {
      providerID: idError ?? existsError,
      name: nameError,
      baseURL: urlError,
      models: modelErrors,
      headers: headerErrors,
    }

    const ok =
      !idError &&
      !existsError &&
      !nameError &&
      !urlError &&
      modelErrors.every((m) => !m.id && !m.name) &&
      headerErrors.every((h) => !h.key && !h.value)

    return { ok, errors: result }
  }

  async function save(e: Event) {
    e.preventDefault()
    if (saving()) return

    const { ok, errors: validationErrors } = validate()
    setErrors(validationErrors)
    if (!ok) return

    setSaving(true)
    setSaveError(undefined)

    const id = providerID().trim()
    const n = name().trim()
    const url = baseURL().trim()
    const key = apiKey().trim()
    const envVarMatch = key.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
    const finalKey = key && !envVarMatch ? key : undefined

    const headersObj = Object.fromEntries(
      headers()
        .map((h) => ({ k: h.key.trim(), v: h.value.trim() }))
        .filter((h) => !!h.k && !!h.v)
        .map((h) => [h.k, h.v]),
    )

    const modelsObj = Object.fromEntries(models().map((m) => [m.id.trim(), { name: m.name.trim() }]))

    const providerCfg: Record<string, unknown> = {
      npm: OPENAI_COMPATIBLE_NPM,
      name: n,
      options: {
        baseURL: url,
        ...(Object.keys(headersObj).length ? { headers: headersObj } : {}),
      },
      models: modelsObj,
    }

    if (envVarMatch) {
      providerCfg.env = [envVarMatch]
    }

    // Set up auth if API key provided
    const setAuth = finalKey
      ? new Promise<void>((resolve, reject) => {
          const cleanup = vscode.onMessage((msg: ExtensionMessage) => {
            if (msg.type === "setProviderAuthResult") {
              cleanup()
              if (msg.success) resolve()
              else reject(new Error(msg.error ?? "Auth failed"))
            }
          })
          vscode.postMessage({ type: "setProviderAuth", providerID: id, apiKey: finalKey })
        })
      : Promise.resolve()

    // Remove from disabled providers if it was there
    const disabledProviders = config().disabled_providers ?? []
    const nextDisabled = disabledProviders.filter((p) => p !== id)

    try {
      await setAuth
      updateConfig({
        provider: { [id]: providerCfg as any },
        disabled_providers: nextDisabled,
      })
      props.onClose()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: "var(--vscode-editor-background, rgba(0,0,0,0.5))",
        display: "flex",
        "align-items": "flex-start",
        "justify-content": "center",
        "z-index": 1000,
        "overflow-y": "auto",
        padding: "24px 16px",
      }}
      onClick={(e) => e.target === e.currentTarget && props.onClose()}
    >
      <div
        style={{
          background: "var(--vscode-sideBar-background)",
          border: "1px solid var(--vscode-panel-border)",
          "border-radius": "6px",
          padding: "20px",
          width: "100%",
          "max-width": "480px",
          "box-shadow": "0 4px 16px rgba(0,0,0,0.3)",
        }}
      >
        <div style={{ display: "flex", "align-items": "center", "justify-content": "space-between", "margin-bottom": "16px" }}>
          <h3 style={{ margin: 0, "font-size": "14px", "font-weight": 600 }}>
            {language.t("provider.custom.title")}
          </h3>
          <IconButton icon="close" variant="ghost" size="small" onClick={props.onClose} aria-label={language.t("common.close")} />
        </div>

        <p style={{ "font-size": "12px", color: "var(--vscode-descriptionForeground)", "margin-bottom": "16px", "line-height": "1.5" }}>
          {language.t("provider.custom.description.prefix")}
          <a
            href="#"
            onClick={(e) => { e.preventDefault(); window.open("https://kilo.ai/docs/ai-providers/openai-compatible") }}
            style={{ color: "var(--vscode-textLink-foreground)" }}
          >
            {language.t("provider.custom.description.link")}
          </a>
          {language.t("provider.custom.description.suffix")}
        </p>

        <form onSubmit={save}>
          <Card>
            <div style={{ display: "flex", "flex-direction": "column", gap: "12px" }}>
              <TextField
                label={language.t("provider.custom.field.providerID.label")}
                placeholder={language.t("provider.custom.field.providerID.placeholder")}
                description={language.t("provider.custom.field.providerID.description")}
                value={providerID()}
                onChange={setProviderID}
                validationState={errors().providerID ? "invalid" : undefined}
                error={errors().providerID}
              />
              <TextField
                label={language.t("provider.custom.field.name.label")}
                placeholder={language.t("provider.custom.field.name.placeholder")}
                value={name()}
                onChange={setName}
                validationState={errors().name ? "invalid" : undefined}
                error={errors().name}
              />
              <TextField
                label={language.t("provider.custom.field.baseURL.label")}
                placeholder={language.t("provider.custom.field.baseURL.placeholder")}
                value={baseURL()}
                onChange={setBaseURL}
                validationState={errors().baseURL ? "invalid" : undefined}
                error={errors().baseURL}
              />
              <TextField
                label={language.t("provider.custom.field.apiKey.label")}
                placeholder={language.t("provider.custom.field.apiKey.placeholder")}
                description={language.t("provider.custom.field.apiKey.description")}
                value={apiKey()}
                onChange={setApiKey}
              />
            </div>
          </Card>

          <div style={{ "margin-top": "16px" }}>
            <label style={{ "font-size": "11px", "font-weight": 600, "text-transform": "uppercase", color: "var(--vscode-descriptionForeground)", display: "block", "margin-bottom": "8px" }}>
              {language.t("provider.custom.models.label")}
            </label>
            <Card>
              <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                <For each={models()}>
                  {(m, i) => (
                    <div style={{ display: "flex", gap: "8px", "align-items": "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label={language.t("provider.custom.models.id.label")}
                          hideLabel
                          placeholder={language.t("provider.custom.models.id.placeholder")}
                          value={m.id}
                          onChange={(v) => updateModel(i(), "id", v)}
                          validationState={errors().models[i()]?.id ? "invalid" : undefined}
                          error={errors().models[i()]?.id}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label={language.t("provider.custom.models.name.label")}
                          hideLabel
                          placeholder={language.t("provider.custom.models.name.placeholder")}
                          value={m.name}
                          onChange={(v) => updateModel(i(), "name", v)}
                          validationState={errors().models[i()]?.name ? "invalid" : undefined}
                          error={errors().models[i()]?.name}
                        />
                      </div>
                      <div style={{ "padding-top": "4px" }}>
                        <IconButton
                          type="button"
                          icon="close"
                          variant="ghost"
                          size="small"
                          onClick={() => removeModel(i())}
                          disabled={models().length <= 1}
                          aria-label={language.t("provider.custom.models.remove")}
                        />
                      </div>
                    </div>
                  )}
                </For>
                <Button type="button" size="small" variant="ghost" onClick={addModel}>
                  + {language.t("provider.custom.models.add")}
                </Button>
              </div>
            </Card>
          </div>

          <div style={{ "margin-top": "12px" }}>
            <label style={{ "font-size": "11px", "font-weight": 600, "text-transform": "uppercase", color: "var(--vscode-descriptionForeground)", display: "block", "margin-bottom": "8px" }}>
              {language.t("provider.custom.headers.label")}
            </label>
            <Card>
              <div style={{ display: "flex", "flex-direction": "column", gap: "8px" }}>
                <For each={headers()}>
                  {(h, i) => (
                    <div style={{ display: "flex", gap: "8px", "align-items": "flex-start" }}>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label={language.t("provider.custom.headers.key.label")}
                          hideLabel
                          placeholder={language.t("provider.custom.headers.key.placeholder")}
                          value={h.key}
                          onChange={(v) => updateHeader(i(), "key", v)}
                          validationState={errors().headers[i()]?.key ? "invalid" : undefined}
                          error={errors().headers[i()]?.key}
                        />
                      </div>
                      <div style={{ flex: 1 }}>
                        <TextField
                          label={language.t("provider.custom.headers.value.label")}
                          hideLabel
                          placeholder={language.t("provider.custom.headers.value.placeholder")}
                          value={h.value}
                          onChange={(v) => updateHeader(i(), "value", v)}
                          validationState={errors().headers[i()]?.value ? "invalid" : undefined}
                          error={errors().headers[i()]?.value}
                        />
                      </div>
                      <div style={{ "padding-top": "4px" }}>
                        <IconButton
                          type="button"
                          icon="close"
                          variant="ghost"
                          size="small"
                          onClick={() => removeHeader(i())}
                          disabled={headers().length <= 1}
                          aria-label={language.t("provider.custom.headers.remove")}
                        />
                      </div>
                    </div>
                  )}
                </For>
                <Button type="button" size="small" variant="ghost" onClick={addHeader}>
                  + {language.t("provider.custom.headers.add")}
                </Button>
              </div>
            </Card>
          </div>

          <Show when={saveError()}>
            <div style={{ color: "var(--vscode-errorForeground)", "font-size": "12px", "margin-top": "12px" }}>
              {saveError()}
            </div>
          </Show>

          <div style={{ display: "flex", gap: "8px", "margin-top": "16px", "justify-content": "flex-end" }}>
            <Button type="button" variant="ghost" size="small" onClick={props.onClose}>
              {language.t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" size="small" disabled={saving()}>
              {saving() ? language.t("common.saving") : language.t("common.submit")}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
