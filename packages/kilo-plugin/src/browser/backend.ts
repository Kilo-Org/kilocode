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
  /** The browser's step token for a post-action need; remembered once the user grants, sent on the identical repeat. */
  stepToken?: string
  /** The step the token was issued for: a late report names the call that caused it, not the one carrying the news. */
  step?: { tool: string; argumentsHash: string }
  /** The action already ran and only its content was withheld: the step is never repeated, the page is read again. */
  afterAction?: true
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
  /** `browser.allow_sensitive`: a download this call starts is kept, with no prompt. */
  allowSensitive?: boolean
}

/**
 * What a page read after a step runs with: the call's grants, whether to read the snapshot itself, and whether to read
 * the tab list for the page's URL and title. Each flag follows the per-tool rule of the read it stands for.
 */
export type PageContext = CallContext & {
  snapshot: boolean
  tabs: boolean
  /**
   * Whether the session's own rules (config, saved choices, organization) allow reading an origin without asking a
   * person. True records the grant for the session, the way an ask those rules answer does.
   */
  readable?: (origin: string) => Promise<boolean>
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
  /**
   * The page state after a step whose result lacks it, for a backend that answers a step with its outcome only (the
   * extension): the result with the page's URL and title and, when `snapshot` is set, its snapshot, in the Playwright
   * MCP's sections. The read runs with the call's grants and never prompts. A backend whose results already carry the
   * page omits this.
   */
  pageState?(name: string, result: CallResult, ctx: PageContext): Promise<CallResult>
  /** Release per-session state when the session ends; a backend without any ignores it. */
  forget?(session: string): void
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
 * shows, never the model. `effectsUncertain` marks a call that may have run before the backend lost the browser; the
 * model text stays the plain unavailable message, and the tool metadata carries the marker.
 */
export class UnavailableError extends Error {
  readonly hint: string
  readonly effectsUncertain: boolean

  constructor(hint: string, message = UNAVAILABLE_MESSAGE, input?: { effectsUncertain?: boolean }) {
    super(message)
    this.name = "BrowserUnavailableError"
    this.hint = hint
    this.effectsUncertain = input?.effectsUncertain === true
  }
}

/**
 * Raised when the browser side speaks a protocol this CLI cannot drive. The message is model-facing; `hint` is the
 * update notice the UI shows.
 */
export class IncompatibleError extends Error {
  readonly hint: string

  constructor(message: string, hint: string) {
    super(message)
    this.name = "BrowserIncompatibleError"
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
