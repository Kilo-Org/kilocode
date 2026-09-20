import { Wakeup } from "@/kilocode/wakeup"
import { Tool } from "@/tool/tool"
import { Effect, Schema } from "effect"
import DESCRIPTION from "./cancel-wakeup.txt"

const Action = Schema.Literals(["list", "cancel"])
type Action = Schema.Schema.Type<typeof Action>

export const Params = Schema.Struct({
  action: Action.annotate({ description: "Operation to perform" }),
  id: Schema.optional(Schema.String).annotate({
    description: "Required for cancel. Id of the pending wakeup to cancel.",
  }),
}).check(
  Schema.makeFilter((params: { action: Action; id?: string }) => {
    if (params.action !== "cancel") return undefined
    if (params.id?.trim()) return undefined
    return "id is required when action is cancel"
  }),
)
export type Params = Schema.Schema.Type<typeof Params>

export type Meta = {
  id?: Wakeup.ID
  count?: number
  cancelled?: boolean
}

/** Whole-unit countdown to the due time, e.g. `in 5m`. */
function relative(dueAt: number, now: number) {
  const delta = Math.max(0, dueAt - now)
  if (delta < 60_000) return `in ${Math.max(1, Math.round(delta / 1_000))}s`
  if (delta < 3_600_000) return `in ${Math.round(delta / 60_000)}m`
  if (delta < 86_400_000) return `in ${Math.round(delta / 3_600_000)}h`
  return `in ${Math.round(delta / 86_400_000)}d`
}

function excerpt(text: string, max = 80) {
  const flat = text.replace(/\s+/g, " ").trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

function line(info: Wakeup.Info, now: number) {
  const due = new Date(info.dueAt).toISOString()
  return `${info.id}  due ${due} (${relative(info.dueAt, now)})  ${excerpt(info.reason ?? info.prompt)}`
}

export const CancelWakeupTool = Tool.define<typeof Params, Meta, Wakeup.Service, "cancel_wakeup">(
  "cancel_wakeup",
  Effect.gen(function* () {
    const wake = yield* Wakeup.Service
    return {
      description: DESCRIPTION,
      parameters: Params,
      execute: (params, ctx) =>
        Effect.gen(function* () {
          if (params.action === "list") {
            const list = yield* wake.list({ sessionID: ctx.sessionID })
            return {
              title: "Scheduled wakeups",
              output: list.length
                ? list.map((info) => line(info, Date.now())).join("\n")
                : "No pending wakeups for this session.",
              metadata: { count: list.length },
            }
          }

          const id = params.id?.trim()
          if (!id) {
            return {
              title: "Invalid wakeup input",
              output: "id is required when action is cancel",
              metadata: {},
            }
          }

          // Cancel is idempotent: an already-fired, already-cancelled, or
          // unknown id is reported, never thrown.
          const removed = yield* wake.cancel(id as Wakeup.ID, ctx.sessionID)
          if (!removed) {
            return {
              title: "No pending wakeup",
              output: `No pending wakeup with id ${id}.`,
              metadata: { id: id as Wakeup.ID },
            }
          }
          return {
            title: "Cancelled wakeup",
            output: `Cancelled wakeup ${removed.id} (${new Date(removed.dueAt).toISOString()}).`,
            metadata: { id: removed.id, cancelled: true },
          }
        }),
    }
  }),
)
