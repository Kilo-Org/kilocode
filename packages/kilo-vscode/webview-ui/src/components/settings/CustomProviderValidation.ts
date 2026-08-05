import type { ReasoningEffort, ReasoningOption } from "../../../../src/shared/custom-provider"
import type { CustomProviderPackage } from "../../../../src/shared/provider-model"
import type { Modalities, ModelEntry } from "./CustomProviderModelCard"

type Translator = (key: string, params?: Record<string, string>) => string

export type HeaderRow = {
  key: string
  value: string
}

export type FormState = {
  providerID: string
  name: string
  npm: CustomProviderPackage
  baseURL: string
  apiKey: string
  efforts: ReasoningEffort[]
  metadata?: ReasoningOption[]
  models: ModelEntry[]
  headers: HeaderRow[]
  saving: boolean
}

export type FormErrors = {
  providerID: string | undefined
  name: string | undefined
  baseURL: string | undefined
  models: Array<{ id?: string; name?: string }>
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
      npm: CustomProviderPackage
      name: string
      env?: string[]
      reasoning_options?: ReasoningOption[]
      options: { baseURL: string; headers?: Record<string, string> }
      models: Record<string, unknown>
    }
  }
}

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/

function checkModel(m: ModelEntry, seenModels: Set<string>, t: Translator) {
  const id = m.id.trim()
  const key = id.toLowerCase()
  let idErr: string | undefined
  if (!id) idErr = t("provider.custom.error.required")
  else if (seenModels.has(key)) idErr = t("provider.custom.error.duplicate")
  else seenModels.add(key)

  const nameErr = !m.name.trim() ? t("provider.custom.error.required") : undefined
  return { id: idErr, name: nameErr }
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

function metadata(efforts: ReasoningEffort[]): ReasoningOption[] {
  return efforts.length > 0 ? [{ type: "effort", values: efforts }] : []
}

function modalities(m: ModelEntry): Modalities | undefined {
  const input = new Set(m.modalities.input ?? [])
  const existing = input.size > 0 || (m.modalities.output?.length ?? 0) > 0
  if (!existing && !m.supportsImages) return

  const image = input.has("image")
  const changed = image !== m.supportsImages
  if (m.supportsImages && !image) {
    input.add("text")
    input.add("image")
  }
  if (!m.supportsImages) input.delete("image")

  const include = input.size > 0 || (m.modalities.input !== undefined && !changed)
  if (!include && !m.modalities.output?.length) return

  return {
    ...(include ? { input: [...input] } : {}),
    ...(m.modalities.output?.length ? { output: m.modalities.output } : {}),
  }
}

function serializeModel(m: ModelEntry): [string, Record<string, unknown>] {
  const entry: Record<string, unknown> = { name: m.name.trim(), reasoning: m.reasoning }
  const modes = modalities(m)
  if (modes) entry.modalities = modes
  if (m.reasoning && m.metadata !== undefined) entry.reasoning_options = m.metadata
  else if (m.reasoning && m.mode === "custom") entry.reasoning_options = metadata(m.efforts)
  else if (m.reasoning && m.mode === "none") entry.reasoning_options = []
  if (m.variants) entry.variants = m.variants
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
  const modelsValid = modelErrors.every((m) => !m.id && !m.name)

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
        npm: input.form.npm,
        name,
        ...resolveEnv(rawEnv, savedEnv),
        ...(input.form.metadata !== undefined
          ? { reasoning_options: input.form.metadata }
          : input.form.efforts.length > 0
            ? { reasoning_options: metadata(input.form.efforts) }
            : {}),
        options,
        models: Object.fromEntries(input.form.models.map(serializeModel)),
      },
    },
  }
}
