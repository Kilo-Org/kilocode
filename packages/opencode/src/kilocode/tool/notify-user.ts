import { Tool } from "@/tool/tool"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { Effect, Schema } from "effect"
import DESCRIPTION from "./notify-user.txt"

const Params = Schema.Struct({
  message: Schema.Trim.check(Schema.isMinLength(1), Schema.isMaxLength(500)).check(
    Schema.makeFilter((value) => (value.trim() ? undefined : "Message must not be empty")),
  ),
})

type Meta = { notificationId: string; ok: boolean; reason?: string }

const FAILURE_TEXT =
  "Push notifications are unavailable: this session is not connected to Kilo cloud. " +
  "Sign in with `kilo auth login` and ensure the session is sharing before retrying."

const SUCCESS_TEXT =
  "Notification sent to the user's Kilo app. Delivery may be suppressed by the user's " +
  "Agent notifications preference, an active rate limit, or because the user is currently " +
  "viewing this session; the tool receives no delivery feedback."

function title(ok: boolean) {
  return ok ? "Notification sent" : "Notification unavailable"
}

export const NotifyUserTool = Tool.define<typeof Params, Meta, KiloSessions.Service, "notify_user">(
  "notify_user",
  Effect.gen(function* () {
    const sessions = yield* KiloSessions.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          const id = crypto.randomUUID()
          const message = params.message
          const result = yield* sessions.sendAgentNotification(ctx.sessionID, { id, message })
          if (result.ok) {
            return {
              title: title(true),
              output: SUCCESS_TEXT,
              metadata: { notificationId: id, ok: true },
            }
          }
          return {
            title: title(false),
            output: result.reason === "not_connected" ? FAILURE_TEXT : `Push notification failed: ${result.reason}.`,
            metadata: { notificationId: id, ok: false, reason: result.reason },
          }
        }),
    }
  }),
)
