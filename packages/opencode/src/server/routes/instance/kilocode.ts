// kilocode_change - new file
// Kilo-specific routes that live in the CLI package (direct access to internals).
// All future kilo-specific endpoints should be added here.
import { Hono } from "hono"
import { describeRoute, validator, resolver } from "hono-openapi"
import z from "zod"
import { Skill } from "@/skill"
import { Agent } from "@/agent/agent"
import { lazy } from "@/util/lazy"
import { Global } from "@opencode-ai/core/global"
import { errors } from "../../error"
import { SessionImportRoutes } from "@/kilocode/session-import/routes"
import { HeapSnapshot } from "@/kilocode/cli/heap-snapshot"
import path from "node:path"
import { isPathWithinAllowlist } from "@/util/path-safety"

export const KilocodeRoutes = lazy(() =>
  new Hono()
    .route("/session-import", SessionImportRoutes())
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
        const resolved = path.resolve(location)
        const dir = path.dirname(resolved)

        // SEC-001 (route-level defense-in-depth): reject path-traversal attempts.
        // Derive the project root from the request so the client cannot force deletion
        // outside its own workspace by injecting `../` into `location`.
        const rawDir = c.req.query("directory") || c.req.header("x-kilo-directory") || process.cwd()
        const projectDir = path.resolve(decodeURIComponent(rawDir))
        const allowedDirs = [
          Global.Path.config,
          path.join(projectDir, ".kilocode"),
          path.join(projectDir, ".kilo"),
          path.join(projectDir, ".opencode"),
          path.join(process.env.HOME ?? "", ".config", "kilo"),
          projectDir,
        ]
        if (!isPathWithinAllowlist(dir, allowedDirs)) {
          return c.json({ error: `path traversal blocked: ${dir}` }, 400)
        }

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
        await Agent.remove(name)
        return c.json(true)
      },
    ),
)
