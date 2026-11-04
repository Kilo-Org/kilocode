import type { OpenCodeClient } from "@opencode/client"

type Log = (...args: unknown[]) => void

export async function prepareDirectory(
  client: Pick<OpenCodeClient, "config" | "agent" | "mcp">,
  dir: string,
): Promise<void> {
  // Listing agents computes the agent and skill state for the directory, so
  // the first prompt does not pay for that discovery after it arrives.
  const results = await Promise.allSettled([
    client.config.get({ location: { directory: dir } }),
    client.agent.list({ location: { directory: dir } }),
    client.mcp.list({ location: { directory: dir } }),
  ])
  const failure = results.find((result) => result.status === "rejected")
  if (failure?.status === "rejected") throw failure.reason
}

async function warm(client: Pick<OpenCodeClient, "mcp">, dir: string, log: Log): Promise<void> {
  log(`[MCPWarmup] Starting for ${dir}`)
  await client.mcp.list({ location: { directory: dir } })
  log(`[MCPWarmup] Completed for ${dir}`)
}

export function startSession<T>(
  client: Pick<OpenCodeClient, "mcp">,
  dir: string,
  create: () => Promise<T>,
  log: Log,
): Promise<T> {
  void warm(client, dir, log).catch((err) => log(`[MCPWarmup] Failed for ${dir}:`, err))
  return create()
}