import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { SessionUsageRpc } from "@opencode-ai/schema/kilocode/session-usage"
import { result, type AdapterOptions } from "./result"

export function createUsageMethods(client: OpenCodeClient, defaultDirectory: string) {
  const rpc = client.rpc(SessionUsageRpc)
  return {
    sessionModelUsage: <Throw extends boolean = false>(
      input: { sessionID: string; directory?: string; workspace?: string },
      options?: AdapterOptions<Throw>,
    ) =>
      result(
        () =>
          rpc.get(
            { sessionID: input.sessionID },
            {
              ...options,
              location: { directory: input.directory ?? defaultDirectory, workspace: input.workspace },
            },
          ),
        options,
      ),
  }
}
