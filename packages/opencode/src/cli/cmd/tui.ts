import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "../tui/worker"
import path from "path"
import { text as streamText } from "node:stream/consumers"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { errorMessage } from "@opencode-ai/tui/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { GlobalEvent } from "@kilocode/sdk/v2"
import type { EventSource } from "@opencode-ai/tui/context/sdk"
import { importCloudSession, localSessionID, reportCloudImportError, validateCloudFork } from "@/kilocode/cloud-session" // kilocode_change
import { createKiloClient } from "@kilocode/sdk/v2" // kilocode_change
import { writeHeapSnapshot } from "v8"
import { KiloTuiThreadDaemon, type StartInput } from "@/kilocode/cli/cmd/tui/thread" // kilocode_change
import { win32InstallCtrlCGuard } from "@opencode-ai/tui/terminal-win32"
import { validateSession } from "../tui/validate-session"
// kilocode_change start - correlate the TUI worker with its parent process
import {
  KILO_PROCESS_ROLE,
  KILO_RUN_ID,
  ensureRunID,
  sanitizedProcessEnv,
} from "@opencode-ai/core/util/opencode-process"
// kilocode_change end
import { createParentRemoteExitBridge, type RemoteExitBridgeClient } from "@/kilocode/cli/cmd/tui/remote-exit-bridge" // kilocode_change
import type { Exit } from "@opencode-ai/tui/context/exit" // kilocode_change

declare global {
  const KILO_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

// kilocode_change start - bridge remote exit only for the embedded worker transport
export function embeddedRemoteExitClient<T>(external: boolean, client: T | undefined): T | undefined {
  return external ? undefined : client
}

export async function runEmbeddedRemoteExitBridge(input: {
  client: RemoteExitBridgeClient
  exit: Exit
  done: Promise<unknown>
  timeoutMs?: number
}) {
  const timeoutMs = input.timeoutMs ?? 5_000
  const bridge = createParentRemoteExitBridge(input.client, input.exit)
  let ready = false
  try {
    try {
      await withTimeout(bridge.ready(), timeoutMs, "remote exit startup timed out")
      ready = true
    } catch {
      await bridge.dispose(timeoutMs).catch(() => {})
    }
    await input.done
  } finally {
    if (ready) await bridge.dispose(timeoutMs).catch(() => {})
  }
}
// kilocode_change end

// kilocode_change start - share the extracted TUI runner between daemon and worker paths
async function start(input: StartInput, remoteExitClient?: RpcClient) {
  const { Effect } = await import("effect")
  const { run } = await import("../tui/layer")
  const { createLegacyTuiPluginHost } = await import("@/plugin/tui/runtime")
  const pluginHost = createLegacyTuiPluginHost()
  if (!remoteExitClient) {
    await Effect.runPromise(run({ ...input, pluginHost }))
    return
  }

  const ready = Promise.withResolvers<Exit>()
  const done = Effect.runPromise(run({ ...input, pluginHost, onExit: ready.resolve }))
  const exit = await Promise.race([ready.promise, done.then(() => undefined)])
  if (!exit) return
  await runEmbeddedRemoteExitBridge({ client: remoteExitClient, exit, done })
}
// kilocode_change end

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
  const dist = new URL("./cli/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("../tui/worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await streamText(process.stdin)
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export function resolveThreadDirectory(project?: string, envPWD = process.env.PWD, cwd = process.cwd()) {
  // kilocode_change start - ignore stale PWD from wrappers such as `bun --cwd`, except kilo-dev's caller cwd
  const dev = process.env.KILO_DEV_CWD
  const real = Filesystem.resolve(cwd)
  const root = dev
    ? Filesystem.resolve(dev)
    : envPWD && Filesystem.resolve(envPWD) === real
      ? Filesystem.resolve(envPWD)
      : real
  // kilocode_change end
  if (project) return Filesystem.resolve(path.isAbsolute(project) ? project : path.join(root, project))
  return dev ? root : real // kilocode_change
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
    const unguard = win32InstallCtrlCGuard()
    const shutdown = {
      pending: undefined as Promise<void> | undefined,
      exiting: false,
    }
    try {
      const { TuiConfig } = await import("@/config/tui")
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
      const next = resolveThreadDirectory(args.project)
      const file = await target()
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())
      // kilocode_change start - default TUI sessions attach to the daemon unless explicitly disabled
      if (await KiloTuiThreadDaemon.attach({ args, cwd, input: () => input(args.prompt), start })) return
      // kilocode_change end
      const auth = KiloTuiThreadDaemon.workerAuth() // kilocode_change - protect TUI-owned HTTP routes from unauthenticated local callers
      // kilocode_change start - propagate stable run metadata and an explicit worker role
      const env = sanitizedProcessEnv({
        [KILO_PROCESS_ROLE]: "worker",
        [KILO_RUN_ID]: ensureRunID(),
        ...auth.env,
        KILO_BACKGROUND_PROCESS_PORTS: "true",
      })
      // kilocode_change end
      const worker = new Worker(file, {
        preload: ["@opentui/solid/preload"], // kilocode_change - Bun workers do not inherit the parent preload
        env, // kilocode_change
      })
      worker.onerror = (e) => {
        console.error("TUI worker error", e.error ?? e.message)
      }
      const client = Rpc.client<typeof rpc>(worker)
      const reload = () => {
        client.call("reload", undefined).catch((err) => console.error("TUI worker reload failed", err))
      }
      process.on("SIGUSR2", reload)

      let stopped = false
      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("SIGUSR2", reload)
        await withTimeout(client.call("shutdown", undefined), 5000).catch((err) =>
          console.error("TUI worker shutdown failed", err),
        )
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
        console.info("Shutting down TUI thread", {
          reason: input.reason,
          signal: input.signal,
          code: input.code,
          pid: process.pid,
          ppid: process.ppid,
        })
        stop()
          .catch((err) => {
            console.error("Failed to terminate TUI worker during shutdown", {
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
              console.debug("TUI parent liveness check failed", {
                parent,
                code,
                error: err,
              })
              return false
            }
            console.debug("TUI detected dead parent process", {
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
            headers: auth.headers, // kilocode_change
            events: undefined,
          }
        : {
            url: "http://kilo.internal",
            fetch: createWorkerFetch(client),
            headers: auth.headers, // kilocode_change
            events: createEventSource(client),
          }

      setTimeout(() => {
        client.call("checkUpgrade", { directory: cwd }).catch((err) => console.error("Upgrade check failed", err))
      }, 1000).unref?.()

      try {
        // kilocode_change start - import cloud session before TUI renders
        if (args.cloudFork && args.session) {
          UI.println("Importing session from cloud...")
          const sdk = createKiloClient({
            baseUrl: transport.url,
            fetch: transport.fetch,
            headers: transport.headers, // kilocode_change
            directory: cwd,
          })
          try {
            const id = await importCloudSession(sdk, args.session)
            args.session = id
            args.cloudFork = false
          } catch (err) {
            reportCloudImportError(err)
            shutdownAndExit({ reason: "cloud-fork-failed", code: 1 })
            return
          }
        }
        // kilocode_change end

        try {
          await validateSession({
            url: transport.url, // kilocode_change
            sessionID: localSessionID(args), // kilocode_change
            directory: cwd,
            fetch: transport.fetch,
            headers: transport.headers, // kilocode_change
          })
        } catch (error) {
          UI.error(errorMessage(error))
          process.exitCode = 1
          return
        }

        // kilocode_change start
        await start(
          {
            // kilocode_change - shared lazy loader also supports daemon attach
            url: transport.url,
            async onSnapshot() {
              const tui = writeHeapSnapshot("tui.heapsnapshot")
              const server = await client.call("snapshot", undefined)
              return [tui, server]
            },
            config,
            directory: cwd,
            fetch: transport.fetch,
            headers: transport.headers, // kilocode_change
            events: transport.events,
            args: {
              continue: args.continue,
              sessionID: args.session,
              agent: args.agent,
              model: args.model,
              prompt,
              fork: args.fork,
            },
          },
          embeddedRemoteExitClient(external, client),
        )
        // kilocode_change end
      } finally {
        await stop()
      }
    } finally {
      try {
        unguard?.()
      } catch (err) {
        console.error("Failed to remove Windows Ctrl+C guard", err)
      }
    }
    if (shutdown.exiting) return
    process.exit(0)
  },
})
