import * as path from "path"
import { fetchProfile } from "@kilocode/kilo-gateway"

export namespace Identity {
  let machineId: string | null = null
  let userId: string | null = null
  let organizationId: string | null = null
  let dataPath = ""

  export function setDataPath(p: string) {
    dataPath = p
  }

  export async function getMachineId(): Promise<string> {
    if (machineId) return machineId

    const override = process.env.KILO_MACHINE_ID
    if (override) {
      machineId = override
      return machineId
    }

    const filepath = path.join(dataPath, "telemetry-id")
    const file = Bun.file(filepath)

    if (await file.exists()) {
      machineId = await file.text()
      return machineId
    }

    machineId = crypto.randomUUID()
    await Bun.write(filepath, machineId)
    return machineId
  }

  export function getDistinctId(): string {
    return userId || machineId || "unknown"
  }

  export function getUserId(): string | null {
    return userId
  }

  export function getOrganizationId(): string | null {
    return organizationId
  }

  export function setOrganizationId(orgId: string | null) {
    organizationId = orgId
  }

  export async function updateFromKiloAuth(token: string | null, accountId?: string): Promise<void> {
    organizationId = accountId || null

    if (!token) {
      userId = null
      return
    }

    const profile = await fetchProfile(token).catch(() => null)
    userId = profile?.email || null
  }

  export function reset() {
    userId = null
    organizationId = null
  }
}
