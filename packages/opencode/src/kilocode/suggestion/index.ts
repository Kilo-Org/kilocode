import { Bus } from "../../bus"
import { BusEvent } from "../../bus/bus-event"
import { Identifier } from "../../id/id"
import { Log } from "../../util/log"
import z from "zod"

export namespace Suggestion {
  const log = Log.create({ service: "suggestion" })

  export const Action = z
    .object({
      label: z.string().describe("Button or option label (1-5 words)"),
      description: z.string().optional().describe("Brief explanation of what this action does"),
      prompt: z.string().describe("Synthetic user prompt to inject when this action is accepted"),
    })
    .meta({
      ref: "SuggestionAction",
    })
  export type Action = z.infer<typeof Action>

  export const Info = z
    .object({
      text: z.string().describe("Suggestion text shown to the user"),
      actions: z.array(Action).min(1).max(2).describe("Available actions the user can take"),
    })
    .meta({
      ref: "SuggestionInfo",
    })
  export type Info = z.infer<typeof Info>

  export const Request = z
    .object({
      id: Identifier.schema("suggestion"),
      sessionID: Identifier.schema("session"),
      text: z.string().describe("Suggestion text shown to the user"),
      actions: z.array(Action).min(1).max(2).describe("Available actions the user can take"),
      blocking: z.boolean().optional().describe("Whether this suggestion blocks prompt input (default: true)"),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "SuggestionRequest",
    })
  export type Request = z.infer<typeof Request>

  export const Accept = z.object({
    index: z.number().int().nonnegative().describe("Zero-based action index to accept"),
  })
  export type Accept = z.infer<typeof Accept>

  export const Event = {
    Shown: BusEvent.define("suggestion.shown", Request),
    Accepted: BusEvent.define(
      "suggestion.accepted",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        index: z.number().int().nonnegative(),
        action: Action,
      }),
    ),
    Dismissed: BusEvent.define(
      "suggestion.dismissed",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
      }),
    ),
  }

  // kilocode_change - Instance.state() removed in v1.4.4; use module-level state
  // (request IDs are globally unique so instance scoping is not needed)
  const pending: Record<
    string,
    {
      info: Request
      resolve: (action: Action) => void
      reject: (error: any) => void
    }
  > = {}

  export async function show(input: {
    sessionID: string
    text: string
    actions: Action[]
    blocking?: boolean
    tool?: { messageID: string; callID: string }
  }): Promise<Action> {
    const s = { pending }
    const id = Identifier.ascending("suggestion")

    log.info("shown", { id, actions: input.actions.length })

    return new Promise<Action>((resolve, reject) => {
      const info: Request = {
        id,
        sessionID: input.sessionID,
        text: input.text,
        actions: input.actions,
        blocking: input.blocking,
        tool: input.tool,
      }
      s.pending[id] = {
        info,
        resolve,
        reject,
      }
      Bus.publish(Event.Shown, info)
    })
  }

  export async function accept(input: { requestID: string; index: number }): Promise<boolean> {
    const s = { pending }
    const existing = s.pending[input.requestID]
    if (!existing) {
      log.warn("accept for unknown request", { requestID: input.requestID })
      return false
    }

    const action = existing.info.actions[input.index]
    if (!action) {
      log.warn("accept for invalid action index", { requestID: input.requestID, index: input.index })
      delete s.pending[input.requestID]
      existing.reject(new Error(`Invalid action index: ${input.index}`))
      return false
    }

    delete s.pending[input.requestID]

    log.info("accepted", { requestID: input.requestID, index: input.index, label: action.label })

    Bus.publish(Event.Accepted, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      index: input.index,
      action,
    })

    existing.resolve(action)
    return true
  }

  export async function dismiss(requestID: string): Promise<boolean> {
    const s = { pending }
    const existing = s.pending[requestID]
    if (!existing) {
      log.warn("dismiss for unknown request", { requestID })
      return false
    }
    delete s.pending[requestID]

    log.info("dismissed", { requestID })

    Bus.publish(Event.Dismissed, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
    })

    existing.reject(new DismissedError())
    return true
  }

  export class DismissedError extends Error {
    constructor() {
      super("The user dismissed this suggestion")
    }
  }

  export async function dismissAll(sessionID: string): Promise<void> {
    const s = { pending }
    for (const [id, entry] of Object.entries(s.pending)) {
      if (entry.info.sessionID !== sessionID) continue
      delete s.pending[id]
      log.info("dismissed", { requestID: id })
      Bus.publish(Event.Dismissed, {
        sessionID: entry.info.sessionID,
        requestID: entry.info.id,
      })
      entry.reject(new DismissedError())
    }
  }

  export async function list() {
    return Object.values(pending).map((item) => item.info)
  }
}
