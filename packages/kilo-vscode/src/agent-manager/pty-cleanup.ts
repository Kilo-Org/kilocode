import type { KiloClient } from "@kilocode/sdk/v2/client"

export async function removePtys(
  getClient: (directory: string) => Promise<KiloClient>,
  directory: string,
): Promise<void> {
  const client = await getClient(directory)
  const { data, error } = await client.pty.list({ directory })
  if (error) throw error
  for (const pty of data ?? []) {
    const result = await client.pty.remove({ directory, ptyID: pty.id })
    if (result.error) console.warn(`[Kilo New] Failed to remove PTY ${pty.id} in ${directory}:`, result.error)
  }
}
