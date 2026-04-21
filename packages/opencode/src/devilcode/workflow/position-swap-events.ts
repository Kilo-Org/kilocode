import z from "zod"
import { BusEvent } from "@/bus/bus-event"
import { PositionSwapSuccess, PositionSwapFailure } from "../team/position-swap"

export const PositionSwapValidating = BusEvent.define(
  "position-swap:validating",
  z.object({
    position: z.string(),
    newProvider: z.string(),
    newModel: z.string(),
  }),
)

export const PositionSwapSucceeded = BusEvent.define("position-swap:success", PositionSwapSuccess)

export const PositionSwapFailed = BusEvent.define("position-swap:failed", PositionSwapFailure)

export const PositionSwapRebalanced = BusEvent.define(
  "position-swap:rebalance",
  z.object({
    role: z.string(),
    freedSlots: z.number(),
    queuedTasks: z.number(),
  }),
)
