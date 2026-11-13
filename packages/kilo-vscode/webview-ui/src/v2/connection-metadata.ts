// Server-wide metadata for one v2 connection: the handshake version, the Kilo Gateway catalog failure, and the Gateway
// model metadata. None of these answers depends on the directory, so every store of the Agent Manager reads one copy
// instead of repeating the requests for each directory.
import type { OpenCodeClient } from "@opencode/client"
import type { createClientConnection } from "@opencode/client/solid"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { toFailure, type Failure } from "./error"
import { catalogEvent, createKiloCatalog } from "./kilo-catalog"
import { createKiloModelsCache, type KiloModelsCache } from "./kilo-models"
import { pluginsListed } from "./plugin-inventory"

type Connection = ReturnType<typeof createClientConnection>

export type ConnectionMetadata = ReturnType<typeof createConnectionMetadata>

/**
 * Call inside a reactive owner. `subscribe` reaches the catalog event: the panel routes it from its shared stream, and
 * a store created alone subscribes to its own event stream.
 */
export function createConnectionMetadata(input: {
  api: OpenCodeClient
  connection: Connection
  subscribe: (type: typeof catalogEvent, handler: () => void) => () => void
  /**
   * Reads the Kilo Gateway catalog status. The Settings and Profile panels pass false, because neither shows the
   * catalog failure and Settings must not issue the request.
   */
  chat?: boolean
}) {
  const [directory, setDirectory] = createSignal<string>()
  const [version, setVersion] = createSignal("")
  const [handshake, setHandshake] = createSignal<Failure>()
  const models: KiloModelsCache = createKiloModelsCache()
  const kiloFailure =
    input.chat === false
      ? () => undefined
      : createKiloCatalog({
          api: input.api,
          directory,
          status: input.connection.status,
          on: input.subscribe,
        })
  const state = { handshake: 0 }

  // A Location that is still activating answers the handshake like a server without it, so the read waits for the
  // plugins of the Location first.
  const readHandshake = (dir: string) => {
    const read = ++state.handshake
    void pluginsListed({ api: input.api, directory: dir, active: () => read === state.handshake })
      .then(() => {
        if (read !== state.handshake) return
        return input.api
          .rpc(KiloHandshakeRpc.Definition)
          .get({}, { location: { directory: dir } })
          .then((info) => {
            if (read !== state.handshake) return
            setVersion(info.version)
            setHandshake(undefined)
          })
      })
      .catch((err: unknown) => {
        if (read !== state.handshake) return
        const failure = toFailure(err)
        setHandshake({
          key: "error.failure.notKilo",
          message: "Not a Kilo v2 server.",
          details: failure.details ?? failure.message,
        })
      })
  }
  // A disposed owner ends the wait and drops a late answer.
  onCleanup(() => {
    state.handshake++
  })
  createEffect(
    on(
      () => [input.connection.status(), directory()] as const,
      ([status, dir]) => {
        if (status !== "connected" || !dir) {
          // A request that fails on a dropped connection says nothing about the server: end the running read. The
          // read starts again when the connection is back.
          state.handshake++
          return
        }
        readHandshake(dir)
      },
    ),
  )

  return {
    /** The directory used for the server-wide reads; the first store that needs them wins. */
    attach(value: string) {
      if (!value || directory()) return
      setDirectory(value)
    },
    version,
    handshake,
    kiloFailure,
    kiloModelsCache: models,
  }
}
