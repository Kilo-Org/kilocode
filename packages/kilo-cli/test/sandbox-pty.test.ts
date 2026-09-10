import { expect, test } from "bun:test"
import { existsSync } from "node:fs"
import { readFile, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Effect, Exit, Layer } from "effect"
import { Pty } from "@opencode-ai/core/pty"
import { PersistentPty } from "@opencode-ai/core/persistent-pty"
import { Session } from "@opencode-ai/schema/session"
import { OpenCode } from "@opencode-ai/client"
import { sandboxSupport } from "../src/sandbox"
import { sandboxPersistentPtyRefusalLayer, sandboxPtyRefusalLayer } from "../src/sandbox-pty"
import { fixture, ready } from "./fixture"

const support = sandboxSupport()

test("sandbox pty refusal requires an enabled sandbox configuration", () => {
  expect(() => sandboxPtyRefusalLayer({ enabled: false })).toThrow("requires an enabled sandbox config")
})

test("refusal layer dies on create and passes non-spawning methods through", async () => {
  const inner = Pty.Service.of({
    list: () => Effect.succeed([]),
    get: () => Effect.die(new Error("unexpected get")),
    create: () => Effect.die(new Error("unexpected create")),
    update: () => Effect.die(new Error("unexpected update")),
    remove: () => Effect.die(new Error("unexpected remove")),
    write: () => Effect.die(new Error("unexpected write")),
    attach: () => Effect.die(new Error("unexpected attach")),
  })
  const program = Effect.gen(function* () {
    const pty = yield* Pty.Service
    const exit = yield* Effect.exit(
      pty.create({ command: process.execPath, args: ["-e", "throw new Error('must not run')"] }),
    )
    expect(Exit.isFailure(exit)).toBe(true)
    expect(yield* pty.list()).toEqual([])
  })
  await Effect.runPromise(
    Effect.provide(
      program,
      sandboxPtyRefusalLayer({ enabled: true, root: os.tmpdir() }).pipe(
        Layer.provide(Layer.succeed(Pty.Service, inner)),
      ),
    ),
  )
})

test("persistent refusal fails create through the declared UnavailableError channel and passes the rest through", async () => {
  const inner = PersistentPty.Service.of({
    list: () => Effect.succeed([]),
    get: () => Effect.die(new Error("unexpected get")),
    create: () => Effect.die(new Error("unexpected create")),
    write: () => Effect.die(new Error("unexpected write")),
    resize: () => Effect.die(new Error("unexpected resize")),
    control: () => Effect.die(new Error("unexpected control")),
    input: () => Effect.die(new Error("unexpected input")),
    snapshot: () => Effect.die(new Error("unexpected snapshot")),
    read: () => Effect.succeed(null),
    remove: () => Effect.die(new Error("unexpected remove")),
    shutdown: () => Effect.die(new Error("unexpected shutdown")),
    handoff: () => Effect.succeed(null),
    attach: () => Effect.die(new Error("unexpected attach")),
  })
  const program = Effect.gen(function* () {
    const pty = yield* PersistentPty.Service
    const error = yield* Effect.flip(
      pty.create(Session.ID.make("ses_0123456789abcdef"), {
        args: [],
        title: "probe",
        env: {},
      }),
    )
    expect(error._tag).toBe("PersistentPty.UnavailableError")
    expect(yield* pty.list()).toEqual([])
  })
  await Effect.runPromise(
    Effect.provide(
      program,
      sandboxPersistentPtyRefusalLayer({ enabled: true, root: os.tmpdir() }).pipe(
        Layer.provide(Layer.succeed(PersistentPty.Service, inner)),
      ),
    ),
  )
})

type Host = {
  child: Bun.Subprocess<"ignore", "pipe", "pipe">
  errors: Promise<string>
  stop: () => Promise<void>
}

function finishLaunch(child: Bun.Subprocess<"ignore", "pipe", "pipe">): Host {
  const errors = new Response(child.stderr).text()
  let stopped = false
  return {
    child,
    errors,
    stop: async () => {
      if (stopped) return
      child.kill("SIGTERM")
      await child.exited
      stopped = true
    },
  }
}

function launchStock(input: Awaited<ReturnType<typeof fixture>>, sentinel: string): Host {
  const child = Bun.spawn(
    [process.execPath, "--no-env-file", path.join(import.meta.dir, "interactive-fixture.ts")],
    {
      cwd: input.cwd,
      env: { ...input.env, KILO_PTY_SENTINEL: sentinel },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    },
  )
  return finishLaunch(child)
}

function launchSandbox(input: Awaited<ReturnType<typeof fixture>>, sentinel: string): Host {
  const child = Bun.spawn(
    [process.execPath, "--no-env-file", path.join(import.meta.dir, "../src/sandbox/interactive-fixture.ts")],
    {
      cwd: input.cwd,
      env: {
        ...input.env,
        KILO_SANDBOX_ROOT: input.cwd,
        KILO_SANDBOX_FIXTURE_CONFIG: "{}",
        KILO_PTY_SENTINEL: sentinel,
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 60000,
    },
  )
  return finishLaunch(child)
}

async function openClient(input: Awaited<ReturnType<typeof fixture>>, host: Host) {
  const listening = await ready(host.child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
  const password = (
    await Bun.file(path.join(input.env.XDG_STATE_HOME!, "kilo2/interactive/server.password")).text()
  ).trim()
  return OpenCode.make({
    baseUrl: listening.value,
    headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
  })
}

const waitFor = async (condition: () => boolean | Promise<boolean>, milliseconds = 8000) => {
  const started = Date.now()
  while (Date.now() - started < milliseconds) {
    if (await condition()) return
    await Bun.sleep(50)
  }
  throw new Error(`waitFor timed out after ${milliseconds}ms`)
}

const pidDead = async (pid: number) => {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}

// Stock host without --sandbox: the public pty.create path still spawns the requested command,
// the terminal is observable, and removing it tears the process down cleanly.
test("stock host without sandbox still creates session terminals", async () => {
  await using input = await fixture()
  const sentinel = path.join(input.cwd, "pty.sentinel")
  const host = launchStock(input, sentinel)
  let client: ReturnType<typeof OpenCode.make> | undefined
  try {
    client = await openClient(input, host)
    const location = { directory: input.cwd }
    const created = await client.pty.create({
      location,
      command: process.execPath,
      args: ["-e", `require('fs').writeFileSync(process.env.KILO_PTY_SENTINEL, 'spawned')`],
      title: "probe",
    })
    const info = created.data
    expect(info.status).toBe("running")
    expect(info.pid).toBeGreaterThan(0)
    await waitFor(() => existsSync(sentinel))
    expect(await readFile(sentinel, "utf8")).toBe("spawned")

    // Teardown: removing the session terminates its process.
    await client.pty.remove({ ptyID: info.id, location })
    await waitFor(() => pidDead(info.pid))

    // Positive control for the persistent surface: the TUI's new-terminal path
    // (experimental.persistentPty.create) spawns through the daemon on a stock host.
    const persistent = await client.experimental.persistentPty.create({
      sessionID: "ses_0123456789abcdef",
      command: process.execPath,
      args: ["-e", `require('fs').writeFileSync(process.env.KILO_PTY_SENTINEL, 'spawned')`],
      cwd: input.cwd,
      title: "persistent probe",
      env: {},
    })
    await waitFor(() => existsSync(sentinel))
    await client.experimental.persistentPty.remove({ ptyID: persistent.id })
    await waitFor(() => pidDead(persistent.pid))
  } finally {
    await host.stop()
    await rm(sentinel, { force: true })
  }
})

// Sandbox host: pty.create is refused before any spawn (the sentinel stays absent) for an
// explicit command and for the default shell, and the host shuts down cleanly afterwards.
test.skipIf(!support.available)(
  "sandbox host refuses session terminal creation and spawns nothing",
  async () => {
    await using input = await fixture()
    const sentinel = path.join(input.cwd, "pty.sentinel")
    const host = launchSandbox(input, sentinel)
    let client: ReturnType<typeof OpenCode.make> | undefined
    try {
      client = await openClient(input, host)
      const location = { directory: input.cwd }
      const refused = await client.pty
        .create({
          location,
          command: process.execPath,
          args: ["-e", `require('fs').writeFileSync(process.env.KILO_PTY_SENTINEL, 'spawned')`],
          title: "probe",
        })
        .then(
          () => null,
          (error: unknown) => error,
        )
      expect(refused).not.toBeNull()
      const refusedDefault = await client.pty.create({ location }).then(
        () => null,
        (error: unknown) => error,
      )
      expect(refusedDefault).not.toBeNull()
      // The TUI's new-terminal path goes through the experimental persistent surface; its
      // create is refused through the declared UnavailableError channel (HTTP 503) before the
      // daemon is touched, so no process runs here either.
      const persistentRefused = await client.experimental.persistentPty
        .create({
          sessionID: "ses_0123456789abcdef",
          command: process.execPath,
          args: ["-e", `require('fs').writeFileSync(process.env.KILO_PTY_SENTINEL, 'spawned')`],
          cwd: input.cwd,
          title: "probe",
          env: {},
        })
        .then(
          () => null,
          (error: unknown) => error,
        )
      expect(persistentRefused).not.toBeNull()
      await Bun.sleep(500)
      expect(existsSync(sentinel)).toBe(false)
      expect(await client.pty.list({ location })).toMatchObject({ data: [] })
    } finally {
      await host.stop()
      await rm(sentinel, { force: true })
    }
  },
  60000,
)
