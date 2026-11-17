import type { Entry } from "./contract-shape"
import type { Item } from "./permission"
import type { BackendID } from "./settings"

export type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }

export type CallResult = { content: ContentBlock[]; isError: boolean }

export type CallContext = {
  session: string
  /** `<class>:<origin>` pairs this session already approved. */
  authorized: readonly string[]
  /** Step tokens approved for this call, one per sensitive step. */
  sensitive: readonly string[]
}

/** A browser backend exposes the same tool list and the same results to the agent. */
export type Backend = {
  id: BackendID
  contractSha: string
  tools: readonly Entry[]
  /**
   * The (class, origin) pairs a call needs, computed before it runs. A backend that
   * cannot know them yet (the extension sees the real origin at action time) omits
   * this and reports `needs_permission` from `call` instead.
   */
  plan?(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<Item[]>
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

/**
 * Raised by a backend when the real origin of a step is not covered by `authorized`.
 * The CLI asks for the items, then retries the call once with the new pairs and any
 * step token, so the backend never prompts and never retries on its own.
 */
export class NeedsPermissionError extends Error {
  readonly items: readonly Item[]
  readonly stepToken?: string

  constructor(items: readonly Item[], stepToken?: string) {
    super("The browser step needs permission.")
    this.name = "BrowserNeedsPermissionError"
    this.items = items
    this.stepToken = stepToken
  }
}
