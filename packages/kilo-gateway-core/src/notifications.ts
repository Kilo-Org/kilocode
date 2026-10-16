export * as KiloNotifications from "./notifications.js"

import { Effect, Option, Schema } from "effect"
import { KiloHeaders } from "./headers.js"
import { json, request } from "./http.js"
import { KiloServer } from "./server.js"

const TIMEOUT_MS = 5_000

export const NotificationSchema = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  message: Schema.String,
  action: Schema.optionalKey(
    Schema.Struct({
      actionText: Schema.String,
      actionURL: Schema.String,
    }),
  ),
  showIn: Schema.optionalKey(Schema.Array(Schema.String)),
  suggestModelId: Schema.optionalKey(Schema.String),
})

export type Notification = typeof NotificationSchema.Type

const Response = Schema.Struct({
  notifications: Schema.Array(NotificationSchema),
})
const decode = Schema.decodeUnknownOption(Response)

// Ported from v1 `fetchKilocodeNotifications` (`api/notifications.ts:36-65`):
// fetches `/api/users/notifications` with Kilo attribution headers.
export function get(
  server: string,
  token: string,
  organizationID?: string | null,
  version = "unknown",
): Effect.Effect<readonly Notification[]> {
  return Effect.gen(function* () {
    if (!token) return []
    const response = yield* request(
      `${KiloServer.normalize(server)}/api/users/notifications`,
      {
        headers: {
          ...KiloHeaders.provider({ version, organizationID }),
          Authorization: `Bearer ${token}`,
        },
      },
      "Notifications fetch failed",
      TIMEOUT_MS,
    )
    if (!response.ok) return []
    const parsed = decode(yield* json(response, "Notifications fetch failed"))
    if (Option.isNone(parsed)) return []
    return parsed.value.notifications
  }).pipe(Effect.orElseSucceed(() => []))
}
