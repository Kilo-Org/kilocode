// Server-wide metadata for one v2 connection: the handshake version. It does not depend on the directory, so every
// store of the Agent Manager shares one handshake read instead of repeating it for each directory.
import type { OpenCodeClient } from "@opencode/client"
import type { createClientConnection } from "@opencode/client/solid"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { createEffect, createSignal, on, onCleanup } from "solid-js"
import { toFailure, type Failure } from "./error"
import { pluginsListed } from "../../../src/shared/plugin-inventory"

type Connection = ReturnType<typeof createClientConnection>

export type ConnectionMetadata = ReturnType<typeof createConnectionMetadata>

/**
 * Retry delays for a failed handshake. A server that just started can answer one request before it is ready, and the
 * banner would otherwise stay until the window reloads.
 */
const HANDSHAKE_RETRY = [500, 1_000, 2_000, 5_000, 10_000] as const

/** Call inside a reactive owner to share the server-wide handshake read across every store of one connection. */
export function createConnectionMetadata(input: { api: OpenCodeClient; connection: Connection }) {
  const active = new Set<string>()
  const [directory, setDirectory] = createSignal<string>()
  const [version, setVersion] = createSignal("")
  const [handshake, setHandshake] = createSignal<Failure>()
  const state = { handshake: 0, verified: false, retry: undefined as ReturnType<typeof setTimeout> | undefined }
  onCleanup(() => clearTimeout(state.retry))

  // A Location that is still activating answers the handshake like a server without it, so the read waits for the
  // plugins of the Location first.
  const readHandshake = (dir: string, attempt = 0) => {
    clearTimeout(state.retry)
    const read = ++state.handshake
    void pluginsListed({ api: input.api, directory: dir, active: () => read === state.handshake })
      .then(() => {
        if (read !== state.handshake) return
        return input.api
          .rpc(KiloHandshakeRpc.Definition)
          .get({}, { location: { directory: dir } })
          .then((info) => {
            if (read !== state.handshake) return
            state.verified = true
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
        const delay = HANDSHAKE_RETRY[attempt]
        if (delay === undefined) return
        state.retry = setTimeout(() => {
          if (read !== state.handshake || input.connection.status() !== "connected") return
          readHandshake(dir, attempt + 1)
        }, delay)
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
          if (status !== "connected") state.verified = false
          state.handshake++
          return
        }
        if (state.verified) return
        readHandshake(dir)
      },
    ),
  )

  return {
    /** Registers a live store directory for the server-wide handshake read; returns a detach cleanup. */
    attach(value: string) {
      if (!value) return () => {}
      active.add(value)
      if (!directory()) setDirectory(value)
      return () => {
        active.delete(value)
        if (directory() !== value) return
        setDirectory(active.values().next().value)
      }
    },
    version,
    handshake,
  }
}
