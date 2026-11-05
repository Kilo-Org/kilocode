import { Runtime } from "@opencode/cli/framework/runtime"
import { OpenCode } from "@opencode/client"
import { Service } from "@opencode/client/effect/service"
import { ServerConnection } from "@opencode/cli/services/server-connection"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { KiloRemoteRpc } from "@opencode/schema/kilocode/remote"
import { KiloSessionSyncRpc } from "@opencode/schema/kilocode/session-sync"
import { Effect } from "effect"
import { RemoteCommand } from "./remote"

export default Runtime.handler(
  RemoteCommand,
  Effect.fnUntraced(function* () {
    // A remote host always owns a private server; it must not enable control on an unrelated daemon.
    process.env.KILO_REMOTE = "1"
    process.env.KILO_REMOTE_KIND = "remote"
    const server = yield* ServerConnection.resolve({ standalone: true })
    const client = OpenCode.make({ baseUrl: server.endpoint.url, headers: Service.headers(server.endpoint) })
    const location = { location: { directory: process.cwd() } }
    yield* Effect.tryPromise(() => client.rpc(KiloHandshakeRpc.Definition).get({}, location))
    const sync = yield* Effect.tryPromise(() =>
      client.rpc(KiloSessionSyncRpc.Definition).status({ directory: process.cwd() }, location),
    )
    if (!sync.enabled)
      return yield* Effect.fail(
        new Error(sync.error?.message ?? "Sign in to Kilo and enable session sync before starting a remote host"),
      )
    yield* Effect.tryPromise(() => client.rpc(KiloRemoteRpc.Definition).enable({}, location))
    console.log("Remote connection enabled. Waiting for remote commands; press Ctrl+C to stop.")
    return yield* Effect.never
  }),
)
