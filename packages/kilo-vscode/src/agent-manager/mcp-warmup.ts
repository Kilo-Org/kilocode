import type { KiloClient } from "@kilocode/sdk/v2/client"

type Client = Pick<KiloClient, "mcp">
type Log = (...args: unknown[]) => void

async function warm(client: Client, dir: string, log: Log): Promise<void> {
  log(`[MCPWarmup] Starting for ${dir}`)
  await client.mcp.status({ directory: dir }, { throwOnError: true })
  log(`[MCPWarmup] Completed for ${dir}`)
}

export function startSession<T>(client: Client, dir: string, create: () => Promise<T>, log: Log): Promise<T> {
  void warm(client, dir, log).catch((err) => log(`[MCPWarmup] Failed for ${dir}:`, err))
  return create()
}
