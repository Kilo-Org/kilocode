import { Database } from "@opencode-ai/core/database/database"
import { assertNetwork } from "@kilocode/sandbox"
import { Effect, Schema } from "effect"
import { EffectBridge } from "../../effect/bridge"
import { KiloSessions } from "../../kilo-sessions/kilo-sessions"
import { RemoteProtocol } from "../../kilo-sessions/remote-protocol"
import { BrowserClient } from "../browser-task/client"
import { BrowserOwner } from "../browser-task/owner"
import { Tool } from "../../tool/tool"

const Params = Schema.declare<RemoteProtocol.BrowserTaskArguments>(
  (value): value is RemoteProtocol.BrowserTaskArguments => RemoteProtocol.BrowserTaskArguments.safeParse(value).success,
)

export const BrowserTaskTool = Tool.define(
  "browser_task",
  Effect.gen(function* () {
    const db = yield* Database.Service
    return {
      description:
        "Delegate a goal to an explicitly enabled browser profile through the authenticated relay. " +
        "The signed-in browser panel must remain open. List providers without dispatching work. " +
        "Run requires provider_id and goal, including every continuation with browser_task_id. " +
        "Status and cancel require an owned browser_task_id, with optional job_id. " +
        "Recover takes no IDs and retrieves this parent's durable intents without replay. " +
        "Each run requires tool permission and fresh browser tab consent. Only the new goal reaches the browser, not this chat history. " +
        "Cancellation cannot undo issued actions. After uncertain execution, close affected tabs, release execution locks, " +
        "and use panel recovery before an explicit continuation with fresh tab consent.",
      parameters: Params,
      // Keep the advertised schema an object for model APIs that reject top-level unions.
      // Params still enforces each operation's exact fields through the shared strict contract.
      jsonSchema: {
        type: "object" as const,
        additionalProperties: false,
        properties: {
          operation: { type: "string" as const, enum: ["list", "run", "status", "cancel", "recover"] },
          provider_id: {
            type: "string" as const,
            description:
              "Required for run, including continuation. Use an explicit provider ID from list. Omit otherwise.",
          },
          goal: {
            type: "string" as const,
            minLength: 1,
            maxLength: RemoteProtocol.BROWSER_GOAL_MAX_BYTES,
            description: "Required only for run. At most 16 KiB of UTF-8. Send only the new goal.",
          },
          browser_task_id: {
            type: "string" as const,
            description:
              "Owned conversation ID. Optional for run continuation; required for status/cancel. Omit for list/recover.",
          },
          job_id: {
            type: "string" as const,
            description: "Optional for status/cancel. Omit to select the owned conversation's latest job.",
          },
        },
        required: ["operation"],
      },
      formatValidationError: () =>
        "Use only the fields for the selected operation. Run requires provider_id and goal; status/cancel require browser_task_id. Identity fields are forbidden.",
      execute: (args: RemoteProtocol.BrowserTaskArguments, ctx: Tool.Context) =>
        Effect.gen(function* () {
          yield* assertNetwork("tool:browser_task", "executeTool")
          // Getting the client never enables remote access, shares a session, or exposes credentials.
          const client = yield* Effect.try({ try: () => KiloSessions.browser(), catch: (err) => err })
          if (args.operation === "list")
            return yield* Effect.tryPromise({ try: () => client.list(ctx.abort), catch: (err) => err })
          yield* ctx.ask({
            permission: "browser_task",
            patterns: [
              args.operation === "run"
                ? args.provider_id
                : args.operation === "recover"
                  ? "recover"
                  : args.browser_task_id,
            ],
            always: [],
            metadata: {
              operation: args.operation,
              ...(args.operation === "run" ? { provider_id: args.provider_id, goal: args.goal } : {}),
            },
          })
          const owner = yield* BrowserOwner.open(ctx).pipe(Effect.provideService(Database.Service, db))
          const bridge = yield* EffectBridge.make()
          const hooks = {
            signal: ctx.abort,
            metadata: (value: BrowserClient.Output) =>
              bridge.promise(ctx.metadata({ title: `Browser task: ${value.status}`, metadata: value })),
          }
          return yield* Effect.tryPromise({
            try: async () => {
              if (args.operation === "recover") return client.recover(owner, hooks)
              if (args.operation !== "run")
                return client.status(owner, args.browser_task_id, args.job_id, hooks, args.operation === "cancel")
              await owner.approve(args.provider_id)
              return client.run(
                owner,
                {
                  providerId: args.provider_id,
                  goal: args.goal,
                  ...(args.browser_task_id ? { browserTaskId: args.browser_task_id } : {}),
                },
                hooks,
              )
            },
            catch: (err) => err,
          })
        }).pipe(
          Effect.catch((err) => {
            if (err instanceof BrowserOwner.Error)
              return Effect.succeed({
                status: "rejected",
                reason: err.data.code,
                summary: err.data.message,
                evidence: [],
                effectsUncertain: false,
                retryable: err.data.retryable,
              } satisfies BrowserClient.Output)
            if (err instanceof BrowserClient.Error) return Effect.succeed(BrowserClient.rejected(err))
            return Effect.die(err)
          }),
          Effect.map((result) => ({
            title: `Browser task: ${result.status}`,
            output: JSON.stringify(result, null, 2),
            metadata: { ...result },
          })),
        ),
    }
  }),
)
