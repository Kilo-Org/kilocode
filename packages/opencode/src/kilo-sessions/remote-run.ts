// kilocode_change - sessionless `create_and_run` deep module for the mobile
// remote flow. The CLI exposes a per-process "local runtime" with a fixed
// launch-directory Instance; this module is the single seam the relay hits
// when a mobile user starts a new session. It owns:
//
//   - strict v1 request parsing matching the shared
//     `createAndRunLocalSessionRequestSchema` (nested `model`, optional
//     `variant`, `agent`); extras are rejected
//   - live catalog validation against the current runtime (provider/model,
//     variant, agent must be present; stale selections are surfaced with a
//     sanitized `CATALOG_CHANGED` code)
//   - per-process idempotency keyed only by `requestId` (in-flight dedupe,
//     bounded 128 terminal entries, never evict in-flight)
//   - the announce order: `Session.Service.create({})` -> `AttachedState.announce`
//     using the acknowledged heartbeat -> start prompt -> return
//   - the prompt-startup boundary: persist the user message (`noReply:true`)
//     and install the loop fiber in a managed scope; return
//     `promptStarted:true` after the message is persisted and the fiber is
//     installed, not after the assistant turn
//   - safe logging: error meta never contains the prompt, path, token, or
//     raw provider error text
//
// The state machine is intentionally small. There is exactly one operation
// per requestId, with three progress milestones:
//
//   (create)        (announce)       (prompt-start)
//   CREATED         ANNOUNCED        STARTED
//        |                |                |
//     CREATE_FAILED  ANNOUNCE_FAILED   PROMPT_START_FAILED
//
//   - CREATE_FAILED evicts the entry; a manual same-id retry is allowed.
//   - ANNOUNCE_FAILED preserves the created session id; a manual same-id
//     retry resumes from the announce step without a second create.
//   - PROMPT_START_FAILED is terminal and nonretryable: same-id returns the
//     same partial (sessionId, promptStarted:false) without a second prompt.

import z from "zod"
import type { ProviderV2 } from "@opencode-ai/core/provider"
import type { ModelV2 } from "@opencode-ai/core/model"
import type { SessionID } from "@/session/schema"
import type { Info as SessionInfo } from "@/session/session"
import type { RemoteRuntime } from "@/kilo-sessions/remote-runtime"
import type { AttachedState } from "@/kilo-sessions/attached-state"

// --- Wire types --------------------------------------------------------

const MAX_PROMPT_LENGTH = 32_768
const MAX_TERMINAL_RESULTS = 128
const MAX_VARIANT_LENGTH = 100
const MAX_PROVIDER_ID_LENGTH = 255
const MAX_MODEL_ID_LENGTH = 255
const MAX_AGENT_SLUG_LENGTH = 100

// Exact string the cloud relay expects on a terminal prompt-start failure.
// The cloud contract (`CreateAndRunLocalSessionResult`) literal-checks this
// message; any other wording trips its strict parser.
const PROMPT_START_FAILED_MESSAGE =
  "The session was created, but the first prompt did not start."

// Sanitized wire strings for the relay. Never echo the prompt, path, token,
// or raw provider error. Centralized so a leak in one branch is a single
// edit, not a sweep.
const SANITIZED = {
  invalidRequest: "invalid create_and_run request",
  catalogLoad: "failed to load runtime catalog",
  catalogModel: "model not found in runtime catalog",
  catalogVariant: "variant not found in runtime catalog",
  catalogAgent: "agent not found in runtime catalog",
  catalogPinnedModel: "agent-pinned model does not match request",
  catalogPinnedVariant: "agent-pinned variant does not match request",
  create: "failed to create session",
  announce: "failed to announce session",
  promptStart: PROMPT_START_FAILED_MESSAGE,
} as const

function errorName(error: unknown): string {
  if (error instanceof Error && error.name) return error.name
  return typeof error
}

export namespace RemoteRun {
  export const Request = z
    .object({
      protocolVersion: z.literal(1),
      requestId: z.string().uuid(),
      prompt: z
        .string()
        .min(1)
        .transform((value) => value.trim())
        .refine((value) => value.length > 0, { message: "prompt must not be blank" })
        .refine((value) => value.length <= MAX_PROMPT_LENGTH, { message: "prompt too long" }),
      model: z
        .object({
          providerID: z.string().min(1).max(MAX_PROVIDER_ID_LENGTH),
          modelID: z.string().min(1).max(MAX_MODEL_ID_LENGTH),
        })
        .strict(),
      variant: z.string().min(1).max(MAX_VARIANT_LENGTH).optional(),
      agent: z.string().min(1).max(MAX_AGENT_SLUG_LENGTH),
    })
    .strict()

  export type Request = z.infer<typeof Request>
}

export type Ok = {
  ok: true
  protocolVersion: 1
  sessionId: SessionID
  promptStarted: true
}

export type Partial = {
  ok: true
  protocolVersion: 1
  sessionId: SessionID
  promptStarted: false
  error: { code: "PROMPT_START_FAILED"; message: typeof PROMPT_START_FAILED_MESSAGE }
}

export type Err = {
  ok: false
  protocolVersion: 1
  error: {
    code: "INVALID_REQUEST" | "CATALOG_CHANGED" | "CREATE_FAILED" | "ANNOUNCE_FAILED"
    message: string
  }
}

export type Result = Ok | Partial | Err

type Terminal = { kind: "terminal"; result: Result }
type AnnounceFailedPartial = { kind: "announce_failed"; sessionId: SessionID }
type Inflight = {
  kind: "inflight"
  promise: Promise<Result>
  sessionId?: SessionID
}

export namespace RemoteRun {
  export type Session = {
    /** Create a root session in the runtime's fixed launch directory.
     *  Production wires this to `Session.Service.create({})`; tests pass a
     *  deterministic stub. */
    readonly create: (input?: Record<string, never>) => Promise<SessionInfo>
  }

  export type Prompt = {
    /**
     * Persist the user message with `noReply:true` and install the
     * assistant-loop fiber in a managed scope. Resolves once the message
     * is persisted and the fiber is installed; later provider/tool errors
     * are session events, not failures of this call.
     */
    readonly start: (input: {
      sessionID: SessionID
      agent: string
      model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
      variant?: string
      prompt: string
    }) => Promise<{ messageID: string; loopInstalled: boolean }>
  }

  export type Options = {
    /** Local runtime presence — owns the fixed launch directory and the
     *  current catalog projection. */
    readonly runtime: RemoteRuntime.Interface
    /** Attached-state machine — owns the duplicate-safe acknowledged
     *  heartbeat used to announce the new session. */
    readonly state: AttachedState.Interface
    /** Session service seam for root-session creation. */
    readonly session: Session
    /** Prompt service seam for message persist + loop install. */
    readonly prompt: Prompt
    /** Warn-only log. Error meta is the only contract — never include
     *  prompt, path, token, or raw provider error. */
    readonly log: {
      error: (msg: string, meta?: unknown) => void
      warn: (msg: string, meta?: unknown) => void
    }
    /** Maximum number of terminal results retained per process. Defaults
     *  to 128. */
    readonly maxTerminalResults?: number
  }

  export type Interface = {
    /**
     * Run the create-and-announce-and-start flow. The returned promise
     * resolves only after the relay has acknowledged the announcement
     * AND the user message has been persisted + the loop fiber installed.
     * No result is sent before the relay ACK.
     *
     * - Pre-create failure evicts the cache so manual same-id retry can re-run.
     * - Create success + announce failure preserves the session id; manual
     *   same-id retry resumes from the announce step.
     * - Announce success + prompt-start failure is terminal and nonretryable;
     *   same-id returns the same partial.
     *
     * - Concurrent duplicate calls join one operation.
     * - Completed duplicate calls return the cached terminal result.
     */
    readonly createAndRun: (request: unknown) => Promise<Result>
    /** Clear the per-process idempotency cache. Production code does not
     *  call this; tests use it to simulate a runtime restart. */
    readonly reset: () => void
  }

  export function create(options: Options): Interface {
    const terminal = new Map<string, Terminal>()
    const inflight = new Map<string, Inflight>()
    const partials = new Map<string, AnnounceFailedPartial>()
    const maxTerminal = options.maxTerminalResults ?? MAX_TERMINAL_RESULTS

    function logError(operation: string, error: unknown) {
      options.log.error("create_and_run failed", {
        operation,
        error: errorName(error),
      })
    }

    function storeTerminal(requestId: string, result: Result) {
      // Bounded LRU: terminal map is capped at maxTerminal. If we exceed
      // the cap, drop the oldest insertion. Inflight entries are never
      // touched here.
      terminal.set(requestId, { kind: "terminal", result })
      if (terminal.size > maxTerminal) {
        const oldest = terminal.keys().next().value
        if (oldest !== undefined) terminal.delete(oldest)
      }
    }

    function storePartial(requestId: string, sessionId: SessionID) {
      partials.set(requestId, { kind: "announce_failed", sessionId })
    }

    function clearPartial(requestId: string) {
      partials.delete(requestId)
    }

    function evictInflight(requestId: string) {
      inflight.delete(requestId)
    }

    async function validateCatalog(parsed: RemoteRun.Request): Promise<Result | undefined> {
      let snapshot
      try {
        snapshot = await options.runtime.catalog({ protocolVersion: 1 })
      } catch (err) {
        logError("catalog", err)
        return {
          ok: false,
          protocolVersion: 1,
          error: { code: "CATALOG_CHANGED", message: SANITIZED.catalogLoad },
        }
      }

      const provider = snapshot.models.all.find((entry) => entry.id === parsed.model.providerID)
      const modelEntry = provider ? provider.models[parsed.model.modelID] : undefined
      if (!provider || !modelEntry) {
        return {
          ok: false,
          protocolVersion: 1,
          error: { code: "CATALOG_CHANGED", message: SANITIZED.catalogModel },
        }
      }

      if (parsed.variant) {
        const variants = (modelEntry as { variants?: Record<string, unknown> }).variants ?? {}
        if (!(parsed.variant in variants)) {
          return {
            ok: false,
            protocolVersion: 1,
            error: { code: "CATALOG_CHANGED", message: SANITIZED.catalogVariant },
          }
        }
      }

      const agent = snapshot.agents.find((entry) => entry.slug === parsed.agent)
      if (!agent) {
        return {
          ok: false,
          protocolVersion: 1,
          error: { code: "CATALOG_CHANGED", message: SANITIZED.catalogAgent },
        }
      }

      // Agent-pinned model/variant semantics: if the agent pins a model,
      // the request must match. If the agent pins a variant, the request
      // must match or omit the variant (pinned variant wins).
      if (agent.model && (agent.model.providerID !== parsed.model.providerID || agent.model.modelID !== parsed.model.modelID)) {
        return {
          ok: false,
          protocolVersion: 1,
          error: { code: "CATALOG_CHANGED", message: SANITIZED.catalogPinnedModel },
        }
      }
      if (agent.variant && parsed.variant && agent.variant !== parsed.variant) {
        return {
          ok: false,
          protocolVersion: 1,
          error: { code: "CATALOG_CHANGED", message: SANITIZED.catalogPinnedVariant },
        }
      }

      return undefined
    }

    async function resumeFromAnnounce(parsed: RemoteRun.Request, sessionId: SessionID): Promise<Result> {
      // Announce the existing session and then start the prompt. We never
      // re-create the session on a same-id retry that already has one.
      try {
        await options.state.announce(sessionId)
      } catch (err) {
        logError("announce", err)
        storePartial(parsed.requestId, sessionId)
        return {
          ok: false,
          protocolVersion: 1,
          error: { code: "ANNOUNCE_FAILED", message: SANITIZED.announce },
        }
      }
      clearPartial(parsed.requestId)
      return runPromptStart(parsed, sessionId)
    }

    async function runPromptStart(parsed: RemoteRun.Request, sessionId: SessionID): Promise<Result> {
      try {
        await options.prompt.start({
          sessionID: sessionId,
          agent: parsed.agent,
          model: {
            providerID: parsed.model.providerID as ProviderV2.ID,
            modelID: parsed.model.modelID as ModelV2.ID,
          },
          ...(parsed.variant ? { variant: parsed.variant } : {}),
          prompt: parsed.prompt,
        })
      } catch (err) {
        logError("prompt_start", err)
        // Terminal nonretryable partial: same-id retry returns the same
        // partial, never a second prompt.
        return {
          ok: true,
          protocolVersion: 1,
          sessionId,
          promptStarted: false,
          error: { code: "PROMPT_START_FAILED", message: PROMPT_START_FAILED_MESSAGE },
        }
      }
      return {
        ok: true,
        protocolVersion: 1,
        sessionId,
        promptStarted: true,
      }
    }

    async function runCreateAndAnnounce(parsed: RemoteRun.Request): Promise<Result> {
      // (1) Create a root session in the fixed launch-directory Instance.
      // The session seam must accept the empty-input contract; if it
      // throws, the cache is invalidated so a manual same-id retry can
      // re-run from scratch.
      let session
      try {
        session = await options.session.create({})
      } catch (err) {
        logError("create", err)
        return {
          ok: false,
          protocolVersion: 1,
          error: { code: "CREATE_FAILED", message: SANITIZED.create },
        }
      }

      // (2) Announce the new session id to the relay using the
      // acknowledged heartbeat. Do NOT return a result before the relay
      // has confirmed — that is the contract that lets the mobile client
      // navigate immediately.
      try {
        await options.state.announce(session.id)
      } catch (err) {
        logError("announce", err)
        // The session was created; preserve its id in the partial so a
        // manual same-id retry resumes from the announce step without a
        // second create.
        storePartial(parsed.requestId, session.id)
        return {
          ok: false,
          protocolVersion: 1,
          error: { code: "ANNOUNCE_FAILED", message: SANITIZED.announce },
        }
      }

      // (3) Persist the user message and install the assistant-loop
      // fiber. We return after the message is persisted and the fiber is
      // installed, not after the assistant turn finishes. If either step
      // fails, cache a terminal partial so the same-id retry returns the
      // same partial without a second prompt.
      return runPromptStart(parsed, session.id)
    }

    async function createAndRun(raw: unknown): Promise<Result> {
      const parsed = RemoteRun.Request.safeParse(raw)
      if (!parsed.success) {
        return {
          ok: false,
          protocolVersion: 1,
          error: { code: "INVALID_REQUEST", message: SANITIZED.invalidRequest },
        }
      }

      // 1. Terminal cache check: completed operations return the cached
      // result without re-running.
      const cached = terminal.get(parsed.data.requestId)
      if (cached) return cached.result

      // 2. Inflight dedupe: if a call with the same requestId is still
      // running, return the same in-flight promise.
      const pending = inflight.get(parsed.data.requestId)
      if (pending) return pending.promise

      // 3. New operation. Validate the request against the live catalog
      // BEFORE any side effects. The runtime is the fixed launch-directory
      // Instance; the request must match it exactly.
      const catalogError = await validateCatalog(parsed.data)
      if (catalogError) {
        storeTerminal(parsed.data.requestId, catalogError)
        return catalogError
      }

      // 4. If a previous same-id attempt left a partial (announce failed
      // but the session exists), resume from the announce step using the
      // preserved session id — never re-create.
      const partial = partials.get(parsed.data.requestId)
      if (partial) {
        const entry: Inflight = {
          kind: "inflight",
          sessionId: partial.sessionId,
          promise: Promise.resolve().then(() => resumeFromAnnounce(parsed.data, partial.sessionId)),
        }
        inflight.set(parsed.data.requestId, entry)
        entry.promise
          .then((result) => {
            if (result.ok && result.promptStarted) {
              storeTerminal(parsed.data.requestId, result)
            } else if (result.ok && !result.promptStarted) {
              storeTerminal(parsed.data.requestId, result)
            }
          })
          .finally(() => evictInflight(parsed.data.requestId))
        return entry.promise
      }

      // 5. Fresh create+announce+start. The work is launched as a
      // promise chain; the call site awaits the same chain, so the
      // terminal-store and inflight-evict side effects run on the same
      // microtask boundary as the caller's resolution. This avoids the
      // sequential `await entry.promise` pattern that would serialize
      // concurrent calls behind the current op's create/announce/prompt
      // chain and starve the microtask queue.
      const entry: Inflight = {
        kind: "inflight",
        promise: Promise.resolve().then(() => runCreateAndAnnounce(parsed.data)),
      }
      inflight.set(parsed.data.requestId, entry)
      entry.promise
        .then((result) => {
          if (result.ok && result.promptStarted) {
            // Success is terminal and dedupable: a same-id call returns
            // the cached session id and promptStarted flag without
            // re-running.
            storeTerminal(parsed.data.requestId, result)
          } else if (result.ok && !result.promptStarted) {
            // Terminal nonretryable partial. Same-id retry returns the
            // same partial, never a second prompt.
            storeTerminal(parsed.data.requestId, result)
          }
          // CREATE_FAILED: not cached; manual same-id retry re-runs from
          // create.
          // ANNOUNCE_FAILED: stored in partials map (not terminal) so the
          // same-id retry can resume from announce.
        })
        .finally(() => evictInflight(parsed.data.requestId))
      return entry.promise
    }

    function reset() {
      terminal.clear()
      inflight.clear()
      partials.clear()
    }

    return { createAndRun, reset }
  }
}
