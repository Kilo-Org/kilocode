import { expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { createKiloClient, type Event, type KiloClient } from "@kilocode/sdk/v2"
import path from "node:path"
import { mkdir } from "node:fs/promises"
import { pathToFileURL } from "node:url"
import { cliIt, type CliFixture } from "../lib/cli-process"
import { awaitWithTimeout } from "../lib/effect"
import { reply } from "../lib/llm-server"
import { testProviderConfig } from "../lib/test-provider"

function gate() {
  const deferred = Promise.withResolvers<void>()
  return {
    promise: deferred.promise,
    open: () => deferred.resolve(),
    wait: (label: string) =>
      awaitWithTimeout(
        Effect.promise(() => deferred.promise),
        label,
        "30 seconds",
      ),
  }
}

function environment(home: string, url: string, opts: { plugin?: string; resume?: boolean; daemon?: boolean } = {}) {
  const base = testProviderConfig(url)
  const model = base.provider.test.models["test-model"]
  const cfg = {
    ...base,
    model: "test/parent",
    small_model: "test/parent",
    enabled_providers: ["test"],
    share: "disabled",
    snapshot: false,
    sandbox: { enabled: false },
    permission: { "*": "allow" },
    plugin: opts.plugin ? [opts.plugin] : [],
    agent: {
      code: { model: "test/parent" },
      general: { model: "test/child" },
      title: { disable: true },
    },
    provider: {
      test: {
        ...base.provider.test,
        models: {
          parent: { ...model, id: "parent", name: "Parent" },
          child: { ...model, id: "child", name: "Child" },
        },
      },
    },
  }
  return {
    PWD: home,
    KILO_CONFIG_CONTENT: JSON.stringify(cfg),
    KILO_CONFIG: "",
    KILO_CONFIG_DIR: "",
    KILO_DB: opts.resume ? path.join(home, "resume.db") : ":memory:",
    KILO_AUTH_CONTENT: "{}",
    KILO_SERVER_PASSWORD: "",
    KILO_SERVER_USERNAME: "kilo",
    KILO_PURE: "false",
    KILO_DISABLE_DEFAULT_PLUGINS: "true",
    KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true",
    KILO_TELEMETRY_LEVEL: "off",
    KILO_AUTO_SHARE: "false",
    KILO_NO_DAEMON: opts.daemon ? "" : "1",
    KILO_PARENT_PID: "",
    KILO_TEST_DAEMON_STATE_DIR: path.join(home, "daemon-state"),
    KILO_TEST_DAEMON_LOG_DIR: path.join(home, "daemon-log"),
  }
}

function drain(client: KiloClient, id: string, timeout = 30_000) {
  return client.kilocode.drainSession(
    { sessionID: id, token: crypto.randomUUID() },
    { throwOnError: true, signal: AbortSignal.timeout(timeout) },
  )
}

function pending(client: KiloClient, id: string) {
  return Effect.promise(() => drain(client, id, 1_000).catch((err: unknown) => err))
}

function observer(url: string, busy: boolean) {
  const sdk = pathToFileURL(path.resolve(import.meta.dir, "../../../sdk/js/src/v2/index.ts")).href
  return `import { createKiloClient } from ${JSON.stringify(sdk)}
  export default async ({ client: legacy }) => {
    const cfg = legacy._client.getConfig()
    const client = createKiloClient({ ...cfg, headers: Object.fromEntries(new Headers(cfg.headers)) })
    const abort = new AbortController()
    const ready = Promise.withResolvers()
    let root
    let pump
    return {
      "chat.message": async (input) => {
        if (root) return
        root = input.sessionID
        const events = await client.event.subscribe(undefined, { signal: abort.signal, sseMaxRetryAttempts: 1, onSseError: (error) => { console.error(error); ready.reject(error) } })
        pump = (async () => {
          let observed
          try {
            for await (const event of events.stream) {
              if (event.type === "server.connected") {
                ready.resolve()
                continue
              }
              if (event.type === "server.instance.disposed") break
              if (event.properties?.sessionID !== root) continue
              if (event.type === "session.error") break
              const matched = ${busy}
                ? event.type === "session.queue.changed" && event.properties.queued.length > 0
                : event.type === "session.status" && event.properties.status.type === "idle"
              if (!matched) continue
              observed = event
              break
            }
          } finally {
            abort.abort()
          }
          if (!observed) return
          const response = await fetch(${JSON.stringify(`${url}/events`)}, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(observed),
          })
          if (!response.ok) throw new Error("event relay failed")
        })().catch((error) => {
          ready.reject(error)
          if (!abort.signal.aborted) console.error(error)
        }).finally(() => ready.reject(new Error("event relay ended")))
        await ready.promise
      },
      dispose: async () => { abort.abort(); await pump },
    }
  }`
}

function probe(home: string, mode: "foreground" | "busy" | "idle" | "intake") {
  return Effect.gen(function* () {
    const entered = gate()
    const release = gate()
    const queued = gate()
    const idle = gate()
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          idleTimeout: 0,
          async fetch(request) {
            const pathname = new URL(request.url).pathname
            if (pathname === "/tool") {
              entered.open()
              await release.promise
              return new Response("PARENT_TOOL_DONE")
            }
            if (pathname === "/events") {
              const event = (await request.json()) as Event
              if (event.type === "session.queue.changed" && event.properties.queued.length > 0) queued.open()
              if (event.type === "session.status" && event.properties.status.type === "idle") idle.open()
              return new Response(null, { status: 204 })
            }
            return new Response("unexpected request", { status: 404 })
          },
        }),
      ),
      (server) =>
        Effect.promise(async () => {
          release.open()
          await server.stop(true)
        }),
    )
    const url = `http://127.0.0.1:${server.port}`
    const file = path.join(home, "drain-observer.mjs")
    const plugin =
      mode === "intake"
        ? `export default async () => ({ "chat.message": async () => { const response = await fetch(${JSON.stringify(`${url}/tool`)}); if (!response.ok) throw new Error("intake gate failed") } })`
        : observer(url, mode === "busy")
    yield* Effect.promise(() => Bun.write(file, plugin))
    return { url, plugin: pathToFileURL(file).href, entered, release, queued, idle }
  })
}

function scenario(
  { home, llm, opencode }: CliFixture,
  mode: "foreground" | "busy" | "idle",
  opts: { attach?: boolean; resume?: boolean; daemon?: boolean; abort?: boolean; scope?: "session" } = {},
) {
  return Effect.gen(function* () {
    const directory = opts.resume ? path.join(home, "session") : home
    if (opts.resume) yield* Effect.promise(() => mkdir(directory))
    const tap = yield* probe(home, mode)
    const child = gate()
    const requested = gate()
    yield* Effect.addFinalizer(() => Effect.sync(child.open))
    const script = `const r = await fetch(${JSON.stringify(`${tap.url}/tool`)}); if (!r.ok) throw new Error("tool gate failed"); console.log(await r.text())`
    const scriptPath = path.join(home, "parent-gate.mjs")
    yield* Effect.promise(() => Bun.write(scriptPath, script))
    yield* llm.pushMatch(
      ({ body }) => body.model === "parent",
      reply().tool("task", {
        description: "Produce background result",
        prompt: "Produce the requested result.",
        subagent_type: "general",
        background: mode !== "foreground",
      }),
      ...(mode === "foreground"
        ? []
        : [
            mode === "busy"
              ? reply().tool("bash", {
                  command: `bun ${JSON.stringify(scriptPath.replaceAll("\\", "/"))}`,
                  description: "Wait for the test request gate",
                })
              : reply().text("WAITING_FOR_CHILD").stop(),
          ]),
      reply().text("FINAL_AFTER_CHILD").stop(),
    )
    yield* llm.pushMatch(({ body }) => {
      if (body.model !== "child") return false
      requested.open()
      return true
    }, reply().wait(child.promise).text("CHILD_RESULT_SENTINEL").stop())
    if (mode === "foreground") child.open()
    const env = environment(home, llm.url, { ...opts, plugin: mode === "foreground" ? undefined : tap.plugin })
    const server = opts.attach || opts.resume ? yield* opencode.serve({ env, readyTimeoutMs: 30_000 }) : undefined
    const session =
      (opts.resume || opts.abort) && server
        ? yield* Effect.promise(() =>
            createKiloClient({ baseUrl: server.url, directory }).session.create({}, { throwOnError: true }),
          )
        : undefined
    if (opts.daemon) {
      yield* Effect.addFinalizer(() =>
        opencode
          .spawn(["daemon", "stop", "--json"], { env })
          .pipe(Effect.tap((result) => Effect.sync(() => opencode.expectExit(result, 0)))),
      )
      const result = yield* opencode.spawn(["daemon", "start", "--hostname", "127.0.0.1", "--port", "0", "--json"], {
        env,
      })
      opencode.expectExit(result, 0)
      expect(JSON.parse(result.stdout).running).toBe(true)
    }
    const run = yield* opencode.startRun("Exercise background completion.", {
      model: "test/parent",
      agent: "code",
      format: "json",
      printLogs: true,
      extraArgs: [
        "--auto",
        "--dir",
        home,
        "--title",
        "drain regression",
        ...(opts.attach && server ? ["--attach", server.url] : []),
        ...(session ? ["--session", session.data.id] : []),
      ],
      env: opts.daemon ? { ...env, KILO_DB: path.join(home, "unused.db") } : env,
    })
    yield* Effect.raceFirst(
      requested.wait("child never reached the mock LLM"),
      run.result.pipe(
        Effect.flatMap((result) =>
          Effect.fail(new Error(`CLI exited before child request: ${JSON.stringify(result)}`)),
        ),
      ),
    )
    if (mode === "busy") {
      yield* tap.entered.wait("parent never entered the held tool")
      child.open()
      yield* tap.queued.wait("child callback was not queued")
      tap.release.open()
    }
    if (mode === "idle") {
      yield* tap.idle.wait("parent never became idle")
      if (!opts.abort) child.open()
    }
    if (opts.abort) {
      if (!server || !session) throw new Error("Abort scenario requires an attached session")
      const client = createKiloClient({ baseUrl: server.url, directory })
      const controller = new AbortController()
      yield* Effect.addFinalizer(() => Effect.sync(() => controller.abort()))
      const ready = gate()
      const token = crypto.randomUUID()
      const stream = yield* Effect.promise(() =>
        client.event.subscribe(undefined, { signal: controller.signal, sseMaxRetryAttempts: 1 }),
      )
      const received = yield* Effect.promise(async () => {
        const signals: string[] = []
        for await (const event of stream.stream) {
          if (event.type === "server.connected") ready.open()
          if (
            (event.type === "session.drain.interrupted" ||
              (event.type === "session.turn.close" && event.properties.reason === "interrupted")) &&
            event.properties.sessionID === session.data.id
          )
            signals.push(event.type)
          if (event.type === "session.drained" && event.properties.token === token) return signals
        }
        throw new Error("Cancellation event stream ended before the barrier")
      }).pipe(Effect.forkChild)
      yield* ready.wait("Cancellation event stream did not connect")
      const aborted = yield* Effect.promise(() =>
        client.session.abort({ sessionID: session.data.id, scope: opts.scope }, { throwOnError: true }),
      )
      expect(aborted.data).toBe(true)
      if (opts.scope === "session") {
        const result = yield* awaitWithTimeout(run.result, "CLI did not report the stopped parent", "45 seconds")
        expect(result.exitCode).not.toBe(0)
        const status = yield* Effect.promise(() => client.session.status({}, { throwOnError: true }))
        expect(Object.values(status.data).some((entry) => entry.type === "busy")).toBe(true)
        child.open()
      }
      yield* Effect.promise(() =>
        client.kilocode.drainSession({ sessionID: session.data.id, token }, { throwOnError: true }),
      )
      expect(yield* awaitWithTimeout(Fiber.join(received), "Cancellation barrier was not delivered")).toEqual([
        "session.drain.interrupted",
      ])
    }
    const result = yield* awaitWithTimeout(run.result, "CLI did not drain and exit", "45 seconds")
    if (opts.abort) {
      expect(result.exitCode).not.toBe(0)
      expect(result.stdout).toContain("WAITING_FOR_CHILD")
      expect(result.stdout).not.toContain("FINAL_AFTER_CHILD")
      expect(yield* llm.pending).toBe(1)
      return
    }
    opencode.expectExit(result, 0)
    const events = opencode.parseJsonEvents(result.stdout)
    const texts = events.filter((event) => event.type === "text").map((event) => (event.part as { text: string }).text)
    expect(texts.filter((text) => text === "FINAL_AFTER_CHILD")).toHaveLength(1)
    expect(events.some((event) => event.type === "error")).toBe(false)
    const inputs = yield* llm.inputs
    const parents = inputs.filter((input) => input.model === "parent")
    expect(parents).toHaveLength(mode === "foreground" ? 2 : 3)
    expect(inputs.filter((input) => input.model === "child")).toHaveLength(1)
    expect(JSON.stringify(parents.at(-1))).toContain("CHILD_RESULT_SENTINEL")
    if (mode !== "foreground") expect(JSON.stringify(parents.at(-1))).toContain("Background task completed")
    if (mode === "busy") expect(JSON.stringify(parents.at(-1))).toContain("PARENT_TOOL_DONE")
    expect(yield* llm.pending).toBe(0)
  })
}

for (const [name, mode, opts] of [
  ["foreground Task completes before headless exit", "foreground", {}],
  ["headless run drains a child callback queued behind a busy parent", "busy", {}],
  ["headless run waits for a child after the parent becomes idle", "idle", {}],
  ["attached run drains a callback queued behind the parent", "busy", { attach: true }],
  ["attached run waits for a child after the parent becomes idle", "idle", { attach: true }],
  [
    "attached run fails when the idle parent is aborted with a child still running",
    "idle",
    { attach: true, abort: true },
  ],
  [
    "attached run fails when only the idle parent is stopped and its child continues",
    "idle",
    { attach: true, abort: true, scope: "session" },
  ],
  ["local run resumes and drains a session from another directory", "busy", { resume: true }],
  ["attached run resumes and drains a session from another directory", "idle", { attach: true, resume: true }],
  ["daemon run resumes and drains a session from another directory", "idle", { daemon: true, resume: true }],
] as const) {
  cliIt.live(name, (fixture) => scenario(fixture, mode, opts), 90_000)
}

for (const [name, mode] of [
  ["SDK drain waits for accepted promptAsync intake and work", "intake"],
  ["SDK drain waits for summarize work after HTTP cancellation", "summary"],
] as const) {
  cliIt.live(
    name,
    ({ home, llm, opencode }) =>
      Effect.gen(function* () {
        const tap = mode === "intake" ? yield* probe(home, "intake") : undefined
        const release = gate()
        yield* Effect.addFinalizer(() => Effect.sync(release.open))
        const server = yield* opencode.serve({
          env: environment(home, llm.url, { plugin: tap?.plugin }),
          readyTimeoutMs: 30_000,
        })
        const client = createKiloClient({ baseUrl: server.url, directory: home })
        const session = yield* Effect.promise(() => client.session.create({}, { throwOnError: true }))
        const id = session.data.id
        const text = mode === "intake" ? "INTAKE_WORK_FINISHED" : "SUMMARY_AFTER_DISCONNECT"
        if (mode === "summary") {
          yield* llm.text("Seed response")
          yield* Effect.promise(() =>
            client.session.prompt(
              { sessionID: id, parts: [{ type: "text", text: "Seed the summary session" }] },
              { throwOnError: true },
            ),
          )
          yield* Effect.promise(() => drain(client, id))
        }
        yield* llm.hold(text, release.promise)
        if (tap) {
          const accepted = yield* Effect.promise(() =>
            client.session.promptAsync(
              { sessionID: id, parts: [{ type: "text", text: "Run admitted work" }] },
              { throwOnError: true },
            ),
          )
          expect(accepted.response.status).toBe(204)
          yield* tap.entered.wait("accepted prompt did not enter the intake hook")
          expect(yield* llm.calls).toBe(0)
          expect(yield* pending(client, id)).toMatchObject({ name: "TimeoutError" })
          tap.release.open()
          yield* awaitWithTimeout(llm.wait(1), "accepted prompt never reached the provider", "30 seconds")
        }
        if (mode === "summary") {
          const abort = new AbortController()
          yield* Effect.addFinalizer(() => Effect.sync(() => abort.abort()))
          const caller = client.session
            .summarize(
              { sessionID: id, providerID: "test", modelID: "parent", auto: false },
              { throwOnError: true, signal: abort.signal },
            )
            .then(
              () => undefined,
              (err: unknown) => err,
            )
          yield* awaitWithTimeout(llm.wait(2), "summary never reached the provider", "30 seconds")
          abort.abort()
          expect(yield* Effect.promise(() => caller)).toMatchObject({ name: "AbortError" })
          const status = yield* Effect.promise(() => client.session.status({}, { throwOnError: true }))
          expect(status.data[id]?.type).toBe("busy")
        }
        const waiting = yield* pending(client, id)
        release.open()
        const finished = yield* Effect.promise(() => drain(client, id))
        expect(waiting).toMatchObject({ name: "TimeoutError" })
        expect(finished.data).toBe(true)
        const messages = yield* Effect.promise(() => client.session.messages({ sessionID: id }, { throwOnError: true }))
        expect(JSON.stringify(messages.data)).toContain(text)
        expect(yield* llm.pending).toBe(0)
      }),
    90_000,
  )
}

cliIt.live(
  "SDK drain follows the session directory and validates acknowledgments",
  ({ home, opencode }) =>
    Effect.gen(function* () {
      const directory = path.join(home, "caller")
      yield* Effect.promise(() => mkdir(directory))
      const server = yield* opencode.serve({
        env: { KILO_SERVER_PASSWORD: "", KILO_SERVER_USERNAME: "kilo" },
        readyTimeoutMs: 30_000,
      })
      const sdk = createKiloClient({ baseUrl: server.url, directory: home })
      const session = yield* Effect.promise(() => sdk.session.create({}))
      if (!session.data) throw new Error("Session creation failed")
      const id = session.data.id
      const abort = new AbortController()
      yield* Effect.addFinalizer(() => Effect.sync(() => abort.abort()))
      const ready = gate()
      const token = crypto.randomUUID()
      const stream = yield* Effect.promise(() =>
        sdk.event.subscribe(undefined, { signal: abort.signal, sseMaxRetryAttempts: 1 }),
      )
      const received = yield* Effect.promise(async () => {
        for await (const event of stream.stream) {
          if (event.type === "server.connected") ready.open()
          if (event.type === "session.drained" && event.properties.token === token) return event.properties
        }
        throw new Error("Drain acknowledgment was not delivered")
      }).pipe(Effect.forkChild)
      yield* ready.wait("Event stream did not connect")
      const result = yield* Effect.promise(() => sdk.kilocode.drainSession({ sessionID: id, directory, token }))
      expect(result.data).toBe(true)
      expect(yield* awaitWithTimeout(Fiber.join(received), "Drain acknowledged the wrong directory")).toEqual({
        sessionID: id,
        token,
      })
      const invalid = yield* Effect.promise(() => sdk.kilocode.drainSession({ sessionID: id, token: "" }))
      expect(invalid.response?.status).toBe(400)
      const missing = yield* Effect.promise(() => sdk.kilocode.drainSession({ sessionID: "ses_missing_drain", token }))
      expect(missing.response?.status).toBe(404)
    }),
  90_000,
)
