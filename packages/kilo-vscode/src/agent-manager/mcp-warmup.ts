import type { KiloClient } from "@kilocode/sdk/v2/client"

type Client = Pick<KiloClient, "mcp">
type Log = (...args: unknown[]) => void

export async function prepareDirectory(
  client: Pick<KiloClient, "config" | "mcp" | "kilocode">,
  dir: string,
): Promise<void> {
  const results = await Promise.allSettled([
    client.config.get({ directory: dir }, { throwOnError: true }),
    client.mcp.status({ directory: dir }, { throwOnError: true }),
    client.kilocode.snapshot.prepare({ directory: dir }, { throwOnError: true }),
  ])
  const failure = results.find((result) => result.status === "rejected")
  if (failure?.status === "rejected") throw failure.reason
}

async function warm(client: Client, dir: string, log: Log): Promise<void> {
  log(`[MCPWarmup] Starting for ${dir}`)
  await client.mcp.status({ directory: dir }, { throwOnError: true })
  log(`[MCPWarmup] Completed for ${dir}`)
}

export function startSession<T>(client: Client, dir: string, create: () => Promise<T>, log: Log): Promise<T> {
  void warm(client, dir, log).catch((err) => log(`[MCPWarmup] Failed for ${dir}:`, err))
  return create()
}
