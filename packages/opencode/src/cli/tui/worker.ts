import { Startup } from "@/kilocode/startup" // kilocode_change - opt-in worker startup profiling begins before the shared import graph
import { Server } from "@/server/server"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { KiloLog } from "@/kilocode/log" // kilocode_change
import { ensureProcessMetadata } from "@opencode-ai/core/util/opencode-process" // kilocode_change
import { createWorkerRemoteExit } from "@/kilocode/cli/cmd/tui/remote-exit-worker" // kilocode_change
import { createWorkerShutdown } from "@/cli/tui/worker-shutdown" // kilocode_change
import { KiloSessions } from "@/kilo-sessions/kilo-sessions" // kilocode_change

ensureProcessMetadata("worker") // kilocode_change - retain worker role and parent run correlation
Startup.setRole("worker") // kilocode_change
Startup.mark("worker.imports") // kilocode_change
await Startup.measure("worker.log", () => KiloLog.init()) // kilocode_change - keep compatibility logs off the TUI terminal
Heap.start()

type FetchInput = { url: string; method: string; headers: Record<string, string>; body?: string }

async function request(input: FetchInput) {
  const headers = { ...input.headers }
  const auth = ServerAuth.header()
  if (auth && !headers["authorization"] && !headers["Authorization"]) {
    headers["Authorization"] = auth
  }
  const req = new Request(input.url, {
    method: input.method,
    headers,
    body: input.body,
  })
  const response = await Server.Default().app.fetch(req)
  const body = await response.text()
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    body,
  }
}

function route(value: string) {
  return new URL(value).pathname.replace(/\/(?:[a-z]{3}_[A-Za-z0-9_-]+|[a-f0-9]{32,})(?=\/|$)/g, "/:id")
}

let trace = Startup.active()

// kilocode_change start - keep upstream's keep-alive intent but never swallow the error silently
const onUnhandledRejection = (error: unknown) => {
  console.error("worker unhandledRejection", error)
}

const onUncaughtException = (error: Error) => {
  console.error("worker uncaughtException", error)
}
// kilocode_change end

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined
const remoteExit = createWorkerRemoteExit(Rpc.emit) // kilocode_change
// kilocode_change start - drain ingest before dispose so GlobalBus/remote stay live
const runShutdown = createWorkerShutdown({
  drain: () => KiloSessions.drainIngestForShutdown(),
  dispose: () => InstanceRuntime.disposeAllInstances(),
  stopServer: async () => {
    if (server) await server.stop(true)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
  },
})
// kilocode_change end

export const rpc = {
  // kilocode_change start - worker lifecycle hooks for remote exit
  tuiReady() {
    remoteExit.ready()
  },
  tuiGone() {
    remoteExit.gone()
  },
  // kilocode_change end
  async fetch(input: FetchInput) {
    if (!trace) return request(input)
    const path = route(input.url)
    const result = await Startup.measure("worker.fetch", () => request(input), { method: input.method, path })
    if (path === "/config/providers") trace = false
    return result
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await InstanceRuntime.load({ directory: input.directory })
    await upgrade().catch(() => {})
  },
  async reload() {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    remoteExit.shutdown() // kilocode_change
    await runShutdown() // kilocode_change - drain → dispose → stopServer
    // kilocode_change start - Clear the Rpc message channel so the worker's event loop can drain and
    // exit naturally. Without this, the active onmessage handle keeps the
    // worker alive even after all async work is done.
    onmessage = null
    // kilocode_change end
  },
}

Rpc.listen(rpc)
Startup.mark("worker.ready") // kilocode_change
