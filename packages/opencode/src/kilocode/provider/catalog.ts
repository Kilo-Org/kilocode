import type { Auth } from "@/auth"
import { fetchDefaultModel, getKiloUrlFromToken, KILO_API_BASE } from "@kilocode/kilo-gateway"

type Options = { kilocodeOrganizationId?: string; baseURL?: string; apiKey?: string; kilocodeToken?: string }

export function token(options: Options | undefined, info: Auth.Info | undefined) {
  if (process.env.KILO_API_KEY) return process.env.KILO_API_KEY
  if (info?.type === "oauth") return info.access
  if (info?.type === "api") return info.key
  if (options?.kilocodeToken != null) return options.kilocodeToken
  return options?.apiKey || undefined
}

function scoped(url: string) {
  return URL.parse(url)
    ?.pathname.match(/\/api\/organizations\/([^/]+)/)
    ?.at(1)
}

export function organization(options: Options | undefined, info: Auth.Info | undefined) {
  return (
    process.env.KILO_ORG_ID ||
    (info?.type === "oauth" ? info.accountId : undefined) ||
    options?.kilocodeOrganizationId ||
    scoped(getKiloUrlFromToken(options?.baseURL ?? "", token(options, info) ?? ""))
  )
}

export function compatible(options: { baseURL?: string; kilocodeToken?: string; kilocodeOrganizationId?: string }) {
  const org = scoped(getKiloUrlFromToken(options.baseURL ?? "", options.kilocodeToken ?? ""))
  return !org || !options.kilocodeOrganizationId || org === options.kilocodeOrganizationId
}

export async function recommend(
  models: Readonly<Record<string, unknown>>,
  options: Options | undefined,
  info: Auth.Info | undefined,
  known = true,
) {
  const first = Object.keys(models).at(0)
  if (!first || !known) return first
  const org = organization(options, info)
  const key = token(options, info)
  if (!compatible({ baseURL: options?.baseURL, kilocodeToken: key, kilocodeOrganizationId: org })) return undefined
  const fallback = org ? first : undefined
  const endpoint = getKiloUrlFromToken(options?.baseURL || KILO_API_BASE, key ?? "")
  if (URL.parse(endpoint)?.origin !== URL.parse(KILO_API_BASE)?.origin) return fallback
  const model = await fetchDefaultModel(key, org, fallback)
  return Object.hasOwn(models, model) ? model : fallback
}
