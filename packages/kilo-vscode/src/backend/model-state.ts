import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { ModelStateRpc } from "@opencode-ai/schema/kilocode/model-state"

export function createModelStateMethods(client: OpenCodeClient, directory: string) {
  const rpc = client.rpc(ModelStateRpc.Definition)
  return {
    list: () => rpc.list({}, { location: { directory } }),
    set: (input: typeof ModelStateRpc.SetInput.Type) => rpc.set(input, { location: { directory } }),
    clear: (input: typeof ModelStateRpc.ClearInput.Type) => rpc.clear(input, { location: { directory } }),
    reset: () => rpc.reset({}, { location: { directory } }),
  }
}
