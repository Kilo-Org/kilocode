import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { makeRuntime } from "@/effect/run-service"
import { resolveKiloIndexingAuth } from "@/kilocode/indexing-auth"

export type OrgState = { type: "personal" } | { type: "org"; id: string } | { type: "unknown" }
export type OrgSource = () => Promise<OrgState>

const config = makeRuntime(Config.Service, Config.defaultLayer)
const auth = makeRuntime(Auth.Service, Auth.defaultLayer)

export async function getAuthOrgId(): Promise<OrgState> {
  try {
    const [cfg, info] = await Promise.all([
      config.runPromise((svc) => svc.get()),
      auth.runPromise((svc) => svc.get("kilo")),
    ])
    const id = resolveKiloIndexingAuth({ config: cfg, auth: info }).organizationId
    if (id) return { type: "org", id }
    return { type: "personal" }
  } catch (err) {
    console.warn("[session-export] org lookup failed", err)
    return { type: "unknown" }
  }
}
