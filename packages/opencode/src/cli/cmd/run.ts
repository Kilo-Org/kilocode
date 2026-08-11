import type { PermissionV1 } from "@opencode-ai/core/v1/permission"
import { FSUtil } from "@opencode-ai/core/fs-util"
// kilocode_change start - use Kilo CLI branding
// CLI entry point for `kilo run` and `kilo --mini`.
//
// Handles three modes:
//   1. Non-interactive (default): sends a single prompt, streams events to
//      stdout, and exits when the session goes idle.
//   2. Interactive local (`kilo --mini`): boots the split-footer direct mode
//      with an in-process server (no external HTTP).
//   3. Interactive attach (`kilo --mini --attach`): connects to a running
//      kilo server and runs interactive mode against it.
// kilocode_change end
//
// Also supports `--command` for slash-command execution, `--format json` for
// raw event streaming, `--continue` / `--session` for session resumption,
// and `--fork` for forking before continuing.
import type { Argv } from "yargs"
import path from "path"
import { pathToFileURL } from "url"
import { open } from "node:fs/promises"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { EOL } from "os"
import { Filesystem } from "@/util/filesystem"
import type { KiloClient, Session, ToolPart } from "@kilocode/sdk/v2"
import { FormatError, FormatUnknownError } from "../error"
import { INTERACTIVE_INPUT_ERROR, resolveInteractiveStdin } from "./run/runtime.stdin"
// kilocode_change start - Kilo implementations (createKiloClient, run-message,
// cloud-session, run-auto, headless, KiloRun) are dynamically imported inside the
// handler so other CLI commands don't pay their module cost at startup.
// kilocode_change end

type ModelInput = Parameters<KiloClient["session"]["prompt"]>[0]["model"]

function pick(value: string | undefined): ModelInput | undefined {
  if (!value) return undefined
  const [providerID, ...rest] = value.split("/")
  return {
    providerID,
    modelID: rest.join("/"),
  } as ModelInput
}

function resolveRunInput(value?: string, piped?: string): string | undefined {
  if (!value) {
    return piped
  }

  if (!piped) {
    return value
  }

  return value + "\n" + piped
}

type FilePart = {
  type: "file"
  url: string
  filename: string
  mime: string
}

const ATTACH_FILE_MAX_BYTES = 10 * 1024 * 1024

type Inline = {
  icon: string
  title: string
  description?: string
}

type SessionInfo = {
  id: string
  title?: string
  directory?: string
  model?: Session["model"]
}

function inline(info: Inline) {
  const suffix = info.description ? UI.Style.TEXT_DIM + ` ${info.description}` + UI.Style.TEXT_NORMAL : ""
  UI.println(UI.Style.TEXT_NORMAL + info.icon, UI.Style.TEXT_NORMAL + info.title + suffix)
}

function block(info: Inline, output?: string) {
  UI.empty()
  inline(info)
  if (!output?.trim()) return
  UI.println(output)
  UI.empty()
}

function formatRunError(error: unknown) {
  return FormatError(error) ?? FormatUnknownError(error)
}

async function tool(part: ToolPart) {
  try {
    const { toolInlineInfo } = await import("./run/tool")
    const next = toolInlineInfo(part)
    if (next.mode === "block") {
      block(next, next.body)
      return
    }

    inline(next)
  } catch {
    inline({
      icon: "\u2699",
      title: part.tool,
    })
  }
}

async function toolError(part: ToolPart) {
  try {
    const { toolInlineInfo } = await import("./run/tool")
    const next = toolInlineInfo(part)
    inline({
      icon: "✗",
      title: `${next.title} failed`,
      ...(next.description && { description: next.description }),
    })
    return
  } catch {
    inline({
      icon: "✗",
      title: `${part.tool} failed`,
    })
  }
}

export const RunCommand = effectCmd({
  command: "run [message..]",
  describe: "run kilo with a message", // kilocode_change
  // --attach connects to a remote server (no local instance needed); the
  // default path runs an in-process server and needs the project instance.
  instance: (args) => !args.attach,
  // For --dir without --attach, load instance for the resolved target dir.
  // The handler also chdirs (preserving the legacy order: chdir → file resolution).
  directory: (args) => (args.dir && !args.attach ? path.resolve(process.cwd(), args.dir) : process.cwd()),
  builder: (yargs: Argv) =>
    yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        describe: "session id to continue",
        type: "string",
      })
      .option("fork", {
        describe: "fork the session before continuing (requires --continue or --session)",
        type: "boolean",
      })
      // kilocode_change start - support cloud fork in run command
      .option("cloud-fork", {
        type: "boolean",
        describe: "fetch session from cloud and continue locally (use with --session)",
      })
      // kilocode_change end
      .option("share", {
        type: "boolean",
        describe: "share the session",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
      })
      .option("attach", {
        type: "string",
        describe: "attach to a running kilo server (e.g., http://localhost:4096)",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "basic auth password (defaults to KILO_SERVER_PASSWORD)",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "basic auth username (defaults to KILO_SERVER_USERNAME or 'kilo')", // kilocode_change
      })
      .option("dir", {
        type: "string",
        describe: "directory to run in, path on remote server if attaching",
      })
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
      })
      .option("mini", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("replay", {
        type: "boolean",
        default: true,
        hidden: true,
        describe: "replay interactive session history on resume and after resize (use --no-replay to disable)",
      })
      .option("replay-limit", {
        type: "number",
        hidden: true,
        describe: "cap visible interactive replay to the newest N messages",
      })
      .option("interactive", {
        alias: ["i"],
        type: "boolean",
        describe: "run in direct interactive split-footer mode",
        default: false,
      })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("demo", {
        type: "boolean",
        default: false,
        hidden: true,
        describe: "enable direct interactive demo slash commands; pass one as the message to run it immediately",
      }),
  handler: Effect.fn("Cli.run")(function* (args) {
    const { Agent } = yield* Effect.promise(() => import("@/agent/agent"))
    const { RuntimeFlags } = yield* Effect.promise(() => import("@/effect/runtime-flags"))
    const { InstanceRef } = yield* Effect.promise(() => import("@/effect/instance-ref"))
    const { ServerAuth } = yield* Effect.promise(() => import("@/server/auth"))
    // kilocode_change start - lazy Kilo implementations (see top-of-file note)
    const { createKiloClient } = yield* Effect.promise(() => import("@kilocode/sdk/v2"))
    const { buildRunMessage } = yield* Effect.promise(() => import("@/kilocode/cli/cmd/run-message"))
    const { importCloudSession, validateCloudFork } = yield* Effect.promise(() => import("@/kilocode/cloud-session"))
    const { KiloRunAuto } = yield* Effect.promise(() => import("@/kilocode/cli/run-auto"))
    const { KiloHeadless } = yield* Effect.promise(() => import("@/kilocode/permission/headless"))
    const { KiloRun, KiloRunDaemon } = yield* Effect.promise(() => import("@/kilocode/cli/cmd/run"))
    // kilocode_change end
    const agentSvc = yield* Agent.Service
    const flags = yield* RuntimeFlags.Service
    const localInstance = yield* InstanceRef
    yield* Effect.promise(async () => {
      const rawMessage = [...args.message, ...(args["--"] || [])].join(" ")
      const interactive = args.mini || args.interactive // kilocode_change - retain `kilo run --interactive`
      const skipPermissions = args.yolo || args["dangerously-skip-permissions"] // kilocode_change - --auto is answered by the tracked-session block below
      const thinking = interactive ? (args.thinking ?? true) : (args.thinking ?? false)
      const die = (message: string): never => {
        UI.error(message)
        process.exit(1)
      }
      const dieInteractive = (error: unknown): never => {
        if (error instanceof Error && error.message === INTERACTIVE_INPUT_ERROR) {
          die(error.message)
        }

        throw error
      }

      let message = buildRunMessage(args.message, args["--"]) // kilocode_change

      if (interactive && args.command) {
        die("--mini cannot be used with --command")
      }

      if (args.mini && args._?.[0] !== "mini") {
        die("--mini must be used without the run subcommand")
      }

      if (args.demo && !interactive) {
        die("--demo requires --mini")
      }

      if (interactive && args.format === "json") {
        die("--mini cannot be used with --format json")
      }

      if (args["replay-limit"] !== undefined && !interactive) {
        die("--replay-limit requires --mini")
      }

      if (
        args["replay-limit"] !== undefined &&
        (!Number.isInteger(args["replay-limit"]) || args["replay-limit"] <= 0)
      ) {
        die("--replay-limit must be a positive integer")
      }

      if (interactive && !process.stdout.isTTY) {
        die("--mini requires a TTY stdout")
      }

      if (interactive) {
        try {
          resolveInteractiveStdin().cleanup?.()
        } catch (error) {
          dieInteractive(error)
        }
      }

      const replay = args.replay === false ? false : args.replay || args["replay-limit"] !== undefined

      const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
      const directory = (() => {
        if (!args.dir) return args.attach ? undefined : root
        if (args.attach) return args.dir

        try {
          process.chdir(path.isAbsolute(args.dir) ? args.dir : path.join(root, args.dir))
          return process.cwd()
        } catch {
          UI.error("Failed to change directory to " + args.dir)
          process.exit(1)
        }
      })()
      const attachHeaders = args.attach
        ? ServerAuth.headers({ password: args.password, username: args.username })
        : undefined
      const attachSDK = (dir?: string) => {
        return createKiloClient({
          baseUrl: args.attach!,
          directory: dir,
          headers: attachHeaders,
        })
      }

      const files: FilePart[] = []
      if (args.file) {
        const list = Array.isArray(args.file) ? args.file : [args.file]

        for (const filePath of list) {
          const resolvedPath = path.resolve(args.attach ? root : (directory ?? root), filePath)
          if (!(await Filesystem.exists(resolvedPath))) {
            UI.error(`File not found: ${filePath}`)
            process.exit(1)
          }

          const stat = Filesystem.stat(resolvedPath)
          const isDirectory = stat?.isDirectory() ?? false
          if (args.attach && isDirectory) {
            UI.error(`Cannot attach local directory without a shared filesystem: ${filePath}`)
            process.exit(1)
          }

          const content = await (async () => {
            if (!args.attach) return
            const handle = await open(resolvedPath, "r")
            try {
              const opened = await handle.stat()
              if (!opened.isFile() || Number(opened.size) > ATTACH_FILE_MAX_BYTES) {
                UI.error(`Cannot attach local file larger than 10 MiB or a special file: ${filePath}`)
                process.exit(1)
              }
              if (opened.size === 0) return Buffer.alloc(0)
              const buffer = Buffer.alloc(Number(opened.size))
              let offset = 0
              while (offset < buffer.length) {
                const read = await handle.read(buffer, offset, buffer.length - offset, offset)
                if (read.bytesRead === 0) break
                offset += read.bytesRead
              }
              return buffer.subarray(0, offset)
            } finally {
              await handle.close()
            }
          })()
          const detected = FSUtil.mimeType(resolvedPath)
          const text = content?.toString("utf8")
          const mime = !args.attach
            ? isDirectory
              ? "application/x-directory"
              : "text/plain"
            : content && text !== undefined && Buffer.from(text, "utf8").equals(content)
              ? "text/plain"
              : detected

          files.push({
            type: "file",
            url: content ? `data:${mime};base64,${content.toString("base64")}` : pathToFileURL(resolvedPath).href,
            filename: path.basename(resolvedPath),
            mime,
          })
        }
      }

      // kilocode_change start - defer stdin until endpoint-backed commands are classified
      const input = { initial: undefined as string | undefined, loaded: false }
      async function loadInput() {
        if (input.loaded) return
        const piped = process.stdin.isTTY ? undefined : await Bun.stdin.text()
        message = resolveRunInput(message, piped) ?? ""
        input.initial = resolveRunInput(rawMessage, piped)
        input.loaded = true
        if (message.trim().length > 0 || args.command || interactive) return
        UI.error("You must provide a message or a command")
        process.exit(1)
      }
      // kilocode_change end

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exit(1)
      }

      // kilocode_change start - validate cloud session imports before local lookup
      const cloudForkError = validateCloudFork({
        cloudFork: args["cloud-fork"],
        fork: args.fork,
        continue: args.continue,
        session: args.session,
      })
      if (cloudForkError) {
        UI.error(cloudForkError)
        process.exit(1)
      }
      // kilocode_change end

      const rules: PermissionV1.Ruleset = interactive
        ? []
        : [
            {
              permission: "question",
              action: "deny",
              pattern: "*",
            },
            // kilocode_change start - non-interactive runs cannot answer suggestions or take over a terminal
            {
              permission: "suggest",
              action: "deny",
              pattern: "*",
            },
            {
              permission: "interactive_terminal",
              action: "deny",
              pattern: "*",
            },
            // kilocode_change end
            {
              permission: "plan_enter",
              action: "deny",
              pattern: "*",
            },
            {
              permission: "plan_exit",
              action: "deny",
              pattern: "*",
            },
          ]

      function title() {
        if (args.title === undefined) return
        if (args.title !== "") return args.title
        return message.slice(0, 50) + (message.length > 50 ? "..." : "")
      }

      async function session(sdk: KiloClient): Promise<SessionInfo | undefined> {
        // kilocode_change start - import cloud session before local lookup
        if (args.session && args["cloud-fork"]) {
          const id = await importCloudSession(sdk, args.session).catch(() => undefined)
          if (!id) {
            UI.error("Failed to import session from cloud")
            process.exit(1)
          }

          const current = await sdk.session
            .get({
              sessionID: id,
            })
            .catch(() => undefined)

          if (!current?.data) {
            UI.error("Session not found")
            process.exit(1)
          }

          return {
            id: current.data.id,
            title: current.data.title,
            directory: current.data.directory,
            model: current.data.model,
          }
        }
        // kilocode_change end

        if (args.session) {
          const current = await sdk.session
            .get({
              sessionID: args.session,
            })
            .catch(() => undefined)

          if (!current?.data) {
            UI.error("Session not found")
            process.exit(1)
          }

          if (args.fork) {
            const forked = await sdk.session.fork({
              sessionID: args.session,
            })
            const id = forked.data?.id
            if (!id) {
              return
            }

            return {
              id,
              title: forked.data?.title ?? current.data.title,
              directory: forked.data?.directory ?? current.data.directory,
              model: forked.data?.model ?? current.data.model,
            }
          }

          return {
            id: current.data.id,
            title: current.data.title,
            directory: current.data.directory,
            model: current.data.model,
          }
        }

        const base = args.continue ? (await sdk.session.list()).data?.find((item) => !item.parentID) : undefined

        if (base && args.fork) {
          const forked = await sdk.session.fork({
            sessionID: base.id,
          })
          const id = forked.data?.id
          if (!id) {
            return
          }

          return {
            id,
            title: forked.data?.title ?? base.title,
            directory: forked.data?.directory ?? base.directory,
            model: forked.data?.model ?? base.model,
          }
        }

        if (base) {
          return {
            id: base.id,
            title: base.title,
            directory: base.directory,
            model: base.model,
          }
        }

        const name = title()
        const result = await sdk.session.create({
          title: name,
          permission: [...rules],
        })
        const id = result.data?.id
        if (!id) {
          return
        }

        return {
          id,
          title: result.data?.title ?? name,
          directory: result.data?.directory,
          model: result.data?.model,
        }
      }

      async function share(sdk: KiloClient, sessionID: string) {
        const cfg = await sdk.config.get()
        if (!cfg.data) return
        if (cfg.data.share !== "auto" && !flags.autoShare && !args.share) return
        const res = await sdk.session.share({ sessionID }).catch((error) => {
          if (error instanceof Error && error.message.includes("disabled")) {
            UI.println(UI.Style.TEXT_DANGER_BOLD + "!  " + error.message)
          }
          return { error }
        })
        if (!res.error && "data" in res && res.data?.share?.url) {
          UI.println(UI.Style.TEXT_INFO_BOLD + "~  " + res.data.share.url)
        }
      }

      async function createFreshSession(
        sdk: KiloClient,
        input: { agent: string | undefined; model: ModelInput | undefined; variant: string | undefined },
      ): Promise<SessionInfo> {
        const result = await sdk.session.create({
          title: args.title !== undefined && args.title !== "" ? args.title : undefined,
          agent: input.agent,
          model: input.model
            ? {
                providerID: input.model.providerID,
                id: input.model.modelID,
                variant: input.variant,
              }
            : undefined,
          permission: [...rules],
        })
        const id = result.data?.id
        if (!id) {
          throw new Error("Failed to create session")
        }

        void share(sdk, id).catch(() => {})
        return {
          id,
          title: result.data?.title,
        }
      }

      async function current(sdk: KiloClient): Promise<string> {
        if (!args.attach) {
          return directory ?? root
        }

        const next = await sdk.path
          .get()
          .then((x) => x.data?.directory)
          .catch(() => undefined)
        if (next) {
          return next
        }

        UI.error("Failed to resolve remote directory")
        process.exit(1)
      }

      async function localAgent() {
        if (!args.agent) return undefined
        const name = args.agent

        const entry = await Effect.runPromise(
          agentSvc.get(name).pipe(Effect.provideService(InstanceRef, localInstance)),
        )
        if (!entry) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" not found. Falling back to default agent`,
          )
          return undefined
        }
        if (entry.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }
        return name
      }

      async function attachAgent(sdk: KiloClient) {
        if (!args.agent) return undefined
        const name = args.agent

        const modes = await sdk.app
          .agents(undefined, { throwOnError: true })
          .then((x) => x.data ?? [])
          .catch(() => undefined)

        if (!modes) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `failed to list agents from ${args.attach}. Falling back to default agent`,
          )
          return undefined
        }

        const agent = modes.find((a) => a.name === name)
        if (!agent) {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" not found. Falling back to default agent`,
          )
          return undefined
        }

        if (agent.mode === "subagent") {
          UI.println(
            UI.Style.TEXT_WARNING_BOLD + "!",
            UI.Style.TEXT_NORMAL,
            `agent "${name}" is a subagent, not a primary agent. Falling back to default agent`,
          )
          return undefined
        }

        return name
      }

      async function pickAgent(sdk: KiloClient) {
        if (!args.agent) return undefined
        if (args.attach) {
          return attachAgent(sdk)
        }

        return localAgent()
      }

      async function execute(sdk: KiloClient) {
        // kilocode_change start - preserve custom command precedence and avoid reading stdin for built-ins
        const deferred = Boolean(args.attach && args.session && !directory)
        const initial = deferred ? undefined : await KiloRun.resolveBuiltin(sdk, args.command, directory)
        if (!deferred) {
          KiloRun.validateBuiltin({ command: initial, continue: args.continue, session: args.session })
          if (!initial) await loadInput()
        }
        // kilocode_change end

        const sess = await session(sdk)
        if (!sess?.id) {
          UI.error("Session not found")
          process.exit(1)
        }
        const sessionID = sess.id
        // kilocode_change start - track Task children; plain headless runs deny subagent asks instead of hanging (#11903)
        const tracked = KiloRunAuto.create(sessionID) // kilocode_change - named to avoid shadowing the `auto` flag
        if (!args.attach && !args.auto && !skipPermissions) KiloHeadless.mark(sessionID) // kilocode_change - --yolo skips too
        // kilocode_change end

        function emit(type: string, data: Record<string, unknown>) {
          if (args.format === "json") {
            process.stdout.write(
              JSON.stringify({
                type,
                timestamp: Date.now(),
                sessionID,
                ...data,
              }) + EOL,
            )
            return true
          }
          return false
        }

        // Consume one subscribed event stream for the active session and mirror it
        // to stdout/UI. `client` is passed explicitly because attach mode may
        // rebind the SDK to the session's directory after the subscription is
        // created, and replies issued from inside the loop must use that client.
        async function loop(client: KiloClient, events: Awaited<ReturnType<typeof sdk.event.subscribe>>) {
          const toggles = new Map<string, boolean>()
          const MAX_RETRIES = 3 // kilocode_change
          let retries = 0 // kilocode_change
          let error: string | undefined
          let autoRejected = false // kilocode_change - plain headless auto-reject must fail the run

          // kilocode_change start - revert to upstream: consume native events without normalizing sync copies
          for await (const event of events.stream) {
            // kilocode_change end

            if (
              event.type === "message.updated" &&
              event.properties.sessionID === sessionID &&
              event.properties.info.role === "assistant" &&
              args.format !== "json" &&
              toggles.get("start") !== true
            ) {
              UI.empty()
              UI.println(`> ${event.properties.info.agent} · ${event.properties.info.modelID}`)
              UI.empty()
              toggles.set("start", true)
            }

            if (event.type === "message.part.updated") {
              const part = event.properties.part
              // kilocode_change start - track Task child sessions so permission replies can target them
              KiloRunAuto.track(tracked, part)
              // kilocode_change end
              if (part.sessionID !== sessionID) continue

              if (part.type === "tool" && (part.state.status === "completed" || part.state.status === "error")) {
                if (emit("tool_use", { part })) continue
                if (part.state.status === "completed") {
                  await tool(part)
                  continue
                }
                await toolError(part)
                UI.error(part.state.error)
              }

              if (
                part.type === "tool" &&
                part.tool === "task" &&
                part.state.status === "running" &&
                args.format !== "json"
              ) {
                if (toggles.get(part.id) === true) continue
                await tool(part)
                toggles.set(part.id, true)
              }

              if (part.type === "step-start") {
                if (emit("step_start", { part })) continue
              }

              if (part.type === "step-finish") {
                if (emit("step_finish", { part })) continue
              }

              if (part.type === "text" && part.time?.end) {
                if (emit("text", { part })) continue
                const text = part.text.trim()
                if (!text) continue
                if (!process.stdout.isTTY) {
                  process.stdout.write(text + EOL)
                  continue
                }
                UI.empty()
                UI.println(text)
                UI.empty()
              }

              if (part.type === "reasoning" && part.time?.end && thinking) {
                if (emit("reasoning", { part })) continue
                const text = part.text.trim()
                if (!text) continue
                const line = `Thinking: ${text}`
                if (process.stdout.isTTY) {
                  UI.empty()
                  UI.println(`${UI.Style.TEXT_DIM}\u001b[3m${line}\u001b[0m${UI.Style.TEXT_NORMAL}`)
                  UI.empty()
                  continue
                }
                process.stdout.write(line + EOL)
              }
            }

            if (event.type === "session.error") {
              const props = event.properties
              if (props.sessionID !== sessionID || !props.error) continue
              let err = String(props.error.name)
              if ("data" in props.error && props.error.data && "message" in props.error.data) {
                err = String(props.error.data.message)
              }
              error = error ? error + EOL + err : err
              // kilocode_change start - stderr first so --format json still surfaces the diagnostic
              UI.error(err)
              emit("error", { error: props.error })
              // kilocode_change end
            }

            // kilocode_change start - reset retry budget only after resumed work becomes busy
            if (
              event.type === "session.status" &&
              event.properties.sessionID === sessionID &&
              event.properties.status.type === "busy"
            ) {
              retries = 0
            }
            // kilocode_change end

            if (
              event.type === "session.status" &&
              event.properties.sessionID === sessionID &&
              event.properties.status.type === "idle"
            ) {
              break
            }

            // kilocode_change start - non-interactive runs dismiss suggestions so they don't block
            if (event.type === "suggestion.shown") {
              const suggestion = event.properties
              if (suggestion.sessionID === sessionID || KiloRunAuto.allowed(tracked, suggestion.sessionID)) {
                await client.suggestion.dismiss({ requestID: suggestion.id }).catch(() => {})
              }
              continue
            }
            // kilocode_change end

            if (event.type === "permission.asked") {
              const permission = event.properties
              // kilocode_change start - skill shell batches need an interactive human decision. The server ignores
              // non-interactive approvals, so headless runs must reject explicitly rather than leave them pending.
              if (permission.metadata?.["skillShell"] === true) {
                await client.permission.reply({ requestID: permission.id, reply: "reject" })
                continue
              }
              // kilocode_change end
              // kilocode_change start - approve root and tracked Task child permissions in auto mode
              if (args.auto) {
                if (!KiloRunAuto.allowed(tracked, permission.sessionID)) continue
                await client.permission.reply({
                  requestID: permission.id,
                  reply: "once",
                })
                continue
              }
              // kilocode_change end

              // kilocode_change start - answer tracked Task child asks too, so subagents don't hang (#11903)
              // Covers daemon/attach modes where the server evaluates permissions in another
              // process and the in-process KiloHeadless deny cannot apply.
              if (permission.sessionID !== sessionID) {
                if (!KiloRunAuto.allowed(tracked, permission.sessionID)) continue
                if (skipPermissions) {
                  await client.permission.reply({
                    requestID: permission.id,
                    reply: "once",
                  })
                  continue
                }
                UI.println(
                  UI.Style.TEXT_WARNING_BOLD + "!",
                  UI.Style.TEXT_NORMAL +
                    `subagent permission requested: ${permission.permission} (${permission.patterns.join(", ")}); auto-rejecting`,
                )
                autoRejected = true // kilocode_change
                await client.permission.reply({
                  requestID: permission.id,
                  reply: "reject",
                })
                continue
              }
              // kilocode_change end

              if (permission.sessionID !== sessionID) continue

              if (skipPermissions) {
                await client.permission.reply({
                  requestID: permission.id,
                  reply: "once",
                })
              } else {
                UI.println(
                  UI.Style.TEXT_WARNING_BOLD + "!",
                  UI.Style.TEXT_NORMAL +
                    `permission requested: ${permission.permission} (${permission.patterns.join(", ")}); auto-rejecting`,
                )
                autoRejected = true // kilocode_change
                await client.permission.reply({
                  requestID: permission.id,
                  reply: "reject",
                })
              }
            }

            // kilocode_change start - bounded network retry handling
            if (event.type === "session.network.asked") {
              const request = event.properties
              if (request.sessionID !== sessionID) continue
              retries++
              if (retries > MAX_RETRIES) {
                UI.println(
                  UI.Style.TEXT_WARNING_BOLD + "!",
                  UI.Style.TEXT_NORMAL + `network retry limit reached (${MAX_RETRIES}); rejecting`,
                )
                await client.network.reject({ requestID: request.id })
                continue
              }
              const delay = Math.min(5000 * Math.pow(2, retries - 1), 60000)
              await new Promise((resolve) => setTimeout(resolve, delay))
              await client.network.reply({ requestID: request.id })
            }
            // kilocode_change end
          }
          // kilocode_change start - idle must not clear an auto-rejected headless run
          if (autoRejected) {
            const msg = "run ended with an auto-rejected permission; pass --auto for autonomous use"
            error = error ? error + EOL + msg : msg
            UI.error(msg)
            emit("error", { error: msg })
          }
          // kilocode_change end
          return error
        }
        const cwd = args.attach ? (directory ?? sess.directory ?? (await current(sdk))) : (directory ?? root)
        const client = args.attach ? attachSDK(cwd) : sdk
        // kilocode_change start - classify deferred attach commands in the session directory
        const builtin = deferred ? await KiloRun.resolveBuiltin(client, args.command, cwd) : initial
        if (deferred) {
          KiloRun.validateBuiltin({ command: builtin, continue: args.continue, session: args.session })
          if (!builtin) await loadInput()
        }
        // kilocode_change end

        // Validate agent if specified
        const agent = await pickAgent(client)

        await share(client, sessionID)

        if (!interactive) {
          const events = await client.event.subscribe()
          const completed = loop(client, events).catch((e) => {
            console.error(e)
            process.exitCode = 1
          })
          async function finish() {
            if (args.attach) return
            const error = await completed
            if (error) process.exitCode = 1
          }

          // kilocode_change start - handle built-in session commands
          if (builtin) {
            const result = await KiloRun.runBuiltin(client, sessionID, builtin, args.model, sess.model, cwd)
            if (result.error) {
              if (!emit("error", { error: result.error })) UI.error(formatRunError(result.error))
              process.exitCode = 1
            }
            return
          }
          // kilocode_change end

          if (args.command) {
            const result = await client.session.command({
              sessionID,
              agent,
              model: args.model,
              command: args.command,
              arguments: message,
              variant: args.variant,
            })
            if (result.error) {
              if (!emit("error", { error: result.error })) UI.error(formatRunError(result.error))
              process.exitCode = 1
              return
            }
            await finish()
            return
          }

          const model = pick(args.model)
          const result = await client.session.prompt({
            sessionID,
            agent,
            model,
            variant: args.variant,
            parts: [...files, { type: "text", text: message }],
          })
          if (result.error) {
            if (!emit("error", { error: result.error })) UI.error(formatRunError(result.error))
            process.exitCode = 1
            return
          }
          await finish()
          return
        }

        const model = pick(args.model)
        const { runInteractiveMode } = await import("./run/runtime")
        try {
          await runInteractiveMode({
            sdk: client,
            directory: cwd,
            sessionID,
            sessionTitle: sess.title,
            resume: Boolean(args.session || args.continue) && !args.fork,
            replay,
            replayLimit: args["replay-limit"],
            agent,
            model,
            variant: args.variant,
            files,
            initialInput: input.initial,
            createSession: createFreshSession,
            thinking,
            backgroundSubagents: flags.experimentalBackgroundSubagents,
            demo: args.demo,
          })
        } catch (error) {
          dieInteractive(error)
        }
        return
      }

      if (interactive && !args.attach && !args.session && !args.continue) {
        await loadInput() // kilocode_change - interactive local mode still consumes its initial input
        const model = pick(args.model)
        const { runInteractiveLocalMode } = await import("./run/runtime")
        const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
          const { Server } = await import("@/server/server")
          const request = new Request(input, init)
          const headers = new Headers(request.headers)
          const auth = ServerAuth.header()
          if (auth) headers.set("Authorization", auth)
          return Server.Default().app.fetch(new Request(request, { headers }))
        }) as typeof globalThis.fetch

        try {
          return await runInteractiveLocalMode({
            directory: directory ?? root,
            fetch: fetchFn,
            resolveAgent: localAgent,
            session,
            share,
            createSession: createFreshSession,
            agent: args.agent,
            model,
            variant: args.variant,
            replay,
            replayLimit: args["replay-limit"],
            files,
            initialInput: input.initial,
            thinking,
            backgroundSubagents: flags.experimentalBackgroundSubagents,
            demo: args.demo,
          })
        } catch (error) {
          dieInteractive(error)
        }
      }

      if (args.attach) {
        const sdk = attachSDK(directory)
        return await execute(sdk)
      }

      if (await KiloRunDaemon.attach({ directory, execute })) return // kilocode_change

      const fetchFn = (async (input: RequestInfo | URL, init?: RequestInit) => {
        const { Server } = await import("@/server/server")
        const request = new Request(input, init)
        const headers = new Headers(request.headers)
        const auth = ServerAuth.header()
        if (auth) headers.set("Authorization", auth)
        return Server.Default().app.fetch(new Request(request, { headers }))
      }) as typeof globalThis.fetch
      const sdk = createKiloClient({
        baseUrl: "http://kilo.internal",
        fetch: fetchFn,
        directory,
      })
      await execute(sdk)
    })
  }),
})

type MiniCommandInput = {
  directory?: string
  attach?: string
  password?: string
  username?: string
  continue?: boolean
  session?: string
  fork?: boolean
  model?: string
  agent?: string
  prompt?: string
  replay?: boolean
  replayLimit?: number
  demo?: boolean
}

export async function runMini(input: MiniCommandInput) {
  if (!RunCommand.handler) throw new Error("Mini command handler is unavailable")
  await RunCommand.handler({
    $0: "opencode",
    _: ["mini"],
    message: input.prompt ? [input.prompt] : [],
    command: undefined,
    continue: input.continue,
    session: input.session,
    fork: input.fork,
    "cloud-fork": undefined, // kilocode_change
    cloudFork: undefined, // kilocode_change
    share: undefined,
    model: input.model,
    agent: input.agent,
    format: "default",
    file: undefined,
    title: undefined,
    attach: input.attach,
    password: input.password,
    username: input.username,
    dir: input.directory,
    port: undefined,
    variant: undefined,
    thinking: undefined,
    mini: true,
    interactive: false,
    replay: input.replay ?? true,
    "replay-limit": input.replayLimit,
    replayLimit: input.replayLimit,
    auto: false,
    yolo: false,
    "dangerously-skip-permissions": false,
    dangerouslySkipPermissions: false,
    demo: input.demo ?? false,
  })
}
