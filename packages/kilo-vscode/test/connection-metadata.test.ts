// The handshake read of one v2 connection. A server answers `rpc.unavailable` for a Kilo RPC until the Location's
// plugins are registered, and a server without the Kilo handshake answers the same, so the read waits for the plugin
// inventory before it decides that the server is not a Kilo v2 server.
import { describe, expect, mock, test } from "bun:test"
import { OpenCode, type OpenCodeClient } from "@opencode/client"
import { mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { command, start, stop } from "../src/server"

// One Solid instance for the module and the test, so effects run and `createRoot` owns them.
const CLIENT_SOLID = "solid-js/dist/solid.js"
mock.module("solid-js", () => import(CLIENT_SOLID))

const { createRoot, createSignal } = (await import(CLIENT_SOLID)) as {
  createRoot: <T>(fn: (dispose: () => void) => T) => T
  createSignal: <T>(value: T) => [() => T, (value: T) => void]
}
const { createConnectionMetadata } = await import("../webview-ui/src/v2/connection-metadata")

const unavailable = { type: "rpc.unavailable", message: "RPC is unavailable: kilocode.handshake" }

async function until(check: () => boolean, attempts = 200) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (check()) return
    await Bun.sleep(10)
  }
  throw new Error("condition not reached")
}

/** `list` answers each inventory read; the handshake succeeds once the last read listed a plugin, as on a Kilo server. */
function make(input: { list: (call: number) => Promise<unknown[]>; kilo: boolean }) {
  const calls: string[] = []
  const state = { listed: false }
  const api = {
    plugin: {
      list: async () => {
        calls.push("plugin.list")
        const data = await input.list(calls.filter((call) => call === "plugin.list").length)
        state.listed = data.length > 0
        return { data }
      },
    },
    rpc: () => ({
      get: async () => {
        calls.push("handshake")
        if (!input.kilo || !state.listed) throw unavailable
        return { version: "1.2.3" }
      },
    }),
  } as unknown as OpenCodeClient
  const [status] = createSignal("connected")
  const connection = { status } as unknown as Parameters<typeof createConnectionMetadata>[0]["connection"]
  return createRoot((dispose) => {
    const metadata = createConnectionMetadata({ api, connection, subscribe: () => () => {}, chat: false })
    metadata.attach("/workspace")
    return { calls, metadata, dispose }
  })
}

describe("createConnectionMetadata handshake", () => {
  test("waits for the plugins of a cold Location instead of reporting a server that is not Kilo", async () => {
    const scope = make({ kilo: true, list: async (call) => (call < 3 ? [] : [{ id: "kilocode.handshake" }]) })
    try {
      await until(() => scope.metadata.version() === "1.2.3")
      expect(scope.calls).toEqual(["plugin.list", "plugin.list", "plugin.list", "handshake"])
      expect(scope.metadata.handshake()).toBeUndefined()
    } finally {
      scope.dispose()
    }
  })

  test("reports a server whose plugins are listed and that has no Kilo handshake", async () => {
    const scope = make({ kilo: false, list: async () => [{ id: "opencode.plan" }] })
    try {
      await until(() => scope.metadata.handshake() !== undefined)
      expect(scope.metadata.handshake()).toMatchObject({ key: "error.failure.notKilo" })
      expect(scope.calls).toEqual(["plugin.list", "handshake"])
    } finally {
      scope.dispose()
    }
  })

  test("reads the handshake at once from a server without a plugin inventory", async () => {
    const scope = make({
      kilo: false,
      list: async () => {
        throw { type: "not_found", message: "not found" }
      },
    })
    try {
      await until(() => scope.metadata.handshake() !== undefined)
      expect(scope.calls).toEqual(["plugin.list", "handshake"])
    } finally {
      scope.dispose()
    }
  })

  test("stops waiting when its owner is disposed", async () => {
    const scope = make({ kilo: true, list: async () => [] })
    await until(() => scope.calls.length >= 2)
    scope.dispose()
    await Bun.sleep(150)
    const settled = scope.calls.length
    await Bun.sleep(300)
    expect(scope.calls).toHaveLength(settled)
    expect(scope.calls).not.toContain("handshake")
  })

  // The real server and the real client: the webview connects as soon as the server prints its URL, before the
  // Location of the workspace has registered its plugins.
  test("reads the version of a real v2 server whose Location is still activating", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "kilo-vscode-handshake-"))
    const found = command({ extension: path.resolve(import.meta.dir, ".."), storage: root, env: {} })
    if (!found) throw new Error("dev entry not found")
    const workspace = path.join(root, "workspace")
    const server = await start({ command: found, cwd: workspace, env: { ...process.env, INIT_CWD: root } })
    const api = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization } })
    const [status] = createSignal("connected")
    const connection = { status } as unknown as Parameters<typeof createConnectionMetadata>[0]["connection"]
    const scope = createRoot((dispose) => {
      const metadata = createConnectionMetadata({ api, connection, subscribe: () => () => {}, chat: false })
      metadata.attach(workspace)
      return { metadata, dispose }
    })
    try {
      await until(() => scope.metadata.version() !== "" || scope.metadata.handshake() !== undefined, 3_000)
      expect(scope.metadata.handshake()).toBeUndefined()
      expect(scope.metadata.version()).not.toBe("")
    } finally {
      scope.dispose()
      const exited = new Promise((resolve) => server.process.once("exit", resolve))
      stop(server.process)
      await exited
      await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
  }, 90_000)
})
