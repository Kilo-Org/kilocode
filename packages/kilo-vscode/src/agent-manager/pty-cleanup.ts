import type { KiloClient } from "@kilocode/sdk/v2/client"

export async function removePtys(
  getClient: (directory: string) => Promise<KiloClient>,
  directory: string,
): Promise<void> {
  const client = await getClient(directory)
  const result = await client.v2.pty.list({ location: { directory } })
  if (result.error) throw result.error
  const failed: unknown[] = []
  for (const pty of result.data?.data ?? []) {
    try {
      const removed = await client.v2.pty.remove({ ptyID: pty.id, location: { directory } })
      if (removed.error) failed.push(removed.error)
    } catch (error) {
      failed.push(error)
    }
  }
  if (failed.length > 0) throw new AggregateError(failed, `Failed to remove PTYs in ${directory}`)
}
