import { Context } from "effect"

/**
 * The hub connection the extension backend needs. The host owns the transport (hub discovery, pairing, native
 * messaging, reconnects); this port is the semantic surface the tool layer drives, so no wire type crosses into the
 * backend and the transport's error codes stay in one place.
 */
export namespace BrowserHub {
  /** One content block of a tool result. Audio and resource blocks are not part of the tool contract. */
  export type Block = { readonly type: "text"; readonly text: string } | { readonly type: "image"; readonly data: string; readonly mimeType: string }

  /** The step a token was issued for: a late report names the call that caused it, not the one carrying the news. */
  export type Step = { tool: string; argumentsHash: string }

  /** One grant a call needs, in the extension's own spelling of an origin. */
  export type Need = { class: string; origin: string; frame?: boolean; reason?: string }

  export type Meta = {
    url?: string
    origin?: string
    /** Origins whose iframes the extension withheld from this result, outermost first. */
    withheldFrames?: readonly string[]
    /** The call may have run before the connection dropped. */
    effectsUncertain?: boolean
    /** Grants the result needs after the action ran; asked without repeating the action. */
    needs?: readonly Need[]
  }

  export type Reply = { content: readonly Block[]; isError?: boolean; meta?: Meta }

  /** The connected extension, as `ext.hello` described it. */
  export type Info = {
    protocol: readonly number[]
    contractSha: string
    extensionVersion: string
    profileLabel: string
  }

  /**
   * Why a hub call failed. The transport maps the protocol's numeric codes to these kinds; a kind the CLI does not
   * know is `unknown`, which the backend refuses instead of guessing.
   */
  export type Kind =
    | "unavailable"
    /** The browser is connected but did not finish the call in time; it may have run in part. */
    | "timeout"
    | "busy"
    | "taken"
    | "stopped"
    | "unsupported"
    | "permission"
    | "blocked"
    | "moved"
    | "mismatch"
    | "unknown"

  /**
   * Why no extension answered an `unavailable` call, as far as the hub connection knows: no hub is reachable
   * (`no_hub`), or none whose extension has the selected browser profile (`no_profile`); a hub runs but no extension
   * ever connected to it (`unpaired`: not installed, "Allow local agents" off, or the pairing page ignored); an
   * extension was connected and went away (`disconnected`: the switch turned off, the browser closed); or one is
   * connected but did not answer the call (`connected`: a timeout, a cancelled turn).
   */
  export type Absence =
    | { kind: "no_hub" }
    | { kind: "no_profile"; profile: string }
    | { kind: "unpaired" }
    | { kind: "disconnected" }
    | { kind: "connected" }

  export class Failure extends Error {
    readonly kind: Kind
    readonly items: readonly Need[]
    readonly stepToken: string | undefined
    /** The call the token was issued for, when the browser names it. */
    readonly step: Step | undefined
    /** The action already ran; the CLI asks without repeating it. */
    readonly afterAction: boolean
    /** The call may have reached the browser before the connection dropped. */
    readonly uncertain: boolean
    readonly meta: Meta | undefined
    /** Why no extension answered, for an `unavailable` failure the hub connection can explain. */
    readonly absence: Absence | undefined

    constructor(input: {
      kind: Kind
      message: string
      items?: readonly Need[]
      stepToken?: string
      step?: Step
      afterAction?: boolean
      uncertain?: boolean
      meta?: Meta
      absence?: Absence
    }) {
      super(input.message)
      this.name = "BrowserHubFailure"
      this.kind = input.kind
      this.items = input.items ?? []
      this.stepToken = input.stepToken
    this.step = input.step
      this.afterAction = input.afterAction === true
      this.uncertain = input.uncertain === true
      this.meta = input.meta
      this.absence = input.absence
    }
  }

  export type CallInput = {
    sessionHandle: string
    name: string
    arguments: Record<string, unknown>
    /** The (class, origin) pairs this session already approved. */
    authorized: readonly { class: string; origin: string }[]
    /** Step tokens approved for this call, one per sensitive step. */
    sensitive?: readonly string[]
    signal?: AbortSignal
  }

  export type Upload = { uploadId: string; name: string; size: number; mimeType: string }

  export type Port = {
    /** The connected extension; rejects with `unavailable` while none is reachable. */
    ready(timeoutMs?: number): Promise<Info>
    open(input: { sessionId: string; title: string; cwd: string }): Promise<{ sessionHandle: string; groupId?: string }>
    close(sessionHandle: string): Promise<void>
    /** The tool names the extension serves for its own contract. */
    list(): Promise<readonly string[]>
    call(input: CallInput): Promise<Reply>
    /** The connected extension as it reported itself, or undefined when none is connected. Never creates a connection. */
    reported(): Promise<Info | undefined>
    begin(input: Upload): Promise<void>
    /** One base64 chunk, at most `MaxUploadChunk` bytes of payload. */
    chunk(input: { uploadId: string; index: number; data: string }): Promise<void>
    end(uploadId: string): Promise<void>
    onRevoked(listener: (input: { sessionHandle: string; reason: string }) => void): () => void
  }

  export interface Interface {
    /**
     * The hub connection for one browser profile, created on first use and reused afterwards. `target` selects a
     * profile by its label; without one the reachable hub is used.
     */
    port(target?: string | null): Port
  }

  export class Service extends Context.Service<Service, Interface>()("@kilocode/BrowserHub") {}
}
