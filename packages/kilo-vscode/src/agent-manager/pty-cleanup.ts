import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { ScriptTerminalManager } from "./ScriptTerminalManager"
import type { TerminalRouter } from "./terminal-routing"

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

export async function acquirePtyCleanup(input: {
  directory: string
  terminals: TerminalRouter
  scripts: ScriptTerminalManager
  getClient: (directory: string) => Promise<KiloClient>
}) {
  const releases = await Promise.all([
    input.terminals.blockDirectory(input.directory),
    input.scripts.blockDirectory(input.directory),
  ])
  try {
    await input.terminals.closeDirectory(input.directory)
    await input.scripts.closeDirectory(input.directory)
    await removePtys(input.getClient, input.directory)
    let released = false
    return () => {
      if (released) return
      released = true
      for (const release of releases) release()
    }
  } catch (error) {
    for (const release of releases) release()
    throw error
  }
}
