import { AgentManagerService } from "@/kilocode/agent-manager/service"
import { AgentManagerTypes } from "@/kilocode/agent-manager/types"
import { errors } from "@/server/error"
import { lazy } from "@/util/lazy"
import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import z from "zod"

export const AgentManagerRoutes = lazy(() =>
  new Hono()
    .post(
      "/session",
      describeRoute({
        summary: "Create managed sessions",
        description:
          "Create one or more managed agent sessions on isolated git worktrees and start each session asynchronously.",
        operationId: "agentManager.create",
        responses: {
          200: {
            description: "Created managed sessions",
            content: {
              "application/json": {
                schema: resolver(AgentManagerTypes.CreateOutput),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", AgentManagerTypes.CreateInput),
      async (c) => {
        const body = c.req.valid("json")
        const result = await AgentManagerService.create(body)
        return c.json(result)
      },
    )
    .get(
      "/session",
      describeRoute({
        summary: "List managed sessions",
        description: "List managed sessions with optional group, status, and cursor filters.",
        operationId: "agentManager.list",
        responses: {
          200: {
            description: "Managed sessions",
            content: {
              "application/json": {
                schema: resolver(AgentManagerTypes.ListOutput),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          groupID: z.string().optional(),
          status: z.enum(["idle", "busy", "error"]).optional(),
          limit: z.coerce.number().optional(),
          cursor: z.string().optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const result = await AgentManagerService.list(query)
        return c.json(result)
      },
    )
    .get(
      "/session/:sessionID",
      describeRoute({
        summary: "Get managed session detail",
        description: "Get details for one managed session, including recent messages.",
        operationId: "agentManager.get",
        responses: {
          200: {
            description: "Managed session detail",
            content: {
              "application/json": {
                schema: resolver(AgentManagerTypes.DetailOutput),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          limit: z.coerce.number().optional(),
        }),
      ),
      async (c) => {
        const param = c.req.valid("param")
        const query = c.req.valid("query")
        const result = await AgentManagerService.get({
          sessionID: param.sessionID,
          limit: query.limit,
        })
        return c.json(result)
      },
    )
    .delete(
      "/session/:sessionID",
      describeRoute({
        summary: "Cancel managed session",
        description: "Abort a managed session and remove its worktree.",
        operationId: "agentManager.cancel",
        responses: {
          200: {
            description: "Cancelled",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      async (c) => {
        const param = c.req.valid("param")
        const result = await AgentManagerService.cancel({
          sessionID: param.sessionID,
        })
        return c.json(result)
      },
    )
    .get(
      "/session/:sessionID/diff",
      describeRoute({
        summary: "Get managed session diff",
        description: "Get a paginated diff for one managed session.",
        operationId: "agentManager.diff",
        responses: {
          200: {
            description: "Diff page",
            content: {
              "application/json": {
                schema: resolver(AgentManagerTypes.DiffOutput),
              },
            },
          },
          ...errors(400, 404),
        },
      }),
      validator(
        "param",
        z.object({
          sessionID: z.string(),
        }),
      ),
      validator(
        "query",
        z.object({
          cursor: z.string().optional(),
          limit: z.coerce.number().optional(),
          includePatch: z.coerce.boolean().optional(),
        }),
      ),
      async (c) => {
        const param = c.req.valid("param")
        const query = c.req.valid("query")
        const result = await AgentManagerService.diff({
          sessionID: param.sessionID,
          cursor: query.cursor,
          limit: query.limit,
          includePatch: query.includePatch,
        })
        return c.json(result)
      },
    ),
)
