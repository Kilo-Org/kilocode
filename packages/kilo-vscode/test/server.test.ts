import { describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { mkdtemp, mkdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { command, environment, parse, start, stop } from "../src/server"

const extension = path.resolve(import.meta.dir, "..")

describe("parse", () => {
  test("reads the URL from a complete JSON line", () => {
    expect(parse('kilo v2 dev profile: /tmp/x\n{"url":"http://127.0.0.1:4096"}\n')).toBe("http://127.0.0.1:4096")
  })

  test("waits for the end of the line", () => {
    expect(parse('{"url":"http://127.0.0.1:40')).toBeUndefined()
  })

  test("ignores other JSON and broken lines", () => {
    expect(parse('{"level":"info"}\n{not json\n{"url":"http://127.0.0.1:1"}\n')).toBe("http://127.0.0.1:1")
  })
})

describe("command", () => {
  test("uses the repository dev entry with an isolated profile when bin/kilo2 is missing", () => {
    const found = command({ extension, storage: "/storage", env: {} })
    expect(found?.args).toEqual([path.resolve(extension, "../../script/dev-isolated.ts"), "serve", "--port", "0", "--stdio"])
    expect(found?.env).toEqual({ KILO_V2_PROFILE: path.join("/storage", "profile") })
  })

  test("keeps an explicit KILO_V2_PROFILE", () => {
    expect(command({ extension, storage: "/storage", env: { KILO_V2_PROFILE: "/p" } })?.env).toEqual({
      KILO_V2_PROFILE: "/p",
    })
  })

  test("prefers a bundled bin/kilo2", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kilo-vscode-"))
    await mkdir(path.join(dir, "bin"))
    await Bun.write(path.join(dir, "bin", "kilo2"), "")
    expect(command({ extension: dir, storage: "/storage", env: {}, platform: "darwin" })).toEqual({
      cmd: path.join(dir, "bin", "kilo2"),
      args: ["serve", "--port", "0", "--stdio"],
      env: {},
    })
    await rm(dir, { recursive: true })
  })

  test("finds nothing outside the repository without a binary", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kilo-vscode-"))
    expect(command({ extension: dir, storage: "/storage", env: {} })).toBeUndefined()
    await rm(dir, { recursive: true })
  })
})

test("environment drops v1-only variables and sets the client", () => {
  const env = environment({ KILO_PARENT_PID: "1", KILO_TELEMETRY_LEVEL: "all", PATH: "/bin" }, { KILO_SERVER_PASSWORD: "x" })
  expect(env.KILO_PARENT_PID).toBeUndefined()
  expect(env.KILO_TELEMETRY_LEVEL).toBeUndefined()
  expect(env).toMatchObject({ PATH: "/bin", KILO_CLIENT: "vscode", KILO_SERVER_PASSWORD: "x", NODE_USE_SYSTEM_CA: "1" })
})

test("starts the real v2 server, passes the Kilo handshake and stops when stdin closes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kilo-vscode-server-"))
  const found = command({ extension, storage: root, env: {} })
  if (!found) throw new Error("dev entry not found")
  const server = await start({ command: found, cwd: path.join(root, "workspace"), env: process.env })
  const api = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization } })
  const info = await api.rpc(KiloHandshakeRpc.Definition).get({}, { location: { directory: path.join(root, "workspace") } })
  expect(info.product).toBe("kilo")
  const denied = await fetch(`${server.url}/api/info`)
  expect(denied.status).toBe(401)
  const exited = new Promise((resolve) => server.process.once("exit", resolve))
  stop(server.process)
  await exited
  await rm(root, { recursive: true, force: true })
}, 90_000)
