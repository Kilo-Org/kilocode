import type { ModelEntry, VariantEntry } from "./CustomProviderModelCard"

type Translator = (key: string, params?: Record<string, string>) => string

export type HeaderRow = {
  key: string
  value: string
}

export type FormState = {
  providerID: string
  name: string
  baseURL: string
  apiKey: string
  models: ModelEntry[]
  headers: HeaderRow[]
  saving: boolean
}

export type FormErrors = {
  providerID: string | undefined
  name: string | undefined
  baseURL: string | undefined
  models: Array<{ id?: string; name?: string; variants?: Array<{ name?: string }> }>
  headers: Array<{ key?: string; value?: string }>
}

type ValidateArgs = {
  form: FormState
  t: Translator
  editing: boolean
  disabledProviders: string[]
  existingProviderIDs: Set<string>
  /** Preserved env vars from the existing provider config (edit mode only) */
  existingEnv?: string[]
}

type ValidateResult = {
  errors: FormErrors
  result?: {
    providerID: string
    name: string
    key: string | undefined
    config: {
      npm: string
      name: string
      env?: string[]
      options: { baseURL: string; headers?: Record<string, string> }
      models: Record<string, unknown>
    }
  }
}

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const OPENAI_COMPATIBLE = "@ai-sdk/openai-compatible"

function checkVariant(v: VariantEntry, seen: Set<string>, t: Translator) {
  const n = v.name.trim()
  if (!n) return { name: t("provider.custom.error.required") }
  if (seen.has(n)) return { name: t("provider.custom.error.duplicate") }
  seen.add(n)
  return { name: undefined }
}

function checkModel(m: ModelEntry, seenModels: Set<string>, t: Translator) {
  const id = m.id.trim()
  let idErr: string | undefined
  if (!id) idErr = t("provider.custom.error.required")
  else if (seenModels.has(id)) idErr = t("provider.custom.error.duplicate")
  else seenModels.add(id)

  const nameErr = !m.name.trim() ? t("provider.custom.error.required") : undefined
  const seen = new Set<string>()
  const variants = m.reasoning ? m.variants.map((v) => checkVariant(v, seen, t)) : []
  return { id: idErr, name: nameErr, variants }
}

function checkHeader(h: HeaderRow, seenKeys: Set<string>, t: Translator) {
  const key = h.key.trim()
  const value = h.value.trim()
  if (!key && !value) return {}

  let keyErr: string | undefined
  if (!key) keyErr = t("provider.custom.error.required")
  else if (seenKeys.has(key.toLowerCase())) keyErr = t("provider.custom.error.duplicate")
  else seenKeys.add(key.toLowerCase())

  const valueErr = !value ? t("provider.custom.error.required") : undefined
  return { key: keyErr, value: valueErr }
}

function checkProviderID(id: string, editing: boolean, disabled: string[], existing: Set<string>, t: Translator) {
  const idErr = !id
    ? t("provider.custom.error.providerID.required")
    : !PROVIDER_ID.test(id)
      ? t("provider.custom.error.providerID.format")
      : undefined
  const existsErr =
    idErr || editing || !existing.has(id) || disabled.includes(id)
      ? undefined
      : t("provider.custom.error.providerID.exists")
  return { idErr, existsErr }
}

function serializeVariant(v: VariantEntry): [string, Record<string, unknown>] {
  const cfg: Record<string, unknown> = {}
  if (v.enableThinking !== undefined) cfg.enable_thinking = v.enableThinking
  if (v.thinking !== undefined) cfg.thinking = { type: v.thinking }
  if (v.reasoningEffort !== undefined) cfg.reasoningEffort = v.reasoningEffort
  if (v.chatTemplateArgs !== undefined) cfg.chat_template_args = { enable_thinking: v.chatTemplateArgs }
  return [v.name.trim(), cfg]
}

function serializeModel(m: ModelEntry): [string, Record<string, unknown>] {
  const ventries = m.reasoning ? m.variants.filter((v) => v.name.trim()).map(serializeVariant) : []
  const entry: Record<string, unknown> = { name: m.name.trim() }
  if (m.reasoning) entry.reasoning = true
  if (ventries.length > 0) entry.variants = Object.fromEntries(ventries)
  return [m.id.trim(), entry]
}

function resolveEnv(rawEnv: string | undefined, savedEnv: string[] | undefined) {
  if (rawEnv) return { env: [rawEnv] }
  if (savedEnv) return { env: savedEnv }
  return {}
}

export function validateCustomProvider(input: ValidateArgs): ValidateResult {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const rawEnv = apiKey.match(/^\{env:([^}]+)\}$/)?.[1]?.trim()
  // When editing and apiKey is empty, preserve existing env from the original config
  const savedEnv = input.editing && !apiKey ? input.existingEnv : undefined
  const key = apiKey && !rawEnv ? apiKey : undefined

  const { idErr, existsErr } = checkProviderID(
    providerID,
    input.editing,
    input.disabledProviders,
    input.existingProviderIDs,
    input.t,
  )

  const nameError = !name ? input.t("provider.custom.error.name.required") : undefined
  const urlError = !baseURL
    ? input.t("provider.custom.error.baseURL.required")
    : !/^https?:\/\//.test(baseURL)
      ? input.t("provider.custom.error.baseURL.format")
      : undefined

  const seenModels = new Set<string>()
  const modelErrors = input.form.models.map((m) => checkModel(m, seenModels, input.t))
  const modelsValid = modelErrors.every((m) => !m.id && !m.name && m.variants.every((v) => !v.name))

  const seenHeaders = new Set<string>()
  const headerErrors = input.form.headers.map((h) => checkHeader(h, seenHeaders, input.t))
  const headersValid = headerErrors.every((h) => !h.key && !h.value)

  const errors: FormErrors = {
    providerID: idErr ?? existsErr,
    name: nameError,
    baseURL: urlError,
    models: modelErrors,
    headers: headerErrors,
  }

  const ok = !idErr && !existsErr && !nameError && !urlError && modelsValid && headersValid
  if (!ok) return { errors }

  const headers = Object.fromEntries(
    input.form.headers
      .map((h) => ({ key: h.key.trim(), value: h.value.trim() }))
      .filter((h) => !!h.key && !!h.value)
      .map((h) => [h.key, h.value]),
  )

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
        ...resolveEnv(rawEnv, savedEnv),
        options,
        models: Object.fromEntries(input.form.models.map(serializeModel)),
      },
    },
  }
}
