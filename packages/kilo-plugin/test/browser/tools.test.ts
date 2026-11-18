import { afterEach, describe, expect, test } from "bun:test"
import { Config } from "@opencode/core/config"
import type { Permission } from "@opencode/core/permission"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document } from "@opencode/schema/config"
import { Tool } from "@opencode/schema/tool"
import { Effect, Exit, Option, Scope, Stream } from "effect"
import { UNAVAILABLE_MESSAGE } from "../../src/browser/backend"
import { BrowserContract } from "../../src/browser/contract"
import { authorize, KiloBrowserToolsPlugin } from "../../src/browser/tools"

type Browser = NonNullable<KiloConfigPolicy.BrowserConfig>

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

/** The plugin against a stand-in tool editor and a config document holding one `browser` block. */
type Hook = (event: Record<string, unknown>) => Effect.Effect<void, unknown>

async function boot(browser?: Browser) {
  const transforms: ((editor: { add: (tool: Tool.Info) => void }) => void)[] = []
  const hooks: Hook[] = []
  const ctx = {
    location: { directory: "/tmp/browser-tools-test" },
    tool: {
      transform: (fn: (typeof transforms)[number]) =>
        Effect.sync(() => (transforms.push(fn), { dispose: Effect.void })),
    },
    event: { subscribe: () => Stream.empty },
    permission: {
      hook: (_: string, callback: Hook) =>
        Effect.sync(() => {
          hooks.push(callback)
          return { dispose: Effect.void }
        }),
    },
  }
  const config = {
    entries: () =>
      Effect.succeed(
        browser === undefined ? [] : [new Document({ type: "document", info: new KiloConfigPolicy.Info({ browser }) })],
      ),
  } as unknown as Config.Interface
  const scope = await Effect.runPromise(Scope.make())
  closers.push(() => Effect.runPromise(Scope.close(scope, Exit.void)))
  await Effect.runPromise(
    KiloBrowserToolsPlugin.effect(ctx as never).pipe(
      Effect.provideService(Scope.Scope, scope),
      Effect.provideService(Config.Service, config),
    ),
  )
  const tools = () => {
    const added: Tool.Info[] = []
    transforms.forEach((fn) => fn({ add: (tool) => added.push(tool) }))
    return added
  }
  const call = (name: string, input: unknown = {}) =>
    Effect.runPromise(
      Effect.result(
        tools()
          .find((tool) => tool.name === name)!
          .execute(input, {
            sessionID: "ses_browser" as never,
            agent: "code" as never,
            messageID: "msg_browser" as never,
            id: "call_browser" as never,
            progress: () => Effect.void,
          }),
      ),
    )
  const evaluate = (event: Record<string, unknown>) =>
    Effect.runPromise(Effect.forEach(hooks, (callback) => callback(event), { discard: true })).then(() => event)
  return { tools, call, evaluate }
}

describe("browser tools", () => {
  test("activation finishes with an endless session event stream and registers every tool", async () => {
    // `event.subscribe` returns an endless stream. Awaiting it inside the plugin effect would keep the tools from ever
    // being registered, so activation must fork it.
    const transforms: ((editor: { add: (tool: Tool.Info) => void }) => void)[] = []
    const ctx = {
      location: { directory: "/tmp/browser-tools-event-test" },
      tool: {
        transform: (fn: (typeof transforms)[number]) =>
          Effect.sync(() => (transforms.push(fn), { dispose: Effect.void })),
      },
      event: { subscribe: () => Stream.never },
      permission: { hook: () => Effect.sync(() => ({ dispose: Effect.void })) },
    }
    const config = { entries: () => Effect.succeed([]) } as unknown as Config.Interface
    const scope = await Effect.runPromise(Scope.make())
    closers.push(() => Effect.runPromise(Scope.close(scope, Exit.void)).then(() => undefined))
    await Effect.runPromise(
      KiloBrowserToolsPlugin.effect(ctx as never).pipe(
        // A bounded wait: the inline form never returns, so this fails instead of hanging the suite.
        Effect.timeout("2 seconds"),
        Effect.provideService(Scope.Scope, scope),
        Effect.provideService(Config.Service, config),
      ),
    )
    const added: Tool.Info[] = []
    transforms.forEach((fn) => fn({ add: (tool) => added.push(tool) }))
    const names = added.map((tool) => tool.name)
    expect(transforms.length).toBeGreaterThan(0)
    expect(names).toContain("browser_navigate")
    expect(names).toContain("browser_snapshot")
  })

  test("registers the whole pinned contract with the vendored schemas", async () => {
    const host = await boot()
    const tools = host.tools()
    expect(tools.map((tool) => tool.name)).toEqual(BrowserContract.entries.map((entry) => entry.name))
    expect(tools.length).toBe(26)
    for (const [index, tool] of tools.entries()) {
      const entry = BrowserContract.entries[index]
      expect(tool.description).toBe(entry.description)
      expect(tool.input).toEqual(entry.inputSchema)
      // Direct tools: the model calls `browser_click`, not a Code Mode wrapper.
      expect(tool.options).toEqual({ codemode: false })
    }
  })

  test("backend off hides every browser tool", async () => {
    const host = await boot({ backend: "off" })
    expect(host.tools()).toEqual([])
  })

  test("an absent browser block keeps the tools on the default backend", async () => {
    const host = await boot()
    expect(host.tools().length).toBe(26)
  })

  test("the extension backend answers every call with the model-facing unavailable error and a hint", async () => {
    const host = await boot({ backend: "extension" })
    const result = await host.call("browser_click", { target: "e1" })
    expect(result._tag).toBe("Failure")
    const error = result._tag === "Failure" ? (result.failure as Tool.Error) : undefined
    expect(error?.message).toBe(UNAVAILABLE_MESSAGE)
    expect(String(error?.metadata?.hint)).toContain("Kilo browser extension")
  })
})

describe("browser permission flow", () => {
  /** A stand-in permission service that records what it was asked. */
  function recorder() {
    const asserts: {
      action: string
      resources: readonly string[]
      save: readonly string[]
      metadata?: Record<string, unknown>
    }[] = []
    const service = {
      assert: (input: {
        action: string
        resources: readonly string[]
        save: readonly string[]
        metadata?: Record<string, unknown>
      }) => Effect.sync(() => void asserts.push(input)),
    } as unknown as Permission.Interface
    return { asserts, service: Option.some(service) }
  }

  const context = {
    sessionID: "ses_permissions",
    agent: "code",
    messageID: "msg_permissions",
    id: "call_permissions",
    progress: () => Effect.void,
  } as never

  test("a public origin asks for its class pattern, once per session", async () => {
    const { asserts, service } = recorder()
    const allowed = () => false
    const items = [{ class: "read" as const, origin: "https://example.com" }]
    await Effect.runPromise(authorize(items, context, false, allowed, service))
    await Effect.runPromise(authorize(items, context, false, allowed, service))
    expect(asserts).toHaveLength(1)
    expect(asserts[0]).toMatchObject({
      action: "browser",
      resources: ["read:https://example.com"],
      save: ["read:https://example.com"],
      metadata: { class: "read", origin: "https://example.com" },
    })
  })

  test("the organization allowlist grants an origin without asking", async () => {
    const { asserts, service } = recorder()
    await Effect.runPromise(
      authorize(
        [{ class: "act", origin: "https://allowed.example.com" }],
        context,
        false,
        (origin) => origin === "https://allowed.example.com",
        service,
      ),
    )
    expect(asserts).toEqual([])
  })

  test("a sensitive step asks browser_sensitive, saves nothing and is never remembered", async () => {
    const { asserts, service } = recorder()
    const items = [{ class: "sensitive" as const, origin: "https://example.com", reason: "password field" }]
    await Effect.runPromise(authorize(items, context, false, () => false, service))
    await Effect.runPromise(authorize(items, context, false, () => false, service))
    expect(asserts).toHaveLength(2)
    expect(asserts[0]).toMatchObject({
      action: "browser_sensitive",
      resources: ["https://example.com"],
      save: [],
      metadata: { browserSensitive: true, interactive: true, reason: "password field" },
    })
  })

  test("a frame item is marked as one", async () => {
    const { asserts, service } = recorder()
    await Effect.runPromise(
      authorize(
        [{ class: "read" as const, origin: "https://frame.example.com", frame: true }],
        context,
        false,
        () => false,
        service,
      ),
    )
    expect(asserts[0].metadata).toMatchObject({ frame: true })
  })

  test("without a permission service the tools do not ask", async () => {
    await Effect.runPromise(
      authorize([{ class: "read", origin: "https://example.com" }], context, false, () => false, Option.none()),
    )
  })
})

describe("browser permission hook", () => {
  test("the localhost family is allowed and every other origin asks", async () => {
    const host = await boot()
    expect(
      await host.evaluate({ action: "browser", effect: "allow", resources: ["read:http://localhost:5173"], rules: [] }),
    ).toMatchObject({ effect: "allow" })
    expect(
      await host.evaluate({ action: "browser", effect: "allow", resources: ["read:https://example.com"], rules: [] }),
    ).toMatchObject({ effect: "ask", message: expect.stringContaining("needs approval") })
  })

  test("a sensitive step asks unless browser.allow_sensitive is on", async () => {
    const strict = await boot()
    expect(
      await strict.evaluate({
        action: "browser_sensitive",
        effect: "allow",
        resources: ["https://example.com"],
        rules: [],
      }),
    ).toMatchObject({ effect: "ask" })
    const relaxed = await boot({ allow_sensitive: true })
    expect(
      await relaxed.evaluate({
        action: "browser_sensitive",
        effect: "allow",
        resources: ["https://example.com"],
        rules: [],
      }),
    ).toMatchObject({ effect: "allow" })
  })

  test("an ask or a deny is never relaxed", async () => {
    const host = await boot()
    // Core evaluation already turned an explicit rule into `ask`; the hook must leave it.
    expect(
      await host.evaluate({
        action: "browser",
        effect: "ask",
        resources: ["act:http://localhost:3000"],
        rules: [{ action: "browser", resource: "act:http://localhost:3000", effect: "ask" }],
      }),
    ).toMatchObject({ effect: "ask" })
    expect(
      await host.evaluate({ action: "browser", effect: "deny", resources: ["read:http://localhost:3000"], rules: [] }),
    ).toMatchObject({ effect: "deny" })
  })
})
