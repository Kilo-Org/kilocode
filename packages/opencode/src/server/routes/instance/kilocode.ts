// kilocode_change - new file
// Kilo-specific routes that live in the CLI package (direct access to internals).
// All future kilo-specific endpoints should be added here.
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Skill } from "@/skill"
import * as KiloAgent from "@/kilocode/agent"
import { lazy } from "@/util/lazy"
import { errors } from "../../error"
import { SessionImportRoutes } from "@/kilocode/session-import/routes"
import { HeapSnapshot } from "@/kilocode/cli/heap-snapshot"
import { SessionOverview } from "@/kilocode/session/overview"
import { jsonRequest } from "./trace"

const QueryBoolean = z.union([
  z.preprocess((value) => (value === "true" ? true : value === "false" ? false : value), z.boolean()),
  z.enum(["true", "false"]),
])

function queryBoolean(value: z.infer<typeof QueryBoolean> | undefined) {
  if (value === undefined) return
  return value === true || value === "true"
}

export const KilocodeRoutes = lazy(() =>
  new Hono()
    .route("/session-import", SessionImportRoutes())
    .get(
      "/session/overview",
      describeRoute({
        summary: "Get session overview",
        description: "Get sessions, runtime statuses, activities, and costs in one lightweight response.",
        operationId: "kilocode.session.overview",
        responses: {
          200: {
            description: "Session overview",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    sessions: z.array(z.unknown()),
                    statuses: z.record(z.string(), z.unknown()),
                    activities: z.record(z.string(), z.unknown()),
                    costs: z.record(z.string(), z.number()),
                  }),
                ),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional(),
          projectID: z.string().optional(),
          worktrees: QueryBoolean.optional(),
          roots: QueryBoolean.optional(),
          start: z.coerce.number().optional(),
          cursor: z.coerce.number().optional(),
          search: z.string().optional(),
          limit: z.coerce.number().optional(),
          archived: QueryBoolean.optional(),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        return jsonRequest("KilocodeRoutes.sessionOverview", c, function* () {
          return yield* SessionOverview.build({
            directory: query.directory,
            projectID: query.projectID,
            worktrees: queryBoolean(query.worktrees),
            roots: queryBoolean(query.roots),
            start: query.start,
            cursor: query.cursor,
            search: query.search,
            limit: query.limit,
            archived: queryBoolean(query.archived),
          })
        })
      },
    )
    .post(
      "/heap/snapshot",
      describeRoute({
        summary: "Write heap snapshot",
        description: "Write a heap snapshot for the CLI process to the log directory.",
        operationId: "kilocode.heap.snapshot",
        responses: {
          200: {
            description: "Heap snapshot file path",
            content: {
              "application/json": {
                schema: resolver(z.string()),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        return c.json(HeapSnapshot.write())
      },
    )
    .post(
      "/skill/remove",
      describeRoute({
        summary: "Remove a skill",
        description: "Remove a skill by deleting its directory from disk and clearing it from cache.",
        operationId: "kilocode.removeSkill",
        responses: {
          200: {
            description: "Skill removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          location: z.string(),
        }),
      ),
      async (c) => {
        const { location } = c.req.valid("json")
        await Skill.remove(location)
        return c.json(true)
      },
    )
    .post(
      "/agent/remove",
      describeRoute({
        summary: "Remove a custom agent",
        description: "Remove a custom (non-native) agent by deleting its markdown file from disk and refreshing state.",
        operationId: "kilocode.removeAgent",
        responses: {
          200: {
            description: "Agent removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "json",
        z.object({
          name: z.string(),
        }),
      ),
      async (c) => {
        const { name } = c.req.valid("json")
        await KiloAgent.remove(name)
        return c.json(true)
      },
    ),
)
