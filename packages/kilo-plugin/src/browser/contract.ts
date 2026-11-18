import { ENTRIES, SHA256, UPSTREAM } from "./contract.generated"
import type { Entry } from "./contract-shape"

/** The pinned Playwright MCP contract shared by every backend. */
export namespace BrowserContract {
  export const entries: readonly Entry[] = ENTRIES
  export const sha256 = SHA256
  export const upstream = UPSTREAM
}
