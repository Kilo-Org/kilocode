import { EventServiceClient as SharedEventServiceClient } from "@kilocode/kilo-gateway/event-service"
import type { KiloChatEventMap, KiloChatEventName } from "./types"

export { HandshakeTimeoutError, WebSocketAuthError, WebSocketConnectError } from "@kilocode/kilo-gateway/event-service"
export type { EventHandler, EventServiceConfig } from "@kilocode/kilo-gateway/event-service"

export class EventServiceClient extends SharedEventServiceClient {
  on<N extends KiloChatEventName>(
    event: N,
    handler: (context: string, payload: KiloChatEventMap[N]) => void,
  ): () => void
  on<T = unknown>(event: string, handler: (context: string, payload: T) => void): () => void
  on(event: string, handler: (context: string, payload: unknown) => void): () => void {
    return super.on(event, handler)
  }
}
