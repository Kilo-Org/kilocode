import { expect } from "bun:test"
import { Effect, Fiber } from "effect"
import { createKiloClient, type Event } from "@kilocode/sdk/v2"
import path from "node:path"
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

function observer(url: string, busy: boolean) {
  const sdk = pathToFileURL(path.resolve(import.meta.dir, "../../../sdk/js/src/v2/index.ts")).href
  return `import { createKiloClient } from ${JSON.stringify(sdk)}
  export default async ({ client: legacy }) => {
    const client = createKiloClient(legacy._client.getConfig())
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

function probe(home: string, busy: boolean) {
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
    yield* Effect.promise(() => Bun.write(file, observer(url, busy)))
    return { url, plugin: pathToFileURL(file).href, entered, release, queued, idle }
  })
}

function scenario({ home, llm, opencode }: CliFixture, mode: "foreground" | "busy" | "idle", attached = false) {
  return Effect.gen(function* () {
    const tap = yield* probe(home, mode === "busy")
    const child = gate()
    const requested = gate()
    yield* Effect.addFinalizer(() => Effect.sync(child.open))
    const base = testProviderConfig(llm.url)
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
      plugin: mode === "foreground" ? [] : [tap.plugin],
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
    const script = `const r = await fetch(${JSON.stringify(`${tap.url}/tool`)}); if (!r.ok) throw new Error("tool gate failed"); console.log(await r.text())`
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
                  command: `bun -e ${JSON.stringify(script)}`,
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
    const env = {
      PWD: home,
      KILO_CONFIG_CONTENT: JSON.stringify(cfg),
      KILO_CONFIG: "",
      KILO_CONFIG_DIR: "",
      KILO_DB: ":memory:",
      KILO_AUTH_CONTENT: "{}",
      KILO_SERVER_PASSWORD: "",
      KILO_SERVER_USERNAME: "kilo",
      KILO_PURE: "false",
      KILO_DISABLE_DEFAULT_PLUGINS: "true",
      KILO_EXPERIMENTAL_BACKGROUND_SUBAGENTS: "true",
      KILO_TELEMETRY_LEVEL: "off",
      KILO_AUTO_SHARE: "false",
    }
    const server = attached ? yield* opencode.serve({ env, readyTimeoutMs: 30_000 }) : undefined
    const run = yield* opencode.startRun("Exercise background completion.", {
      model: "test/parent",
      agent: "code",
      format: "json",
      printLogs: true,
      extraArgs: ["--auto", "--dir", home, "--title", "drain regression", ...(server ? ["--attach", server.url] : [])],
      env,
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
      child.open()
    }
    const result = yield* awaitWithTimeout(run.result, "CLI did not drain and exit", "45 seconds")
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

cliIt.live("foreground Task completes before headless exit", (fixture) => scenario(fixture, "foreground"), 90_000)
cliIt.live(
  "headless run drains a child callback queued behind a busy parent",
  (fixture) => scenario(fixture, "busy"),
  90_000,
)
cliIt.live(
  "headless run waits for a child after the parent becomes idle",
  (fixture) => scenario(fixture, "idle"),
  90_000,
)
cliIt.live(
  "attached run drains a callback queued behind the parent",
  (fixture) => scenario(fixture, "busy", true),
  90_000,
)
cliIt.live(
  "attached run waits for a child after the parent becomes idle",
  (fixture) => scenario(fixture, "idle", true),
  90_000,
)

cliIt.live(
  "SDK drain validates requests and publishes its matching acknowledgment",
  ({ home, opencode }) =>
    Effect.gen(function* () {
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
      const result = yield* Effect.promise(() => sdk.kilocode.drainSession({ sessionID: id, token }))
      expect(result.data).toBe(true)
      expect(yield* Fiber.join(received)).toEqual({ sessionID: id, token })
      const invalid = yield* Effect.promise(() => sdk.kilocode.drainSession({ sessionID: id, token: "" }))
      expect(invalid.response?.status).toBe(400)
      const missing = yield* Effect.promise(() => sdk.kilocode.drainSession({ sessionID: "ses_missing_drain", token }))
      expect(missing.response?.status).toBe(404)
    }),
  90_000,
)
