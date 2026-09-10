import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { result, type AdapterOptions } from "./result"

export function createProcessMethods(client: OpenCodeClient, defaultDirectory: string) {
  return {
    stopSession: <Throw extends boolean = false>(
      input: { sessionID: string; directory?: string; workspace?: string },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        const location = { directory: input.directory ?? defaultDirectory, workspace: input.workspace }
        const shells = await client.shell.list({ location }, options)
        // Native ShellTool records the originating session in this metadata.
        await Promise.all(
          shells.data
            .filter((shell) => shell.metadata.sessionID === input.sessionID)
            .map((shell) => client.shell.remove({ id: shell.id, location }, options)),
        )
        return true
      }, options),
  }
}
