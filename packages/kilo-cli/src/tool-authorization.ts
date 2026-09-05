import { Instance } from "@opencode-ai/core/instance/service"
import { Agent } from "@opencode-ai/core/agent"
import { Location } from "@opencode-ai/core/location"
import { Permission } from "@opencode-ai/core/permission"
import { PermissionSaved } from "@opencode-ai/core/permission/saved"
import { PluginHooks } from "@opencode-ai/core/plugin/hooks"
import { Session } from "@opencode-ai/core/session"
import { Tool } from "@opencode-ai/schema/tool"
import { Effect } from "effect"

export type ToolAuthorizationInput = {
  readonly action: string
  readonly sessionID: Tool.Context["sessionID"]
  readonly agent: Tool.Context["agent"]
  readonly messageID: Tool.Context["messageID"]
  readonly callID: Tool.Context["id"]
  readonly metadata?: Record<string, unknown>
  readonly resources?: ReadonlyArray<string>
  readonly save?: ReadonlyArray<string>
}

export type ToolAuthorizer = (input: ToolAuthorizationInput) => Effect.Effect<void, Tool.Error>
export type BoardNoticeInput = Pick<ToolAuthorizationInput, "sessionID" | "agent" | "messageID" | "callID">

type Services = { sessions: Pick<Session.Interface, "get">; instances: Instance.Interface }

// Host-only service composition. Plugin Tool.options.permission controls tool
// visibility, not execution approval; reuse the native assertion/interrupt path.
export function createToolAuthorizer(services: Services): ToolAuthorizer {
  return (input) =>
    Effect.gen(function* () {
      const session = yield* services.sessions.get(input.sessionID)
      yield* Permission.Service.use((permission) =>
        permission.assert({
          sessionID: input.sessionID,
          agent: input.agent,
          action: input.action,
          resources: input.resources ?? ["*"],
          save: input.save ?? ["*"],
          metadata: input.metadata,
          source: { type: "tool", messageID: input.messageID, id: input.callID },
        }),
      ).pipe(services.instances.provide(session))
    }).pipe(
      Effect.mapError(
        (error) =>
          new Tool.Error({
            message:
              error instanceof Permission.CorrectedError
                ? `User feedback: ${error.feedback}`
                : error instanceof Permission.BlockedError
                  ? error.message
                  : "Tool operation was not authorized",
          }),
      ),
    )
}

// Permission.Interface has no non-interactive evaluation method. Mirror only
// its configured-deny -> saved grants -> plugin evaluation order, using its
// own evaluator. Never call ask/assert here: a notice must not open approval
// UI after an unrelated tool. Replace this bridge if Core exports evaluation.
export function createBoardNoticeGuard(services: Services & { saved: Pick<PermissionSaved.Interface, "list"> }) {
  return (input: BoardNoticeInput): Effect.Effect<boolean> =>
    Effect.gen(function* () {
      const session = yield* services.sessions.get(input.sessionID)
      return yield* Effect.gen(function* () {
        const agents = yield* Agent.Service
        const location = yield* Location.Service
        const hooks = yield* PluginHooks.Service
        const agent = yield* agents.resolve(input.agent)
        if (!agent || Permission.evaluate("board_read", "*", agent.permissions).effect === "deny") return false
        const grants = (yield* services.saved.list({ projectID: location.project.id })).map((rule) => ({
          action: rule.action,
          resource: rule.resource,
          effect: "allow" as const,
        }))
        const evaluation = yield* hooks.trigger("permission", "evaluate", {
          sessionID: input.sessionID,
          agent: input.agent,
          action: "board_read",
          resources: ["*"],
          source: { type: "tool", messageID: input.messageID, id: input.callID },
          effect: Permission.evaluate("board_read", "*", agent.permissions, grants).effect,
        })
        return evaluation.effect === "allow"
      }).pipe(services.instances.provide(session))
    }).pipe(Effect.orElseSucceed(() => false))
}
