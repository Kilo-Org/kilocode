import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { resolveKiloIndexingAuth } from "@/kilocode/indexing-auth"

export type OrgSource = () => Promise<string | undefined>

export async function getAuthOrgId(): Promise<string | undefined> {
  try {
    const [cfg, auth] = await Promise.all([Config.get(), Auth.get("kilo")])
    return resolveKiloIndexingAuth({ config: cfg, auth }).organizationId
  } catch (err) {
    console.warn("[session-export] org lookup failed", err)
    return undefined
  }
}
