import type { Entry } from "./contract-shape"
import type { BackendID } from "./settings"

export type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }

export type CallResult = { content: ContentBlock[]; isError: boolean }

export type CallContext = { session: string }

/** A browser backend exposes the same tool list and the same results to the agent. */
export type Backend = {
  id: BackendID
  contractSha: string
  tools: readonly Entry[]
  call(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<CallResult>
  dispose(): Promise<void>
}

/** Raised for a tool call when no browser can serve it. The message is model-facing. */
export class UnavailableError extends Error {
  readonly hint: string

  constructor(hint: string, message = "The browser is not available right now.") {
    super(message)
    this.name = "BrowserUnavailableError"
    this.hint = hint
  }
}
