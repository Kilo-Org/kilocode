import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { ToolRegistry } from "../../tool/registry"
import { Worktree } from "../../worktree"
import { Instance } from "../../project/instance"
import { Project } from "../../project/project"
import { MCP } from "../../mcp"
import { zodToJsonSchema } from "zod-to-json-schema"
import { errors } from "../error"
import { lazy } from "../../util/lazy"
import { $ } from "bun" // kilocode_change
import path from "path" // kilocode_change
import { Snapshot } from "../../snapshot" // kilocode_change
import { Review } from "../../kilocode/review/review" // kilocode_change
import { Log } from "../../util/log" // kilocode_change

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
      async (c) => {
        const log = Log.create({ service: "worktree-diff" })
        const base = c.req.query("base") || (await Review.getBaseBranch())
        const dir = Instance.directory
        log.info("computing diff", { dir, base })

        const mergeBaseResult = await $`git merge-base HEAD ${base}`.cwd(dir).quiet().nothrow()
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
        if (numstat.exitCode === 0) {
          for (const line of numstat.stdout.toString().trim().split("\n")) {
            if (!line) continue
            const parts = line.split("\t")
            const add = parts[0]
            const del = parts[1]
            const file = parts.slice(2).join("\t")
            if (file)
              stats.set(file, {
                additions: add === "-" ? 0 : parseInt(add!, 10),
                deletions: del === "-" ? 0 : parseInt(del!, 10),
              })
          }
        }

        const diffs: Snapshot.FileDiff[] = []
        const seen = new Set<string>()
        for (const line of nameStatus.stdout.toString().trim().split("\n")) {
          if (!line) continue
          const parts = line.split("\t")
          const statusChar = parts[0]
          const file = parts.slice(1).join("\t")
          if (!file || !statusChar) continue

          seen.add(file)
          const status =
            statusChar === "A" ? ("added" as const) : statusChar === "D" ? ("deleted" as const) : ("modified" as const)

          const before =
            status === "added"
              ? ""
              : await (async () => {
                  const result = await $`git show ${ancestor}:${file}`.cwd(dir).quiet().nothrow()
                  return result.exitCode === 0 ? result.stdout.toString() : ""
                })()

          const after =
            status === "deleted"
              ? ""
              : await (async () => {
                  const f = Bun.file(path.join(dir, file))
                  return (await f.exists()) ? await f.text() : ""
                })()

          const stat = stats.get(file) ?? { additions: 0, deletions: 0 }
          diffs.push({
            file,
            before,
            after,
            additions: stat.additions,
            deletions: stat.deletions,
            status,
          })
        }

        // Include untracked files (new files never staged) so the diff
        // viewer shows all working-tree changes, not just tracked ones.
        const untrackedResult = await $`git ls-files --others --exclude-standard`.cwd(dir).quiet().nothrow()
        if (untrackedResult.exitCode === 0) {
          const untrackedFiles = untrackedResult.stdout.toString().trim()
          if (untrackedFiles) {
            log.info("untracked files found", { count: untrackedFiles.split("\n").length })
          }
          for (const file of untrackedFiles.split("\n")) {
            if (!file || seen.has(file)) continue
            const f = Bun.file(path.join(dir, file))
            if (!(await f.exists())) continue
            const content = await f.text()
            const lines = content.endsWith("\n") ? content.split("\n").length - 1 : content.split("\n").length
            diffs.push({
              file,
              before: "",
              after: content,
              additions: lines,
              deletions: 0,
              status: "added",
            })
          }
        } else {
          log.warn("git ls-files failed", {
            exitCode: untrackedResult.exitCode,
            stderr: untrackedResult.stderr.toString().trim(),
          })
        }

        log.info("diff complete", { totalFiles: diffs.length })
        return c.json(diffs)
      },
    )
    // kilocode_change end
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
