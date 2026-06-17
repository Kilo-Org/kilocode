import type { KiloClient } from "@kilocode/sdk/v2/client"

export type CloudAgentProfile = {
  label: string
  organizationId?: string
}

export async function resolveCloudAgentProfile(client: KiloClient | null): Promise<CloudAgentProfile> {
  if (!client) throw new Error("Cloud Agent account context is unavailable")
  const res = await client.kilo.profile(undefined, { throwOnError: true })
  const data = record(res.data)
  const profile = record(data?.profile)
  if (!data || !profile || !("currentOrgId" in data)) throw new Error("Cloud Agent account context is unavailable")

  const id = data.currentOrgId
  if (id === null) return { label: text(profile.name) || text(profile.email) || "Personal account" }
  if (typeof id !== "string" || !id.trim()) throw new Error("Cloud Agent account context is unavailable")

  const org = Array.isArray(profile.organizations)
    ? profile.organizations.map(record).find((item) => item?.id === id)
    : undefined
  return { label: text(org?.name) || "Organization account", organizationId: id }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value instanceof Object ? (value as Record<string, unknown>) : undefined
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : ""
}
