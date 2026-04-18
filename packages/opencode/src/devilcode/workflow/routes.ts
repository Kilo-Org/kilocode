// devilcode_change - new file
// Read-only HTTP endpoints exposing workflow state to the VS Code extension.
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
    ),
)
