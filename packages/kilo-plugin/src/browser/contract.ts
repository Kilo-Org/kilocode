import { ENTRIES, SHA256, UPSTREAM } from "./contract.generated"
import type { Entry } from "./contract-shape"

/**
 * Pinned tools no backend can run, so none is offered to a model. `browser_run_code_unsafe` runs Playwright code in
 * the server process: the Playwright backend will not run model code in the CLI process, and the extension cannot
 * compile code under its script policy. The pin and its SHA-256 keep it, so the handshake still matches the
 * extension's vendored contract.
 */
const UNSERVED: Record<string, true> = { browser_run_code_unsafe: true }

/** The pinned Playwright MCP contract shared by every backend. */
export namespace BrowserContract {
  /** The tools every backend offers: the pinned list without the ones none can run. */
  export const entries: readonly Entry[] = ENTRIES.filter((entry) => !UNSERVED[entry.name])
  /**
   * Whether a pinned tool is one no backend runs. The registry hides it; a backend that is handed it directly
   * refuses it instead of forwarding it, so the capability cannot come back through another caller.
   */
  export function unserved(name: string): boolean {
    return UNSERVED[name] === true
  }
  export const sha256 = SHA256
  export const upstream = UPSTREAM
}
