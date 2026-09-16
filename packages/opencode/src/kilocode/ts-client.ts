// kilocode_change - new file
// Lightweight TypeScript diagnostic client that shells out to tsgo/tsc
// instead of spawning a persistent typescript-language-server process.
// This drops memory from ~500MB persistent to ~50MB peak (0 idle).

import { LSPClient } from "../lsp/client"
import { Bus } from "../bus"
import { GlobalBus, type GlobalEvent } from "../bus/global"
import { BusEvent } from "../bus/bus-event"
import { TsCheck } from "./ts-check"
import { Filesystem } from "../util/filesystem"
import * as Log from "@opencode-ai/core/util/log"
import { withTimeout } from "../util/timeout"
import path from "path"
import { capture, type InstanceContext } from "./instance"
import { Schema } from "effect"

export namespace TsClient {
  const log = Log.create({ service: "ts-client" })
  // A check that took longer than this is treated as slow. Slow checks run in
  // the background and never block the edit, write, or apply_patch tools.
  const SLOW_CHECK_MS = 100
  // Upper bound on the response-critical wait for a check known to be fast.
  const WAIT_BUDGET_MS = 150
  const Diagnostics = BusEvent.define(
    "lsp.client.diagnostics",
    Schema.Struct({ serverID: Schema.String, path: Schema.String }),
  )

  export function create(input: { root: string; ctx?: InstanceContext }): LSPClient.Info {
    const diagnostics = new Map<string, LSPClient.Diagnostic[]>()
    const ctx = input.ctx ?? capture()
    let revision = 0
    let pending: { start: number; revision: number; controller: AbortController; promise: Promise<void> } | undefined
    let duration: number | undefined
    let checked: number | undefined
    let closed = false

    function invalidate() {
      revision++
      checked = undefined
      // A change can also invalidate dependent files and removed source paths.
      diagnostics.clear()
      pending?.controller.abort()
    }

    function changed(event: GlobalEvent) {
      if (closed || event.directory !== (ctx?.directory ?? input.root)) return
      if (event.payload.type !== "file.edited" && event.payload.type !== "file.watcher.updated") return
      const file = event.payload.properties?.file
      if (typeof file !== "string" || file.endsWith(".tsbuildinfo")) return
      invalidate()
    }

    GlobalBus.on("event", changed)

    function run(): Promise<void> {
      if (pending) return pending.promise
      const current = revision
      const controller = new AbortController()
      const start = Date.now()
      const clock = performance.now()
      const promise = TsCheck.run(client.root, controller.signal)
        .then(async (result) => {
          if (closed || current !== revision || result === undefined) return
          diagnostics.clear()
          for (const [file, items] of result) {
            diagnostics.set(file, items)
          }
          // Completion time cannot prove that a file was read after a write.
          checked = start
          if (!ctx) return
          for (const file of result.keys()) {
            if (closed || current !== revision) return
            await Bus.publish(ctx, Diagnostics, {
              path: file,
              serverID: client.serverID,
            })
          }
        })
        .catch((err) => {
          log.error("ts check failed", { error: err })
        })
        .finally(() => {
          duration = performance.now() - clock
          pending = undefined
          // Coalesce all writes during this run into one fresh project check.
          // Failures alone do not trigger an automatic retry loop.
          if (!closed && current !== revision) void run()
        })
      pending = { start, revision: current, controller, promise }
      return promise
    }

    const client: LSPClient.Info = {
      root: input.root,
      get serverID() {
        return "typescript"
      },
      get connection(): any {
        // LSP namespace methods (hover, definition, etc.) call
        // connection.sendRequest() directly. Provide a stub that
        // rejects so those code paths surface a clear error instead
        // of crashing with "cannot read property sendRequest of undefined".
        return {
          sendRequest() {
            return Promise.reject(
              new Error("TypeScript LSP operations are not supported in lightweight diagnostic mode"),
            )
          },
          sendNotification() {
            return Promise.resolve()
          },
        }
      },
      notify: {
        async open(_input: { path: string }) {
          // No-op. Warm-up calls from read.ts (touchFile(path, false))
          // trigger notify.open() but should NOT spawn tsgo. The actual
          // check is deferred to waitForDiagnostics() which is only
          // called when tools need diagnostics (write, edit, apply_patch).
          return 0
        },
      },
      get diagnostics() {
        return diagnostics
      },
      async waitForDiagnostics(input: { path: string; version: number; mode?: "document" | "full"; after?: number }) {
        if (closed) return
        const file = Filesystem.normalizePath(path.resolve(ctx?.directory ?? client.root, input.path))
        const stat = await Bun.file(file)
          .stat()
          .catch(() => undefined)
        if (closed) return
        if (stat && checked !== undefined && stat.mtimeMs < checked) return
        if (pending) {
          // Tools such as apply_patch write all files before requesting results.
          // Joining that run is safe, but a later write invalidates it.
          if (pending.revision === revision && (!stat || stat.mtimeMs >= pending.start)) invalidate()
          return
        }
        invalidate()
        const task = run()
        // Unknown or slow checkers must not block the tool. The check keeps
        // running and the next tool call sees its result.
        if (duration !== undefined && duration > SLOW_CHECK_MS) return
        await withTimeout(task, WAIT_BUDGET_MS).catch(() => {
          log.debug("ts check still running, returning without diagnostics", { path: input.path })
        })
      },
      async shutdown() {
        log.info("shutting down ts-client")
        closed = true
        GlobalBus.off("event", changed)
        invalidate()
        pending?.controller.abort()
        await pending?.promise
      },
    }

    log.info("created lightweight ts client", { root: input.root })
    return client
  }
}
