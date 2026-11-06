// Server-wide metadata for one v2 connection: the handshake version, the Kilo Gateway catalog failure, and the Gateway
// model metadata. None of these answers depends on the directory, so every store of the Agent Manager reads one copy
// instead of repeating the requests for each directory.
import type { OpenCodeClient, OpenCodeEvent } from "@opencode/client"
import type { createClientConnection } from "@opencode/client/solid"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { createKiloModelsCache, type KiloModelsCache } from "./kilo-models"

type Connection = ReturnType<typeof createClientConnection>
type Failure = KiloGatewayRpc.CatalogFailure

export const catalogEvent = `rpc.${KiloGatewayRpc.Definition.id}.catalog` as const

export type ConnectionMetadata = ReturnType<typeof createConnectionMetadata>

/**
 * Call inside a reactive owner. The panel routes every event through `receive`; a store created alone passes
 * `subscribe` so the catalog event reaches it directly.
 */
export function createConnectionMetadata(input: {
  api: OpenCodeClient
  connection: Connection
  subscribe?: (handler: () => void) => () => void
}) {
  const rpc = input.api.rpc(KiloGatewayRpc.Definition)
  const [directory, setDirectory] = createSignal<string>()
  const [version, setVersion] = createSignal("")
  const [handshake, setHandshake] = createSignal("")
  const [failure, setFailure] = createSignal<Failure>()
  const models: KiloModelsCache = createKiloModelsCache()
  const state = { handshake: 0, catalog: 0 }

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
  const readCatalog = (dir: string) => {
    const read = ++state.catalog
    void rpc["catalog.status"]({}, { location: { directory: dir } }).then(
      (result) => read === state.catalog && setFailure(result.failure ?? undefined),
      () => read === state.catalog && setFailure(undefined),
    )
  }
  createEffect(
    on(
      () => [input.connection.status(), directory()] as const,
      ([status, dir]) => {
        if (status !== "connected" || !dir) return
        readHandshake(dir)
        readCatalog(dir)
      },
    ),
  )
  if (input.subscribe)
    onCleanup(
      input.subscribe(() => {
        const dir = directory()
        if (dir) readCatalog(dir)
      }),
    )

  return {
    /** The directory used for the server-wide reads; the first store that needs them wins. */
    attach(value: string) {
      if (!value || directory()) return
      setDirectory(value)
    },
    receive(event: OpenCodeEvent) {
      if (event.type !== catalogEvent) return
      const dir = directory()
      if (dir) readCatalog(dir)
    },
    version,
    handshake,
    kiloFailure: failure,
    kiloModels: models.value,
    kiloModelsCache: models,
  }
}

function message(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null && "message" in error) return String(error.message)
  return String(error)
}
