import type { Plugin } from "@opencode-ai/plugin/tui"
import { Option, Schema } from "effect"

const handoff = Schema.decodeUnknownOption(
  Schema.Struct({ kiloPlanHandoff: Schema.Struct({ sessionID: Schema.String }) }),
)

export function installPlanHandoff(ctx: Pick<Plugin.Context, "data" | "ui">) {
  const opened = new Set<string>()
  return ctx.data.on("session.tool.success", (event) => {
    const route = ctx.ui.router.current()
    if (route.type !== "session" || route.sessionID !== event.data.sessionID) return
    const metadata = handoff(event.data.metadata)
    if (Option.isNone(metadata)) return
    const sessionID = metadata.value.kiloPlanHandoff.sessionID
    if (opened.has(sessionID)) return
    opened.add(sessionID)
    ctx.ui.tabs.open(route.sessionID)
    if (!ctx.ui.tabs.open(sessionID)) ctx.ui.router.navigate({ type: "session", sessionID })
  })
}
