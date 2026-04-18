import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import { Log } from "../util/log"
import { describeRoute, generateSpecs, validator, resolver, openAPIRouteHandler } from "hono-openapi"
import { Hono } from "hono"
import { cors } from "hono/cors"
import { streamSSE } from "hono/streaming"
import { basicAuth } from "hono/basic-auth"
// devilcode_change - Bun-native rate limiter (replaces hono-rate-limiter)
import { rateLimit } from "./rate-limit"
import z from "zod"
import { Provider } from "../provider/provider"
import { NamedError } from "@opencode-ai/util/error"
import { LSP } from "../lsp"
import { Format } from "../format"
import { TuiRoutes } from "./routes/tui"
import { Instance } from "../project/instance"
import { Vcs } from "../project/vcs"
import { Agent } from "../agent/agent"
import { Skill } from "../skill/skill"
import { Auth } from "../auth"
import { ModelCache } from "../provider/model-cache" // devilcode_change
import { Flag } from "../flag/flag"
import { Command } from "../command"
import { Global } from "../global"
import { WorkspaceContext } from "../control-plane/workspace-context"
import { WorkspaceRouterMiddleware } from "../control-plane/workspace-router-middleware"
import { ProjectRoutes } from "./routes/project"
import { SessionRoutes } from "./routes/session"
import { PtyRoutes } from "./routes/pty"
import { McpRoutes } from "./routes/mcp"
import { FileRoutes } from "./routes/file"
import { ConfigRoutes } from "./routes/config"
import { ExperimentalRoutes } from "./routes/experimental"
import { TelemetryRoutes } from "./routes/telemetry" // devilcode_change
import { ProviderRoutes } from "./routes/provider"
import { createDevilRoutes } from "@devilcode/kilo-gateway" // devilcode_change
import { Database } from "../storage/db" // devilcode_change
import { Session } from "../session" // devilcode_change
import { Identifier } from "../id/id" // devilcode_change
import { SessionTable, MessageTable, PartTable } from "../session/session.sql" // devilcode_change
import { lazy } from "../util/lazy"
import { InstanceBootstrap } from "../project/bootstrap"
import { NotFoundError } from "../storage/db"
import type { ContentfulStatusCode } from "hono/utils/http-status"
import { websocket } from "hono/bun"
import { HTTPException } from "hono/http-exception"
import { errors } from "./error"
import { CommitMessageRoutes } from "./routes/commit-message" // devilcode_change
import { EnhancePromptRoutes } from "./routes/enhance-prompt" // devilcode_change
import { DevilcodeRoutes } from "./routes/devilcode" // devilcode_change
import { PermissionKilocodeRoutes } from "../devilcode/permission/routes" // devilcode_change
import { Filesystem } from "@/util/filesystem"
import { QuestionRoutes } from "./routes/question"
import { PermissionRoutes } from "./routes/permission"
import { RemoteRoutes } from "./routes/remote" // devilcode_change
import { GlobalRoutes } from "./routes/global"
import { MDNS } from "./mdns"

// Disable ai-sdk warnings - this global is needed to prevent ai-sdk from logging warnings to stdout
// https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
try {
  ;(globalThis as { AI_SDK_LOG_WARNINGS?: boolean }).AI_SDK_LOG_WARNINGS = false
} catch {
  // Ignore if global assignment fails
}

export const API_VERSION = "1.0.0" // devilcode_change

export namespace Server {
  const log = Log.create({ service: "server" })

  let _url: URL | undefined
  let _corsWhitelist: string[] = []

  function corsOrigin(input?: string) {
    if (!input) return

    const ports = [3000, 5173, 8080, 4096]
    if (input.startsWith("http://localhost:")) {
      const port = parseInt(input.split(":")[2], 10)
      if (ports.includes(port)) return input
      return
    }
    if (input.startsWith("http://127.0.0.1:")) {
      const port = parseInt(input.split(":")[2], 10)
      if (ports.includes(port)) return input
      return
    }
    if (
      input === "tauri://localhost" ||
      input === "http://tauri.localhost" ||
      input === "https://tauri.localhost"
    )
      return input
    if (/^https:\/\/([a-z0-9-]+\.)*opencode\.ai$/.test(input)) {
      return input
    }
    if (_corsWhitelist.includes(input)) {
      return input
    }
    return
  }

  // devilcode_change - shared rate limiter instance (audit C7)
  const _rateLimitMiddleware = rateLimit({
    windowMs: Flag.DEVIL_RATE_LIMIT_WINDOW_MS ?? 15 * 60 * 1000,
    limit: Flag.DEVIL_RATE_LIMIT_MAX ?? 100,
    standardHeaders: true,
    onRejected(c, res) {
      const origin = corsOrigin(c.req.header("origin"))
      if (!origin) return
      res.headers.set("Access-Control-Allow-Origin", origin)
      res.headers.set("Vary", "Origin")
    },
  })

  export function url(): URL {
    return _url ?? new URL("http://localhost:4096")
  }

  const app = new Hono()
  export const App: () => Hono = lazy(
    () =>
      // TODO: Break server.ts into smaller route files to fix type inference
      app
        .onError((err, c) => {
          log.error("failed", {
            error: err,
          })
          if (err instanceof NamedError) {
            let status: ContentfulStatusCode
            if (err instanceof NotFoundError) status = 404
            else if (err instanceof Provider.ModelNotFoundError) status = 400
            else if (err.name.startsWith("Worktree")) status = 400
            else status = 500
            return c.json(err.toObject(), { status })
          }
          if (err instanceof HTTPException) return err.getResponse()
          const message = err instanceof Error && err.stack ? err.stack : err.toString()
          return c.json(new NamedError.Unknown({ message }).toObject(), {
            status: 500,
          })
        })
        .use((c, next) => {
          // Allow CORS preflight requests to succeed without auth.
          // Browser clients sending Authorization headers will preflight with OPTIONS.
          // devilcode_change - audit H1: tradeoff documented. OPTIONS preflight cannot carry the
          // basic-auth header (browsers strip it before sending preflight), so blocking OPTIONS
          // would break all browser clients. Mitigations: rate-limit middleware (audit C7) still
          // applies; CORS origin allowlist gates which origins can preflight at all (see below).
          if (c.req.method === "OPTIONS") return next()
          const password = Flag.DEVIL_SERVER_PASSWORD
          if (!password) return next()
          const username = Flag.DEVIL_SERVER_USERNAME ?? "kilo" // devilcode_change
          return basicAuth({ username, password })(c, next)
        })
        // devilcode_change start - Rate limiting (audit C7). Disable via DEVIL_DISABLE_RATE_LIMIT=1.
        .use(async (c, next) => {
          if (Flag.DEVIL_DISABLE_RATE_LIMIT) return next()
          // Skip preflight + health/log/telemetry to avoid throttling internal traffic.
          const path = c.req.path
          if (
            c.req.method === "OPTIONS" ||
            path === "/global/health" ||
            path === "/log" ||
            path === "/telemetry/capture"
          )
            return next()
          return _rateLimitMiddleware(c, next)
        })
        // devilcode_change end
        // devilcode_change start - Request body size limit: 10MB
        .use(async (c, next) => {
          const contentLength = c.req.header("content-length")
          if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
            return c.json({ error: "Request body too large (max 10MB)" }, 413)
          }
          await next()
        })
        // devilcode_change end
        .use(async (c, next) => {
          // devilcode_change start
          // devilcode change add telemetry because it is high volume
          // add early return to prevent logging timing
          const skipLogging =
            c.req.path === "/log" || c.req.path === "/telemetry/capture" || c.req.path === "/global/health"
          if (skipLogging) {
            await next()
            return
          }
          // devilcode_change end
          if (!skipLogging) {
            log.info("request", {
              method: c.req.method,
              path: c.req.path,
            })
          }
          const timer = log.time("request", {
            method: c.req.method,
            path: c.req.path,
          })
          await next()
          if (!skipLogging) {
            timer.stop()
          }
        })
        // devilcode_change start - CORS whitelist with specific localhost ports only
        .use(
          cors({
            origin: corsOrigin,
          }),
        )
        // devilcode_change end
        .route("/global", GlobalRoutes())
        .put(
          "/auth/:providerID",
          describeRoute({
            summary: "Set auth credentials",
            description: "Set authentication credentials",
            operationId: "auth.set",
            responses: {
              200: {
                description: "Successfully set authentication credentials",
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
            "param",
            z.object({
              providerID: z.string(),
            }),
          ),
          validator("json", Auth.Info),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            const info = c.req.valid("json")
            await Auth.set(providerID, info)
            // devilcode_change start - invalidate provider/model cache after auth change
            ModelCache.clear(providerID)
            // devilcode_change end
            return c.json(true)
          },
        )
        .delete(
          "/auth/:providerID",
          describeRoute({
            summary: "Remove auth credentials",
            description: "Remove authentication credentials",
            operationId: "auth.remove",
            responses: {
              200: {
                description: "Successfully removed authentication credentials",
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
            "param",
            z.object({
              providerID: z.string(),
            }),
          ),
          async (c) => {
            const providerID = c.req.valid("param").providerID
            await Auth.remove(providerID)
            // devilcode_change start - invalidate provider/model cache after auth removal
            ModelCache.clear(providerID)
            // devilcode_change end
            return c.json(true)
          },
        )
        .use(async (c, next) => {
          if (c.req.path === "/log") return next()
          const workspaceID = c.req.query("workspace") || c.req.header("x-kilo-workspace")
          const raw = c.req.query("directory") || c.req.header("x-kilo-directory") || process.cwd()
          const directory = Filesystem.resolve(
            (() => {
              try {
                return decodeURIComponent(raw)
              } catch {
                return raw
              }
            })(),
          )

          return WorkspaceContext.provide({
            workspaceID,
            async fn() {
              return Instance.provide({
                directory,
                init: InstanceBootstrap,
                async fn() {
                  return next()
                },
              })
            },
          })
        })
        .use(WorkspaceRouterMiddleware)
        .get(
          "/doc",
          openAPIRouteHandler(app, {
            documentation: {
              info: {
                title: "kilo", // devilcode_change
                version: API_VERSION,
                description: "kilo api", // devilcode_change
              },
              openapi: "3.1.1",
            },
          }),
        )
        .use(
          validator(
            "query",
            z.object({
              directory: z.string().optional(),
              workspace: z.string().optional(),
            }),
          ),
        )
        .route("/project", ProjectRoutes())
        .route("/pty", PtyRoutes())
        .route("/config", ConfigRoutes())
        .route("/experimental", ExperimentalRoutes())
        .route("/session", SessionRoutes())
        .route("/permission", PermissionRoutes())
        .route("/permission", PermissionKilocodeRoutes()) // kilocode_change
        .route("/question", QuestionRoutes())
        .route("/provider", ProviderRoutes())
        .route("/telemetry", TelemetryRoutes()) // devilcode_change
        .route("/remote", RemoteRoutes()) // devilcode_change
        .route("/commit-message", CommitMessageRoutes()) // devilcode_change
        .route("/enhance-prompt", EnhancePromptRoutes()) // devilcode_change
        .route("/devilcode", DevilcodeRoutes()) // devilcode_change
        // devilcode_change start - Devil Gateway routes
        .route(
          "/kilo",
          createDevilRoutes({
            Hono,
            describeRoute,
            validator,
            resolver,
            errors,
            Auth,
            z,
            Database, // devilcode_change
            Instance, // devilcode_change
            SessionTable, // devilcode_change
            MessageTable, // devilcode_change
            PartTable, // devilcode_change
            SessionToRow: Session.toRow, // devilcode_change
            Bus, // devilcode_change
            SessionCreatedEvent: Session.Event.Created, // devilcode_change
            Identifier, // devilcode_change
            ModelCache, // devilcode_change
          }),
        )
        // devilcode_change end
        .route("/", FileRoutes())
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
            description:
              "Retrieve the current working directory and related path information for the OpenCode instance.",
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
            description:
              "Retrieve version control system (VCS) information for the current project, such as git branch.",
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
            const branch = await Vcs.branch()
            return c.json({
              branch,
            })
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
        .post(
          "/log",
          describeRoute({
            summary: "Write log",
            description: "Write a log entry to the server logs with specified level and metadata.",
            operationId: "app.log",
            responses: {
              200: {
                description: "Log entry written successfully",
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
              service: z.string().meta({ description: "Service name for the log entry" }),
              level: z.enum(["debug", "info", "error", "warn"]).meta({ description: "Log level" }),
              message: z.string().meta({ description: "Log message" }),
              extra: z
                .record(z.string(), z.any())
                .optional()
                .meta({ description: "Additional metadata for the log entry" }),
            }),
          ),
          async (c) => {
            const { service, level, message, extra } = c.req.valid("json")
            const logger = Log.create({ service })

            switch (level) {
              case "debug":
                logger.debug(message, extra)
                break
              case "info":
                logger.info(message, extra)
                break
              case "error":
                logger.error(message, extra)
                break
              case "warn":
                logger.warn(message, extra)
                break
            }

            return c.json(true)
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
        .get(
          "/event",
          describeRoute({
            summary: "Subscribe to events",
            description: "Get events",
            operationId: "event.subscribe",
            responses: {
              200: {
                description: "Event stream",
                content: {
                  "text/event-stream": {
                    schema: resolver(BusEvent.payloads()),
                  },
                },
              },
            },
          }),
          async (c) => {
            log.info("event connected")
            // devilcode_change start - Security headers for SSE endpoints
            c.header("X-Accel-Buffering", "no")
            c.header("X-Content-Type-Options", "nosniff")
            c.header("X-Frame-Options", "DENY")
            c.header("Referrer-Policy", "strict-origin-when-cross-origin")
            c.header("Content-Security-Policy", "default-src 'none'; connect-src 'self'; script-src 'none'")
            // devilcode_change end
            return streamSSE(c, async (stream) => {
              stream.writeSSE({
                data: JSON.stringify({
                  type: "server.connected",
                  properties: {},
                }),
              })
              const unsub = Bus.subscribeAll(async (event) => {
                await stream.writeSSE({
                  data: JSON.stringify(event),
                })
                if (event.type === Bus.InstanceDisposed.type) {
                  stream.close()
                }
              })

              // Send heartbeat every 10s to prevent stalled proxy streams.
              const heartbeat = setInterval(() => {
                stream.writeSSE({
                  data: JSON.stringify({
                    type: "server.heartbeat",
                    properties: {},
                  }),
                })
              }, 10_000)

              await new Promise<void>((resolve) => {
                stream.onAbort(() => {
                  clearInterval(heartbeat)
                  unsub()
                  resolve()
                  log.info("event disconnected")
                })
              })
            })
          },
        )
        // Return 404 for all unmatched routes
        .all("/*", async (c) => c.notFound()) as unknown as Hono,
  )

  export async function openapi() {
    // Cast to break excessive type recursion from long route chains
    const result = await generateSpecs(App() as Hono, {
      documentation: {
        info: {
          title: "kilo", // devilcode_change
          version: API_VERSION,
          description: "kilo api", // devilcode_change
        },
        openapi: "3.1.1",
      },
    })
    return result
  }

  export function listen(opts: {
    port: number
    hostname: string
    mdns?: boolean
    mdnsDomain?: string
    cors?: string[]
  }) {
    _corsWhitelist = opts.cors ?? []

    const args = {
      hostname: opts.hostname,
      idleTimeout: 0,
      fetch: App().fetch,
      websocket: websocket,
    } as const
    const tryServe = (port: number) => {
      try {
        return Bun.serve({ ...args, port })
      } catch {
        return undefined
      }
    }
    const server = opts.port === 0 ? (tryServe(4096) ?? tryServe(0)) : tryServe(opts.port)
    if (!server) throw new Error(`Failed to start server on port ${opts.port}`)

    _url = server.url

    const shouldPublishMDNS =
      opts.mdns &&
      server.port &&
      opts.hostname !== "127.0.0.1" &&
      opts.hostname !== "localhost" &&
      opts.hostname !== "::1"
    if (shouldPublishMDNS) {
      MDNS.publish(server.port!, opts.mdnsDomain)
    } else if (opts.mdns) {
      log.warn("mDNS enabled but hostname is loopback; skipping mDNS publish")
    }

    const originalStop = server.stop.bind(server)
    server.stop = async (closeActiveConnections?: boolean) => {
      if (shouldPublishMDNS) MDNS.unpublish()
      return originalStop(closeActiveConnections)
    }

    return server
  }
}
