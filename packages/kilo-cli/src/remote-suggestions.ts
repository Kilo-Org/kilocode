import type { OpenCodeClient } from "@opencode-ai/client"
import { Tool } from "@opencode-ai/schema/tool"
import { Effect, Schema } from "effect"

/**
 * v1 suggestion parity (ecccd1f kilocode/suggestion/{index,tool}.ts), ported
 * through existing plugin seams: a `suggest` tool whose execute pends on the
 * holder until the consumer accepts or dismisses, an in-process pending
 * registry (per-enabled-remote instance — never a global singleton), and
 * consumer-shaped wire frames emitted by the remote adapter from update
 * listeners. The consumer contract is fully specified on the deployed side
 * (cloud origin/main cloud-agent-sdk schemas.ts:722-746, normalizer
 * `suggestion.shown` mapping): actions are 1-2 `{label, description?, prompt}`
 * entries and the accepted action's prompt is admitted exactly once through
 * the public session API.
 */

export interface SuggestionAction {
  readonly label: string
  readonly description?: string
  readonly prompt: string
}

export interface SuggestionPending {
  readonly id: string
  readonly sessionID: string
  readonly text: string
  readonly actions: readonly SuggestionAction[]
  readonly tool?: { readonly messageID: string; readonly callID: string } | undefined
}

export type RemoteSuggestionsUpdate =
  | { readonly type: "shown"; readonly suggestion: SuggestionPending }
  | {
      readonly type: "accepted"
      readonly sessionID: string
      readonly requestID: string
      readonly index: number
      readonly action: SuggestionAction
    }
  | { readonly type: "dismissed"; readonly sessionID: string; readonly requestID: string }

/** v1's DismissedError: the pending suggestion was dismissed or cancelled. */
export class SuggestionDismissedError extends Error {
  constructor() {
    super("suggestion dismissed")
    this.name = "SuggestionDismissedError"
  }
}

export interface RemoteSuggestions {
  /**
   * Register a pending suggestion and publish the shown update. `done`
   * resolves with the accepted action, or rejects with SuggestionDismissedError
   * when dismissed, auto-dismissed, cancelled, or disposed — v1's promise
   * shape without the Instance/Bus coupling. Synchronous insertion: the
   * subscriber-eligibility check runs in the caller's interruptible execution
   * (`ensureEligible`) before this is called, so cancellation during the
   * lookup can never defer an orphaned card.
   */
  show(input: {
    readonly sessionID: string
    readonly text: string
    readonly actions: ReadonlyArray<SuggestionAction>
    readonly tool?: { readonly messageID: string; readonly callID: string } | undefined
  }): { readonly id: string; readonly done: Promise<SuggestionAction> }
  find(requestID: string): SuggestionPending | undefined
  accept(requestID: string, index: number): boolean
  dismiss(requestID: string): boolean
  /** v1 SessionPrompt parity: a newly queued prompt dismisses the session's pendings. */
  dismissAll(sessionID: string): void
  pending(): readonly SuggestionPending[]
  /**
   * Adapter-supplied viewer-eligibility gate: true only when the session has
   * an active remote subscription (the subscribed session itself or a
   * validated descendant of one). Absent until the adapter installs it, so a
   * check before the adapter exists reports ineligible.
   */
  setEligibility(lookup: (sessionID: string) => Promise<boolean>): void
  /**
   * The subscriber boundary as an interruptible check: remote enabled at the
   * Location does not mean a viewer subscribed to every local session, and a
   * card nobody can see must not hang the model turn. Call this before `show`
   * so cancellation during the lookup prevents later insertion.
   */
  ensureEligible(sessionID: string): Effect.Effect<boolean>
  onUpdate(listener: (update: RemoteSuggestionsUpdate) => void): () => void
  /** Reject every pending (disable/disconnect cleanup); later shows refuse. */
  dispose(): void
}

export function createRemoteSuggestions(): RemoteSuggestions {
  const pending = new Map<
    string,
    {
      info: SuggestionPending
      resolve: (action: SuggestionAction) => void
      reject: (error: unknown) => void
    }
  >()
  const listeners = new Set<(update: RemoteSuggestionsUpdate) => void>()
  let eligibility: ((sessionID: string) => Promise<boolean>) | undefined
  let disposed = false

  // Listeners must never strand a settle: the promise is resolved before the
  // update publishes, and one throwing listener neither skips its peers nor
  // leaks into the settle path.
  const publish = (update: RemoteSuggestionsUpdate) => {
    for (const listener of [...listeners]) {
      try {
        listener(update)
      } catch {
        // Listener failures are the adapter's concern, never the settle's.
      }
    }
  }

  // Dismiss semantics shared by the relay command, the queued-prompt
  // auto-dismiss, and cleanup: the pending entry is removed, the rejected
  // promise releases the awaiting tool, and the consumer learns the card is
  // gone through the dismissed update.
  const dismissEntry = (entry: { info: SuggestionPending; reject: (error: unknown) => void }) => {
    pending.delete(entry.info.id)
    entry.reject(new SuggestionDismissedError())
    publish({ type: "dismissed", sessionID: entry.info.sessionID, requestID: entry.info.id })
  }

  return {
    show(input) {
      // Fresh random request identity per daemon lifetime: a counter restarts
      // with the process, so a resumed session could otherwise receive a stale
      // accept targeting a newer suggestion's id.
      const id = `sug_${crypto.randomUUID()}`
      const info: SuggestionPending = {
        id,
        sessionID: input.sessionID,
        text: input.text,
        actions: input.actions.map((action) => ({ ...action })),
        tool: input.tool ? { ...input.tool } : undefined,
      }
      let resolve!: (action: SuggestionAction) => void
      let reject!: (error: unknown) => void
      const done = new Promise<SuggestionAction>((res, rej) => {
        resolve = res
        reject = rej
      })
      if (disposed) {
        reject(new SuggestionDismissedError())
        return { id, done }
      }
      const entry = { info, resolve, reject }
      pending.set(id, entry)
      publish({ type: "shown", suggestion: info })
      return { id, done }
    },
    find(requestID) {
      return pending.get(requestID)?.info
    },
    accept(requestID, index) {
      const entry = pending.get(requestID)
      if (!entry) return false
      const action = entry.info.actions[index]
      if (!action) return false
      // Settle before notifying so a throwing listener can never strand the
      // already-removed entry's awaiting tool.
      pending.delete(requestID)
      entry.resolve({ ...action })
      publish({ type: "accepted", sessionID: entry.info.sessionID, requestID, index, action: { ...action } })
      return true
    },
    dismiss(requestID) {
      const entry = pending.get(requestID)
      if (!entry) return false
      dismissEntry(entry)
      return true
    },
    dismissAll(sessionID) {
      for (const entry of [...pending.values()]) {
        if (entry.info.sessionID === sessionID) dismissEntry(entry)
      }
    },
    pending() {
      return [...pending.values()].map((entry) => entry.info)
    },
    setEligibility(lookup) {
      eligibility = lookup
    },
    ensureEligible(sessionID) {
      return Effect.promise(async () => {
        if (disposed || !eligibility) return false
        try {
          return await eligibility(sessionID)
        } catch {
          return false
        }
      })
    },
    onUpdate(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    dispose() {
      disposed = true
      for (const entry of [...pending.values()]) dismissEntry(entry)
    },
  }
}

/**
 * The v1 `suggest` tool port (ecccd1f kilocode/suggestion/tool.ts): the model
 * calls it after finishing work, the tool pends until the consumer resolves
 * the card, and the accepted action's prompt is admitted exactly once through
 * the public session API. Slash actions dispatch the command natively — v2's
 * public command API resolves the command server-side, replacing v1's
 * resolvePrompt template fetch — and an unknown command falls back to the raw
 * prompt text like v1's resolvePrompt. Other command failures fail the tool
 * explicitly rather than double-injecting.
 */
export const SuggestParams = Schema.Struct({
  suggest: Schema.String.annotate({ description: "Short suggestion text shown to the user" }),
  actions: Schema.Array(
    Schema.Struct({
      label: Schema.String.annotate({ description: "Button or option label (1-5 words)" }),
      description: Schema.optional(Schema.String).annotate({
        description: "Brief explanation of what this action does",
      }),
      prompt: Schema.String.annotate({
        description: "Synthetic user prompt to inject when this action is accepted",
      }),
    }),
  )
    .check(Schema.isNonEmpty(), Schema.isMaxLength(2))
    .annotate({ description: "Available actions the user can take" }),
})

export function suggestTool(options: {
  readonly suggestions: RemoteSuggestions
  readonly client: Pick<OpenCodeClient, "session" | "command">
}): Tool.Info<typeof SuggestParams, undefined> {
  return {
    name: "suggest",
    input: SuggestParams,
    // v1 parity: suggest is a direct model-facing tool (never CodeMode-wrapped),
    // so the scripted card flow reaches the model as a first-class call.
    options: { codemode: false },
    description:
      "Suggest follow-up actions to the user after completing work. Renders interactive buttons in the " +
      "user's client; when the user picks one, the chosen action's prompt is admitted as the next user " +
      "prompt. Only call this once per turn, after your final summary, and only for actions the user " +
      "genuinely should decide on. 1-2 actions maximum; each prompt must be self-contained.",
    execute: (input, context) =>
      Effect.gen(function* () {
        // The subscriber boundary as an interruptible check before any holder
        // state exists: cancellation during the lookup prevents later
        // insertion, and an ineligible session settles the tool immediately.
        const eligible = yield* options.suggestions.ensureEligible(context.sessionID)
        if (!eligible) {
          return {
            content: "No remote viewer is subscribed to this session; the suggestion was not delivered.",
            metadata: { unavailable: true },
          }
        }
        const shown = options.suggestions.show({
          sessionID: context.sessionID,
          text: input.suggest,
          actions: input.actions,
          tool: { messageID: context.messageID, callID: context.id },
        })
        const settled = yield* Effect.promise(() =>
          shown.done.then(
            (value) => ({ kind: "accepted" as const, action: value }),
            (error: unknown) => {
              if (error instanceof SuggestionDismissedError) return { kind: "dismissed" as const }
              throw error
            },
          ),
        ).pipe(
          // v1 abort-listener parity: an interrupted turn cancels the pending
          // card so the consumer's suggestion state clears with the execution.
          Effect.onInterrupt(() => Effect.sync(() => options.suggestions.dismiss(shown.id))),
        )
        if (settled.kind === "dismissed") {
          return { content: "User dismissed the suggestion.", metadata: { dismissed: true } }
        }
        const action = settled.action
        yield* injectAction(options.client, context.sessionID, action.prompt)
        return {
          content: `User accepted the suggestion "${action.label}". The request was admitted as a follow-up prompt.`,
          metadata: { accepted: action, dismissed: false },
        }
      }).pipe(
        Effect.mapError((error) =>
          new Tool.Error({ message: error instanceof Error ? error.message : String(error) }),
        ),
      ),
  }
}

// v1 resolvePrompt parity: a slash action dispatches the command natively (the
// public command API resolves the template server-side); an unknown command
// admits the raw prompt text instead, exactly like v1's resolvePrompt fallback.
// Dispatch failures after a resolved command fail the tool explicitly — no
// fallback that could inject twice.
function injectAction(
  client: Pick<OpenCodeClient, "session" | "command">,
  sessionID: Tool.Context["sessionID"],
  prompt: string,
) {
  const name = prompt.startsWith("/") ? prompt.slice(1).split(/\s/, 1)[0] : undefined
  if (!name) return admitRaw(client, sessionID, prompt)
  const args = prompt.slice(1 + name.length).trim()
  return Effect.gen(function* () {
    const session = yield* Effect.promise(() => client.session.get({ sessionID }).catch(() => undefined))
    if (!session) return yield* admitRaw(client, sessionID, prompt)
    const listed = yield* Effect.promise(() => client.command.list({ location: session.location }).catch(() => undefined))
    if (!listed?.data.some((command) => command.name === name)) {
      return yield* admitRaw(client, sessionID, prompt)
    }
    yield* Effect.tryPromise({
      try: () => client.session.command({ sessionID, command: name, text: args }),
      catch: (error) => new Error(`suggestion command "${name}" failed to dispatch: ${String(error)}`),
    })
  })
}

function admitRaw(client: Pick<OpenCodeClient, "session" | "command">, sessionID: Tool.Context["sessionID"], prompt: string) {
  return Effect.tryPromise({
    try: () => client.session.prompt({ sessionID, text: prompt }),
    catch: (error) => new Error(`failed to admit suggestion prompt: ${String(error)}`),
  })
}
