// kilocode_change - new file
// Lightweight TypeScript diagnostic client that shells out to tsgo/tsc
// instead of spawning a persistent typescript-language-server process.
// This drops memory from ~500MB persistent to ~50MB peak (0 idle).

import { LSPClient } from "../lsp/client"
import { Bus } from "../bus"
import { TsCheck } from "./ts-check"
import { Log } from "../util/log"
import { withTimeout } from "../util/timeout"
import path from "path"
import { Instance } from "../project/instance"

export namespace TsClient {
  const log = Log.create({ service: "ts-client" })

  export function create(input: { root: string }): LSPClient.Info {
    const diagnostics = new Map<string, LSPClient.Diagnostic[]>()
    // Pending tsgo run promise — used for coalescing rapid calls.
    // Only set when waitForDiagnostics() triggers a run, NOT on
    // notify.open() (which is a warm-up call from read.ts).
    let pending: Promise<void> | undefined

    function check(): Promise<void> {
      if (pending) return pending
      pending = TsCheck.run(client.root)
        .then((result) => {
          diagnostics.clear()
          for (const [file, diags] of result) {
            diagnostics.set(file, diags)
          }
          for (const file of result.keys()) {
            Bus.publish(LSPClient.Event.Diagnostics, {
              path: file,
              serverID: client.serverID,
            })
          }
        })
        .catch((err) => {
          log.error("ts check failed", { error: err })
        })
        .finally(() => {
          pending = undefined
        })
      return pending
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
        },
      },
      get diagnostics() {
        return diagnostics
      },
      async waitForDiagnostics(_input: { path: string }) {
        // Run tsgo --noEmit and wait for results. Coalesces concurrent calls.
        // 30s cap matches the process timeout in TsCheck.run(). Silent catch
        // matches the real LSPClient's .catch(() => {}) on its 3s timeout.
        await withTimeout(check(), 30_000).catch(() => {})
      },
      async shutdown() {
        log.info("shutting down ts-client")
        diagnostics.clear()
      },
    }

    log.info("created lightweight ts client", { root: input.root })
    return client
  }
}
