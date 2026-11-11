import { expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { LanguageModel } from "@opencode/ai/effect"
import { OpenAIChat } from "@opencode/ai/protocols"
import { TestLLM } from "@opencode/ai/testing"
import { OpenCode } from "@opencode/client"
import { LayerNodePlatform } from "@opencode/core/effect/app-node-platform"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { KiloSessionDrainRpc } from "@opencode/schema/kilocode/session-drain"
import { createRoutes } from "@opencode/server/routes"
import { Context, Deferred, Effect, Layer, References, Stream } from "effect"
import { HttpEffect, HttpRouter, HttpServer } from "effect/http"
import { mkdtemp, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { KiloHost } from "../src/host"
import { KiloRunDrain } from "../src/run-drain"
import { hostMirrorsPlugin } from "../src/mirrors"

type Env = {
  readonly client: ReturnType<typeof OpenCode.make>
  readonly location: { readonly directory: string }
  readonly llm: Context.Service.Shape<typeof TestLLM.Test>
  readonly run: <A>(effect: Effect.Effect<A>) => Promise<A>
}

// The session drain end to end: the contract in @opencode/schema, the handler in the session-drain plugin, the plugin
// registered by the host overrides, and the call through the generated client's `rpc` entry point. A scripted model
// stands in for the provider, and a local stand-in for the Kilo API answers the Gateway.
const boot = (body: (env: Env) => Promise<void>) => async () => {
  using backend = fixture()
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-drain-"))
  await Bun.write(
    path.join(directory, "kilo2.json"),
    JSON.stringify({
      agents: { reviewer: { mode: "subagent", system: "DRAIN_CHILD" } },
      permissions: [{ action: "*", resource: "*", effect: "allow" }],
    }),
  )
  const variables = { ...signedOut, KILO_API_URL: backend.url }
  const previous = Object.fromEntries(Object.keys(variables).map((key) => [key, process.env[key]]))
  apply(variables)
  try {
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const model = yield* Layer.build(TestLLM.testLayer())
          const context = yield* Layer.build(
            createRoutes(
              {
                password: "secret",
                database: { path: ":memory:" },
                models: { fetch: false },
                fs: { filewatcher: false },
                config: { directory, project: false },
              },
              () => [],
              [
                ...KiloHost.overrides,
                LayerNodePlatform.llmClient.replace(Layer.succeedContext(model)),
                SessionRunnerModel.node.replace(
                  Layer.succeed(SessionRunnerModel.Service, {
                    resolve: () =>
                      Effect.succeed(
                        SessionRunnerModel.resolved(
                          LanguageModel.make({ id: "drain", provider: "test", route: OpenAIChat.route }),
                          {
                            capabilities: { tools: true, input: ["text"], output: ["text"] },
                            cost: [],
                            limit: { context: 200_000, output: 32_000 },
                          },
                        ),
                      ),
                  }),
                ),
              ],
            ).pipe(Layer.provide(HttpServer.layerServices)),
          )
          const handler = Context.get(context, HttpRouter.HttpRouter)
            .asHttpEffect()
            .pipe(HttpEffect.toWebHandlerWith(context))
          const client = OpenCode.make({
            baseUrl: "http://kilo.local",
            headers: { authorization: `Basic ${btoa("opencode:secret")}` },
            fetch: Object.assign(
              async (input: string | URL | Request, init?: RequestInit) =>
                handler(input instanceof Request ? input : new Request(input, init)),
              { preconnect: fetch.preconnect },
            ),
          })
          const run = Effect.runPromiseWith(yield* Effect.context<never>())
          yield* Effect.promise(() =>
            body({ client, location: { directory }, llm: Context.get(model, TestLLM.Test), run }),
          )
        }),
      ).pipe(Effect.provideService(References.MinimumLogLevel, "Warn")),
    )
  } finally {
    apply(previous)
    // Shell removal precedes scoped process teardown, which can briefly retain Windows directory handles.
    await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
  }
}

const signedOut = {
  KILO_API_KEY: undefined,
  KILOCODE_TOKEN: undefined,
  KILO_AUTH_CONTENT: undefined,
  KILO_ORG_ID: undefined,
  KILO_AI_GATEWAY_URL: undefined,
}

function apply(variables: Record<string, string | undefined>) {
  Object.entries(variables).forEach(([key, value]) => {
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  })
}

const session = (env: Env) =>
  env.client.session.create({
    location: env.location,
    title: "Drain",
    agent: "build",
    model: { providerID: "test", id: "drain" },
  })

/** A reply that streams only after `gate` opens. */
const held = (gate: Deferred.Deferred<void>, text: string) =>
  Stream.fromEffect(Deferred.await(gate)).pipe(Stream.flatMap(() => Stream.fromIterable(TestLLM.text(text, text))))

/** Settles with "pending" while the promise has not settled after the server had time to act on it. */
const state = (promise: Promise<unknown>) =>
  Promise.race([
    promise.then(
      () => "resolved",
      () => "rejected",
    ),
    Bun.sleep(100).then(() => "pending"),
  ])

const backgroundCommand = `node -e "const timer = setInterval(() => { if (require('node:fs').existsSync('release')) clearInterval(timer) }, 50)"`

test(
  "drains a session through the generated client and publishes the token event",
  boot(async (env) => {
    const created = await session(env)
    const rpc = env.client.rpc(KiloSessionDrainRpc.Definition)
    const controller = new AbortController()
    const events = env.client.event.subscribe({ signal: controller.signal })[Symbol.asyncIterator]()
    try {
      expect((await events.next()).value?.type).toBe("server.connected")
      const received = (async () => {
        for await (const event of { [Symbol.asyncIterator]: () => events }) {
          if (event.type === "rpc.kilocode.session-drain.drained") return event.data
        }
        throw new Error("Event stream disconnected before the token event")
      })()
      expect(await rpc.drain({ sessionID: created.id, token: "round-trip" }, { location: env.location })).toBe(true)
      expect(await received).toEqual({ sessionID: created.id, token: "round-trip" })
    } finally {
      controller.abort()
      await events.return?.(undefined)
    }
    expect(await rpc.drain({ sessionID: created.id }, { location: env.location })).toBe(true)
    await expect(rpc.drain({ sessionID: "ses_missing" }, { location: env.location })).rejects.toMatchObject({
      type: "not_found",
    })
    await expect(rpc.drain({ sessionID: created.id, token: "" }, { location: env.location })).rejects.toMatchObject({
      type: "rpc.invalid_input",
    })
  }),
  30_000,
)

test(
  "the headless wait resolves after the work and its acknowledgment",
  boot(async (env) => {
    const created = await session(env)
    const gate = await env.run(Deferred.make<void>())
    await env.run(env.llm.push(held(gate, "finished")))
    await env.client.session.prompt({ sessionID: created.id, text: "Work" })
    await env.run(env.llm.wait(1))
    const waiting = KiloRunDrain.wait({
      client: env.client,
      sessionID: created.id,
      location: env.location,
      signal: new AbortController().signal,
    })
    expect(await state(waiting)).toBe("pending")
    await env.run(Deferred.succeed(gate, undefined))
    await waiting
    expect(Object.keys(await env.client.session.active())).not.toContain(created.id)
  }),
  30_000,
)

test(
  "the headless wait fails when the session is interrupted",
  boot(async (env) => {
    const created = await session(env)
    await env.run(env.llm.push(Stream.never))
    await env.client.session.prompt({ sessionID: created.id, text: "Hang" })
    await env.run(env.llm.wait(1))
    const waiting = KiloRunDrain.wait({
      client: env.client,
      sessionID: created.id,
      location: env.location,
      signal: new AbortController().signal,
    })
    expect(await state(waiting)).toBe("pending")
    await env.client.session.interrupt({ sessionID: created.id })
    await expect(waiting).rejects.toThrow("Session interrupted: user")
  }),
  30_000,
)

test(
  "aborting the run stops the wait and interrupts the session",
  boot(async (env) => {
    const created = await session(env)
    await env.run(env.llm.push(Stream.never))
    await env.client.session.prompt({ sessionID: created.id, text: "Hang" })
    await env.run(env.llm.wait(1))
    const controller = new AbortController()
    const waiting = KiloRunDrain.wait({
      client: env.client,
      sessionID: created.id,
      location: env.location,
      signal: controller.signal,
    })
    expect(await state(waiting)).toBe("pending")
    controller.abort()
    await expect(waiting).rejects.toBeDefined()
    await env.client.experimental.session.wait({ sessionID: created.id })
    expect(Object.keys(await env.client.session.active())).not.toContain(created.id)
  }),
  30_000,
)

test(
  "the run exits only after background work that its prompt did not start",
  boot(async (env) => {
    const created = await session(env)
    const gate = path.join(env.location.directory, "release")
    await env.run(
      env.llm.push(
        TestLLM.toolCall("call_shell", "shell", {
          command: backgroundCommand,
          background: true,
        }),
        TestLLM.text("started", "started"),
        TestLLM.text("nothing new", "status"),
        TestLLM.text("shell finished", "finished"),
      ),
    )
    await env.client.session.prompt({ sessionID: created.id, text: "Start the shell" })
    await env.run(env.llm.wait(2))
    await env.client.experimental.session.wait({ sessionID: created.id })
    expect(await env.client.experimental.job.list({ sessionID: created.id, descendants: true })).toMatchObject([
      { kind: "shell", status: "running" },
    ])
    const code = process.exitCode
    const run = KiloRunDrain.prompt({
      client: env.client,
      sessionID: created.id,
      location: env.location,
      message: "Status?",
      files: [],
      thinking: false,
      format: "json",
      auto: false,
      standalone: true,
      signal: new AbortController().signal,
      renderTool: async () => {},
      renderToolError: async () => {},
    })
    try {
      await env.run(env.llm.wait(3))
      expect(await state(run)).toBe("pending")
      await Bun.write(gate, "")
      await run
      expect(process.exitCode ?? 0).toBe(code ?? 0)
      expect((await env.run(env.llm.requests())).length).toBe(4)
      expect(await env.client.experimental.job.list({ sessionID: created.id, descendants: true })).toEqual([])
    } finally {
      process.exitCode = code
    }
  }),
  30_000,
)

test.each(["shell", "subagent"] as const)(
  "aborting an idle session's drain stops its older background %s and leaves unrelated work running",
  (kind) =>
    boot(async (env) => {
      const created = await session(env)
      const other = await session(env)
      await env.run(
        env.llm.serve((request) => {
          const text = JSON.stringify(request)
          if (text.includes("DRAIN_CHILD") || text.includes("Unrelated work")) return Stream.never
          if (text.includes("<shell") || text.includes("<subagent")) return Stream.never
          if (text.includes("call_background")) return TestLLM.text("started", "started")
          return TestLLM.toolCall(
            "call_background",
            kind,
            kind === "shell"
              ? { command: backgroundCommand, background: true }
              : { agent: "reviewer", description: "Review", prompt: "Wait for cancellation", background: true },
          )
        }),
      )
      await env.client.session.prompt({ sessionID: other.id, text: "Unrelated work" })
      await env.run(env.llm.wait(1))
      await env.client.session.prompt({ sessionID: created.id, text: "Start background work" })
      await env.run(env.llm.wait(kind === "shell" ? 3 : 4))
      await env.client.experimental.session.wait({ sessionID: created.id })
      const jobs = await env.client.experimental.job.list({ sessionID: created.id, descendants: true })
      expect(jobs).toMatchObject([{ kind, status: "running" }])
      const controller = new AbortController()
      const waiting = KiloRunDrain.wait({
        client: env.client,
        sessionID: created.id,
        location: env.location,
        signal: controller.signal,
      })
      try {
        expect(await state(waiting)).toBe("pending")
        controller.abort()
        await expect(waiting).rejects.toBeDefined()
        expect(await env.client.experimental.job.list({ sessionID: created.id, descendants: true })).not.toContainEqual(
          expect.objectContaining({ status: "running" }),
        )
        const active = Object.keys(await env.client.session.active())
        expect(active).not.toContain(created.id)
        expect(active).toContain(other.id)
        for (const job of jobs) {
          if (job.kind === "subagent") expect(active).not.toContain(job.childSessionID)
          if (job.kind === "shell")
            expect((await env.client.shell.list({ location: env.location })).data).not.toContainEqual(
              expect.objectContaining({ id: job.shellID }),
            )
        }
      } finally {
        controller.abort()
        await Bun.write(path.join(env.location.directory, "release"), "")
        await env.client.session.interrupt({ sessionID: other.id })
      }
    })(),
  30_000,
)

test("the host loads the Kilo run mirror in place of the upstream run module", async () => {
  const entry = path.resolve(import.meta.dir, "../../cli/src/run/run.ts")
  const build = (plugins: Bun.BunPlugin[]) =>
    Bun.build({ entrypoints: [entry], plugins, packages: "external", target: "bun" }).then(async (result) => {
      expect(result.success, result.logs.map(String).join("\n")).toBe(true)
      return result.outputs[0]!.text()
    })
  expect(await build([hostMirrorsPlugin])).toContain("rpc.kilocode.session-drain.drained")
  expect(await build([])).not.toContain("rpc.kilocode.session-drain.drained")
})

test("run mirror differs from upstream only at host integration points", async () => {
  const upstream = (await Bun.file(new URL("../../cli/src/run/run.ts", import.meta.url)).text()).replaceAll(
    "\r\n",
    "\n",
  )
  const mirror = (await Bun.file(new URL("../src/cli-run.ts", import.meta.url)).text()).replaceAll("\r\n", "\n")
  const replace = (source: string, from: string, to: string) => {
    expect(source.split(from)).toHaveLength(2)
    return source.replace(from, to)
  }
  const imports = [
    ["../util/io", "@opencode/cli/util/io"],
    ["../services/server-connection", "@opencode/cli/services/server-connection"],
    ["../session-target", "@opencode/cli/session-target"],
    ["./noninteractive", "./run-drain"],
    ["./ui", "@opencode/cli/run/ui"],
    ["../env", "@opencode/cli/env"],
    ["../util/error", "@opencode/cli/util/error"],
  ] as const
  const normalized = imports.reduce((source, [from, to]) => replace(source, `from "${from}"`, `from "${to}"`), upstream)
  const prompt = replace(
    normalized,
    'import { runNonInteractivePrompt } from "./run-drain"',
    'import { KiloRunDrain } from "./run-drain" // Kilo: the prompt step with the session drain',
  )
  expect(mirror).toBe(
    "// Mirror of packages/cli/src/run/run.ts (v2.2.6), loaded in its place by ./mirrors. The only difference: after the\n" +
      "// reply, the run drains the session (./run-drain) before it exits. Keep it in step with the upstream file; the\n" +
      '// differences are marked "Kilo:".\n' +
      replace(
        prompt,
        "  await runNonInteractivePrompt({",
        "  // Kilo: the prompt step drains the session after the reply.\n  await KiloRunDrain.prompt({",
      ),
  )
})
