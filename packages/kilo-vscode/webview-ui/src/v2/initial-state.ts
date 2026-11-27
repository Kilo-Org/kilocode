import type { KiloInitialState } from "../../../src/protocol"

/** Read persisted host state injected into webview HTML by `chat.ts` for synchronous frame-0 hydration. */
export function readKiloInitialState(): Partial<KiloInitialState> | undefined {
  if (typeof window === "undefined") return undefined
  return (window as unknown as { KILO_INITIAL_STATE?: Partial<KiloInitialState> }).KILO_INITIAL_STATE
}
