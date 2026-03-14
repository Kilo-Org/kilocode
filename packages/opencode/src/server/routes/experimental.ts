import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { ToolRegistry } from "../../tool/registry"
import { Worktree } from "../../worktree"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { MCP } from "../../mcp"
import { Session } from "../../session"
import { zodToJsonSchema } from "zod-to-json-schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Snapshot } from "../../snapshot" // kilocode_change
import { Review } from "../../kilocode/review/review" // kilocode_change
import { WorktreeDiff } from "../../kilocode/review/worktree-diff" // kilocode_change
import { Log } from "../../util/log" // kilocode_change
import { WorkspaceRoutes } from "./workspace"

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .get(
      "/tool/ids",
      describeRoute({
        summary: "List tool IDs",
        description:
          "Get a list of all available tool IDs, including both built-in tools and dynamically registered tools.",
        operationId: "tool.ids",
        responses: {
          200: {
            description: "Tool IDs",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string()).meta({ ref: "ToolIDs" })),
              },
            },
          },
          ...errors(400),
        },
      }),
      async (c) => {
        return c.json(await ToolRegistry.ids())
      },
    )
    .get(
      "/tool",
      describeRoute({
        summary: "List tools",
        description:
          "Get a list of available tools with their JSON schema parameters for a specific provider and model combination.",
        operationId: "tool.list",
        responses: {
          200: {
            description: "Tools",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .array(
                      z
                        .object({
                          id: z.string(),
                          description: z.string(),
                          parameters: z.any(),
                        })
                        .meta({ ref: "ToolListItem" }),
                    )
                    .meta({ ref: "ToolList" }),
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
          provider: z.string(),
          model: z.string(),
        }),
      ),
      async (c) => {
        const { provider, model } = c.req.valid("query")
        const tools = await ToolRegistry.tools({ providerID: provider, modelID: model })
        return c.json(
          tools.map((t) => ({
            id: t.id,
            description: t.description,
            // Handle both Zod schemas and plain JSON schemas
            parameters: (t.parameters as any)?._def ? zodToJsonSchema(t.parameters as any) : t.parameters,
          })),
        )
      },
    )
    .route("/workspace", WorkspaceRoutes())
    .post(
      "/worktree",
      describeRoute({
        summary: "Create worktree",
        description: "Create a new git worktree for the current project and run any configured startup scripts.",
        operationId: "worktree.create",
        responses: {
          200: {
            description: "Worktree created",
            content: {
              "application/json": {
                schema: resolver(Worktree.Info),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.create.schema),
      async (c) => {
        const body = c.req.valid("json")
        const worktree = await Worktree.create(body)
        return c.json(worktree)
      },
    )
    .get(
      "/worktree",
      describeRoute({
        summary: "List worktrees",
        description: "List all sandbox worktrees for the current project.",
        operationId: "worktree.list",
        responses: {
          200: {
            description: "List of worktree directories",
            content: {
              "application/json": {
                schema: resolver(z.array(z.string())),
              },
            },
          },
        },
      }),
      async (c) => {
        const sandboxes = await Project.sandboxes(Instance.project.id)
        return c.json(sandboxes)
      },
    )
    .delete(
      "/worktree",
      describeRoute({
        summary: "Remove worktree",
        description: "Remove a git worktree and delete its branch.",
        operationId: "worktree.remove",
        responses: {
          200: {
            description: "Worktree removed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.remove.schema),
      async (c) => {
        const body = c.req.valid("json")
        await Worktree.remove(body)
        await Project.removeSandbox(Instance.project.id, body.directory)
        return c.json(true)
      },
    )
    .post(
      "/worktree/reset",
      describeRoute({
        summary: "Reset worktree",
        description: "Reset a worktree branch to the primary default branch.",
        operationId: "worktree.reset",
        responses: {
          200: {
            description: "Worktree reset",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Worktree.reset.schema),
      async (c) => {
        const body = c.req.valid("json")
        await Worktree.reset(body)
        return c.json(true)
      },
    )
    // kilocode_change start - worktree diff endpoint for agent manager
    .get(
      "/worktree/diff",
      describeRoute({
        summary: "Get worktree diff",
        description: "Get file diffs for a worktree compared to its base branch. Includes uncommitted changes.",
        operationId: "worktree.diff",
        responses: {
          200: {
            description: "File diffs",
            content: {
              "application/json": {
                schema: resolver(z.array(Snapshot.FileDiff)),
              },
            },
          },
          ...errors(400),
        },
      }),
      // kilocode_change start
      validator(
        "query",
        z.object({
          base: z.string().optional().meta({ description: "Base branch or ref to diff against" }),
        }),
      ),
      async (c) => {
        const log = Log.create({ service: "worktree-diff" })
        const query = c.req.valid("query")
        const base = query.base || (await Review.getBaseBranch())
        // kilocode_change end
        const dir = Instance.directory
        log.info("computing diff", { dir, base })
        const diffs = await WorktreeDiff.full({ dir, base, log })
        return c.json(
          diffs.map((diff) => ({
            file: diff.file,
            before: diff.before,
            after: diff.after,
            additions: diff.additions,
            deletions: diff.deletions,
            status: diff.status,
          })),
        )
      },
    )
    .get(
      "/worktree/diff/summary",
      describeRoute({
        summary: "Get worktree diff summary",
        description: "Get lightweight file diff metadata for a worktree compared to its base branch.",
        operationId: "worktree.diffSummary",
        responses: {
          200: {
            description: "Diff summary items",
            content: {
              "application/json": {
                schema: resolver(z.array(WorktreeDiff.Item)),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          base: z.string().optional().meta({ description: "Base branch or ref to diff against" }),
        }),
      ),
      async (c) => {
        const log = Log.create({ service: "worktree-diff" })
        const query = c.req.valid("query")
        const base = query.base || (await Review.getBaseBranch())
        const dir = Instance.directory
        log.info("computing diff summary", { dir, base })
        return c.json(await WorktreeDiff.summary({ dir, base, log }))
      },
    )
    .get(
      "/worktree/diff/file",
      describeRoute({
        summary: "Get worktree diff detail",
        description: "Get full diff contents for one worktree file compared to its base branch.",
        operationId: "worktree.diffFile",
        responses: {
          200: {
            description: "Diff detail item",
            content: {
              "application/json": {
                schema: resolver(WorktreeDiff.Item.nullable()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator(
        "query",
        z.object({
          base: z.string().optional().meta({ description: "Base branch or ref to diff against" }),
          file: z.string().meta({ description: "Relative file path to load diff contents for" }),
        }),
      ),
      async (c) => {
        const log = Log.create({ service: "worktree-diff" })
        const query = c.req.valid("query")
        const base = query.base || (await Review.getBaseBranch())
        const dir = Instance.directory
        log.info("computing diff detail", { dir, base, file: query.file })
        return c.json((await WorktreeDiff.detail({ dir, base, file: query.file, log })) ?? null)
      },
    )
    // kilocode_change end
    .get(
      "/session",
      describeRoute({
        summary: "List sessions",
        description:
          "Get a list of all OpenCode sessions across projects, sorted by most recently updated. Archived sessions are excluded by default.",
        operationId: "experimental.session.list",
        responses: {
          200: {
            description: "List of sessions",
            content: {
              "application/json": {
                schema: resolver(Session.GlobalInfo.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          roots: z.coerce.boolean().optional().meta({ description: "Only return root sessions (no parentID)" }),
          start: z.coerce
            .number()
            .optional()
            .meta({ description: "Filter sessions updated on or after this timestamp (milliseconds since epoch)" }),
          cursor: z.coerce
            .number()
            .optional()
            .meta({ description: "Return sessions updated before this timestamp (milliseconds since epoch)" }),
          search: z.string().optional().meta({ description: "Filter sessions by title (case-insensitive)" }),
          limit: z.coerce.number().optional().meta({ description: "Maximum number of sessions to return" }),
          archived: z.coerce.boolean().optional().meta({ description: "Include archived sessions (default false)" }),
        }),
      ),
      async (c) => {
        const query = c.req.valid("query")
        const limit = query.limit ?? 100
        const sessions: Session.GlobalInfo[] = []
        for await (const session of Session.listGlobal({
          directory: query.directory,
          roots: query.roots,
          start: query.start,
          cursor: query.cursor,
          search: query.search,
          limit: limit + 1,
          archived: query.archived,
        })) {
          sessions.push(session)
        }
        const hasMore = sessions.length > limit
        const list = hasMore ? sessions.slice(0, limit) : sessions
        if (hasMore && list.length > 0) {
          c.header("x-next-cursor", String(list[list.length - 1].time.updated))
        }
        return c.json(list)
      },
    )
    .get(
      "/resource",
      describeRoute({
        summary: "Get MCP resources",
        description: "Get all available MCP resources from connected servers. Optionally filter by name.",
        operationId: "experimental.resource.list",
        responses: {
          200: {
            description: "MCP resources",
            content: {
              "application/json": {
                schema: resolver(z.record(z.string(), MCP.Resource)),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await MCP.resources())
      },
    ),
)
