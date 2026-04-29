import z from "zod"
import { BusEvent } from "@/bus/bus-event"

export const SymphonyEvent = {
  WorkerStarted: BusEvent.define(
    "symphony.worker.started",
    z.object({
      issueId: z.string(),
      identifier: z.string(),
      sessionId: z.string(),
      workspacePath: z.string(),
    }),
  ),

  WorkerCompleted: BusEvent.define(
    "symphony.worker.completed",
    z.object({
      issueId: z.string(),
      identifier: z.string(),
      sessionId: z.string(),
      turnCount: z.number(),
      inputTokens: z.number(),
      outputTokens: z.number(),
      totalTokens: z.number(),
    }),
  ),

  WorkerFailed: BusEvent.define(
    "symphony.worker.failed",
    z.object({
      issueId: z.string(),
      identifier: z.string(),
      error: z.string(),
      attempt: z.number(),
    }),
  ),

  StallDetected: BusEvent.define(
    "symphony.stall.detected",
    z.object({
      issueId: z.string(),
      identifier: z.string(),
      lastEventAt: z.number(),
    }),
  ),

  ConfigReloaded: BusEvent.define(
    "symphony.config.reloaded",
    z.object({
      source: z.enum(["workflow_md", "team_config"]),
    }),
  ),
}
