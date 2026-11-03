import { define } from "@opencode/plugin/effect/plugin"
import { Agent } from "@opencode/schema/agent"
import { KiloAgentManagerRpc } from "@opencode/schema/kilocode/agent-manager"
import { SessionID } from "@opencode/schema/session-id"
import { FSUtil } from "@opencode/util/fs-util"
import { Global } from "@opencode/util/global"
import { Effect, Ref, type Scope } from "effect"
import { guard } from "./guard"
import { installPermission } from "./permission"
import { createService, type Emit } from "./service"
import { SnapshotCleanup } from "./snapshot"
import { makeTools, type Runtime } from "./tool"

// The Agent Manager plugin: the `kilocode.agent-manager` RPC that the VS Code extension answers, the two model-facing
// tools that ask it, the state-file guard on the mutation tools, and the side-effect permission hardening.
export const KiloAgentManagerPlugin = define<FSUtil.Service | Global.Service | Scope.Scope>({
  id: "kilocode.agent-manager",
  effect: Effect.fn("KiloAgentManagerPlugin")(function* (ctx) {
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const emit = yield* Ref.make<Emit | undefined>(undefined)
    const manager = yield* createService({
      requested: (request) =>
        Ref.get(emit).pipe(
          Effect.flatMap((current) =>
            current ? current.requested(request) : Effect.die(new Error("Agent Manager RPC is not registered")),
          ),
        ),
      cancelled: (event) =>
        Ref.get(emit).pipe(
          Effect.flatMap((current) =>
            current ? current.cancelled(event) : Effect.die(new Error("Agent Manager RPC is not registered")),
          ),
        ),
    })

    const registration = yield* ctx.rpc
      .register(KiloAgentManagerRpc.Definition, {
        list: () => manager.list(),
        reply: (input, context) =>
          manager.reply(input).pipe(
            Effect.as({}),
            Effect.catchTags({
              "AgentManager.NotFoundError": () => Effect.fail(context.error("not_found", "Unknown Agent Manager request")),
              "AgentManager.InvalidReplyError": () =>
                Effect.fail(context.error("invalid_reply", "The result does not match the pending request")),
            }),
          ),
        reject: (input, context) =>
          manager.reject(input).pipe(
            Effect.as({}),
            Effect.catchTag("AgentManager.NotFoundError", () =>
              Effect.fail(context.error("not_found", "Unknown Agent Manager request")),
            ),
          ),
        removeSnapshot: (input, context) =>
          SnapshotCleanup.remove({
            data: global.data,
            project: ctx.location.project.id,
            directory: ctx.location.project.directory,
            worktree: input.worktree,
            fs,
          }).pipe(
            Effect.map((removed) => ({ removed })),
            Effect.catch((error) =>
              Effect.fail(
                context.error(
                  "invalid_worktree",
                  error instanceof Error ? error.message : String(error),
                ),
              ),
            ),
          ),
      })
      .pipe(Effect.orDie)

    yield* Ref.set(emit, {
      requested: (request) => registration.events.emit("requested", request).pipe(Effect.orDie),
      cancelled: (event) => registration.events.emit("cancelled", event).pipe(Effect.orDie),
    })

    const runtime: Runtime = {
      permission: { assert: (input) => ctx.permission.assert(input) },
      session: {
        model: (sessionID) =>
          ctx.session
            .get({ sessionID: SessionID.make(sessionID) })
            .pipe(
              Effect.map((session) => session.model),
              Effect.orElseSucceed(() => undefined),
            ),
      },
      agents: {
        list: () => ctx.agent.list().pipe(Effect.map((result) => result.data), Effect.orDie),
        get: (id) =>
          ctx.agent
            .get({ agentID: Agent.ID.make(id) })
            .pipe(
              Effect.map((result) => result.data),
              Effect.orElseSucceed(() => undefined),
            ),
      },
      models: {
        list: () => ctx.model.list().pipe(Effect.map((result) => result.data), Effect.orDie),
        default: () => ctx.model.default().pipe(Effect.map((result) => result.data), Effect.orDie),
      },
      manager,
      start: (event) => registration.events.emit("start", event).pipe(Effect.orDie),
    }

    const tools = makeTools(runtime)
    yield* ctx.tool.transform((editor) => {
      editor.add(tools.agentManager)
      editor.add(tools.models)
    })
    yield* installPermission(ctx)
    yield* guard(ctx)
    yield* Effect.addFinalizer(() => manager.dispose)
  }),
})
