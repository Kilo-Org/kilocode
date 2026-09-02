import type { Auth } from "@/auth"
import type { Provider } from "@/provider/provider"
import { fetchDefaultModel } from "@kilocode/kilo-gateway"

export function organization(
  options: { kilocodeOrganizationId?: string; baseURL?: string } | undefined,
  info: Auth.Info | undefined,
) {
  return (
    options?.kilocodeOrganizationId ??
    URL.parse(options?.baseURL ?? "")
      ?.pathname.match(/\/api\/organizations\/([^/]+)/)
      ?.at(1) ??
    (info?.type === "oauth" ? info.accountId : undefined) ??
    process.env.KILO_ORG_ID
  )
}

export async function recommend(
  models: Provider.Info["models"],
  options: { kilocodeOrganizationId?: string; baseURL?: string; apiKey?: string } | undefined,
  info: Auth.Info | undefined,
) {
  const org = organization(options, info)
  const stored = info?.type === "oauth" ? info.access : info?.key
  const token = org ? process.env.KILO_API_KEY || stored || options?.apiKey : stored
  const fallback = org ? Object.keys(models).at(0) : undefined
  if (org && !fallback) return undefined
  const model = await fetchDefaultModel(token, org, fallback)
  return Object.hasOwn(models, model) ? model : fallback
}
