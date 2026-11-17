import type { Backend } from "./backend"
import { UnavailableError } from "./backend"
import { BrowserContract } from "./contract"

const HINT =
  "Turn on Allow local agents in the Kilo browser extension. The extension transport arrives in a later release."

/** Placeholder for the extension transport: the tool list is known, calls report no browser yet. */
export const extensionBackend: Backend = {
  id: "extension",
  contractSha: BrowserContract.sha256,
  tools: BrowserContract.entries,
  call: () => Promise.reject(new UnavailableError(HINT)),
  dispose: () => Promise.resolve(),
}
