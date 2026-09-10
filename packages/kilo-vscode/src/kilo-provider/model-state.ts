import { ModelStateRpc } from "@opencode-ai/schema/kilocode/model-state"
import { Schema } from "effect"
import type { KiloClient } from "../backend/index"

type PostMessage = (msg: unknown) => void

/** Preserve the original webview messages while the host owns persistence. */
export async function handleMessage(
  type: string,
  message: Record<string, unknown>,
  client: KiloClient | null,
  post: PostMessage,
): Promise<boolean> {
  if (!["persistModelSelection", "clearModelSelection", "requestModelSelections"].includes(type)) return false
  if (!client) throw new Error("Connect to the Kilo server to manage model selections")
  if (type === "persistModelSelection") {
    await client.modelState.set(Schema.decodeUnknownSync(ModelStateRpc.SetInput)(message))
    return true
  }
  if (type === "clearModelSelection") {
    await client.modelState.clear(Schema.decodeUnknownSync(ModelStateRpc.ClearInput)(message))
    return true
  }
  post({ type: "modelSelectionsLoaded", selections: await client.modelState.list() })
  return true
}

export async function reset(client: KiloClient | null, post: PostMessage): Promise<void> {
  if (!client) throw new Error("Connect to the Kilo server to reset model selections")
  post({ type: "modelSelectionsLoaded", selections: await client.modelState.reset() })
}
