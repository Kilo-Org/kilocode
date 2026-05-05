import { z } from "zod"
import {
  CUSTOM_PROVIDER_INTERFACE_IDS,
  PROVIDER_ID_PATTERN,
  customProviderInterface,
  customProviderPackage,
} from "./provider-model"
import type { CustomProviderInterface, CustomProviderPackage } from "./provider-model"

const INVALID_PROVIDER_ID = "Invalid provider ID"
const INVALID_ENV = "Invalid environment variable name"
const INVALID_BASE_URL = "Base URL must start with http:// or https://"

export const ProviderIDSchema = z.string().trim().regex(PROVIDER_ID_PATTERN, INVALID_PROVIDER_ID)
export const EnvSchema = z
  .string()
  .trim()
  .regex(/^[A-Z_][A-Z0-9_]*$/, INVALID_ENV)

const VariantConfigSchema = z.object({
  enable_thinking: z.boolean().optional(),
  thinking: z.object({ type: z.enum(["enabled", "disabled"]) }).optional(),
  reasoningEffort: z.enum(["none", "minimal", "low", "medium", "high", "xhigh", "max"]).optional(),
  chat_template_args: z.object({ enable_thinking: z.boolean() }).optional(),
})

export type VariantConfig = z.infer<typeof VariantConfigSchema>

const ModalitySchema = z.enum(["text", "audio", "image", "video", "pdf"])

export const CustomProviderConfigSchema = z
  .object({
    npm: z.string().optional(),
    interfaceType: z.enum(CUSTOM_PROVIDER_INTERFACE_IDS).optional(),
    name: z.string().trim().min(1).max(200),
    env: z.array(EnvSchema).max(1).optional(),
    options: z
      .object({
        interfaceType: z.enum(CUSTOM_PROVIDER_INTERFACE_IDS).optional(),
        baseURL: z
          .string()
          .trim()
          .url()
          .refine((value) => value.startsWith("http://") || value.startsWith("https://"), {
            message: INVALID_BASE_URL,
          }),
        headers: z.record(z.string().trim().min(1), z.string().trim().min(1)).optional(),
      })
      .strict(),
    models: z
      .record(
        z.string().trim().min(1),
        z
          .object({
            name: z.string().trim().min(1).max(200),
            reasoning: z.boolean().optional(),
            attachment: z.boolean().optional(),
            limit: z
              .object({
                context: z.number().int().positive(),
                output: z.number().int().min(0).optional(),
              })
              .optional(),
            modalities: z
              .object({
                input: z.array(ModalitySchema),
                output: z.array(ModalitySchema),
              })
              .optional(),
            variants: z.record(z.string().trim().min(1), VariantConfigSchema).optional(),
          })
          .strict(),
      )
      .refine((value) => Object.keys(value).length > 0, "At least one model is required"),
  })
  .strict()

export type SanitizedProviderConfig = {
  npm: CustomProviderPackage
  name: string
  env?: string[]
  options: {
    baseURL: string
    interfaceType?: CustomProviderInterface
    headers?: Record<string, string>
  }
  models: Record<
    string,
    {
      name: string
      reasoning?: true
      attachment?: boolean
      limit?: { context: number; output: number }
      modalities?: { input: Array<z.infer<typeof ModalitySchema>>; output: Array<z.infer<typeof ModalitySchema>> }
      variants?: Record<string, VariantConfig>
    }
  >
}

export type CustomProviderAuthChange = { mode: "preserve" } | { mode: "clear" } | { mode: "set"; key: string }

export const MASKED_CUSTOM_PROVIDER_KEY = "********"

type Issue = { error: string; issue?: z.ZodIssue }

function fail(error: string, issue?: z.ZodIssue): Issue {
  return issue ? { error, issue } : { error }
}

export function validateProviderID(providerID: string): { value: string } | Issue {
  const result = ProviderIDSchema.safeParse(providerID)
  if (result.success) return { value: result.data }
  const issue = result.error.issues[0]
  return fail(issue?.message ?? INVALID_PROVIDER_ID, issue)
}

export function parseCustomProviderSecret(raw: string): { value: { apiKey?: string; env?: string } } | Issue {
  const value = raw.trim()
  if (!value) return { value: {} }

  const match = value.match(/^\{env:([^}]+)\}$/)
  if (!match) return { value: { apiKey: value } }

  const env = match[1]?.trim() ?? ""
  const result = EnvSchema.safeParse(env)
  if (result.success) return { value: { env: result.data } }
  const issue = result.error.issues[0]
  return fail(issue?.message ?? INVALID_ENV, issue)
}

export function resolveCustomProviderAuth(apiKey: string | undefined, changed: boolean): CustomProviderAuthChange {
  const key = apiKey?.trim()
  if (!changed) return { mode: "preserve" }
  if (key) return { mode: "set", key }
  return { mode: "clear" }
}

export function resolveCustomProviderKey(auth: "api" | "oauth" | "wellknown" | undefined) {
  if (auth !== "api") return ""
  return MASKED_CUSTOM_PROVIDER_KEY
}

export function normalizeCustomProviderConfig(
  config: z.output<typeof CustomProviderConfigSchema>,
): SanitizedProviderConfig {
  const type = config.interfaceType ?? customProviderInterface(config.npm, config.options.interfaceType)
  const headers = config.options.headers
    ? Object.fromEntries(
        Object.entries(config.options.headers)
          .map(([key, value]) => [key.trim(), value.trim()] as const)
          .filter(([key, value]) => key.length > 0 && value.length > 0),
      )
    : undefined

  return {
    npm: customProviderPackage(type),
    name: config.name.trim(),
    ...(config.env ? { env: config.env.map((item) => item.trim()) } : {}),
    options: {
      baseURL: config.options.baseURL.trim(),
      interfaceType: type,
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    },
    models: Object.fromEntries(
      Object.entries(config.models).map(([id, model]) => [
        id.trim(),
        {
          name: model.name.trim(),
          ...(model.reasoning ? { reasoning: true as const } : {}),
          ...(typeof model.attachment === "boolean" ? { attachment: model.attachment } : {}),
          ...(model.limit ? { limit: { context: model.limit.context, output: model.limit.output ?? 0 } } : {}),
          ...(model.modalities
            ? {
                modalities: {
                  input: [...model.modalities.input],
                  output: [...model.modalities.output],
                },
              }
            : {}),
          ...(model.variants && Object.keys(model.variants).length > 0 ? { variants: model.variants } : {}),
        },
      ]),
    ),
  }
}

export function sanitizeCustomProviderConfig(provider: unknown): { value: SanitizedProviderConfig } | Issue {
  const result = CustomProviderConfigSchema.safeParse(provider)
  if (!result.success) {
    const issue = result.error.issues[0]
    return fail(issue?.message ?? "Invalid custom provider config", issue)
  }

  return { value: normalizeCustomProviderConfig(result.data) }
}

type AnyRecord = Record<string, unknown>

function isRecord(v: unknown): v is AnyRecord {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

/**
 * Build a provider patch that includes null sentinels for models and variants
 * that existed in the previous config but are absent from the new one. The CLI
 * `config.update` endpoint deep-merges the payload with the existing config;
 * without explicit nulls, removed entries would persist on disk.
 */
export function withCustomProviderDeletions(existing: unknown, next: SanitizedProviderConfig): SanitizedProviderConfig {
  if (!isRecord(existing)) return next
  const oldModels = isRecord(existing.models) ? existing.models : {}
  const patched: AnyRecord = { ...next.models }

  for (const id of Object.keys(oldModels)) {
    if (!(id in patched)) {
      patched[id] = null
      continue
    }
    const oldModel = oldModels[id]
    const oldVariants = isRecord(oldModel) && isRecord(oldModel.variants) ? oldModel.variants : {}
    const newModel = patched[id]
    if (!isRecord(newModel)) continue
    const newVariants = isRecord(newModel.variants) ? newModel.variants : {}
    const removedVariants = Object.keys(oldVariants).filter((v) => !(v in newVariants))
    if (removedVariants.length === 0) continue
    const nulls = Object.fromEntries(removedVariants.map((v) => [v, null]))
    patched[id] = { ...newModel, variants: { ...newVariants, ...nulls } }
  }

  return { ...next, models: patched as SanitizedProviderConfig["models"] }
}
