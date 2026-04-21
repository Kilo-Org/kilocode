// devilcode_change - new file
// HTTP endpoints exposing workflow state to the VS Code extension.
// Mounted at /devilcode/workflow/ via devilcode.ts.
import { Hono } from "hono"
import { describeRoute, resolver } from "hono-openapi"
import { lazy } from "../../util/lazy"
import { Instance } from "../../project/instance"
import { WorkflowStateManager } from "./state"
import { LockManager } from "./locks"
import { EventLogger } from "./events"
import { LessonStore } from "./learning"
import { WorkflowState, PlanTask, ReviewVerdict } from "./types"
import { FileLock } from "./locks"
import { Lesson } from "./learning"
import { Log } from "../../util/log"
import z from "zod"
import { computeAggregations, emptyAggregations } from "./aggregations"
import path from "path"
import { Bus } from "@/bus"
import { Config } from "@/config/config"
import { applyPositionSwap, PositionSwapRequest, PositionSwapResult } from "../team/position-swap"
import { PositionSwapValidating, PositionSwapSucceeded, PositionSwapFailed, PositionSwapRebalanced } from "./position-swap-events"
import { getConcurrencyManager } from "../team/concurrency"

const log = Log.create({ service: "workflow.routes" })
const InternalError = z.object({ error: z.string() })

function isENOENT(e: unknown): e is { code: "ENOENT" } {
  return typeof e === "object" && e !== null && "code" in e && (e as { code: string }).code === "ENOENT"
}

// Response schema for the /status endpoint when workflow is not initialized.
const UninitializedStatus = z.object({ initialized: z.literal(false) })

export const WorkflowRoutes = lazy(() =>
  new Hono()
    .get(
      "/status",
      describeRoute({
        summary: "Get workflow status",
        description:
          "Returns the current WorkflowState (stage, phase, active tasks). Returns { initialized: false } when no .planning/ directory exists.",
        operationId: "devilcode.workflow.status",
        responses: {
          200: {
            description: "Workflow status",
            content: {
              "application/json": {
                schema: resolver(z.union([WorkflowState, UninitializedStatus])),
              },
            },
          },
          500: {
            description: "Workflow status read failed",
            content: {
              "application/json": {
                schema: resolver(InternalError),
              },
            },
          },
        },
      }),
      async (c) => {
        const manager = new WorkflowStateManager(Instance.directory)
        if (!(await manager.hasWorkflow())) {
          return c.json({ initialized: false as const })
        }
        try {
          const state = await manager.readState()
          return c.json(state)
        } catch (e) {
          if (isENOENT(e)) {
            return c.json({ initialized: false as const })
          }
          log.error("workflow status read failed", { error: e })
          return c.json({ error: "Internal error" }, 500)
        }
      },
    )
    .get(
      "/plans",
      describeRoute({
        summary: "Get plans for current phase",
        description: "Returns PlanTask[] for the current workflow phase. Returns [] when workflow is not initialized.",
        operationId: "devilcode.workflow.plans",
        responses: {
          200: {
            description: "Plan tasks",
            content: {
              "application/json": {
                schema: resolver(PlanTask.array()),
              },
            },
          },
          500: {
            description: "Workflow plans read failed",
            content: {
              "application/json": {
                schema: resolver(InternalError),
              },
            },
          },
        },
      }),
      async (c) => {
        const manager = new WorkflowStateManager(Instance.directory)
        if (!(await manager.hasWorkflow())) {
          return c.json([] as PlanTask[])
        }
        try {
          const state = await manager.readState()
          if (!state.currentPhase) return c.json([] as PlanTask[])
          const plans = await manager.readAllPlans(state.currentPhase)
          return c.json(plans)
        } catch (e) {
          // devilcode_change - audit N5: distinguish "no plans yet" (ENOENT) from real disk errors.
          if (isENOENT(e)) {
            return c.json([] as PlanTask[])
          }
          log.error("workflow plans read failed", { error: e })
          return c.json({ error: "Internal error" }, 500)
        }
      },
    )
    .get(
      "/review",
      describeRoute({
        summary: "Get review verdict for current phase",
        description: "Returns ReviewVerdict for the current phase. Returns 404 when no review exists.",
        operationId: "devilcode.workflow.review",
        responses: {
          200: {
            description: "Review verdict",
            content: {
              "application/json": {
                schema: resolver(ReviewVerdict),
              },
            },
          },
          404: {
            description: "No review found for the current phase",
          },
        },
      }),
      async (c) => {
        const manager = new WorkflowStateManager(Instance.directory)
        if (!(await manager.hasWorkflow())) {
          return c.json({ error: "no workflow" }, 404)
        }
        try {
          const state = await manager.readState()
          if (!state.currentPhase) return c.json({ error: "no current phase" }, 404)
          const verdict = await manager.readReview(state.currentPhase)
          return c.json(verdict)
        } catch {
          return c.json({ error: "no review found" }, 404)
        }
      },
    )
    .get(
      "/locks",
      describeRoute({
        summary: "Get active file locks",
        description: "Returns FileLock[] from the lock manager. Returns [] when workflow is not initialized.",
        operationId: "devilcode.workflow.locks",
        responses: {
          200: {
            description: "Active file locks",
            content: {
              "application/json": {
                schema: resolver(FileLock.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const planningDir = `${Instance.directory}/.planning`
        const lockManager = new LockManager(planningDir)
        try {
          const locks = await lockManager.listLocks()
          return c.json(locks)
        } catch {
          return c.json([] as FileLock[])
        }
      },
    )
    .get(
      "/events",
      describeRoute({
        summary: "Get recent workflow events",
        description: "Returns the last 50 WorkflowEvent entries from the append-only event log.",
        operationId: "devilcode.workflow.events",
        responses: {
          200: {
            description: "Recent workflow events",
            content: {
              "application/json": {
                schema: resolver(
                  z.array(
                    z.object({
                      eventType: z.string(),
                      taskId: z.string().optional(),
                      role: z.string().optional(),
                      message: z.string(),
                      durationMs: z.number().optional(),
                      metadata: z.record(z.string(), z.unknown()).optional(),
                      timestamp: z.string().optional(),
                    }),
                  ),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const planningDir = `${Instance.directory}/.planning`
        const eventLogger = new EventLogger(planningDir)
        try {
          const events = await eventLogger.readRecent(50)
          return c.json(events)
        } catch {
          return c.json([])
        }
      },
    )
    .get(
      "/lessons",
      describeRoute({
        summary: "Get captured lessons",
        description: "Returns all Lesson entries from the lesson store.",
        operationId: "devilcode.workflow.lessons",
        responses: {
          200: {
            description: "Captured lessons",
            content: {
              "application/json": {
                schema: resolver(Lesson.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const planningDir = `${Instance.directory}/.planning`
        const lessonStore = new LessonStore(planningDir)
        try {
          const lessons = await lessonStore.list()
          return c.json(lessons)
        } catch {
          return c.json([] as Lesson[])
        }
      },
    )
    .get(
      "/aggregations",
      describeRoute({
        summary: "Get workflow aggregations",
        description:
          "Compute telemetry aggregation metrics from the event log: success rates, stall rates, cost totals, and stage durations.",
        operationId: "devilcode.workflow.aggregations",
        responses: {
          200: {
            description: "Aggregation metrics",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    successRateByTeam: z.record(
                      z.string(),
                      z.object({
                        completed: z.number(),
                        started: z.number(),
                        rate: z.number(),
                      }),
                    ),
                    stallRateByPosition: z.record(
                      z.string(),
                      z.object({
                        maxWaitMs: z.number(),
                        avgWaitMs: z.number(),
                      }),
                    ),
                    costByWorkflow: z.array(
                      z.object({
                        workflowId: z.string(),
                        totalCost: z.number(),
                      }),
                    ),
                    durationByStage: z.record(
                      z.string(),
                      z.object({
                        avgMs: z.number(),
                        p95Ms: z.number(),
                        count: z.number(),
                      }),
                    ),
                    generatedAt: z.string(),
                  }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        const planningDir = path.join(Instance.directory, ".planning")
        const since = c.req.query("since")
        const limitParam = c.req.query("limit")
        const limit = limitParam ? parseInt(limitParam, 10) : undefined
        try {
          const aggregations = await computeAggregations(planningDir, {
            since: since ?? undefined,
            limit: limit && !isNaN(limit) ? limit : undefined,
          })
          return c.json(aggregations)
        } catch {
          return c.json(emptyAggregations())
        }
      },
    )
    .post(
      "/team/swap",
      describeRoute({
        summary: "Swap a position's provider and model",
        description:
          "Live-updates the team config for a given position. Validates the position exists, applies the swap, rebalances concurrency slots, and emits bus events. Changes are persisted via Config.update().",
        operationId: "devilcode.workflow.team.swap",
        responses: {
          200: {
            description: "Swap succeeded",
            content: {
              "application/json": {
                schema: resolver(PositionSwapResult),
              },
            },
          },
          400: {
            description: "Invalid request body",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
          422: {
            description: "Business rule failure (POSITION_NOT_FOUND, DELEGATION_VIOLATION, WORKFLOW_NOT_ACTIVE)",
            content: {
              "application/json": {
                schema: resolver(PositionSwapResult),
              },
            },
          },
          500: {
            description: "Internal error reading or persisting config",
            content: {
              "application/json": {
                schema: resolver(z.object({ error: z.string() })),
              },
            },
          },
        },
      }),
      async (c) => {
        const log = Log.create({ service: "workflow.routes.swap" })
        let body: unknown
        try {
          body = await c.req.json()
        } catch {
          return c.json({ error: "Invalid JSON body" }, 400)
        }

        const parsed = PositionSwapRequest.safeParse(body)
        if (!parsed.success) {
          return c.json({ error: parsed.error.message }, 400)
        }
        const request = parsed.data

        let current: Awaited<ReturnType<typeof Config.get>>
        try {
          current = await Config.get()
        } catch (e) {
          log.error("failed to read config for swap", { error: e })
          return c.json({ error: "Failed to read config" }, 500)
        }

        if (!current.team) {
          return c.json({ success: false as const, error: "Team config not found", code: "WORKFLOW_NOT_ACTIVE" as const }, 422)
        }

        // Emit validating event
        await Bus.publish(PositionSwapValidating, {
          position: request.position,
          newProvider: request.provider,
          newModel: request.model,
        })

        // Clone team config to avoid mutating cached state
        const teamConfig = JSON.parse(JSON.stringify(current.team)) as typeof current.team

        const result = applyPositionSwap(teamConfig, request)

        if (!result.success) {
          await Bus.publish(PositionSwapFailed, result)
          return c.json(result, 422)
        }

        // Rebalance concurrency if the role has maxConcurrent defined.
        // Note: Current swap only changes provider/model, not maxConcurrent, so oldMax === newMax.
        // The rebalance call is a no-op but is left in place for future maxConcurrent swaps.
        const role = teamConfig.roles[request.position]
        const concurrencyManager = getConcurrencyManager()
        const oldMax = role.maxConcurrent
        const rebalance = concurrencyManager.rebalanceAfterSwap(request.position, oldMax, oldMax)

        // Persist updated team config
        try {
          await Config.update({ ...current, team: teamConfig })
        } catch (e) {
          log.error("failed to persist config after swap", { error: e })
          return c.json({ error: "Failed to persist config" }, 500)
        }

        const finalResult = { ...result, slotsRebalanced: rebalance.queued }
        await Bus.publish(PositionSwapSucceeded, finalResult)

        if (rebalance.queued > 0) {
          await Bus.publish(PositionSwapRebalanced, {
            role: request.position,
            freedSlots: rebalance.freed,
            queuedTasks: rebalance.queued,
          })
        }

        return c.json(finalResult)
      },
    ),
)
