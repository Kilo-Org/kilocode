import * as path from "path"

export namespace Identity {
  let machineId: string | null = null
  let userId: string | null = null
  let organizationId: string | null = null
  let dataPath = ""

  export function setDataPath(p: string) {
    dataPath = p
  }

  export async function getMachineId(): Promise<string | undefined> {
    if (machineId) return machineId
    const override = process.env.KILO_MACHINE_ID
    if (override) {
      machineId = override
      return machineId
    }

    // Don't write to the working directory if no data path is configured
    if (!dataPath) return undefined

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

  export async function updateFromKiloAuth(_token: string | null, _accountId?: string): Promise<void> {
    userId = null
    organizationId = null
  }

  export function reset() {
    userId = null
    organizationId = null
  }
}
