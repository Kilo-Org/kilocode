// Validation and serialization for the custom provider dialog: it produces the v2 `providers.<id>` value with
// `package`, the `settings.baseURL`/`headers` overlays and `models.<id>` with `capabilities`. The API key is returned
// separately so the dialog stores it as a credential.
import type { CustomProviderPackage } from "./provider-visibility"

type Translator = (key: string, params?: Record<string, string>) => string

export type ModelEntry = {
  id: string
  name: string
  reasoning: boolean
  supportsImages: boolean
  /** The raw `models.<id>.variants` value, carried through unchanged because the dialog does not edit it. */
  variants?: unknown
}

export type ModelErrors = { id?: string; name?: string }

export type HeaderRow = {
  key: string
  value: string
}

export type FormState = {
  providerID: string
  name: string
  package: CustomProviderPackage
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
  models: ModelErrors[]
  headers: Array<{ key?: string; value?: string }>
}

export type CustomProviderConfigValue = {
  name: string
  package: CustomProviderPackage
  env?: string[]
  settings: { baseURL: string }
  headers?: Record<string, string>
  models: Record<
    string,
    {
      name: string
      capabilities: { input: string[]; reasoning?: { supported: true } }
      variants?: unknown
    }
  >
}

type ValidateArgs = {
  form: FormState
  t: Translator
  editing: boolean
  disabledProviders: string[]
  existingProviderIDs: Set<string>
  /** Preserved env vars from the existing provider config (edit mode only). */
  existingEnv?: string[]
}

type ValidateResult = {
  errors: FormErrors
  result?: {
    providerID: string
    name: string
    /** The key to store as a credential, when the form supplies one. */
    key: string | undefined
    env: string[] | undefined
    config: CustomProviderConfigValue
  }
}

const PROVIDER_ID = /^[a-z0-9][a-z0-9-_]*$/
const ENV_NAME = /^[A-Z_][A-Z0-9_]*$/

function checkModel(m: ModelEntry, seenModels: Set<string>, t: Translator): ModelErrors {
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

function serializeModel(m: ModelEntry): CustomProviderConfigValue["models"][string] {
  return {
    name: m.name.trim(),
    capabilities: {
      input: m.supportsImages ? ["text", "image"] : ["text"],
      ...(m.reasoning ? { reasoning: { supported: true as const } } : {}),
    },
    ...(m.variants !== undefined ? { variants: m.variants } : {}),
  }
}

/** Reads an `{env:VAR}` API-key value: the key comes from an environment variable instead of a stored credential. */
export function parseEnvKey(apiKey: string): string | undefined {
  const raw = apiKey.trim()
  const match = raw.match(/^\{env:([^}]+)\}$/)
  if (!match) return
  const name = match[1]?.trim() ?? ""
  return ENV_NAME.test(name) ? name : undefined
}

type ConfigRecord = Record<string, unknown>

function record(value: unknown): ConfigRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ConfigRecord) : {}
}

/**
 * Merges the dialog's value into the existing `providers.<id>`, so fields the dialog does not model survive an edit:
 * other provider settings, `body`, model `limit`/`cost`/`variants` and extra capability keys. A model the dialog no
 * longer lists is removed, and an unchecked Reasoning toggle clears `capabilities.reasoning`.
 */
export function mergeProviderConfig(existing: unknown, produced: CustomProviderConfigValue): CustomProviderConfigValue {
  if (!existing || typeof existing !== "object" || Array.isArray(existing)) return produced
  const before = existing as ConfigRecord
  const beforeModels = record(before.models)

  const models: ConfigRecord = {}
  for (const [id, model] of Object.entries(produced.models)) {
    const prior = beforeModels[id]
    if (!prior || typeof prior !== "object") {
      models[id] = model
      continue
    }
    const capabilities: ConfigRecord = { ...record((prior as ConfigRecord).capabilities), ...model.capabilities }
    if (!model.capabilities.reasoning) delete capabilities.reasoning
    models[id] = { ...(prior as ConfigRecord), ...model, capabilities }
  }

  const merged: ConfigRecord = {
    ...before,
    ...produced,
    settings: { ...record(before.settings), ...produced.settings },
    models,
  }
  if (!produced.env) delete merged.env
  return merged as CustomProviderConfigValue
}

export function validateCustomProvider(input: ValidateArgs): ValidateResult {
  const providerID = input.form.providerID.trim()
  const name = input.form.name.trim()
  const baseURL = input.form.baseURL.trim()
  const apiKey = input.form.apiKey.trim()

  const rawEnv = parseEnvKey(apiKey)
  const key = apiKey && !rawEnv ? apiKey : undefined
  // A typed key replaces a stored env var; only an untouched edit keeps it.
  const env = rawEnv ? [rawEnv] : key ? undefined : input.editing ? input.existingEnv : undefined

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

  return {
    errors,
    result: {
      providerID,
      name,
      key,
      env,
      config: {
        name,
        package: input.form.package,
        ...(env ? { env } : {}),
        settings: { baseURL },
        ...(Object.keys(headers).length ? { headers } : {}),
        models: Object.fromEntries(input.form.models.map((m) => [m.id.trim(), serializeModel(m)])),
      },
    },
  }
}
