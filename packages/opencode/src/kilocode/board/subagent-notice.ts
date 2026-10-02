// Shared-board INFO from a subagent to its parent about something a human did
// to the subagent (steered it, interrupted it). Gated by the board setting;
// failures are logged under the caller's label and never fail the caller.
import { Effect } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import type { Config } from "@/config/config"
import type { RuntimeFlags } from "@/effect/runtime-flags"
import type { SessionID } from "@/session/schema"
import { BoardEnabled } from "./enabled"
import { BoardStore } from "./store"

export const post = Effect.fn("KiloSubagentNotice.post")(function* (input: {
  from: SessionID
  to: SessionID
  messageID: string
  body: string
  /** Log message when posting fails. */
  label: string
  config: Config.Interface
  flags: RuntimeFlags.Info
  database: Database.Interface
}) {
  if (!BoardEnabled.on(yield* input.config.get(), input.flags)) return
  yield* BoardStore.post({
    sessionID: input.from,
    messageID: input.messageID,
    to: input.to,
    type: "INFO",
    body: input.body,
  }).pipe(
    Effect.provideService(Database.Service, input.database),
    Effect.catch((err) => Effect.logWarning(input.label, { "session.id": input.from, err })),
  )
})

export * as KiloSubagentNotice from "./subagent-notice"
