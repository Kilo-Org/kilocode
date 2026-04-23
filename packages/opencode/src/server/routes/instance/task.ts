// kilocode_change - new file
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import { SessionID } from "@/session/schema"
import z from "zod"
import { Task } from "@/session/task"
import { lazy } from "@/util/lazy"
import { errors } from "../../error"

export const TaskRoutes = lazy(() =>
  new Hono()
    .get(
      "/:sessionID/task",
      describeRoute({
        summary: "List tasks",
        description: "Retrieve all tasks associated with a specific session.",
        operationId: "task.list",
        responses: {
          200: {
            description: "List of tasks",
            content: {
              "application/json": {
                schema: resolver(Task.Info.array()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        return c.json(Task.Service.list(sessionID))
      },
    )
    .post(
      "/:sessionID/task",
      describeRoute({
        summary: "Create task",
        description: "Create a new task in the specified session.",
        operationId: "task.create",
        responses: {
          200: {
            description: "Created task",
            content: {
              "application/json": {
                schema: resolver(Task.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
        }),
      ),
      validator(
        "json",
        z.object({
          title: z.string(),
          description: z.string().optional(),
          priority: Task.Info.shape.priority.optional(),
          dependsOn: z.array(z.string()).optional(),
          assignee: z.string().optional(),
        }),
      ),
      async (c) => {
        const { sessionID } = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await Task.Service.create({ sessionID, ...body }))
      },
    )
    .get(
      "/:sessionID/task/:taskID",
      describeRoute({
        summary: "Get task",
        description: "Retrieve a specific task by its ID.",
        operationId: "task.get",
        responses: {
          200: {
            description: "Task",
            content: {
              "application/json": {
                schema: resolver(Task.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          taskID: z.string(),
        }),
      ),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const task = Task.Service.get(taskID)
        if (!task) return c.json({ error: "Task not found" }, 404)
        return c.json(task)
      },
    )
    .patch(
      "/:sessionID/task/:taskID",
      describeRoute({
        summary: "Update task",
        description: "Update an existing task's properties.",
        operationId: "task.update",
        responses: {
          200: {
            description: "Updated task",
            content: {
              "application/json": {
                schema: resolver(Task.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          taskID: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          title: z.string().optional(),
          description: z.string().optional(),
          status: Task.Info.shape.status.optional(),
          priority: Task.Info.shape.priority.optional(),
          assignee: z.string().optional(),
          dependsOn: z.array(z.string()).optional(),
          worktree: z.string().optional(),
          pr: z.string().optional(),
          summary: z.string().optional(),
        }),
      ),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const body = c.req.valid("json")
        return c.json(await Task.Service.update(taskID, body))
      },
    )
    .delete(
      "/:sessionID/task/:taskID",
      describeRoute({
        summary: "Delete task",
        description: "Delete a task from a session.",
        operationId: "task.delete",
        responses: {
          200: {
            description: "Task deleted",
            content: {
              "application/json": {
                schema: resolver(z.object({ ok: z.literal(true) })),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          taskID: z.string(),
        }),
      ),
      async (c) => {
        const { taskID } = c.req.valid("param")
        await Task.Service.del(taskID)
        return c.json({ ok: true as const })
      },
    )
    .post(
      "/:sessionID/task/:taskID/claim",
      describeRoute({
        summary: "Claim task",
        description: "Assign an agent to a task and set its status to in_progress.",
        operationId: "task.claim",
        responses: {
          200: {
            description: "Updated task",
            content: {
              "application/json": {
                schema: resolver(Task.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          taskID: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          assignee: z.string(),
        }),
      ),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const { assignee } = c.req.valid("json")
        return c.json(await Task.Service.claim(taskID, assignee))
      },
    )
    .post(
      "/:sessionID/task/:taskID/complete",
      describeRoute({
        summary: "Complete task",
        description: "Mark a task as done with a completion summary.",
        operationId: "task.complete",
        responses: {
          200: {
            description: "Updated task",
            content: {
              "application/json": {
                schema: resolver(Task.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          taskID: z.string(),
        }),
      ),
      validator(
        "json",
        z.object({
          summary: z.string(),
        }),
      ),
      async (c) => {
        const { taskID } = c.req.valid("param")
        const { summary } = c.req.valid("json")
        return c.json(await Task.Service.complete(taskID, summary))
      },
    )
    .post(
      "/:sessionID/task/:taskID/block",
      describeRoute({
        summary: "Block task",
        description: "Mark a task as blocked.",
        operationId: "task.block",
        responses: {
          200: {
            description: "Updated task",
            content: {
              "application/json": {
                schema: resolver(Task.Info),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: SessionID.zod,
          taskID: z.string(),
        }),
      ),
      async (c) => {
        const { taskID } = c.req.valid("param")
        return c.json(await Task.Service.block(taskID))
      },
    ),
)
