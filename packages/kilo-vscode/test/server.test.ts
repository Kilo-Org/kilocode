import { describe, expect, test } from "bun:test"
import { OpenCode } from "@opencode/client"
import { KiloHandshakeRpc } from "@opencode/schema/kilocode/handshake"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { command, environment, indexingEnvironment, manager, parse, serverPlans, settingsEnvironment, start, stop } from "../src/server"

const extension = path.resolve(import.meta.dir, "..")

function checkout() {
  const dir = mkdtempSync(path.join(tmpdir(), "kilo-vscode-checkout-"))
  const extension = path.join(dir, "packages", "kilo-vscode")
  mkdirSync(extension, { recursive: true })
  mkdirSync(path.join(dir, "script"), { recursive: true })
  writeFileSync(path.join(dir, "script", "dev-isolated.ts"), "")
  return { dir, extension }
}

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
    const { dir, extension } = checkout()
    const found = command({ extension, storage: "/storage", env: {} })
    expect(found?.args).toEqual([path.join(dir, "script", "dev-isolated.ts"), "serve", "--port", "0", "--stdio"])
    expect(found?.env).toEqual({ KILO_V2_PROFILE: path.join("/storage", "profile") })
    rmSync(dir, { recursive: true })
  })

  test("keeps an explicit KILO_V2_PROFILE", () => {
    const { dir, extension } = checkout()
    expect(command({ extension, storage: "/storage", env: { KILO_V2_PROFILE: "/p" } })?.env).toEqual({
      KILO_V2_PROFILE: "/p",
    })
    rmSync(dir, { recursive: true })
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

describe("serverPlans", () => {
  test("is the profile data plan directory for the isolated dev server", () => {
    const cmd = { cmd: "bun", args: [], env: { KILO_V2_PROFILE: path.join(tmpdir(), "profile") } }
    expect(serverPlans(cmd, {})).toBe(path.join(tmpdir(), "profile", "data", "kilo2", "plans"))
  })

  test("is the Kilo data plan directory for the bundled server", () => {
    expect(serverPlans({ cmd: "kilo2", args: [], env: {} }, { XDG_DATA_HOME: "/d" })).toBe(
      path.join("/d", "kilo2", "plans"),
    )
  })
})

test("environment drops v1-only variables and sets the client", () => {
  const env = environment(
    { KILO_PARENT_PID: "1", KILO_TELEMETRY_LEVEL: "all", PATH: "/bin" },
    { OPENCODE_PASSWORD: "x" },
  )
  expect(env.KILO_PARENT_PID).toBeUndefined()
  expect(env.KILO_TELEMETRY_LEVEL).toBeUndefined()
  expect(env).toMatchObject({
    PATH: "/bin",
    KILO_CLIENT: "vscode",
    KILO_PLATFORM: "vscode",
    OPENCODE_PASSWORD: "x",
    NODE_USE_SYSTEM_CA: "1",
  })
})

test("environment drops inherited server passwords", () => {
  const env = environment({ OPENCODE_PASSWORD: "a", OPENCODE_SERVER_PASSWORD: "b", KILO_SERVER_PASSWORD: "c" }, {})
  expect(env.OPENCODE_PASSWORD).toBeUndefined()
  expect(env.OPENCODE_SERVER_PASSWORD).toBeUndefined()
  expect(env.KILO_SERVER_PASSWORD).toBeUndefined()
})


describe("indexingEnvironment", () => {
  test("disables indexing when no workspace folder is open", () => {
    expect(indexingEnvironment(undefined)).toEqual({ KILO_DISABLE_CODEBASE_INDEXING: "vscode-no-workspace" })
    expect(indexingEnvironment(0)).toEqual({ KILO_DISABLE_CODEBASE_INDEXING: "vscode-no-workspace" })
  })

  test("leaves indexing on when a workspace folder is open", () => {
    expect(indexingEnvironment(1)).toEqual({})
  })
})

describe("settingsEnvironment", () => {
  const editor = "Visual Studio Code 1.114.0"

  test("reports the editor to the Gateway and disables Claude Code loading by default", () => {
    expect(settingsEnvironment({ claudeCodeCompat: false, extraCaCerts: "", editor })).toEqual({
      KILOCODE_EDITOR_NAME: editor,
      KILO_DISABLE_CLAUDE_CODE: "true",
    })
  })

  test("leaves Claude Code loading on when compatibility is enabled", () => {
    expect(settingsEnvironment({ claudeCodeCompat: true, extraCaCerts: "", editor })).toEqual({
      KILOCODE_EDITOR_NAME: editor,
    })
  })

  test("sets the extra CA certificates path, trimmed", () => {
    expect(settingsEnvironment({ claudeCodeCompat: true, extraCaCerts: "/certs/ca.pem ", editor })).toEqual({
      KILOCODE_EDITOR_NAME: editor,
      NODE_EXTRA_CA_CERTS: "/certs/ca.pem",
    })
  })

  test("ignores a blank CA certificates value", () => {
    expect(settingsEnvironment({ claudeCodeCompat: true, extraCaCerts: "   ", editor })).toEqual({
      KILOCODE_EDITOR_NAME: editor,
    })
  })
})

test("environment drops an inherited owned setting but keeps the rest", () => {
  const env = environment(
    {
      KILO_DISABLE_CLAUDE_CODE: "true",
      OPENCODE_DISABLE_CLAUDE_CODE: "true",
      KILO_DISABLE_CLAUDE_CODE_SKILLS: "true",
      NODE_EXTRA_CA_CERTS: "/old.pem",
    },
    {},
  )
  expect(env.KILO_DISABLE_CLAUDE_CODE).toBeUndefined()
  expect(env.OPENCODE_DISABLE_CLAUDE_CODE).toBeUndefined()
  expect(env.KILO_DISABLE_CLAUDE_CODE_SKILLS).toBe("true")
  expect(env.NODE_EXTRA_CA_CERTS).toBe("/old.pem")
})

test("manager keeps a failed start, reports it once and retries after a restart", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kilo-vscode-manager-"))
  const errors: string[] = []
  const server = manager({
    command: () => ({ cmd: process.execPath, args: ["-e", "process.exit(3)"], env: {} }),
    cwd: root,
    env: process.env,
    onError: (error) => errors.push(error.message),
  })
  const first = server.get()
  await expect(first).rejects.toThrow("exited during startup")
  // Requests during the retry interval do not start another server.
  expect(server.get()).toBe(first)
  expect(errors).toHaveLength(1)
  await server.stop()
  const second = server.get()
  expect(second).not.toBe(first)
  await expect(second).rejects.toThrow("exited during startup")
  expect(errors).toHaveLength(2)
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
})

test("manager reports every started and stopped server", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kilo-vscode-manager-lifecycle-"))
  const firstStop = Promise.withResolvers<void>()
  const secondStop = Promise.withResolvers<void>()
  const script = `
    const http = require("node:http")
    const server = http.createServer((request, response) => {
      if (request.url === "/exit") return response.end("bye", () => setImmediate(() => process.exit(0)))
      response.end("ok")
    })
    server.listen(0, "127.0.0.1", () => {
      console.log(JSON.stringify({ url: "http://127.0.0.1:" + server.address().port }))
    })
    process.stdin.resume()
    process.stdin.on("end", () => server.close())
  `
  let starts = 0
  let stops = 0
  let started: string | undefined
  const server = manager({
    command: () => ({ cmd: process.execPath, args: ["-e", script], env: {} }),
    cwd: root,
    env: process.env,
    onStart: (value) => {
      starts++
      started = value.url
    },
    onStop: () => {
      stops++
      if (stops === 1) firstStop.resolve()
      if (stops === 2) secondStop.resolve()
    },
  })
  const first = await server.get()
  expect(starts).toBe(1)
  expect(started).toBe(first.url)
  expect((await fetch(`${first.url}/exit`)).status).toBe(200)
  await firstStop.promise
  const second = await server.get()
  expect(starts).toBe(2)
  expect(second.url).not.toBe(first.url)
  const exited = new Promise<void>((resolve) => second.process.once("exit", () => resolve()))
  await server.stop()
  await secondStop.promise
  await exited
  expect(stops).toBe(2)
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}, 10_000)

test("starts the real v2 server, passes the Kilo handshake and stops when stdin closes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "kilo-vscode-server-"))
  const found = command({ extension, storage: root, env: {} })
  if (!found) throw new Error("dev entry not found")
  // A stale INIT_CWD must not move the server out of the workspace, and an inherited password must not replace ours.
  const server = await start({
    command: found,
    cwd: path.join(root, "workspace"),
    env: { ...process.env, INIT_CWD: root, OPENCODE_PASSWORD: "inherited" },
  })
  const api = OpenCode.make({ baseUrl: server.url, headers: { authorization: server.authorization } })
  const info = await api
    .rpc(KiloHandshakeRpc.Definition)
    .get({}, { location: { directory: path.join(root, "workspace") } })
  expect(info.product).toBe("kilo")
  // Without a location, the server creates the session in its own working directory.
  const session = await api.session.create({})
  expect(await realpath(session.location.directory)).toBe(await realpath(path.join(root, "workspace")))
  const denied = await fetch(`${server.url}/api/info`)
  expect(denied.status).toBe(401)
  const exited = new Promise((resolve) => server.process.once("exit", resolve))
  stop(server.process)
  await exited
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}, 90_000)
