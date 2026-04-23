import { cmd } from "@/cli/cmd/cmd"
import { tui } from "./app"
import { Rpc } from "@/util"
import { type rpc } from "./worker"
import path from "path"
import { text as streamText } from "node:stream/consumers"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { Log } from "@/util"
import { errorMessage } from "@/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig } from "@/cli/network"
import { Filesystem } from "@/util"
import type { GlobalEvent } from "@kilocode/sdk/v2"
import type { EventSource } from "./context/sdk"
import { win32DisableProcessedInput, win32InstallCtrlCGuard } from "./win32"
import { importCloudSession, validateCloudFork } from "@/kilocode/cloud-session" // kilocode_change
import { createKiloClient } from "@kilocode/sdk/v2" // kilocode_change
import { writeHeapSnapshot } from "v8"
import { TuiConfig } from "./config/tui"

declare global {
  const KILO_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client.call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: RpcClient): EventSource {
  return {
    subscribe: async (handler) => {
      return client.on<GlobalEvent>("global.event", (e) => {
        handler(e)
      })
    },
  }
}

async function target() {
  if (typeof KILO_WORKER_PATH !== "undefined") return KILO_WORKER_PATH
  const dist = new URL("./cli/cmd/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("./worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await streamText(process.stdin)
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export const TuiThreadCommand = cmd({
  command: "$0 [project]",
  describe: "start kilo tui", // kilocode_change
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start kilo in", // kilocode_change
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("cloud-fork", {
        type: "boolean",
        describe: "fetch session from cloud and continue locally (use with --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      }),
  handler: async (args) => {
    // Keep ENABLE_PROCESSED_INPUT cleared even if other code flips it.
    // (Important when running under `bun run` wrappers on Windows.)
    const unguard = win32InstallCtrlCGuard()
    const shutdown = {
      pending: undefined as Promise<void> | undefined,
      exiting: false,
    }
    try {
      // Must be the very first thing — disables CTRL_C_EVENT before any Worker
      // spawn or async work so the OS cannot kill the process group.
      win32DisableProcessedInput()

      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }
      // kilocode_change start
      const cloudForkError = validateCloudFork(args)
      if (cloudForkError) {
        UI.error(cloudForkError)
        process.exitCode = 1
        return
      }
      // kilocode_change end

      // Resolve relative --project paths from PWD, then use the real cwd after
      // chdir so the thread and worker share the same directory key.
      const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
      const next = args.project
        ? Filesystem.resolve(path.isAbsolute(args.project) ? args.project : path.join(root, args.project))
        : Filesystem.resolve(process.cwd())
      const file = await target()
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      const worker = new Worker(file, {
        env: Object.fromEntries(
          Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
        ),
      })
      worker.onerror = (e) => {
        Log.Default.error("thread error", {
          message: e.message,
          filename: e.filename,
          lineno: e.lineno,
          colno: e.colno,
          error: e.error,
        })
      }

      const client = Rpc.client<typeof rpc>(worker)
      const error = (e: unknown) => {
        Log.Default.error("process error", { error: errorMessage(e) })
      }
      const reload = () => {
        client.call("reload", undefined).catch((err) => {
          Log.Default.warn("worker reload failed", {
            error: errorMessage(err),
          })
        })
      }
      process.on("uncaughtException", error)
      process.on("unhandledRejection", error)
      process.on("SIGUSR2", reload)

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("uncaughtException", error)
        process.off("unhandledRejection", error)
        process.off("SIGUSR2", reload)
        await withTimeout(client.call("shutdown", undefined), 5000).catch((error) => {
          Log.Default.warn("worker shutdown failed", {
            error: errorMessage(error),
          })
        })
        worker.terminate()
      }
      // kilocode_change start - graceful shutdown on external signals
      // The worker's postMessage for the RPC result may never be delivered
      // after shutdown because the worker's event loop drains. Send the
      // shutdown request without awaiting the response, wait for the worker
      // to exit naturally or force-terminate after a timeout.
      // Guard against multiple invocations (SIGHUP + SIGTERM + onExit).
      const shutdownAndExit = (input: { reason: string; code: number; signal?: NodeJS.Signals }) => {
        if (shutdown.exiting) return
        shutdown.exiting = true
        Log.Default.info("shutting down tui thread", {
          reason: input.reason,
          signal: input.signal,
          code: input.code,
          pid: process.pid,
          ppid: process.ppid,
        })
        stop()
          .catch((err) => {
            Log.Default.error("failed to terminate worker during shutdown", {
              reason: input.reason,
              signal: input.signal,
              error: err,
            })
          })
          .finally(() => {
            unguard?.()
            process.exit(input.code)
          })
      }
      process.once("SIGHUP", () => shutdownAndExit({ reason: "signal", signal: "SIGHUP", code: 129 }))
      process.once("SIGTERM", () => shutdownAndExit({ reason: "signal", signal: "SIGTERM", code: 143 }))
      // In some terminal/tab-close paths the parent shell is terminated without
      // forwarding a signal to this process, leaving the TUI orphaned. Detect
      // parent PID re-parenting and exit explicitly.
      const parent = process.ppid
      const orphanWatch = setInterval(() => {
        const orphaned = (() => {
          if (process.ppid !== parent) return true
          if (parent === 1) return false
          try {
            process.kill(parent, 0)
            return false
          } catch (err) {
            const code = (err as NodeJS.ErrnoException).code
            if (code !== "ESRCH") {
              Log.Default.debug("parent liveness check failed", {
                parent,
                code,
                error: err,
              })
              return false
            }
            Log.Default.debug("detected dead parent process", {
              parent,
              error: err,
            })
            return true
          }
        })()
        if (!orphaned) return
        shutdownAndExit({ reason: "parent-exit", code: 0 })
      }, 1000)
      orphanWatch.unref()
      // kilocode_change end

      const prompt = await input(args.prompt)
      const config = await TuiConfig.get()

      const network = resolveNetworkOptionsNoConfig(args)
      const external =
        process.argv.includes("--port") ||
        process.argv.includes("--hostname") ||
        process.argv.includes("--mdns") ||
        network.mdns ||
        network.port !== 0 ||
        network.hostname !== "127.0.0.1"

      const transport = external
        ? {
            url: (await client.call("server", network)).url,
            fetch: undefined,
            events: undefined,
          }
        : {
            url: "http://kilo.internal",
            fetch: createWorkerFetch(client),
            events: createEventSource(client),
          }

      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000).unref?.()

      try {
        // kilocode_change start - import cloud session before TUI renders
        if (args.cloudFork && args.session) {
          UI.println("Importing session from cloud...")
          const sdk = createKiloClient({
            baseUrl: transport.url,
            fetch: transport.fetch,
            directory: cwd,
          })
          const id = await importCloudSession(sdk, args.session).catch(() => undefined)
          if (!id) {
            UI.error("Failed to import session from cloud")
            shutdownAndExit({ reason: "cloud-fork-failed", code: 1 })
            return
          }
          args.session = id
          args.cloudFork = false
        }
        // kilocode_change end

        await tui({
          url: transport.url,
          async onSnapshot() {
            const tui = writeHeapSnapshot("tui.heapsnapshot")
            const server = await client.call("snapshot", undefined)
            return [tui, server]
          },
          config,
          directory: cwd,
          fetch: transport.fetch,
          events: transport.events,
          args: {
            continue: args.continue,
            sessionID: args.session,
            agent: args.agent,
            model: args.model,
            prompt,
            fork: args.fork,
          },
        })
      } finally {
        await stop()
      }
    } finally {
      unguard?.()
    }
    if (shutdown.exiting) return
    process.exit(0)
  },
})
// scratch
