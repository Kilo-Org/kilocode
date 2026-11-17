import type { Entry } from "./contract-shape"
import type { BrowserPermission } from "./permission"

export type BackendID = "playwright" | "extension"

export type ContentBlock = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }

type Item = BrowserPermission.Item

/** What a call reported about the page it acted on, for the tool metadata and for frame scoping. */
export type CallMeta = {
  url?: string
  origin?: string
  /** Origins whose iframes were withheld from this result, outermost first. */
  withheldFrames?: readonly string[]
  /** Items the result needs after the action ran; the tool layer asks without repeating the action. */
  needs?: readonly Item[]
}

export type CallResult = { content: ContentBlock[]; isError: boolean; meta?: CallMeta }

export type CallContext = {
  /** The turn's abort signal: closing the browser or cancelling the session ends the call. */
  signal?: AbortSignal
  /** The tool session, so the backend keeps its current page per session instead of one for the process. */
  session?: string
  /** `<class>:<origin>` pairs this session already approved. */
  authorized?: readonly string[]
  /** Step tokens approved for this call, one per sensitive step. */
  sensitive?: readonly string[]
}

/**
 * The browser as the tool layer sees it: one tool list and one result shape, whichever backend runs. A backend owns its
 * browser (launch, profiles, lifecycle); the tools own the model-facing output.
 */
export type BrowserBackend = {
  readonly id: BackendID
  readonly contractSha: string
  /** The contract tools this browser actually serves, in the pinned order. */
  listTools(): Promise<readonly Entry[]>
  /**
   * The (class, origin) pairs a call needs, computed before it runs. A backend that cannot know them yet (the
   * extension sees the real origin at action time) omits this and reports `needs_permission` from `call`.
   */
  plan?(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<Item[]>
  callTool(name: string, args: Record<string, unknown>, ctx: CallContext): Promise<CallResult>
  dispose(): Promise<void>
}

/**
 * Raised when the real origin of a step is not covered by `authorized`. The tool layer asks for the items, then
 * retries the call once with the new pairs and any step token, so the backend never prompts and never retries itself.
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
