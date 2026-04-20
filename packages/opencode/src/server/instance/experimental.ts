import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { ProviderID, ModelID } from "../../provider/schema"
import { ToolRegistry } from "../../tool/registry"
import { Worktree } from "../../worktree"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { MCP } from "../../mcp"
import { Session } from "../../session"
import { Config } from "../../config/config"
import { ConsoleState } from "../../config/console-state"
import { Account, AccountID, OrgID } from "../../account"
import { AppRuntime } from "../../effect/app-runtime"
import { zodToJsonSchema } from "zod-to-json-schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { Snapshot } from "../../snapshot" // kilocode_change
import { Review } from "../../kilocode/review/review" // kilocode_change
import { WorktreeDiff } from "../../kilocode/review/worktree-diff" // kilocode_change
import { WorktreeFamily } from "../../kilocode/worktree-family" // kilocode_change
import { Log } from "../../util/log" // kilocode_change
import { Effect, Option } from "effect"
import { WorkspaceRoutes } from "./workspace"
import { Filesystem } from "../../util/filesystem" // kilocode_change
import path from "path" // kilocode_change
import { Agent } from "@/agent/agent"
import { HttpApiRoutes } from "./httpapi"

const ConsoleOrgOption = z.object({
  accountID: z.string(),
  accountEmail: z.string(),
  accountUrl: z.string(),
  orgID: z.string(),
  orgName: z.string(),
  active: z.boolean(),
})

const ConsoleOrgList = z.object({
  orgs: z.array(ConsoleOrgOption),
})

const ConsoleSwitchBody = z.object({
  accountID: z.string(),
  orgID: z.string(),
})

export const ExperimentalRoutes = lazy(() =>
  new Hono()
    .route("/httpapi", HttpApiRoutes())
    .get(
      "/console",
      describeRoute({
        summary: "Get active Console provider metadata",
        description: "Get the active Console org name and the set of provider IDs managed by that Console org.",
        operationId: "experimental.console.get",
        responses: {
          200: {
            description: "Active Console provider metadata",
            content: {
              "application/json": {
                schema: resolver(ConsoleState),
              },
            },
          },
        },
      }),
      async (c) => {
        const result = await AppRuntime.runPromise(
          Effect.gen(function* () {
            const config = yield* Config.Service
            const account = yield* Account.Service
            const [state, groups] = yield* Effect.all([config.getConsoleState(), account.orgsByAccount()], {
              concurrency: "unbounded",
            })
            return {
              ...state,
              switchableOrgCount: groups.reduce((count, group) => count + group.orgs.length, 0),
            }
          }),
        )
        return c.json(result)
      },
    )
    .get(
      "/console/orgs",
      describeRoute({
        summary: "List switchable Console orgs",
        description: "Get the available Console orgs across logged-in accounts, including the current active org.",
        operationId: "experimental.console.listOrgs",
        responses: {
          200: {
            description: "Switchable Console orgs",
            content: {
              "application/json": {
                schema: resolver(ConsoleOrgList),
              },
            },
          },
        },
      }),
      async (c) => {
        const orgs = await AppRuntime.runPromise(
          Effect.gen(function* () {
            const account = yield* Account.Service
            const [groups, active] = yield* Effect.all([account.orgsByAccount(), account.active()], {
              concurrency: "unbounded",
            })
            const info = Option.getOrUndefined(active)
            return groups.flatMap((group) =>
              group.orgs.map((org) => ({
                accountID: group.account.id,
                accountEmail: group.account.email,
                accountUrl: group.account.url,
                orgID: org.id,
                orgName: org.name,
                active: !!info && info.id === group.account.id && info.active_org_id === org.id,
              })),
            )
          }),
        )
        return c.json({ orgs })
      },
    )
    .post(
      "/console/switch",
      describeRoute({
        summary: "Switch active Console org",
        description: "Persist a new active Console account/org selection for the current local OpenCode state.",
        operationId: "experimental.console.switchOrg",
        responses: {
          200: {
            description: "Switch success",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      validator("json", ConsoleSwitchBody),
      async (c) => {
        const body = c.req.valid("json")
        await AppRuntime.runPromise(
          Effect.gen(function* () {
            const account = yield* Account.Service
            yield* account.use(AccountID.make(body.accountID), Option.some(OrgID.make(body.orgID)))
          }),
        )
        return c.json(true)
      },
    )
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
        const ids = await AppRuntime.runPromise(
          Effect.gen(function* () {
            const registry = yield* ToolRegistry.Service
            return yield* registry.ids()
          }),
        )
        return c.json(ids)
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
        const tools = await AppRuntime.runPromise(
          Effect.gen(function* () {
            const agents = yield* Agent.Service
            const registry = yield* ToolRegistry.Service
            return yield* registry.tools({
              providerID: ProviderID.make(provider),
              modelID: ModelID.make(model),
              agent: yield* agents.get(yield* agents.defaultAgent()),
            })
          }),
        )
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
      validator("json", Worktree.CreateInput.optional()),
      async (c) => {
        const body = c.req.valid("json")
        const worktree = await AppRuntime.runPromise(Worktree.Service.use((svc) => svc.create(body)))
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
        const sandboxes = await AppRuntime.runPromise(Project.Service.use((svc) => svc.sandboxes(Instance.project.id)))
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
      validator("json", Worktree.RemoveInput),
      async (c) => {
        const body = c.req.valid("json")
        await AppRuntime.runPromise(Worktree.Service.use((svc) => svc.remove(body)))
        await AppRuntime.runPromise(
          Project.Service.use((svc) => svc.removeSandbox(Instance.project.id, body.directory)),
        )
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
      validator("json", Worktree.ResetInput),
      async (c) => {
        const body = c.req.valid("json")
        await AppRuntime.runPromise(Worktree.Service.use((svc) => svc.reset(body)))
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
          // kilocode_change start
          projectID: z.string().optional().meta({ description: "Filter sessions by project ID" }),
          directory: z.string().optional().meta({ description: "Filter sessions by project directory" }),
          worktrees: z.coerce
            .boolean()
            .optional()
            .meta({ description: "Restrict sessions to the current repo worktree family or current directory" }),
          // kilocode_change end
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
        const limit = query.limit ?? 100 // kilocode_change
        // kilocode_change start
        const projectID = query.worktrees && !query.projectID ? Instance.project.id : query.projectID
        // kilocode_change end
        const directories = query.worktrees ? await WorktreeFamily.list() : undefined // kilocode_change
        // kilocode_change start - sort longest-first so most specific worktree matches first
        const sorted = directories ? [...directories].sort((a, b) => b.length - a.length) : undefined
        // kilocode_change end
        const sessions: Session.GlobalInfo[] = []
        for await (const session of Session.listGlobal({
          projectID, // kilocode_change
          directory: query.worktrees ? undefined : query.directory, // kilocode_change - ignore SDK-injected directory when listing across worktrees
          directories, // kilocode_change
          roots: query.roots,
          start: query.start,
          cursor: query.cursor,
          search: query.search,
          limit: limit + 1,
          archived: query.archived,
        })) {
          // kilocode_change start - resolve worktree folder name for each session
          if (sorted) {
            const root = sorted.find((d) => Filesystem.contains(d, session.directory))
            sessions.push({ ...session, worktreeName: path.basename(root ?? session.directory) })
            continue
          }
          // kilocode_change end
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
        return c.json(
          await AppRuntime.runPromise(
            Effect.gen(function* () {
              const mcp = yield* MCP.Service
              return yield* mcp.resources()
            }),
          ),
        )
      },
    ),
)
