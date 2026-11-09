// Server-wide metadata for one v2 connection: the handshake version, the Kilo Gateway catalog failure, and the Gateway
// model metadata. None of these answers depends on the directory, so every store of the Agent Manager reads one copy
// instead of repeating the requests for each directory.
import type { OpenCodeClient } from "@opencode/client"
import type { createClientConnection } from "@opencode/client/solid"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { createEffect, createSignal, on } from "solid-js"
import { catalogEvent, createKiloCatalog } from "./kilo-catalog"
import { createKiloModelsCache, type KiloModelsCache } from "./kilo-models"

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
  const [handshake, setHandshake] = createSignal("")
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

  const readHandshake = (dir: string) => {
    const read = ++state.handshake
    void input.api
      .rpc(KiloHandshakeRpc.Definition)
      .get({}, { location: { directory: dir } })
      .then((info) => {
        if (read !== state.handshake) return
        setVersion(info.version)
        setHandshake("")
      })
      .catch((err: unknown) => {
        if (read === state.handshake) setHandshake(`Not a Kilo v2 server: ${message(err)}`)
      })
  }
  createEffect(
    on(
      () => [input.connection.status(), directory()] as const,
      ([status, dir]) => {
        if (status !== "connected" || !dir) return
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

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message)
  return String(error)
}
