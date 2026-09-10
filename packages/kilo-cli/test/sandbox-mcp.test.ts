import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Exit, Scope } from "effect"
import { OpenCode } from "@opencode-ai/client"
import type { Mcp } from "@opencode-ai/schema/mcp"
import { sandboxArgvLauncherScript, sandboxSupport, type SandboxConfig } from "../src/sandbox"
import { createSandboxMcpSpawnGate, sandboxServerCommand } from "../src/sandbox-mcp"
import { fixture, ready } from "./fixture"

const support = sandboxSupport()

// The hook returns the ServerConfig union; these tests only exercise local spawns, so narrow
// explicitly instead of casting.
const requireLocal = (spawned: Mcp.ServerConfig) => {
  if (spawned.type !== "local") throw new Error(`gate returned a non-local config: ${spawned.type}`)
  return spawned
}

test("sandbox server command rewrites all local servers including disabled and leaves remote alone", () => {
  expect(sandboxServerCommand({ type: "remote", url: "https://example.com/mcp" }, "/launcher")).toBeUndefined()
  expect(sandboxServerCommand({ type: "local", command: [] }, "/launcher")).toBeUndefined()
  const rewritten = sandboxServerCommand({ type: "local", command: ["server", "--flag"] }, "/launcher")
  expect(rewritten).toEqual({ command: ["/launcher", "server", "--flag"] })
  // A direct mcp.connect starts a disabled server unconditionally, so disabled configs are
  // rewritten as well; the spawn-time gate keeps the disabled flag, so nothing spawns
  // automatically either way.
  const disabled = sandboxServerCommand({ type: "local", command: ["server"], disabled: true }, "/launcher")
  expect(disabled).toEqual({ command: ["/launcher", "server"] })
})

test("sandbox server command bakes the opencode marker and never treats paths as provenance", () => {
  const opencode = sandboxServerCommand({ type: "local", command: ["opencode", "mcp", "serve"] }, "/launcher")
  expect(opencode).toEqual({ command: ["/launcher", "opencode", "mcp", "serve"], environment: { BUN_BE_BUN: "1" } })
  // A user-controlled command path that references a sandbox directory is still wrapped:
  // a path is not provenance, and the connection-scoped gate wraps raw configs on every spawn.
  const suspicious = sandboxServerCommand({ type: "local", command: ["/tmp/kilo2-sandbox-evil/server"] }, "/launcher")
  expect(suspicious?.command[0]).toBe("/launcher")
  expect(suspicious?.command[1]).toBe("/tmp/kilo2-sandbox-evil/server")
})

test("sandbox mcp gate requires an enabled sandbox configuration", () => {
  expect(() => createSandboxMcpSpawnGate({ enabled: false })).toThrow("requires an enabled sandbox config")
})

test.skipIf(!support.available)("gate wraps local spawns with a connection-scoped launcher", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "kilo2-sandbox-gate-"))
  const root = path.join(parent, "workspace")
  await mkdir(root, { recursive: true })
  const gate = createSandboxMcpSpawnGate({ enabled: true, root })
  const scope = await Effect.runPromise(Scope.make())
  try {
    const wrapped = requireLocal(
      await Effect.runPromise(
        gate
          .beforeSpawn!({ type: "local", command: ["node", "server.mjs"] }, root)
          .pipe(Scope.provide(scope)),
      ),
    )
    const launcher = wrapped.command[0]!
    expect(launcher).toContain("kilo2-sandbox-")
    expect(wrapped.command.slice(1)).toEqual(["node", "server.mjs"])
    expect(wrapped.type).toBe("local")
    expect(existsSync(launcher)).toBe(true)

    // A second connection gets its own launcher; both are removed with their scopes.
    const second = requireLocal(
      await Effect.runPromise(
        gate
          .beforeSpawn!({ type: "local", command: ["node", "server.mjs"] }, root)
          .pipe(Scope.provide(scope)),
      ),
    )
    expect(second.command[0]).not.toBe(launcher)
    expect(existsSync(second.command[0]!)).toBe(true)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
  }
  const scoped = await Effect.runPromise(Scope.make())
  const launched = requireLocal(
    await Effect.runPromise(
      gate
        .beforeSpawn!({ type: "local", command: ["node", "server.mjs"] }, root)
        .pipe(Scope.provide(scoped)),
    ),
  )
  expect(existsSync(launched.command[0]!)).toBe(true)
  await Effect.runPromise(Scope.close(scoped, Exit.void))
  expect(existsSync(launched.command[0]!)).toBe(false)
  expect(existsSync(path.dirname(launched.command[0]!))).toBe(false)
  await rm(parent, { recursive: true, force: true })
})

test.skipIf(!support.available)("gate leaves remote and empty-argv configs unchanged without a launcher", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-sandbox-gate-remote-"))
  const gate = createSandboxMcpSpawnGate({ enabled: true, root })
  const scope = await Effect.runPromise(Scope.make())
  try {
    const remote: Mcp.ServerConfig = { type: "remote", url: "https://example.com/mcp" }
    expect(await Effect.runPromise(gate.beforeSpawn!(remote, root).pipe(Scope.provide(scope)))).toBe(remote)
    const empty: Mcp.ServerConfig = { type: "local", command: [] }
    expect(await Effect.runPromise(gate.beforeSpawn!(empty, root).pipe(Scope.provide(scope)))).toBe(empty)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    await rm(root, { recursive: true, force: true })
  }
})

test.skipIf(!support.available)("gate bakes the opencode marker and keeps user environment precedence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "kilo2-sandbox-gate-env-"))
  const gate = createSandboxMcpSpawnGate({ enabled: true, root })
  const scope = await Effect.runPromise(Scope.make())
  try {
    const wrapped = requireLocal(
      await Effect.runPromise(
        gate.beforeSpawn!({ type: "local", command: ["opencode", "mcp", "serve"] }, root).pipe(
          Scope.provide(scope),
        ),
      ),
    )
    expect(wrapped.command[1]).toBe("opencode")
    expect(wrapped.environment?.BUN_BE_BUN).toBe("1")
    const user = requireLocal(
      await Effect.runPromise(
        gate
          .beforeSpawn!(
            {
              type: "local",
              command: ["opencode", "mcp", "serve"],
              environment: { BUN_BE_BUN: "0" },
            },
            root,
          )
          .pipe(Scope.provide(scope)),
      ),
    )
    expect(user.environment?.BUN_BE_BUN).toBe("0")
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void))
    await rm(root, { recursive: true, force: true })
  }
})

test.skipIf(!support.available)("gate fails closed when the launcher cannot be created", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "kilo2-sandbox-gate-fail-"))
  const root = path.join(parent, "workspace")
  await mkdir(root, { recursive: true })
  const gate = createSandboxMcpSpawnGate({ enabled: true, root: path.join(parent, "missing") })
  const scope = await Effect.runPromise(Scope.make())
  try {
    const exit = await Effect.runPromiseExit(
      gate
        .beforeSpawn!({ type: "local", command: ["node", "server.mjs"] }, root)
        .pipe(Scope.provide(scope)),
    )
    expect(Exit.isFailure(exit)).toBe(true)
  } finally {
    await Effect.runPromise(Scope.close(scope, Exit.void).pipe(Effect.ignore))
    await rm(parent, { recursive: true, force: true })
  }
})

test("argv launcher keeps exactly one command separator on both backends", () => {
  const config = { enabled: true, root: os.tmpdir() }
  // Regression for the Linux launcher emitting `bwrap ... -- -- <command>`, which execs the
  // separator instead of the command. linuxArguments already terminates with `--`.
  const linux = sandboxArgvLauncherScript({ kind: "linux", executable: "/usr/bin/bwrap" }, config)
  expect(linux).toContain("--bind")
  expect(linux).not.toContain("-- --")
  expect(linux.trimEnd().endsWith(`'--' "$@"`)).toBe(true)
  const macos = sandboxArgvLauncherScript({ kind: "macos", executable: "/usr/bin/sandbox-exec" }, config)
  expect(macos).not.toContain("-- --")
  expect(macos.trimEnd().endsWith('-- "$@"')).toBe(true)
})

test.skipIf(!support.available)(
  "gate-wrapped spawn carries a real MCP handshake and confines tool writes and network",
  async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "kilo2-sandbox-mcp-live-"))
    const root = path.join(parent, "workspace")
    const outside = path.join(parent, "outside")
    const probeTmp = path.join(root, "probe-tmp")
    await mkdir(root, { recursive: true })
    await mkdir(outside, { recursive: true })
    await mkdir(probeTmp, { recursive: true })
    const serverPath = path.join(parent, "mcp-server.mjs")
    await Bun.write(serverPath, FIXTURE_SERVER)
    let networkHits = 0
    const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        networkHits++
        return new Response("unexpected")
      },
    })
    const gate = createSandboxMcpSpawnGate({ enabled: true, root })
    const scope = await Effect.runPromise(Scope.make())
    let child: Bun.Subprocess<"pipe", "pipe", "pipe"> | undefined
    try {
      // Spawn exactly what the gate returns for the raw fixture config: the launcher path is
      // command[0], the confined executable follows, and the launcher dies with this scope.
      const wrapped = requireLocal(
        await Effect.runPromise(
          gate
            .beforeSpawn!(
              {
                type: "local",
                command: [process.execPath, serverPath],
              },
              root,
            )
            .pipe(Scope.provide(scope)),
        ),
      )
      expect(wrapped.command[0]).not.toBe(process.execPath)
      child = Bun.spawn([...wrapped.command], {
        cwd: root,
        env: probeEnv({
          tmpdir: probeTmp,
          inside: path.join(root, "inside.txt"),
          outside: path.join(outside, "outside.txt"),
          port: listener.port,
          root,
          marker: "1",
        }),
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
      })
      const client = startClient(child)
      const initialize = await client.request<{ serverInfo: { name: string } }>(1, "initialize", {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "sandbox-mcp-test", version: "0.0.0" },
      })
      expect(initialize.result.serverInfo).toMatchObject({ name: "probe" })
      client.notify("notifications/initialized", {})
      const tools = await client.request<{ tools: ReadonlyArray<{ name: string }> }>(2, "tools/list", {})
      expect(tools.result.tools.map((tool) => tool.name)).toEqual(["probe"])
      // The server's startup probe records confinement facts from its own first boot.
      const startup = await readFile(path.join(root, "probe.startup"), "utf8")
      expect(startup.startsWith("denied:")).toBe(true)

      const inside = await client.request<ToolResult>(3, "tools/call", {
        name: "probe",
        arguments: { target: "inside" },
      })
      expect(text(inside.result)).toBe("wrote-inside")
      expect(await readFile(path.join(root, "inside.txt"), "utf8")).toBe("inside-written")

      const escaped = await client.request<ToolResult>(4, "tools/call", {
        name: "probe",
        arguments: { target: "outside" },
      })
      expect(text(escaped.result).startsWith("denied:")).toBe(true)
      await expect(readFile(path.join(outside, "outside.txt"), "utf8")).rejects.toThrow()

      const network = await client.request<ToolResult>(5, "tools/call", {
        name: "probe",
        arguments: { target: "network" },
      })
      expect(text(network.result).startsWith("denied:")).toBe(true)
      expect(networkHits).toBe(0)

      // The launcher is bound to the connection scope: closing it removes the file even though
      // the config it produced is still referenced here.
      const launcher = wrapped.command[0]!
      await Effect.runPromise(Scope.close(scope, Exit.void))
      expect(existsSync(launcher)).toBe(false)
      expect(existsSync(path.dirname(launcher))).toBe(false)
    } finally {
      await Effect.runPromise(Scope.close(scope, Exit.void).pipe(Effect.ignore))
      if (child) {
        child.stdin.end()
        child.kill()
        await child.exited
      }
      await listener.stop(true)
      await rm(parent, { recursive: true, force: true })
    }
  },
)

type Completion = {
  stream?: boolean
  messages: ReadonlyArray<{ role: string; content?: unknown }>
}

function streamAnswer(content: string) {
  return streamResponse({ role: "assistant", content }, "stop")
}

function streamProbe(target: string) {
  return streamResponse(
    {
      tool_calls: [
        {
          index: 0,
          id: "call_probe",
          type: "function",
          function: { name: "probe_probe", arguments: JSON.stringify({ target }) },
        },
      ],
    },
    "tool_calls",
  )
}

function streamResponse(delta: Record<string, unknown>, finishReason: string) {
  const frames = [
    { choices: [{ index: 0, delta, finish_reason: null }] },
    { choices: [{ index: 0, delta: {}, finish_reason: finishReason }] },
  ]
  return new Response(
    frames
      .map(
        (frame) =>
          `data: ${JSON.stringify({
            id: "sandbox-mcp-fixture",
            object: "chat.completion.chunk",
            model: "chat",
            created: 1,
            ...frame,
          })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
}

type ProbeFixture = Awaited<ReturnType<typeof fixture>>

function probeEnv(input: {
  tmpdir: string
  inside: string
  outside: string
  port: number | undefined
  root: string
  marker: string
}) {
  return {
    TMPDIR: input.tmpdir,
    PROBE_INSIDE: input.inside,
    PROBE_OUTSIDE: input.outside,
    PROBE_PORT: String(input.port),
    PROBE_PID: path.join(input.root, "probe.pid"),
    PROBE_STARTUP: path.join(input.root, "probe.startup"),
    PROBE_SENTINEL: path.join(input.root, "probe.sentinel"),
    PROBE_MARKER: input.marker,
  }
}

function probeHostConfig(
  input: ProbeFixture,
  options: {
    enabled: boolean
    marker: string
    model: ReturnType<typeof Bun.serve>
    listener: ReturnType<typeof Bun.serve>
    serverPath: string
    probeTmp: string
    outside: string
  },
) {
  return JSON.stringify({
    model: "fixture/chat",
    permissions: [
      { action: "external_directory", resource: path.join(options.outside, "*"), effect: "allow" },
      { action: "shell", resource: "*", effect: "allow" },
      { action: "probe_probe", resource: "*", effect: "allow" },
    ],
    providers: {
      fixture: {
        package: "aisdk:@ai-sdk/openai-compatible",
        settings: { baseURL: `http://127.0.0.1:${options.model.port}/v1`, apiKey: "fixture" },
        models: { chat: {} },
      },
    },
    mcp: {
      servers: {
        probe: {
          type: "local",
          codemode: false,
          ...(options.enabled ? {} : { disabled: true }),
          command: [process.execPath, options.serverPath],
          environment: probeEnv({
            tmpdir: options.probeTmp,
            inside: path.join(input.cwd, "inside.txt"),
            outside: path.join(options.outside, "outside.txt"),
            port: options.listener.port,
            root: input.cwd,
            marker: options.marker,
          }),
        },
      },
    },
  })
}

function launchProbeHost(input: ProbeFixture, config: string) {
  const child = Bun.spawn(
    [process.execPath, "--no-env-file", path.join(import.meta.dir, "../src/sandbox/interactive-fixture.ts")],
    {
      cwd: input.cwd,
      env: {
        ...input.env,
        KILO_SANDBOX_ROOT: input.cwd,
        KILO_SANDBOX_FIXTURE_CONFIG: config,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 120000,
    },
  )
  const errors = new Response(child.stderr).text()
  let stopped = false
  const stopChild = async () => {
    if (stopped) return
    child.kill("SIGTERM")
    await child.exited
    stopped = true
  }
  return { child, errors, stopChild }
}

async function openProbeClient(child: Bun.Subprocess<"ignore", "pipe", "pipe">, input: ProbeFixture) {
  const endpoint = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
  const password = (
    await Bun.file(path.join(input.env.XDG_STATE_HOME!, "kilo2/interactive/server.password")).text()
  ).trim()
  return OpenCode.make({
    baseUrl: endpoint.value,
    headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
  })
}

const waitConnected = async (
  client: ReturnType<typeof OpenCode.make>,
  directory: string,
  label: string,
): Promise<number> => {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const servers = (await client.mcp.list({ location: { directory } })).data
    const probe = servers.find((server) => server.name === "probe")
    if (probe?.status.status === "connected") {
      await Bun.sleep(500)
      return Number(await readFile(path.join(directory, "probe.pid"), "utf8"))
    }
    if (probe?.status.status === "failed") throw new Error(`probe failed: ${JSON.stringify(probe.status)}`)
    await Bun.sleep(250)
  }
  throw new Error(`probe never connected: ${label}`)
}

const waitPidDead = async (pid: number) => {
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
      await Bun.sleep(150)
    } catch {
      return
    }
  }
  throw new Error(`probe server pid ${pid} is still alive`)
}

const assertNoNewLaunchers = async (baseline: Set<string>, tmpdir: string) => {
  const leaked = (await readdir(tmpdir)).filter((entry) => entry.startsWith("kilo2-sandbox-") && !baseline.has(entry))
  expect(leaked).toEqual([])
}

const readStartup = async (root: string) =>
  (await readFile(path.join(root, "probe.startup"), "utf8")).startsWith("denied:")

// The gate is installed at the composition root (profile().overrides), so a cold
// `client.mcp.add` racing plugin activation still spawns through the gate: the first boot is
// confined, the sentinel reads denied, and a post-activation reload restarts confined again.
test.skipIf(!support.available)(
  "cold add on an activating location spawns the first boot confined (composition-root gate)",
  async () => {
    await using input = await fixture()
    const outside = path.join(input.directory, "outside")
    const probeTmp = path.join(input.cwd, "probe-tmp")
    await mkdir(outside, { recursive: true })
    await mkdir(probeTmp, { recursive: true })
    const serverPath = path.join(input.directory, "mcp-server.mjs")
    await Bun.write(serverPath, FIXTURE_SERVER)
    const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("unexpected")
      },
    })
    const host = launchProbeHost(
      input,
      probeHostConfig(input, {
        enabled: false,
        marker: "1",
        model: listener,
        listener,
        serverPath,
        probeTmp,
        outside,
      }),
    )
    const launcherBaseline = new Set(
      (await readdir(input.env.TMPDIR!)).filter((entry) => entry.startsWith("kilo2-sandbox-")),
    )
    let client: ReturnType<typeof OpenCode.make> | undefined
    try {
      client = await openProbeClient(host.child, input)
      const location = { directory: input.cwd }
      // No awaitActivation here: the spawn must be confined regardless of activation state.
      await client.mcp.add({
        location,
        server: "probe",
        config: {
          type: "local",
          codemode: false,
          command: [process.execPath, serverPath],
          environment: probeEnv({
            tmpdir: probeTmp,
            inside: path.join(input.cwd, "inside.txt"),
            outside: path.join(outside, "outside.txt"),
            port: listener.port,
            root: input.cwd,
            marker: "1",
          }),
        },
      })
      const firstPid = await waitConnected(client, input.cwd, "immediate add")
      const sentinel = await readFile(path.join(input.cwd, "probe.sentinel"), "utf8")
      expect(sentinel.startsWith("denied:")).toBe(true)

      // Restarting the same path after activation completes stays confined with a fresh pid.
      await client.plugin.awaitActivation({ location })
      await client.mcp.add({
        location,
        server: "probe",
        config: {
          type: "local",
          codemode: false,
          command: [process.execPath, serverPath],
          environment: probeEnv({
            tmpdir: probeTmp,
            inside: path.join(input.cwd, "inside.txt"),
            outside: path.join(outside, "outside.txt"),
            port: listener.port,
            root: input.cwd,
            marker: "2",
          }),
        },
      })
      const secondPid = await waitConnected(client, input.cwd, "after activation")
      expect(secondPid).not.toBe(firstPid)
      expect(await readStartup(input.cwd)).toBe(true)

      await host.stopChild()
      await waitPidDead(firstPid)
      await waitPidDead(secondPid)
      await assertNoNewLaunchers(launcherBaseline, input.env.TMPDIR!)
    } finally {
      await host.stopChild()
      await listener.stop(true)
    }
  },
  120000,
)

// Direct-connect regression: `mcp.connect` starts a disabled local server unconditionally
// (core/src/mcp/index.ts, `connect` -> `startServer`), so the spawn-time gate must wrap it: the
// startup probe reads denied.
test.skipIf(!support.available)(
  "regression: direct mcp.connect on a disabled local server starts it confined",
  async () => {
    await using input = await fixture()
    const outside = path.join(input.directory, "outside")
    const probeTmp = path.join(input.cwd, "probe-tmp")
    await mkdir(outside, { recursive: true })
    await mkdir(probeTmp, { recursive: true })
    const serverPath = path.join(input.directory, "mcp-server.mjs")
    await Bun.write(serverPath, FIXTURE_SERVER)
    const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        return new Response("unexpected")
      },
    })
    const host = launchProbeHost(
      input,
      probeHostConfig(input, {
        enabled: false,
        marker: "1",
        model: listener,
        listener,
        serverPath,
        probeTmp,
        outside,
      }),
    )
    let client: ReturnType<typeof OpenCode.make> | undefined
    try {
      client = await openProbeClient(host.child, input)
      const location = { directory: input.cwd }
      await client.plugin.awaitActivation({ location })
      // The disabled server does not spawn on its own.
      const disabled = (await client.mcp.list({ location })).data.find((server) => server.name === "probe")
      expect(disabled?.status.status).toBe("disabled")
      expect(existsSync(path.join(input.cwd, "probe.pid"))).toBe(false)

      // The public connect overrides disabled and must land on the launcher.
      await client.mcp.connect({ location, server: "probe" })
      const pid = await waitConnected(client, input.cwd, "direct connect")
      expect(await readStartup(input.cwd)).toBe(true)

      await host.stopChild()
      await waitPidDead(pid)
    } finally {
      await host.stopChild()
      await listener.stop(true)
    }
  },
  120000,
)

// Enabled from initial config: the server boots during location startup through the
// composition-root gate, so no unconfined process ever runs, before or during activation.
test.skipIf(!support.available)(
  "interactive host confines an enabled-from-config MCP server before activation completes",
  async () => {
    await using input = await fixture()
    const outside = path.join(input.directory, "outside")
    const probeTmp = path.join(input.cwd, "probe-tmp")
    await mkdir(outside, { recursive: true })
    await mkdir(probeTmp, { recursive: true })
    const serverPath = path.join(input.directory, "mcp-server.mjs")
    await Bun.write(serverPath, FIXTURE_SERVER)
    let networkHits = 0
    const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        networkHits++
        return new Response("unexpected")
      },
    })
    const model = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body: Completion = await request.json()
        if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content: "fixture" } }] })
        if (body.messages.at(-1)?.role === "tool") return streamAnswer("Probe finished")
        const lastUser = [...body.messages].reverse().find((message) => message.role === "user")
        const prompt = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content)
        const target = prompt.includes("outside") ? "outside" : prompt.includes("network") ? "network" : "inside"
        return streamProbe(target)
      },
    })
    const launcherBaseline = new Set((await readdir(input.env.TMPDIR!)).filter((e) => e.startsWith("kilo2-sandbox-")))
    const host = launchProbeHost(
      input,
      probeHostConfig(input, {
        enabled: true,
        marker: "1",
        model,
        listener,
        serverPath: serverPath,
        probeTmp,
        outside,
      }),
    )
    let client: ReturnType<typeof OpenCode.make> | undefined
    let sessionID: string | undefined
    try {
      client = await openProbeClient(host.child, input)
      const location = { directory: input.cwd }
      await client.plugin.awaitActivation({ location })
      const plugins = (await client.plugin.list({ location })).data
      expect(plugins.find((plugin) => plugin.id === "kilo2.sandbox")).toMatchObject({ state: { status: "active" } })
      // The server boots with the initial config, during location startup. Its exclusive sentinel
      // is written by whichever boot ran first and records that boot's own outside-root write
      // attempt: if any unconfined spawn beat the confined ones, the sentinel says "wrote".
      const pid = await waitConnected(client, input.cwd, "enabled-from-config")
      const sentinel = await readFile(path.join(input.cwd, "probe.sentinel"), "utf8")
      expect(sentinel.startsWith("denied:")).toBe(true)

      const session = await client.session.create({
        location: { directory: input.cwd },
        model: { providerID: "fixture", id: "chat" },
      })
      sessionID = session.id
      await client.session.prompt({ sessionID: session.id, text: "Probe inside" })
      await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(20000) })
      expect(await readFile(path.join(input.cwd, "inside.txt"), "utf8")).toBe("inside-written")

      await host.stopChild()
      await waitPidDead(pid)
      await assertNoNewLaunchers(launcherBaseline, input.env.TMPDIR!)
    } catch (error) {
      const messages = await client?.message
        .list({ sessionID: sessionID ?? "" })
        .then((data) => JSON.stringify(data))
        .catch((cause) => `message list failed: ${String(cause)}`)
      await host.stopChild()
      const stderr = await host.errors
      throw new Error(`${String(error)}\nmessages: ${messages}\n${stderr}`, { cause: error })
    } finally {
      await host.stopChild()
      await model.stop(true)
      await listener.stop(true)
    }
  },
  120000,
)

// Full lifecycle through the public client: disabled -> enabled via add (real reload/reconcile),
// model-driven probes, reload restart, and shutdown cleanup of per-connection launchers.
test.skipIf(!support.available)(
  "interactive host confines a configured local MCP server through launch and the public client",
  async () => {
    await using input = await fixture()
    const outside = path.join(input.directory, "outside")
    const probeTmp = path.join(input.cwd, "probe-tmp")
    await mkdir(outside, { recursive: true })
    await mkdir(probeTmp, { recursive: true })
    const serverPath = path.join(input.directory, "mcp-server.mjs")
    await Bun.write(serverPath, FIXTURE_SERVER)
    let networkHits = 0
    const listener = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch() {
        networkHits++
        return new Response("unexpected")
      },
    })
    const model = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        const body: Completion = await request.json()
        if (!body.stream) return Response.json({ choices: [{ message: { role: "assistant", content: "fixture" } }] })
        if (body.messages.at(-1)?.role === "tool") return streamAnswer("Probe finished")
        const lastUser = [...body.messages].reverse().find((message) => message.role === "user")
        const prompt = typeof lastUser?.content === "string" ? lastUser.content : JSON.stringify(lastUser?.content)
        const target = prompt.includes("outside") ? "outside" : prompt.includes("network") ? "network" : "inside"
        return streamProbe(target)
      },
    })
    const launcherBaseline = new Set(
      (await readdir(input.env.TMPDIR!)).filter((entry) => entry.startsWith("kilo2-sandbox-")),
    )
    const config = probeHostConfig(input, {
      enabled: false,
      marker: "1",
      model,
      listener,
      serverPath,
      probeTmp,
      outside,
    })
    const host = launchProbeHost(input, config)
    let client: ReturnType<typeof OpenCode.make> | undefined
    let sessionID: string | undefined
    try {
      client = await openProbeClient(host.child, input)
      const location = { directory: input.cwd }
      await client.plugin.awaitActivation({ location })
      const plugins = (await client.plugin.list({ location })).data
      expect(plugins.find((plugin) => plugin.id === "kilo2.sandbox")).toMatchObject({ state: { status: "active" } })

      // The configured server starts disabled, so nothing spawns at all.
      const disabled = (await client.mcp.list({ location })).data.find((server) => server.name === "probe")
      expect(disabled?.status.status).toBe("disabled")
      expect(existsSync(path.join(input.cwd, "probe.pid"))).toBe(false)

      // Enabling through the public API runs the real reload/reconcile pipeline.
      await client.mcp.add({
        location,
        server: "probe",
        config: {
          type: "local",
          codemode: false,
          command: [process.execPath, serverPath],
          environment: probeEnv({
            tmpdir: probeTmp,
            inside: path.join(input.cwd, "inside.txt"),
            outside: path.join(outside, "outside.txt"),
            port: listener.port,
            root: input.cwd,
            marker: "1",
          }),
        },
      })
      const firstPid = await waitConnected(client, input.cwd, "after add")
      // The server's own startup probe proves the first spawn was already confined.
      expect(await readStartup(input.cwd)).toBe(true)

      const session = await client.session.create({
        location: { directory: input.cwd },
        model: { providerID: "fixture", id: "chat" },
      })
      sessionID = session.id
      const api = client
      const runPrompt = async (prompt: string) => {
        await api.session.prompt({ sessionID: session.id, text: prompt })
        await api.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(20000) })
      }

      await runPrompt("Probe inside")
      expect(await readFile(path.join(input.cwd, "inside.txt"), "utf8")).toBe("inside-written")

      await runPrompt("Probe outside")
      await expect(readFile(path.join(outside, "outside.txt"), "utf8")).rejects.toThrow()

      await runPrompt("Probe network")
      expect(networkHits).toBe(0)

      // A config reload with a changed environment restarts the server with a fresh
      // connection-scoped launcher and keeps it confined.
      await client.mcp.add({
        location,
        server: "probe",
        config: {
          type: "local",
          codemode: false,
          command: [process.execPath, serverPath],
          environment: probeEnv({
            tmpdir: probeTmp,
            inside: path.join(input.cwd, "inside.txt"),
            outside: path.join(outside, "outside.txt"),
            port: listener.port,
            root: input.cwd,
            marker: "2",
          }),
        },
      })
      const secondPid = await waitConnected(client, input.cwd, "after reload")
      expect(secondPid).not.toBe(firstPid)
      expect(await readStartup(input.cwd)).toBe(true)
      expect(await readFile(path.join(input.cwd, "inside.txt"), "utf8")).toBe("inside-written")

      // Shutdown with the server child live: host teardown stops the child and releases every
      // connection-scoped launcher it created.
      await host.stopChild()
      await waitPidDead(firstPid)
      await waitPidDead(secondPid)
      await assertNoNewLaunchers(launcherBaseline, input.env.TMPDIR!)
    } catch (error) {
      const messages = await client?.message
        .list({ sessionID: sessionID ?? "" })
        .then((data) => JSON.stringify(data))
        .catch((cause) => `message list failed: ${String(cause)}`)
      await host.stopChild()
      const stderr = await host.errors
      throw new Error(`${String(error)}\nmessages: ${messages}\n${stderr}`, { cause: error })
    } finally {
      await host.stopChild()
      await model.stop(true)
      await listener.stop(true)
    }
  },
  120000,
)

type ToolResult = { content?: ReadonlyArray<{ text?: string }> }

const text = (result: ToolResult) => result.content?.[0]?.text ?? ""

function startClient(child: Bun.Subprocess<"pipe", "pipe", "pipe">) {
  const pending = new Map<number, (message: unknown) => void>()
  const decoder = new TextDecoder()
  let buffer = ""
  const reader = child.stdout.getReader()
  ;(async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      let index = buffer.indexOf("\n")
      while (index !== -1) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        index = buffer.indexOf("\n")
        if (!line.trim()) continue
        const message = JSON.parse(line) as { id?: number }
        if (message.id === undefined) continue
        const resolve = pending.get(message.id)
        if (!resolve) continue
        pending.delete(message.id)
        resolve(message)
      }
    }
  })()
  return {
    notify: (method: string, params: Record<string, unknown>) => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`)
      child.stdin.flush()
    },
    request: <T>(id: number, method: string, params: Record<string, unknown>): Promise<{ result: T }> => {
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
      child.stdin.flush()
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`timed out waiting for ${method}`))
        }, 15000)
        pending.set(id, (message) => {
          clearTimeout(timer)
          resolve(message as { result: T })
        })
      })
    },
  }
}

const FIXTURE_SERVER = `
import { createInterface } from "node:readline"
import { writeFileSync } from "node:fs"
const denied = (error) => "denied:" + (error?.cause?.code ?? error.code ?? error.message)
const startup = (() => {
  try {
    writeFileSync(process.env.PROBE_OUTSIDE, "startup-wrote")
    return "wrote"
  } catch (error) {
    return denied(error)
  }
})()
writeFileSync(process.env.PROBE_PID, String(process.pid))
writeFileSync(process.env.PROBE_STARTUP, startup)
try {
  writeFileSync(process.env.PROBE_SENTINEL, startup + " pid=" + process.pid, { flag: "wx" })
} catch (error) {
  if (error.code !== "EEXIST") throw error
}
const respond = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\\n")
const probe = async (args) => {
  const target = args?.target
  if (target === "inside") {
    try {
      writeFileSync(process.env.PROBE_INSIDE, "inside-written")
      return "wrote-inside"
    } catch (error) {
      return denied(error)
    }
  }
  if (target === "outside") {
    try {
      writeFileSync(process.env.PROBE_OUTSIDE, "outside-written")
      return "wrote-outside"
    } catch (error) {
      return denied(error)
    }
  }
  if (target === "network") {
    try {
      const response = await fetch("http://127.0.0.1:" + process.env.PROBE_PORT + "/", { signal: AbortSignal.timeout(3000) })
      await response.arrayBuffer()
      return "connected"
    } catch (error) {
      return denied(error)
    }
  }
  return "unknown-target"
}
createInterface({ input: process.stdin }).on("line", async (line) => {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch {
    return
  }
  if (message.id === undefined || message.id === null) return
  if (message.method === "initialize") {
    return respond(message.id, {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "probe", version: "0.0.0" },
    })
  }
  if (message.method === "tools/list") {
    return respond(message.id, {
      tools: [
        {
          name: "probe",
          description: "probe",
          inputSchema: {
            type: "object",
            properties: { target: { type: "string", enum: ["inside", "outside", "network"] } },
            required: ["target"],
          },
        },
      ],
    })
  }
  if (message.method === "tools/call") {
    return respond(message.id, { content: [{ type: "text", text: await probe(message.params?.arguments) }] })
  }
  return respond(message.id, {})
})
`
