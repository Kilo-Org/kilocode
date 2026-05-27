import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { makeRuntime } from "@/effect/run-service"
import { resolveKiloIndexingAuth } from "@/kilocode/indexing-auth"

export type OrgSource = () => Promise<string | undefined>

const config = makeRuntime(Config.Service, Config.defaultLayer)
const auth = makeRuntime(Auth.Service, Auth.defaultLayer)

export async function getAuthOrgId(): Promise<string | undefined> {
  try {
    const [cfg, info] = await Promise.all([config.runPromise((svc) => svc.get()), auth.runPromise((svc) => svc.get("kilo"))])
    return resolveKiloIndexingAuth({ config: cfg, auth: info }).organizationId
  } catch (err) {
    console.warn("[session-export] org lookup failed", err)
    return undefined
  }
}
