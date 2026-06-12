import { fetchDefaultModel } from "@kilocode/kilo-gateway"
import { resolveKiloCredentials } from "@/kilocode/auth/credentials"

export function fetchKiloDefaultModel(config: unknown, auth: unknown) {
  const credentials = resolveKiloCredentials({ config, auth })
  return fetchDefaultModel(credentials.token, credentials.organizationId)
}
