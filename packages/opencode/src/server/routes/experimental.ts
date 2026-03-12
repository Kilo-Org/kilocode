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
import { $ } from "bun" // kilocode_change
import path from "path" // kilocode_change
import { Snapshot } from "../../snapshot" // kilocode_change
import { Review } from "../../kilocode/review/review" // kilocode_change
import { Log } from "../../util/log" // kilocode_change
import { BinaryFile } from "@opencode-ai/util/binary-file"
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
    .route("/workspace", WorkspaceRoutes())
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
        const t0 = performance.now()
        const query = c.req.valid("query")
        const base = query.base || (await Review.getBaseBranch())
        // kilocode_change end
        const dir = Instance.directory
        log.info("[PERF] worktree-diff START", { dir, base })

        const tMergeBase = performance.now()
        const mergeBaseResult = await $`git merge-base HEAD ${base}`.cwd(dir).quiet().nothrow()
        log.info("[PERF] git merge-base", { ms: Math.round(performance.now() - tMergeBase) })
        if (mergeBaseResult.exitCode !== 0) {
          log.warn("git merge-base failed", {
            exitCode: mergeBaseResult.exitCode,
            stderr: mergeBaseResult.stderr.toString().trim(),
            dir,
            base,
          })
          return c.json([])
        }
        const ancestor = mergeBaseResult.stdout.toString().trim()
        log.info("merge-base resolved", { ancestor: ancestor.slice(0, 12) })

        const nameStatus = await $`git -c core.quotepath=false diff --name-status --no-renames ${ancestor}`
          .cwd(dir)
          .quiet()
          .nothrow()
        if (nameStatus.exitCode !== 0) return c.json([])

        const numstat = await $`git -c core.quotepath=false diff --numstat --no-renames ${ancestor}`
          .cwd(dir)
          .quiet()
          .nothrow()
        const stats = new Map<string, { additions: number; deletions: number }>()
        // kilocode_change start - track binary files to skip content reads
        const binaryFiles = new Set<string>()
        if (numstat.exitCode === 0) {
          for (const line of numstat.stdout.toString().trim().split("\n")) {
            if (!line) continue
            const parts = line.split("\t")
            const add = parts[0]
            const del = parts[1]
            const file = parts.slice(2).join("\t")
            if (!file) continue
            if (BinaryFile.isNumstat(add, del, file)) {
              binaryFiles.add(file)
              stats.set(file, { additions: 0, deletions: 0 })
            } else {
              stats.set(file, {
                additions: add === "-" ? 0 : parseInt(add!, 10),
                deletions: del === "-" ? 0 : parseInt(del!, 10),
              })
            }
          }
        }
        // kilocode_change end

        const seen = new Set<string>()
        const entries: { file: string; status: "added" | "deleted" | "modified" }[] = []
        for (const line of nameStatus.stdout.toString().trim().split("\n")) {
          if (!line) continue
          const parts = line.split("\t")
          const statusChar = parts[0]
          const file = parts.slice(1).join("\t")
          if (!file || !statusChar) continue
          seen.add(file)
          const status =
            statusChar === "A" ? ("added" as const) : statusChar === "D" ? ("deleted" as const) : ("modified" as const)
          entries.push({ file, status })
        }

        // kilocode_change - parallel file reads with concurrency limit
        log.info("[PERF] tracked file count", { count: entries.length })
        const tFileReads = performance.now()
        const CONCURRENCY = 10
        const diffs: Snapshot.FileDiff[] = []
        for (let i = 0; i < entries.length; i += CONCURRENCY) {
          const batch = entries.slice(i, i + CONCURRENCY)
          const results = await Promise.all(
            batch.map(async (entry) => {
              const stat = stats.get(entry.file) ?? { additions: 0, deletions: 0 }
              // kilocode_change - skip content reads for binary files (images, LFS pointers, etc)
              if (binaryFiles.has(entry.file)) {
                return {
                  file: entry.file,
                  before: "",
                  after: "",
                  additions: stat.additions,
                  deletions: stat.deletions,
                  binary: true,
                  status: entry.status,
                }
              }
              const before =
                entry.status === "added"
                  ? ""
                  : await (async () => {
                      const result = await $`git show ${ancestor}:${entry.file}`.cwd(dir).quiet().nothrow()
                      return result.exitCode === 0 ? result.stdout.toString() : ""
                    })()
              const after =
                entry.status === "deleted"
                  ? ""
                  : await (async () => {
                      const f = Bun.file(path.join(dir, entry.file))
                      return (await f.exists()) ? await f.text() : ""
                    })()
              return {
                file: entry.file,
                before,
                after,
                additions: stat.additions,
                deletions: stat.deletions,
                status: entry.status,
              }
            }),
          )
          diffs.push(...results)
        }

        log.info("[PERF] all tracked file reads (parallel)", {
          ms: Math.round(performance.now() - tFileReads),
          files: entries.length,
        })

        // Include untracked files (new files never staged) so the diff
        // viewer shows all working-tree changes, not just tracked ones.
        const untrackedResult = await $`git ls-files --others --exclude-standard`.cwd(dir).quiet().nothrow()
        if (untrackedResult.exitCode === 0) {
          const untrackedFiles = untrackedResult.stdout.toString().trim()
          if (untrackedFiles) {
            log.info("untracked files found", { count: untrackedFiles.split("\n").length })
          }
          const untrackedEntries = untrackedFiles.split("\n").filter((file: string) => file && !seen.has(file))
          for (let i = 0; i < untrackedEntries.length; i += CONCURRENCY) {
            const batch = untrackedEntries.slice(i, i + CONCURRENCY)
            const results = await Promise.all(
              batch.map(async (file: string) => {
                // kilocode_change - skip binary untracked files by extension
                if (BinaryFile.isPath(file)) {
                  return {
                    file,
                    before: "",
                    after: "",
                    additions: 0,
                    deletions: 0,
                    binary: true,
                    status: "added" as const,
                  }
                }
                const f = Bun.file(path.join(dir, file))
                if (!(await f.exists())) return undefined
                const content = await f.text()
                const lines = content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length
                return {
                  file,
                  before: "",
                  after: content,
                  additions: lines,
                  deletions: 0,
                  status: "added" as const,
                }
              }),
            )
            for (const r of results) {
              if (r) diffs.push(r)
            }
          }
        } else {
          log.warn("git ls-files failed", {
            exitCode: untrackedResult.exitCode,
            stderr: untrackedResult.stderr.toString().trim(),
          })
        }

        const totalBytes = diffs.reduce(
          (sum: number, d: Snapshot.FileDiff) => sum + d.before.length + d.after.length,
          0,
        )
        log.info("[PERF] worktree-diff DONE", {
          totalMs: Math.round(performance.now() - t0),
          totalFiles: diffs.length,
          totalBytes,
          totalMB: (totalBytes / 1024 / 1024).toFixed(2),
        })
        return c.json(diffs)
      },
    )
    // kilocode_change end
    // kilocode_change start - lightweight stats endpoint for agent manager
    .get(
      "/worktree/stats",
      describeRoute({
        summary: "Get worktree diff stats",
        description:
          "Get lightweight diff stats (file count, additions, deletions) without file contents. Much faster than /worktree/diff for use in polling scenarios.",
        operationId: "worktree.stats",
        responses: {
          200: {
            description: "Diff stats",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    files: z.number(),
                    additions: z.number(),
                    deletions: z.number(),
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
          base: z.string().optional().meta({ description: "Base branch or ref to diff against" }),
        }),
      ),
      async (c) => {
        const log = Log.create({ service: "worktree-stats" })
        const query = c.req.valid("query")
        const base = query.base || (await Review.getBaseBranch())
        const dir = Instance.directory

        const mergeBaseResult = await $`git merge-base HEAD ${base}`.cwd(dir).quiet().nothrow()
        if (mergeBaseResult.exitCode !== 0) {
          return c.json({ files: 0, additions: 0, deletions: 0 })
        }
        const ancestor = mergeBaseResult.stdout.toString().trim()

        const numstat = await $`git -c core.quotepath=false diff --numstat --no-renames ${ancestor}`
          .cwd(dir)
          .quiet()
          .nothrow()

        let files = 0
        let additions = 0
        let deletions = 0
        if (numstat.exitCode === 0) {
          for (const line of numstat.stdout.toString().trim().split("\n")) {
            if (!line) continue
            const parts = line.split("\t")
            const add = parts[0]
            const del = parts[1]
            if (add && del) {
              files++
              additions += add === "-" ? 0 : parseInt(add, 10)
              deletions += del === "-" ? 0 : parseInt(del, 10)
            }
          }
        }

        // Count untracked files
        const untrackedResult = await $`git ls-files --others --exclude-standard`.cwd(dir).quiet().nothrow()
        if (untrackedResult.exitCode === 0) {
          const untracked = untrackedResult.stdout.toString().trim()
          if (untracked) {
            for (const file of untracked.split("\n")) {
              if (!file) continue
              files++
              // kilocode_change - skip reading binary files for line count
              if (BinaryFile.isPath(file)) continue
              const f = Bun.file(path.join(dir, file))
              if (await f.exists()) {
                const content = await f.text()
                additions += content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length
              }
            }
          }
        }

        log.info("stats complete", { files, additions, deletions })
        return c.json({ files, additions, deletions })
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
