import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { OpenCode } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { mkdtemp, realpath, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloApp } from "../src/app"

const entry = path.join(import.meta.dir, "../src/index.ts")
const login = new Set(["KILO_API_KEY", "KILOCODE_TOKEN", "KILO_AUTH_CONTENT", "KILO_ORG_ID", "KILO_AI_GATEWAY_URL"])

// The connection an IDE client makes: it starts the host entry as `serve --stdio`, reads the URL, calls the
// `kilocode.handshake` RPC to confirm a Kilo v2 server, then calls the route group of another Kilo plugin. HOME and
// XDG are isolated, and a local stand-in for the Kilo API answers the Gateway.
test("a client starts the host, confirms a Kilo v2 server through the handshake and calls a plugin route", async () => {
  using backend = fixture()
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "kilo-handshake-")))
  // Keep a developer's Kilo login out of the test.
  const inherited = Object.fromEntries(Object.entries(process.env).filter(([key]) => !login.has(key)))
  // The package directory, so its bunfig.toml preload compiles the TUI modules the CLI imports.
  const child = Bun.spawn([process.execPath, entry, "serve", "--stdio"], {
    cwd: path.dirname(import.meta.dir),
    env: {
      ...inherited,
      HOME: root,
      USERPROFILE: root,
      OPENCODE_TEST_HOME: root,
      XDG_CACHE_HOME: path.join(root, "cache"),
      XDG_CONFIG_HOME: path.join(root, "config"),
      XDG_DATA_HOME: path.join(root, "data"),
      XDG_STATE_HOME: path.join(root, "state"),
      KILO_API_URL: backend.url,
      KILO_SERVER_PASSWORD: "secret",
      OPENCODE_DISABLE_AUTOUPDATE: "1",
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "inherit",
  })
  try {
    const { url } = JSON.parse(await firstLine(child.stdout)) as { url: string }
    const client = OpenCode.make({ baseUrl: url, headers: { authorization: `Basic ${btoa("opencode:secret")}` } })
    const options = { location: { directory: root } }

    expect(await client.rpc(KiloHandshakeRpc.Definition).get({}, options)).toEqual({
      product: "kilo",
      version: KiloApp.version,
      channel: KiloApp.channel,
    })
    expect(await client.rpc(KiloGatewayRpc.Definition).authStatus({}, options)).toEqual({
      authenticated: false,
      organizationID: null,
      server: backend.url,
    })
  } finally {
    // The stdio server stops when its input closes.
    child.stdin.end()
    await child.exited
    await rm(root, { recursive: true, force: true })
  }
}, 60_000)

async function firstLine(stream: ReadableStream<Uint8Array>) {
  const decoder = new TextDecoder()
  const reader = stream.getReader()
  const read = async (text: string): Promise<string> => {
    if (text.includes("\n")) return text.slice(0, text.indexOf("\n"))
    const chunk = await reader.read()
    if (chunk.done) throw new Error(`the server exited before it printed its URL: ${text}`)
    return read(text + decoder.decode(chunk.value, { stream: true }))
  }
  return read("").finally(() => reader.releaseLock())
}
