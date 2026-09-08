import type { KiloClient } from "@kilocode/sdk/v2/client"
import type { ScriptTerminalManager } from "./ScriptTerminalManager"
import type { SessionTerminalManager } from "./SessionTerminalManager"
import type { TerminalRouter } from "./terminal-routing"

export async function block(target: string, blocked: Map<string, number>, creates?: Set<Promise<unknown>>) {
  blocked.set(target, (blocked.get(target) ?? 0) + 1)
  if (creates) await Promise.allSettled([...creates])
  let released = false
  return () => {
    if (released) return
    released = true
    const count = blocked.get(target)
    if (!count || count === 1) blocked.delete(target)
    else blocked.set(target, count - 1)
  }
}

export async function removePtys(
  getClient: (directory: string) => Promise<KiloClient>,
  directory: string,
): Promise<void> {
  const client = await getClient(directory)
  const result = await client.v2.pty.list({ location: { directory } })
  if (result.error) throw result.error
  const failed: unknown[] = []
  const ptys = result.data?.data ?? []
  for (let index = 0; index < ptys.length; index += 4) {
    await Promise.all(
      ptys.slice(index, index + 4).map(async (pty) => {
        try {
          const removed = await client.v2.pty.remove({ ptyID: pty.id, location: { directory } })
          if (removed.error) failed.push(removed.error)
        } catch (error) {
          failed.push(error)
        }
      }),
    )
  }
  if (failed.length > 0) throw new AggregateError(failed, `Failed to remove PTYs in ${directory}`)
}

export async function acquirePtyCleanup(input: {
  directory: string
  terminals: TerminalRouter
  integrated: SessionTerminalManager
  scripts: ScriptTerminalManager
  getClient: (directory: string) => Promise<KiloClient>
}) {
  const releases = await Promise.all([
    input.terminals.blockDirectory(input.directory),
    input.scripts.blockDirectory(input.directory),
  ])
  try {
    input.integrated.closeDirectory(input.directory)
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
