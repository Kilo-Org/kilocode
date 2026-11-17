import type { Entry } from "./contract-shape"

export type BackendID = "playwright" | "extension"

export type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }

export type CallResult = { content: ContentBlock[]; isError: boolean }

export type CallContext = {
  /** The turn's abort signal: closing the browser or cancelling the session ends the call. */
  signal?: AbortSignal
  /**
   * `<class>:<origin>` pairs this session already approved, and the step tokens approved for this call. The tools
   * reserve both for the permission layer: a backend reads them to scope frames and sensitive steps, and an empty
   * list means nothing was granted yet.
   */
  authorized?: readonly string[]
  sensitive?: readonly string[]
}

/**
 * The browser as the tool layer sees it: one tool list and one result shape, whichever backend runs. A backend owns
 * its browser (launch, profiles, lifecycle); the tools own the model-facing output.
 */
export type BrowserBackend = {
  readonly id: BackendID
  readonly contractSha: string
  /** The contract tools this browser actually serves, in the pinned order. */
  listTools(): Promise<readonly Entry[]>
  callTool(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<CallResult>
  dispose(): Promise<void>
}

/**
 * Raised for a tool call when no browser can serve it. The message is model-facing; `hint` is the setup step the UI
 * shows, never the model.
 */
export class UnavailableError extends Error {
  readonly hint: string

  constructor(hint: string, message = UNAVAILABLE_MESSAGE) {
    super(message)
    this.name = "BrowserUnavailableError"
    this.hint = hint
  }
}

export const UNAVAILABLE_MESSAGE = "The browser is not available right now."

/** A tool the pinned contract lists but this browser cannot run. */
export const UNSUPPORTED_MESSAGE = "unsupported in this browser"

export class UnsupportedError extends Error {
  constructor() {
    super(UNSUPPORTED_MESSAGE)
    this.name = "BrowserUnsupportedError"
  }
}

/** `unsupported in this browser` is a tool error the model is meant to see, not a crash. */
export function isModelFacing(error: unknown): error is Error {
  return error instanceof UnavailableError || error instanceof UnsupportedError
}
