import { describeRoute, resolver, validator } from "hono-openapi"
import { Hono } from "hono"
// import { proxy } from "hono/proxy" // kilocode_change - disabled external proxy
import type { UpgradeWebSocket } from "hono/ws"
import z from "zod"
// import { createHash } from "node:crypto" // kilocode_change - disabled external proxy
import * as fs from "node:fs/promises"
import { Log } from "../util/log"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill"
import { Global } from "../global"
import { LSP } from "../lsp"
import { Command } from "../command"
// import { Flag } from "../flag/flag" // kilocode_change - unused after disabling embedded UI
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { Snapshot } from "@/snapshot"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { ProviderRoutes } from "./routes/provider"
import { EventRoutes } from "./routes/event"
import { errorHandler } from "./middleware"
import { register as registerKiloRoutes } from "../kilocode/server/instance" // kilocode_change
import { getMimeType } from "hono/utils/mime"

const log = Log.create({ service: "server" })

// kilocode_change start - disabled embedded UI
// const embeddedUIPromise = Flag.KILO_DISABLE_EMBEDDED_WEB_UI
//   ? Promise.resolve(null)
//   : // @ts-expect-error - generated file at build time
//     import("opencode-web-ui.gen.ts").then((module) => module.default as Record<string, string>).catch(() => null)
// kilocode_change end

export const InstanceRoutes = (upgrade: UpgradeWebSocket, app: Hono = new Hono()) => {
  const base = app
    .onError(errorHandler(log))
    .route("/project", ProjectRoutes())
    .route("/pty", PtyRoutes(upgrade))
    .route("/config", ConfigRoutes())
    .route("/experimental", ExperimentalRoutes())
    .route("/session", SessionRoutes())
    .route("/permission", PermissionRoutes())
    .route("/question", QuestionRoutes())
    .route("/provider", ProviderRoutes())
    .route("/", FileRoutes())
    .route("/", EventRoutes())
    .route("/mcp", McpRoutes())
    .route("/tui", TuiRoutes())
    .post(
      "/instance/dispose",
      describeRoute({
        summary: "Dispose instance",
        description: "Clean up and dispose the current OpenCode instance, releasing all resources.",
        operationId: "instance.dispose",
        responses: {
          200: {
            description: "Instance disposed",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await Instance.dispose()
        return c.json(true)
      },
    )
    .get(
      "/path",
      describeRoute({
        summary: "Get paths",
        description: "Retrieve the current working directory and related path information for the OpenCode instance.",
        operationId: "path.get",
        responses: {
          200: {
            description: "Path",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      home: z.string(),
                      state: z.string(),
                      config: z.string(),
                      worktree: z.string(),
                      directory: z.string(),
                    })
                    .meta({
                      ref: "Path",
                    }),
                ),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json({
          home: Global.Path.home,
          state: Global.Path.state,
          config: Global.Path.config,
          worktree: Instance.worktree,
          directory: Instance.directory,
        })
      },
    )
    .get(
      "/vcs",
      describeRoute({
        summary: "Get VCS info",
        description: "Retrieve version control system (VCS) information for the current project, such as git branch.",
        operationId: "vcs.get",
        responses: {
          200: {
            description: "VCS info",
            content: {
              "application/json": {
                schema: resolver(Vcs.Info),
              },
            },
          },
        },
      }),
      async (c) => {
        const [branch, default_branch] = await Promise.all([Vcs.branch(), Vcs.defaultBranch()])
        return c.json({
          branch,
          default_branch,
        })
      },
    )
    .get(
      "/vcs/diff",
      describeRoute({
        summary: "Get VCS diff",
        description: "Retrieve the current git diff for the working tree or against the default branch.",
        operationId: "vcs.diff",
        responses: {
          200: {
            description: "VCS diff",
            content: {
              "application/json": {
                schema: resolver(Vcs.FileDiff.array()),
              },
            },
          },
        },
      }),
      validator(
        "query",
        z.object({
          mode: Vcs.Mode,
        }),
      ),
      async (c) => {
        return c.json(await Vcs.diff(c.req.valid("query").mode))
      },
    )
    .get(
      "/command",
      describeRoute({
        summary: "List commands",
        description: "Get a list of all available commands in the OpenCode system.",
        operationId: "command.list",
        responses: {
          200: {
            description: "List of commands",
            content: {
              "application/json": {
                schema: resolver(Command.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const commands = await Command.list()
        return c.json(commands)
      },
    )
    .get(
      "/agent",
      describeRoute({
        summary: "List agents",
        description: "Get a list of all available AI agents in the OpenCode system.",
        operationId: "app.agents",
        responses: {
          200: {
            description: "List of agents",
            content: {
              "application/json": {
                schema: resolver(Agent.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const modes = await Agent.list()
        return c.json(modes)
      },
    )
    .get(
      "/skill",
      describeRoute({
        summary: "List skills",
        description: "Get a list of all available skills in the OpenCode system.",
        operationId: "app.skills",
        responses: {
          200: {
            description: "List of skills",
            content: {
              "application/json": {
                schema: resolver(Skill.Info.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        const skills = await Skill.all()
        return c.json(skills)
      },
    )
    .get(
      "/lsp",
      describeRoute({
        summary: "Get LSP status",
        description: "Get LSP server status",
        operationId: "lsp.status",
        responses: {
          200: {
            description: "LSP server status",
            content: {
              "application/json": {
                schema: resolver(LSP.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await LSP.status())
      },
    )
    .get(
      "/formatter",
      describeRoute({
        summary: "Get formatter status",
        description: "Get formatter status",
        operationId: "formatter.status",
        responses: {
          200: {
            description: "Formatter status",
            content: {
              "application/json": {
                schema: resolver(Format.Status.array()),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await Format.status())
      },
    )

  // kilocode_change start - register kilo-specific routes before catch-all
  const extended = registerKiloRoutes(base)
  // kilocode_change end

  // kilocode_change start - disable external proxy to app.opencode.ai for privacy/security
  return extended.all("/*", async (c) => {
    return c.notFound()
  })
  // kilocode_change end

  // kilocode_change start - disabled embedded UI
  // if (embeddedWebUI) {
  //   const match = embeddedWebUI[path.replace(/^\//, "")] ?? embeddedWebUI["index.html"] ?? null
  //   if (!match) return c.json({ error: "Not Found" }, 404)

  //   if (await fs.exists(match)) {
  //     const mime = getMimeType(match) ?? "text/plain"
  //     c.header("Content-Type", mime)
  //     if (mime.startsWith("text/html")) {
  //       c.header("Content-Security-Policy", DEFAULT_CSP)
  //     }
  //     return c.body(new Uint8Array(await fs.readFile(match)))
  //   } else {
  //     return c.json({ error: "Not Found" }, 404)
  //   }
  // } else {
  //   const response = await proxy(`https://app.opencode.ai${path}`, {
  //     ...c.req,
  //     headers: {
  //       ...c.req.raw.headers,
  //       host: "app.opencode.ai",
  //     },
  //   })
  //   const match = response.headers.get("content-type")?.includes("text/html")
  //     ? (await response.clone().text()).match(
  //         /<script\b(?![^>]*\bsrc\s*=)[^>]*\bid=(['"])oc-theme-preload-script\1[^>]*>([\s\S]*?)<\/script>/i,
  //       )
  //     : undefined
  //   const hash = match ? createHash("sha256").update(match[2]).digest("base64") : ""
  //   response.headers.set("Content-Security-Policy", csp(hash))
  //   return response
  // }
  // kilocode_change end
}
