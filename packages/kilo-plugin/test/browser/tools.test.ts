import { afterEach, describe, expect, mock, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { Permission } from "@opencode/core/permission"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document } from "@opencode/schema/config"
import { Tool } from "@opencode/schema/tool"
import { Skill } from "@opencode/schema/skill"
import { Effect, Exit, Option, PubSub, Scope, Stream } from "effect"
import { TIMEOUT_MESSAGE, UNAVAILABLE_MESSAGE } from "../../src/browser/backend"
import { BrowserContract } from "../../src/browser/contract"
import { EXTENSION_HINT, STOPPED } from "../../src/browser/extension"
import { BrowserHub } from "../../src/browser/hub"
import { hashArguments, resetSteps } from "../../src/browser/steps"
import { authorize, effective, granted, KiloBrowserToolsPlugin, resetGrants, trim } from "../../src/browser/tools"
import { KiloGatewayAccounts } from "../../src/gateway/accounts"

// The status RPC asks the backend whether a browser exists. The test machine needs none: a fake execute path that is
// never there keeps readiness deterministic.
mock.module("playwright-core", () => ({ chromium: { executablePath: () => "/nonexistent/kilo/chromium" } }))

type Browser = NonNullable<KiloConfigPolicy.BrowserConfig>

const closers: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
  // The grant and step caches are module-level, so one test's grants must never answer the next test's ask.
  resetGrants()
  resetSteps()
})

/** A hub the tool layer can drive: it records the calls and answers with the scripted reply. */
function fakeHub(
  options: {
    call?: (input: BrowserHub.CallInput) => Promise<BrowserHub.Reply>
    adopt?: () => Promise<BrowserHub.Adoption>
  } = {},
) {
  const calls: BrowserHub.CallInput[] = []
  const opened: { sessionId: string; title: string; cwd: string }[] = []
  const began: BrowserHub.Upload[] = []
  let handles = 0
  const shared: string[] = []
  const revoked = new Set<(input: { sessionHandle: string; reason: string }) => void>()
  const port: BrowserHub.Port = {
    reported: () => Promise.resolve(undefined),
    ready: () =>
      Promise.resolve({
        protocol: [1],
        contractSha: BrowserContract.sha256,
        extensionVersion: "1.0.0",
        profileLabel: "Fake profile",
      }),
    open: (input) => {
      opened.push(input)
      handles += 1
      return Promise.resolve({ sessionHandle: `handle-${handles}` })
    },
    close: () => Promise.resolve(),
    share: (handle) => {
      shared.push(handle)
      return Promise.resolve()
    },
    adopt: () => (options.adopt ? options.adopt() : Promise.resolve("adopted")),
    list: () => Promise.resolve(BrowserContract.entries.map((entry) => entry.name)),
    call: (input) => {
      calls.push(input)
      if (options.call) return options.call(input)
      return Promise.resolve({
        content: [{ type: "text", text: "- Page URL: http://localhost:3000\n- Page Title: Local" }],
      })
    },
    begin: (input) => {
      began.push(input)
      return Promise.resolve()
    },
    chunk: () => Promise.resolve(),
    end: () => Promise.resolve(),
    onRevoked: (listener) => {
      revoked.add(listener)
      return () => revoked.delete(listener)
    },
  }
  return {
    calls,
    opened,
    began,
    shared,
    service: { port: () => port } satisfies BrowserHub.Interface,
    revoke: (input: { sessionHandle: string; reason: string }) => revoked.forEach((listener) => listener(input)),
  }
}

/**
 * Session events the test feeds one at a time. The plugin's subscription pulls the next event only after it handled the
 * previous one, so each push resolves once the plugin has handled that event.
 */
function sessionEvents() {
  const queue: { event: { type: string; data: { sessionID: string } }; handled: PromiseWithResolvers<void> }[] = []
  let arrived = Promise.withResolvers<void>()
  async function* pull() {
    let last: PromiseWithResolvers<void> | undefined
    for (;;) {
      last?.resolve()
      while (queue.length === 0) {
        await arrived.promise
        arrived = Promise.withResolvers<void>()
      }
      const next = queue.shift()!
      last = next.handled
      yield next.event
    }
  }
  return {
    stream: () => Stream.fromAsyncIterable(pull(), (error) => error),
    push: (type: string, sessionID: string) => {
      const handled = Promise.withResolvers<void>()
      queue.push({ event: { type, data: { sessionID } }, handled })
      arrived.resolve()
      return handled.promise
    },
  }
}

/** No extension is reachable: the backend reports the model-facing unavailable error. */
function unreachable(): BrowserHub.Interface {
  return {
    port: () =>
      ({
        ready: () =>
          Promise.reject(new BrowserHub.Failure({ kind: "unavailable", message: "no extension is connected" })),
        reported: () => Promise.resolve(undefined),
        onRevoked: () => () => {},
      }) as never,
  }
}

/** A stand-in permission service that records what it was asked; its rules allow the page reads' own tools. */
function recorder() {
  const asserts: { action: string; resources: readonly string[]; save?: readonly string[] }[] = []
  const service = {
    assert: (input: { action: string; resources: readonly string[]; save?: readonly string[] }) =>
      Effect.sync(() => void asserts.push(input)),
    allows: (input: { action: string }) => Effect.succeed(["browser_snapshot", "browser_tabs"].includes(input.action)),
  } as unknown as Permission.Interface
  return { asserts, service: Option.some(service) }
}

/** The plugin against a stand-in tool editor and a config document holding one `browser` block. */
type Hook = (event: Record<string, unknown>) => Effect.Effect<void, unknown>

async function boot(
  browser?: Browser | (() => Browser),
  options: {
    hub?: BrowserHub.Interface
    permission?: Option.Option<Permission.Interface>
    events?: ReturnType<typeof sessionEvents>
  } = {},
) {
  const transforms: ((editor: { add: (tool: Tool.Info) => void }) => void)[] = []
  const hooks: Hook[] = []
  const skillTransforms: ((editor: { add: (skill: Skill.Info) => void }) => void)[] = []
  // The domain reloads the plugin asks for, and the event stream a test publishes `config.updated` on.
  const reloads = { tool: 0, skill: 0 }
  const wakers: (() => void)[] = []
  const bump = (domain: keyof typeof reloads) =>
    Effect.sync(() => {
      reloads[domain] += 1
      wakers.splice(0).forEach((wake) => wake())
    })
  const events = await Effect.runPromise(PubSub.unbounded<{ type: string; data: unknown }>())
  const registrations: string[] = []
  const statuses: (() => Effect.Effect<unknown>)[] = []
  const controls: Record<"share" | "adopt", (input: { sessionID: string }) => Effect.Effect<unknown>>[] = []
  const notices: unknown[] = []
  const ctx = {
    location: { directory: "/tmp/browser-tools-test" },
    skill: {
      transform: (fn: (typeof skillTransforms)[number]) =>
        Effect.sync(() => (skillTransforms.push(fn), { dispose: Effect.void })),
      reload: () => bump("skill"),
    },
    // The status RPC the settings dialog reads; `status` below calls the handler the plugin registers, `control` the
    // share and adopt handlers, and every emitted notice lands in `notices`.
    rpc: {
      register: (
        definition: { id: string },
        handlers: { status: () => Effect.Effect<unknown> } & (typeof controls)[number],
      ) =>
        Effect.sync(() => {
          registrations.push(definition.id)
          statuses.push(handlers.status)
          controls.push({ share: handlers.share, adopt: handlers.adopt })
          return {
            events: { emit: (_: string, data: unknown) => Effect.sync(() => void notices.push(data)) },
            dispose: Effect.void,
          }
        }),
    },
    tool: {
      transform: (fn: (typeof transforms)[number]) =>
        Effect.sync(() => (transforms.push(fn), { dispose: Effect.void })),
      reload: () => bump("tool"),
    },
    event: {
      // The session-event fixture is one shared queue, so only the subscriber for session events reads it; every other
      // subscription (the config reload) reads the published events of its own types.
      subscribe: (input?: { types?: readonly string[] }) =>
        options.events && input?.types?.some((type) => type.startsWith("session."))
          ? options.events.stream()
          : Stream.fromPubSub(events).pipe(Stream.filter((event) => input?.types?.includes(event.type) ?? true)),
    },
    permission: {
      hook: (_: string, callback: Hook) =>
        Effect.sync(() => {
          hooks.push(callback)
          return { dispose: Effect.void }
        }),
    },
  }
  const config = {
    // A function is read per call, the way the plugin reads the config: a test can change a setting mid-session.
    entries: () =>
      Effect.succeed(
        browser === undefined
          ? []
          : [
              new Document({
                type: "document",
                info: new KiloConfigPolicy.Info({ browser: typeof browser === "function" ? browser() : browser }),
              }),
            ],
      ),
  } as unknown as Config.Interface
  const scope = await Effect.runPromise(Scope.make())
  closers.push(() => Effect.runPromise(Scope.close(scope, Exit.void)))
  const provided = KiloBrowserToolsPlugin.effect(ctx as never).pipe(
    Effect.provideService(Scope.Scope, scope),
    Effect.provideService(Config.Service, config),
    Effect.provideService(BrowserHub.Service, options.hub ?? unreachable()),
  )
  const permission = options.permission ?? Option.none()
  await Effect.runPromise(
    Option.isSome(permission) ? provided.pipe(Effect.provideService(Permission.Service, permission.value)) : provided,
  )
  const tools = () => {
    const added: Tool.Info[] = []
    transforms.forEach((fn) => fn({ add: (tool) => added.push(tool) }))
    return added
  }
  // The registry flattens the `browser` namespace, so a test names a tool the way a call does: `browser_click` and
  // `click` both reach the tool registered as `click`, and the backend still receives `browser_click`.
  const call = (name: string, input: unknown = {}, session = "ses_browser") =>
    Effect.runPromise(
      Effect.result(
        tools()
          .find((tool) => tool.name === (name.startsWith("browser_") ? name.slice("browser_".length) : name))!
          .execute(input, {
            sessionID: session as never,
            agent: "code" as never,
            messageID: "msg_browser" as never,
            id: "call_browser" as never,
            progress: () => Effect.void,
          }),
      ),
    )
  const evaluate = (event: Record<string, unknown>) =>
    Effect.runPromise(Effect.forEach(hooks, (callback) => callback(event), { discard: true })).then(() => event)
  const status = () => {
    const handler = statuses[0]
    if (!handler) throw new Error("the plugin registered no status RPC")
    return Effect.runPromise(handler())
  }
  const control = (method: "share" | "adopt", sessionID = "ses_browser") => {
    const handlers = controls[0]
    if (!handlers) throw new Error("the plugin registered no browser RPC")
    return Effect.runPromise(handlers[method]({ sessionID }))
  }
  const publish = (type: string) => Effect.runPromise(PubSub.publish(events, { type, data: {} }))
  /** Resolves once both domains were reloaded `count` times: the plugin's subscriber runs a moment after a publish. */
  const reloaded = async (count: number) => {
    while (reloads.tool < count || reloads.skill < count) {
      const woken = Promise.withResolvers<void>()
      wakers.push(woken.resolve)
      await woken.promise
    }
  }
  return {
    tools,
    // The registry reruns every transform on a reload, so a read applies them afresh, as the next turn would.
    get skills() {
      const added: Skill.Info[] = []
      skillTransforms.forEach((fn) => fn({ add: (skill) => added.push(skill) }))
      return added
    },
    call,
    evaluate,
    registrations,
    status,
    control,
    notices,
    reloads,
    publish,
    reloaded,
  }
}

describe("browser tools", () => {
  test("activation finishes with an endless session event stream and registers every tool", async () => {
    // `event.subscribe` returns an endless stream. Awaiting it inside the plugin effect would keep the tools from ever
    // being registered, so activation must fork it.
    const transforms: ((editor: { add: (tool: Tool.Info) => void }) => void)[] = []
    const ctx = {
      location: { directory: "/tmp/browser-tools-event-test" },
      skill: { transform: () => Effect.void },
      tool: {
        transform: (fn: (typeof transforms)[number]) =>
          Effect.sync(() => (transforms.push(fn), { dispose: Effect.void })),
      },
      event: { subscribe: () => Stream.never },
      // The plugin registers the status RPC before it decides whether to hide the tools.
      rpc: { register: () => Effect.sync(() => ({ events: { emit: () => Effect.void }, dispose: Effect.void })) },
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
        Effect.provideService(BrowserHub.Service, unreachable()),
      ),
    )
    const added: Tool.Info[] = []
    transforms.forEach((fn) => fn({ add: (tool) => added.push(tool) }))
    const names = added.map((tool) => tool.name)
    expect(transforms.length).toBeGreaterThan(0)
    expect(names).toContain("navigate")
    expect(names).toContain("snapshot")
  })

  test("registers every pinned tool a backend can run, with the vendored schemas", async () => {
    const host = await boot()
    const tools = host.tools()
    expect(host.skills.map((skill) => skill.id)).toEqual([Skill.ID.make("browser-automation")])
    expect(tools.length).toBe(25)
    expect(tools.map((tool) => tool.name)).not.toContain("run_code_unsafe")
    for (const [index, tool] of tools.entries()) {
      const entry = BrowserContract.entries[index]
      expect(tool.description).toBe(entry.description)
      expect(tool.input).toEqual(entry.inputSchema)
      expect(`${tool.options?.namespace}_${tool.name}`).toBe(entry.name)
      expect(tool.options).toEqual({ namespace: "browser", codemode: true })
    }
  })

  test("backend off hides every browser tool", async () => {
    const host = await boot({ backend: "off" })
    expect(host.tools()).toEqual([])
    expect(host.skills).toEqual([])
  })

  test("an absent browser block keeps the tools on the default backend", async () => {
    const host = await boot()
    expect(host.tools().length).toBe(BrowserContract.entries.length)
  })

  test("registers the browser status RPC even when the backend is off", async () => {
    const host = await boot({ backend: "off" })
    expect(host.registrations).toEqual(["kilocode.browser"])
  })

  test("a config change hides the tools and the skill for the next turn and shows them again, without a restart", async () => {
    let backend: Browser["backend"] = "extension"
    const host = await boot(() => ({ backend }))
    expect(host.tools().length).toBe(BrowserContract.entries.length)

    backend = "off"
    await host.publish("config.updated")
    await host.reloaded(1)
    expect(host.tools()).toEqual([])
    expect(host.skills).toEqual([])
    expect(((await host.status()) as { backend: string }).backend).toBe("off")

    backend = "playwright"
    await host.publish("config.updated")
    await host.reloaded(2)
    expect(host.tools().length).toBe(BrowserContract.entries.length)
    expect(host.skills.map((skill) => skill.id)).toEqual([Skill.ID.make("browser-automation")])
    expect(((await host.status()) as { backend: string }).backend).toBe("playwright")
  })

  test("a backend that is off at start shows its tools once the config turns it on", async () => {
    let backend: Browser["backend"] = "off"
    const host = await boot(() => ({ backend }))
    expect(host.tools()).toEqual([])
    backend = "extension"
    await host.publish("config.updated")
    await host.reloaded(1)
    expect(host.tools().length).toBe(BrowserContract.entries.length)
  })

  test("a call made after the user turned the tools off says so and never asks the model to turn them on", async () => {
    let backend: Browser["backend"] = "extension"
    const host = await boot(() => ({ backend }))
    // A call the model planned against the tool list it already had.
    backend = "off"
    const result = await host.call("browser_snapshot")
    expect(result._tag).toBe("Failure")
    const error = result._tag === "Failure" ? (result.failure as Tool.Error) : undefined
    expect(error?.message).toContain("The user turned the browser tools off")
    expect(error?.message).not.toContain("Set browser.backend")
    expect(error?.metadata?.hint).toBeUndefined()
  })

  test("the extension backend answers every call with the actionable setup step the model can relay", async () => {
    const host = await boot({ backend: "extension" })
    const result = await host.call("click", { target: "e1" })
    expect(result._tag).toBe("Failure")
    const error = result._tag === "Failure" ? (result.failure as Tool.Error) : undefined
    // The metadata hint never reaches a `run --format json` caller, so the message carries the same instruction.
    expect(error?.message).toBe(
      'The browser is not available right now. Install the Kilo browser extension and turn on "Allow local agents" in its settings, or set browser.backend to "playwright".',
    )
    expect(error?.metadata?.hint).toBe(EXTENSION_HINT)
  })
})

describe("browser status RPC", () => {
  const fetch = globalThis.fetch

  /** Answer the organization policy endpoint, and record the paths the server asked. */
  function policies(answer: (org: string) => unknown) {
    const asked: string[] = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(String(input))
      asked.push(url.pathname)
      return new Response(JSON.stringify(answer(url.pathname.split("/").at(-2) ?? "")), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as typeof globalThis.fetch
    return asked
  }

  /** The signed-in account whose organization policy the plugin reads. */
  function account(org: string) {
    return KiloGatewayAccounts.register(
      "/tmp/browser-tools-test",
      () => ({ baseURL: "https://api.kilo.ai", token: "token", organizationID: org }) as never,
    )
  }

  afterEach(() => {
    globalThis.fetch = fetch
  })

  test("the status names the backend the organization policy leaves", async () => {
    const asked = policies(() => ({
      browserControl: "playwright_only",
      browserAllowedOrigins: ["https://example.com", "https://app.example.com"],
    }))
    const restore = account("org_status_pin")
    const previous = process.env.KILO_API_URL
    process.env.KILO_API_URL = "https://api.kilo.ai"
    try {
      const host = await boot({ backend: "extension" })
      const status = (await host.status()) as {
        backend: string
        organization?: unknown
        playwright: { ready: boolean }
      }
      expect(status.backend).toBe("playwright")
      expect(status.organization).toEqual({
        control: "playwright_only",
        origins: ["https://example.com", "https://app.example.com"],
      })
      expect(asked).toContain("/api/organizations/org_status_pin/browser-policy")
    } finally {
      if (previous === undefined) delete process.env.KILO_API_URL
      else process.env.KILO_API_URL = previous
      restore()
    }
  })

  test("a policy that turns browser control off reads as the off backend", async () => {
    policies(() => ({ browserControl: "off" }))
    const restore = account("org_status_off")
    try {
      const host = await boot({ backend: "playwright" })
      const status = (await host.status()) as { backend: string; organization?: unknown }
      expect(status.backend).toBe("off")
      expect(status.organization).toEqual({ control: "off", origins: [] })
    } finally {
      restore()
    }
  })

  test("a playwright_only pin never turns a config that is off back on", async () => {
    policies(() => ({ browserControl: "playwright_only" }))
    const restore = account("org_status_pin_off")
    try {
      const host = await boot({ backend: "off" })
      const status = (await host.status()) as { backend: string; organization?: unknown }
      // The organization policy restricts, it does not enable: with the config off, status and the call path both
      // say the browser is off.
      expect(status.backend).toBe("off")
      expect(status.organization).toEqual({ control: "playwright_only", origins: [] })
      expect(host.tools()).toEqual([])
    } finally {
      restore()
    }
  })

  test("without a policy the status keeps the config's backend", async () => {
    const host = await boot({ backend: "extension" })
    const status = (await host.status()) as { backend: string; organization?: unknown }
    expect(status.backend).toBe("extension")
    expect(status.organization).toBeUndefined()
  })

  test("share and adopt under an organization that turned browser control off name the organization", async () => {
    policies(() => ({ browserControl: "off" }))
    const restore = account("org_control_off")
    try {
      // Choosing the extension in /browser cannot help here, so the answer is not `not_extension`.
      const host = await boot({ backend: "extension" }, { hub: fakeHub().service })
      expect(await host.control("share")).toEqual({ kind: "organization_off" })
      expect(await host.control("adopt")).toEqual({ kind: "organization_off" })
    } finally {
      restore()
    }
  })

  test("a Playwright pin and the user's own off still ask for the extension", async () => {
    policies((org) => ({ browserControl: org === "org_control_pin" ? "playwright_only" : "allow" }))
    const pinned = account("org_control_pin")
    try {
      expect(await (await boot({ backend: "extension" })).control("share")).toEqual({ kind: "not_extension" })
    } finally {
      pinned()
    }
    const allowed = account("org_control_allow")
    try {
      expect(await (await boot({ backend: "off" })).control("adopt")).toEqual({ kind: "not_extension" })
    } finally {
      allowed()
    }
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

describe("browser skill text", () => {
  // The skill is the one place the model reads which browser the tools drive, so each backend must get its own text.
  const SKILL = Skill.ID.make("browser-automation")

  test("the extension backend says the tools drive the user's own browser", async () => {
    const host = await boot({ backend: "extension" })
    const [skill] = host.skills
    expect(skill.id).toBe(SKILL)
    expect(skill.description).toBe("Use to inspect or interact with the user's own browser through the Kilo extension.")
    expect(skill.content).toContain("drive the user's own browser through the Kilo extension")
    expect(skill.content).toContain("Kilo tab group")
    expect(skill.content).toContain("permission per site")
    expect(skill.content).toContain("sensitive step")
    expect(skill.content).toContain("take a tab back")
    expect(skill.content).not.toContain("Playwright")
  })

  test("the Playwright backend keeps the Playwright wording and the extension paragraph out", async () => {
    const [skill] = (await boot({ backend: "playwright" })).skills
    expect(skill.description).toBe("Use to inspect or interact with a web page using Playwright.")
    expect(skill.content.startsWith("# Browser automation\n\nUse Code Mode")).toBe(true)
    expect(skill.content).not.toContain("Kilo extension")
    expect(skill.content).not.toContain("Kilo tab group")
  })

  test("both backends say browser_type replaces the content and slowly types at the caret", async () => {
    for (const backend of ["extension", "playwright"] as const) {
      const [skill] = (await boot({ backend })).skills
      expect(skill.content).toContain(
        "browser_type replaces the field's content; `slowly: true` types at the caret instead",
      )
    }
  })

  test("both backends send an agent that must act on a page from browser_open to these tools", async () => {
    for (const backend of ["extension", "playwright"] as const) {
      const [skill] = (await boot({ backend })).skills
      // The file wraps its lines, so the sentences are compared with the wrapping flattened.
      const text = skill.content.replace(/\s+/g, " ")
      expect(text).toContain("shows a page in the Integrated Browser for the user to look at")
      expect(text).toContain("these browser tools are the ones that read and act on a page")
    }
  })

  test("a backend change swaps the text for the next turn without a restart", async () => {
    let backend: Browser["backend"] = "extension"
    const host = await boot(() => ({ backend }))
    expect(host.skills[0].description).toContain("Kilo extension")

    backend = "playwright"
    await host.publish("config.updated")
    await host.reloaded(1)
    expect(host.skills[0].description).toBe("Use to inspect or interact with a web page using Playwright.")
    expect(host.skills[0].content).not.toContain("Kilo tab group")

    backend = "extension"
    await host.publish("config.updated")
    await host.reloaded(2)
    expect(host.skills[0].content).toContain("Kilo tab group")
  })
})

describe("browser tools over the extension backend", () => {
  const page = (url: string, title: string, lines: string[] = []) =>
    ["### Page", `- Page URL: ${url}`, `- Page Title: ${title}`, "", "### Snapshot", "```yaml", ...lines, "```"].join(
      "\n",
    )

  test("a call reaches the extension and the metadata names its backend and page", async () => {
    const hub = fakeHub({
      call: () =>
        Promise.resolve({
          content: [{ type: "text", text: page("http://localhost:3000", "Local", ['- button "Send"']) }],
          meta: { withheldFrames: ["https://ads.example.com"] },
        }),
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service })
    const result = await host.call("browser_navigate", { url: "http://localhost:3000" })
    expect(result._tag).toBe("Success")
    const answer = result._tag === "Success" ? (result.success as Tool.Result) : undefined
    expect(answer?.metadata?.browser).toMatchObject({
      backend: "extension",
      observation: "diff",
      url: "http://localhost:3000",
      title: "Local",
      withheldFrames: ["https://ads.example.com"],
    })
    expect(hub.calls.map((call) => call.name)).toEqual(["browser_navigate", "browser_console_messages"])
    expect(hub.opened).toHaveLength(1)
  })

  test("the session's execution events decide which turns a Stop all halts", async () => {
    const hub = fakeHub()
    const events = sessionEvents()
    const host = await boot({ backend: "extension" }, { hub: hub.service, events })
    const stopped = (result: Awaited<ReturnType<typeof host.call>>) =>
      result._tag === "Failure" && String((result.failure as Tool.Error).message) === STOPPED

    await events.push("session.execution.started", "ses_open")
    await events.push("session.execution.started", "ses_waiting")
    expect((await host.call("browser_snapshot", {}, "ses_open"))._tag).toBe("Success")
    // Stop all: the revoke names only ses_open, yet the turn ses_waiting is running is halted with it.
    hub.revoke({ sessionHandle: "handle-1", reason: "user_stop" })
    expect(stopped(await host.call("browser_snapshot", {}, "ses_waiting"))).toBe(true)
    // A conversation idle at the stop is untouched.
    expect((await host.call("browser_snapshot", {}, "ses_idle"))._tag).toBe("Success")
    // The conversation's next user message starts a new turn, which works.
    await events.push("session.execution.started", "ses_waiting")
    expect((await host.call("browser_snapshot", {}, "ses_waiting"))._tag).toBe("Success")
    expect(hub.opened.map((value) => value.sessionId)).toEqual(["ses_open", "ses_idle", "ses_waiting"])
  })

  test("a needs_permission answer asks and retries once with the grant it approved", async () => {
    const { asserts, service } = recorder()
    let attempts = 0
    const hub = fakeHub({
      call: (input) => {
        attempts += 1
        if (attempts === 1) {
          return Promise.reject(
            new BrowserHub.Failure({
              kind: "permission",
              message: "needs permission",
              items: [{ class: "read", origin: "https://example.com" }],
            }),
          )
        }
        expect(input.authorized).toEqual([{ class: "read", origin: "https://example.com" }])
        return Promise.resolve({ content: [{ type: "text", text: page("https://example.com", "Example") }] })
      },
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    const result = await host.call("browser_click", { target: "e1" })
    expect(result._tag).toBe("Success")
    // The tool's own key first, then the grant the extension asked for.
    expect(asserts.map((entry) => entry.action)).toEqual(["browser_click", "browser"])
    expect(asserts[1]).toMatchObject({ resources: ["read:https://example.com"] })
    expect(hub.calls).toHaveLength(2)
  })

  /** A hub that refuses each call with the next scripted failure, then answers once every one has been reported. */
  function scripted(failures: BrowserHub.Failure[]) {
    const steps = [...failures]
    return fakeHub({
      call: (input) => {
        if (input.name === "browser_console_messages") return Promise.resolve({ content: [] })
        const next = steps.shift()
        if (next) return Promise.reject(next)
        return Promise.resolve({ content: [{ type: "text", text: page("https://example.com", "Example") }] })
      },
    })
  }
  const needs = (items: BrowserHub.Failure["items"], stepToken?: string) =>
    new BrowserHub.Failure({ kind: "permission", message: "needs permission", items, stepToken })
  const stepped = (calls: readonly BrowserHub.CallInput[], name: string) => calls.filter((call) => call.name === name)

  test("a first password fill asks for the act grant, then the sensitive step, and runs on that call", async () => {
    const { asserts, service } = recorder()
    const hub = scripted([
      needs([{ class: "act", origin: "https://example.com" }]),
      needs([{ class: "sensitive", origin: "https://example.com", reason: "password field" }], "step-1"),
    ])
    const host = await boot({ backend: "extension", allow_sensitive: true }, { hub: hub.service, permission: service })
    const result = await host.call("browser_type", { target: "e1", text: "hunter2" })
    expect(result._tag).toBe("Success")
    expect(asserts.map((entry) => entry.action)).toEqual(["browser_type", "browser", "browser_sensitive"])
    const typed = stepped(hub.calls, "browser_type")
    expect(typed).toHaveLength(3)
    expect(typed[2]).toMatchObject({
      authorized: [{ class: "act", origin: "https://example.com" }],
      sensitive: ["step-1"],
    })
  })

  test("a navigate that redirects to a new origin asks for it and lands on the retry", async () => {
    const { asserts, service } = recorder()
    const hub = scripted([
      needs([{ class: "navigate", origin: "https://start.example.com" }]),
      new BrowserHub.Failure({
        kind: "moved",
        message: "moved",
        items: [{ class: "read", origin: "https://landed.example.com" }],
      }),
    ])
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    const result = await host.call("browser_navigate", { url: "https://start.example.com/go" })
    expect(result._tag).toBe("Success")
    expect(asserts.slice(1).map((entry) => entry.resources)).toEqual([
      ["navigate:https://start.example.com"],
      ["read:https://landed.example.com"],
    ])
    expect(stepped(hub.calls, "browser_navigate").at(-1)?.authorized).toEqual([
      { class: "navigate", origin: "https://start.example.com" },
      { class: "read", origin: "https://landed.example.com" },
    ])
  })

  test("a need that comes back after its approval stops the call and says so", async () => {
    const { asserts, service } = recorder()
    const redirect = () =>
      new BrowserHub.Failure({
        kind: "moved",
        message: "moved",
        items: [{ class: "read", origin: "https://landed.example.com" }],
      })
    const hub = scripted([redirect(), redirect(), redirect()])
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    const result = await host.call("browser_navigate", { url: "https://start.example.com/go" })
    expect(result._tag === "Failure" ? (result.failure as Tool.Error).message : "").toBe(
      "The browser asked again for permission to read https://landed.example.com after it was approved. Do not repeat this step; continue without it or ask the user for help.",
    )
    expect(stepped(hub.calls, "browser_navigate")).toHaveLength(2)
    expect(asserts.filter((entry) => entry.action === "browser")).toHaveLength(1)
  })

  test("a call asks at most three times and then tells the model to call again for the rest", async () => {
    const { asserts, service } = recorder()
    const hub = scripted(
      ["https://a.example.com", "https://b.example.com", "https://c.example.com", "https://d.example.com"].map(
        (origin) => needs([{ class: "read", origin, frame: true }]),
      ),
    )
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    const result = await host.call("browser_snapshot")
    expect(result._tag === "Failure" ? (result.failure as Tool.Error).message : "").toBe(
      "This step needs more approvals than one call asks for. Call the tool again to ask for the rest.",
    )
    expect(stepped(hub.calls, "browser_snapshot")).toHaveLength(4)
    expect(asserts.filter((entry) => entry.action === "browser")).toHaveLength(3)
  })

  test("a later need keeps the sensitive approval the call already has", async () => {
    const { asserts, service } = recorder()
    const hub = scripted([
      needs([{ class: "act", origin: "https://example.com" }]),
      needs([{ class: "sensitive", origin: "https://example.com", reason: "password field" }], "step-1"),
      needs([{ class: "read", origin: "https://frame.example.com", frame: true }]),
    ])
    const host = await boot({ backend: "extension", allow_sensitive: true }, { hub: hub.service, permission: service })
    const result = await host.call("browser_type", { target: "e1", text: "hunter2" })
    expect(result._tag).toBe("Success")
    expect(asserts.filter((entry) => entry.action === "browser_sensitive")).toHaveLength(1)
    // The browser checks the frame grant before the sensitive step, so the approved token is still unspent.
    expect(stepped(hub.calls, "browser_type").map((call) => call.sensitive)).toEqual([
      undefined,
      undefined,
      ["step-1"],
      ["step-1"],
    ])
  })

  test("a refusal that names no permission stops the call and says so", async () => {
    const { asserts, service } = recorder()
    const hub = scripted([needs([])])
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    const result = await host.call("browser_click", { target: "e1" })
    expect(result._tag === "Failure" ? (result.failure as Tool.Error).message : "").toBe(
      "The browser refused this step without naming the permission it needs. Continue without this action.",
    )
    expect(stepped(hub.calls, "browser_click")).toHaveLength(1)
    expect(asserts.map((entry) => entry.action)).toEqual(["browser_click"])
  })

  test("a tab with no web origin is answered with the next step and asks the user nothing", async () => {
    const { asserts, service } = recorder()
    const hub = fakeHub({
      call: () =>
        Promise.reject(
          new BrowserHub.Failure({
            kind: "permission",
            message: "needs permission",
            items: [{ class: "read", origin: "://" }],
          }),
        ),
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    const result = await host.call("browser_snapshot")
    expect(result._tag).toBe("Failure")
    const error = result._tag === "Failure" ? (result.failure as Tool.Error) : undefined
    expect(error?.message).toContain("no web page open")
    // Only the tool's own key was asked: no grant for an empty origin ever reached the user.
    expect(asserts.map((entry) => entry.action)).toEqual(["browser_snapshot"])
    expect(hub.calls).toHaveLength(1)
  })

  test("a need without a web origin is dropped without an ask and the call still converges", async () => {
    const { asserts, service } = recorder()
    const hub = scripted([
      needs([
        { class: "act", origin: "https://example.com" },
        { class: "read", origin: "opaque:null", frame: true },
      ]),
      needs([{ class: "sensitive", origin: "https://example.com", reason: "password field" }], "step-1"),
      needs([{ class: "read", origin: "https://frame.example.com", frame: true }]),
    ])
    const host = await boot({ backend: "extension", allow_sensitive: true }, { hub: hub.service, permission: service })
    const result = await host.call("browser_type", { target: "e1", text: "hunter2" })
    expect(result._tag).toBe("Success")
    // Three asks, the dropped need among none of them: the limit is left for the needs a person can approve.
    expect(asserts.slice(1).map((entry) => entry.resources)).toEqual([
      ["act:https://example.com"],
      ["https://example.com"],
      ["read:https://frame.example.com"],
    ])
    expect(stepped(hub.calls, "browser_type")).toHaveLength(4)
  })

  test("a retry left with only needs without a web origin stops with their refusal instead of asking again", async () => {
    const { asserts, service } = recorder()
    const hub = scripted([
      needs([{ class: "read", origin: "https://frame.example.com", frame: true }]),
      needs([{ class: "read", origin: "opaque:null", frame: true }]),
    ])
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    const result = await host.call("browser_snapshot")
    expect(result._tag === "Failure" ? (result.failure as Tool.Error).message : "").toContain(
      "A frame on this page has no web origin",
    )
    expect(stepped(hub.calls, "browser_snapshot")).toHaveLength(2)
    expect(asserts.map((entry) => entry.action)).toEqual(["browser_snapshot", "browser"])
  })

  test("a post-action need asks, reads the page again and never repeats the action", async () => {
    const { asserts, service } = recorder()
    const hub = fakeHub({
      call: (input) => {
        if (input.name === "browser_click") {
          return Promise.reject(
            new BrowserHub.Failure({
              kind: "permission",
              message: "The page moved to https://example.com; its content is withheld until read is granted.",
              items: [{ class: "read", origin: "https://example.com" }],
              afterAction: true,
            }),
          )
        }
        return Promise.resolve({
          content: [{ type: "text", text: page("https://example.com", "Example", ['- link "Hi"']) }],
        })
      },
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    const result = await host.call("browser_click", { target: "e1" })
    expect(result._tag).toBe("Success")
    // Exactly one click: the action ran once, and the read that follows is a snapshot.
    expect(hub.calls.map((call) => call.name)).toEqual(["browser_click", "browser_snapshot"])
    expect(asserts.map((entry) => entry.action)).toEqual(["browser_click", "browser"])
    const answer = result._tag === "Success" ? (result.success as Tool.Result) : undefined
    expect(JSON.stringify(answer?.content)).toContain("Hi")
  })

  test("a dropped connection fails the call with the unavailable message and the uncertainty marker", async () => {
    const hub = fakeHub({
      call: () =>
        Promise.reject(
          new BrowserHub.Failure({
            kind: "unavailable",
            message: "The browser connection dropped: the hub closed the connection",
            uncertain: true,
          }),
        ),
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service })
    const result = await host.call("browser_click", { target: "e1" })
    expect(result._tag).toBe("Failure")
    const error = result._tag === "Failure" ? (result.failure as Tool.Error) : undefined
    expect(error?.message).toBe(`${UNAVAILABLE_MESSAGE} ${EXTENSION_HINT}`)
    expect(error?.metadata).toMatchObject({ hint: EXTENSION_HINT, effectsUncertain: true })
  })

  test("a call the browser did not finish in time says so, and does not call the browser missing", async () => {
    const hub = fakeHub({
      call: () =>
        Promise.reject(
          new BrowserHub.Failure({
            kind: "timeout",
            message: "The browser did not answer tools.call within 120000ms.",
            uncertain: true,
          }),
        ),
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service })
    const result = await host.call("browser_click", { target: "e1" })
    expect(result._tag).toBe("Failure")
    const error = result._tag === "Failure" ? (result.failure as Tool.Error) : undefined
    expect(error?.message).toBe(TIMEOUT_MESSAGE)
    expect(error?.metadata).toEqual({ effectsUncertain: true })
  })

  test("a cancelled call that may have run in part carries the uncertainty marker; one never sent does not", async () => {
    const run = async (uncertain: boolean) => {
      const hub = fakeHub({
        call: () => Promise.reject(new BrowserHub.Failure({ kind: "cancelled", message: "cancelled", uncertain })),
      })
      const host = await boot({ backend: "extension" }, { hub: hub.service })
      const result = await host.call("browser_click", { target: "e1" })
      expect(result._tag).toBe("Failure")
      return result._tag === "Failure" ? (result.failure as Tool.Error) : undefined
    }
    // In flight: the call reached the extension, so the host must be told the page may have changed.
    const running = await run(true)
    expect(running?.message).toContain("cancelled before it finished")
    expect(running?.metadata).toEqual({ effectsUncertain: true })
    // Never sent: nothing ran, and the failure is definite.
    const early = await run(false)
    expect(early?.message).toContain("cancelled before it was sent")
    expect(early?.metadata).toBeUndefined()
  })

  test("an extension that went away is told to turn its switch back on, in the message and the UI hint", async () => {
    const gone: BrowserHub.Interface = {
      port: () =>
        ({
          ready: () =>
            Promise.reject(
              new BrowserHub.Failure({
                kind: "unavailable",
                message: "not connected",
                absence: { kind: "disconnected" },
              }),
            ),
          reported: () => Promise.resolve(undefined),
          onRevoked: () => () => {},
        }) as never,
    }
    const host = await boot({ backend: "extension" }, { hub: gone })
    const result = await host.call("browser_snapshot")
    const error = result._tag === "Failure" ? (result.failure as Tool.Error) : undefined
    const hint = String(error?.metadata?.hint)
    expect(hint).toContain('turn on "Allow local agents"')
    expect(hint).not.toContain("Install")
    // Both surfaces carry the same step: a `run --format json` caller sees only the message.
    expect(error?.message).toBe(`${UNAVAILABLE_MESSAGE} ${hint}`)
  })

  test("browser_snapshot diff mode compares the extension's snapshots", async () => {
    let index = 0
    const hub = fakeHub({
      call: () => {
        index += 1
        const lines = index === 1 ? ['- button "Send"'] : ['- button "Pay"', '- text "Thanks"']
        return Promise.resolve({ content: [{ type: "text", text: page("http://localhost:3000", "Local", lines) }] })
      },
    })
    const host = await boot({ backend: "extension", observation: "diff" }, { hub: hub.service })
    await host.call("browser_click", { target: "e1" })
    const second = await host.call("browser_click", { target: "e2" })
    expect(second._tag).toBe("Success")
    const text = JSON.stringify(second._tag === "Success" ? second.success.content : "")
    expect(text).toContain("Page changes")
    expect(text).toContain("changed 1")
  })

  test("the diff console section comes from the extension's own console read, never a prompt", async () => {
    const asserts: { action: string }[] = []
    const service = {
      assert: (input: { action: string }) => Effect.sync(() => void asserts.push(input)),
      allows: () => Effect.succeed(true),
    } as unknown as Permission.Interface
    const hub = fakeHub({
      call: (input) => {
        if (input.name === "browser_console_messages") {
          return Promise.resolve({
            content: [{ type: "text", text: "### Result\n- [ERROR] boom @ https://example.com/app.js" }],
          })
        }
        return Promise.resolve({
          content: [{ type: "text", text: page("https://example.com", "Example", ['- button "Send"']) }],
        })
      },
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: Option.some(service) })
    const result = await host.call("browser_click", { target: "e1" })
    expect(result._tag).toBe("Success")
    const text = JSON.stringify(result._tag === "Success" ? result.success.content : "")
    expect(text).toContain("Console errors")
    expect(text).toContain("boom")
    // The console read is a read: it asks for nothing beyond the tool's own key.
    expect(asserts.map((entry) => entry.action)).toEqual(["browser_click"])
    expect(hub.calls.map((call) => call.name)).toEqual(["browser_click", "browser_console_messages"])
  })

  // A granted act or navigate need is the model's own next step. Whether the step already ran decides the wording, in
  // every observation mode: `afterAction` means it ran, so the page is read again and the step is never repeated.
  for (const observation of ["none", "diff"] as const) {
    test(`a granted act need that already ran tells the model to read, not repeat, in ${observation} mode`, async () => {
      const { asserts, service } = recorder()
      const hub = fakeHub({
        call: (input) => {
          if (input.name !== "browser_click") return Promise.resolve({ content: [{ type: "text", text: "{}" }] })
          return Promise.reject(
            new BrowserHub.Failure({
              kind: "permission",
              message: "The page moved to https://example.com; its content is withheld until act is granted.",
              items: [{ class: "act", origin: "https://example.com" }],
              afterAction: true,
              meta: { url: "https://example.com/landed", withheldFrames: ["https://frame.example.com"] },
            }),
          )
        },
      })
      const host = await boot({ backend: "extension", observation }, { hub: hub.service, permission: service })
      const result = await host.call("browser_click", { target: "e1" })
      expect(result._tag).toBe("Success")
      expect(asserts.map((entry) => entry.action)).toEqual(["browser_click", "browser"])
      expect(asserts[1]).toMatchObject({ resources: ["act:https://example.com"] })
      expect(hub.calls.map((call) => call.name)).toEqual(["browser_click"])
      const answer = result._tag === "Success" ? (result.success as Tool.Result) : undefined
      const text = JSON.stringify(answer?.content)
      expect(text).toContain("The step ran. The permission is granted; read the page again (browser_snapshot)")
      expect(text).not.toContain("Repeat the same step")
      // The result's own page state survives: the real URL and the withheld frames, not the grant origin.
      expect(answer?.metadata?.browser).toMatchObject({
        url: "https://example.com/landed",
        withheldFrames: ["https://frame.example.com"],
      })
    })
  }

  test("a need returned in a result's _meta is answered as an action that already ran", async () => {
    const { service } = recorder()
    const hub = fakeHub({
      call: (input) => {
        if (input.name !== "browser_click") return Promise.resolve({ content: [{ type: "text", text: "{}" }] })
        return Promise.resolve({
          content: [{ type: "text", text: "The page moved to https://example.com; its content is withheld." }],
          meta: { url: "https://example.com/landed", needs: [{ class: "act", origin: "https://example.com" }] },
        })
      },
    })
    const host = await boot({ backend: "extension", observation: "none" }, { hub: hub.service, permission: service })
    const result = await host.call("browser_click", { target: "e1" })
    expect(result._tag).toBe("Success")
    const text = JSON.stringify(result._tag === "Success" ? result.success.content : "")
    expect(text).toContain("The step ran. The permission is granted; read the page again (browser_snapshot)")
    expect(text).not.toContain("Repeat the same step")
  })

  test("a late need carried by another call redeems on its causing step exactly once", async () => {
    const { service } = recorder()
    const hash = hashArguments({ target: "e1" })
    const sent: (string | undefined)[] = []
    const hub = fakeHub({
      call: (input) => {
        // The download starts after the click returned: the report arrives on whatever call comes next.
        if (input.name === "browser_snapshot") {
          return Promise.reject(
            new BrowserHub.Failure({
              kind: "permission",
              message: "A download started after the click on e1 and was stopped: it needs approval.",
              items: [{ class: "sensitive", origin: "https://example.com", reason: "download: report.pdf" }],
              stepToken: "tok-late",
              step: { tool: "browser_click", argumentsHash: hash },
              afterAction: true,
            }),
          )
        }
        sent.push(input.sensitive?.[0])
        return Promise.resolve({ content: [{ type: "text", text: "- file report.pdf" }] })
      },
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    const carried = await host.call("browser_snapshot")
    expect(carried._tag).toBe("Success")
    // The carrying call says which step to repeat, and never "the same step".
    const text = JSON.stringify(carried._tag === "Success" ? carried.success.content : "")
    expect(text).toContain("Approved. Repeat that step to receive the file.")
    expect(text).not.toContain("the same step")

    // The identical click redeems it once; a second identical click carries nothing.
    await host.call("browser_click", { target: "e1" })
    await host.call("browser_click", { target: "e1" })
    expect(sent).toEqual(["tok-late", undefined])
  })

  test("a late need is not redeemed by another step or another conversation", async () => {
    const { service } = recorder()
    const hash = hashArguments({ target: "e1" })
    const sent: (string | undefined)[] = []
    const hub = fakeHub({
      call: (input) => {
        if (input.name === "browser_snapshot") {
          return Promise.reject(
            new BrowserHub.Failure({
              kind: "permission",
              message: "A download started after the click on e1 and was stopped: it needs approval.",
              items: [{ class: "sensitive", origin: "https://example.com", reason: "download: report.pdf" }],
              stepToken: "tok-late",
              step: { tool: "browser_click", argumentsHash: hash },
              afterAction: true,
            }),
          )
        }
        sent.push(input.sensitive?.[0])
        return Promise.resolve({ content: [{ type: "text", text: "- file report.pdf" }] })
      },
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    await host.call("browser_snapshot")
    await host.call("browser_click", { target: "e2" })
    await host.call("browser_click", { target: "e1" }, "ses_other")
    expect(sent).toEqual([undefined, undefined])
  })

  test("an old-format need without a step keeps the carrying call's token", async () => {
    const { service } = recorder()
    const sent: (string | undefined)[] = []
    let reports = 1
    const hub = fakeHub({
      call: (input) => {
        if (input.name === "browser_snapshot" && reports > 0) {
          reports -= 1
          return Promise.reject(
            new BrowserHub.Failure({
              kind: "permission",
              message: "A download started and was stopped: it needs approval.",
              items: [{ class: "sensitive", origin: "https://example.com", reason: "download: report.pdf" }],
              stepToken: "tok-carrying",
              afterAction: true,
            }),
          )
        }
        sent.push(input.sensitive?.[0])
        return Promise.resolve({ content: [{ type: "text", text: "ok" }] })
      },
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    const carried = await host.call("browser_snapshot")
    const text = JSON.stringify(carried._tag === "Success" ? carried.success.content : "")
    expect(text).toContain("Approved. Repeat the same step to receive the file.")
    // Without a named step the token belongs to the call that carried the report, as before.
    await host.call("browser_snapshot")
    expect(sent).toEqual(["tok-carrying"])
  })

  test("a granted act need that never ran asks for the step again", async () => {
    // Only the after-action producer exists on the wire today, so the other branch of the decision is exercised
    // directly: a need without the flag never ran, and repeating the step is exactly what the model should do.
    const settled = granted({
      needs: [{ class: "act", origin: "https://example.com" }],
      result: { content: [{ type: "text", text: "Acting on this page needs approval." }], isError: false },
      active: {} as never,
      entry: {} as never,
      input: {},
      session: "ses_branches",
      grants: new Set<string>(),
      allowSensitive: false,
      observation: "none",
      backend: "extension",
      context: {} as never,
      permission: Option.none(),
      organization: undefined,
    })
    const text = JSON.stringify(settled.kind === "result" ? settled.result.content : "")
    expect(text).toContain("Approved. Repeat the same step to perform it.")
    expect(text).not.toContain("The step ran")
    expect(settled.kind === "result" ? settled.result.metadata?.browser : undefined).toMatchObject({
      url: "https://example.com",
    })
  })

  test("a mixed read and act need is granted but never re-read", async () => {
    const { asserts, service } = recorder()
    const hub = fakeHub({
      call: (input) => {
        if (input.name !== "browser_click") return Promise.resolve({ content: [{ type: "text", text: "{}" }] })
        return Promise.reject(
          new BrowserHub.Failure({
            kind: "permission",
            message: "The page changed; its content is withheld until both classes are granted.",
            items: [
              { class: "read", origin: "https://example.com" },
              { class: "act", origin: "https://example.com" },
            ],
            afterAction: true,
          }),
        )
      },
    })
    const host = await boot({ backend: "extension", observation: "diff" }, { hub: hub.service, permission: service })
    const result = await host.call("browser_click", { target: "e1" })
    expect(result._tag).toBe("Success")
    // `every`: one act item is enough to keep the notice, so a mixed need must not read the page either.
    expect(hub.calls.map((call) => call.name)).toEqual(["browser_click"])
    const asked = asserts.filter((entry) => entry.action === "browser").flatMap((entry) => entry.resources ?? [])
    expect(asked).toEqual(["read:https://example.com", "act:https://example.com"])
    const text = JSON.stringify(result._tag === "Success" ? result.success.content : "")
    // The mixed need carried afterAction, so it ran: the model is told to read, never to repeat.
    expect(text).toContain("read the page again")
    expect(text).not.toContain("Repeat the same step")
  })

  test("a granted post-action step is spent on the identical repeat only", async () => {
    const { asserts, service } = recorder()
    let clicks = 0
    const downloads: (string | undefined)[] = []
    const hub = fakeHub({
      call: (input) => {
        if (input.name !== "browser_click") return Promise.resolve({ content: [{ type: "text", text: "{}" }] })
        clicks += 1
        downloads.push(input.sensitive?.[0])
        if (clicks === 1) {
          return Promise.reject(
            new BrowserHub.Failure({
              kind: "permission",
              message: "A download started (report.pdf) and was stopped: it needs the user's permission.",
              items: [{ class: "sensitive", origin: "https://example.com", reason: "download: report.pdf" }],
              stepToken: "tok-1",
              afterAction: true,
            }),
          )
        }
        return Promise.resolve({ content: [{ type: "text", text: "- file report.pdf" }] })
      },
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })

    // 1. The click runs once; the result says the download needs approval.
    const first = await host.call("browser_click", { target: "e1" })
    expect(first._tag).toBe("Success")
    expect(clicks).toBe(1)
    expect(JSON.stringify(first._tag === "Success" ? first.success.content : "")).toContain(
      "Approved. Repeat the same step to receive the file.",
    )
    expect(asserts.map((entry) => entry.action)).toEqual(["browser_click", "browser_sensitive"])

    // 2. The grant above triggered no call of its own.
    expect(clicks).toBe(1)

    // 3. The model repeats the step: it carries the extension's token.
    await host.call("browser_click", { target: "e1" })
    expect(clicks).toBe(2)
    expect(downloads[1]).toBe("tok-1")

    // 4. A later repeat without a fresh grant carries no token.
    await host.call("browser_click", { target: "e1" })
    expect(clicks).toBe(3)
    expect(downloads[2]).toBeUndefined()
  })

  test("another session's repeat never carries the token", async () => {
    const { service } = recorder()
    let clicks = 0
    const seen: (string | undefined)[] = []
    const hub = fakeHub({
      call: (input) => {
        if (input.name !== "browser_click") return Promise.resolve({ content: [{ type: "text", text: "{}" }] })
        clicks += 1
        seen.push(input.sensitive?.[0])
        if (clicks === 1) {
          return Promise.reject(
            new BrowserHub.Failure({
              kind: "permission",
              message: "A download started (report.pdf) and was stopped: it needs the user's permission.",
              items: [{ class: "sensitive", origin: "https://example.com", reason: "download: report.pdf" }],
              stepToken: "tok-1",
              afterAction: true,
            }),
          )
        }
        return Promise.resolve({ content: [{ type: "text", text: "- file report.pdf" }] })
      },
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service, permission: service })
    await host.call("browser_click", { target: "e1" })
    await host.call("browser_click", { target: "e1" }, "ses_other")
    expect(seen[1]).toBeUndefined()
  })

  test("the per-target backends are bounded through the plugin and an evicted one is disposed", async () => {
    let target = "a"
    const released: string[] = []
    const closed: string[] = []
    const base = fakeHub()
    const ports = new Map<string, BrowserHub.Port>()
    const service: BrowserHub.Interface = {
      port: (name) => {
        const label = name ?? ""
        const existing = ports.get(label)
        if (existing) return existing
        let handles = 0
        const port: BrowserHub.Port = {
          ...base.service.port(),
          open: () => {
            handles += 1
            return Promise.resolve({ sessionHandle: `${label}-${handles}` })
          },
          close: (handle) => {
            closed.push(handle)
            return Promise.resolve()
          },
          onRevoked: () => () => {
            released.push(label)
          },
        }
        ports.set(label, port)
        return port
      },
    }
    const host = await boot(() => ({ backend: "extension", target }), { hub: service })
    // Five targets through the real plugin wiring: the fifth call evicts the least recently used one.
    for (const label of ["a", "b", "c", "d", "e"]) {
      target = label
      await host.call("browser_snapshot")
    }
    expect([...ports.keys()]).toEqual(["a", "b", "c", "d", "e"])
    expect(released).toEqual(["a"])
    // The evicted backend closed the browser session it had opened.
    expect(closed).toEqual(["a-1"])
  })

  test("one effective backend serves the calls and the status: off wins, a Playwright pin forces it", () => {
    const extension = {
      backend: "extension" as const,
      observation: "diff" as const,
      allowSensitive: false,
      target: null,
      headless: true,
    }
    const allowed = { control: "allow" as const, origins: [] }
    const pinned = { control: "playwright_only" as const, origins: [] }
    const off = { control: "off" as const, origins: [] }
    // Without a policy the config decides, including the extension.
    expect(effective(extension, undefined)).toBe("extension")
    expect(effective(extension, allowed)).toBe("extension")
    // A Playwright pin forces the bundled browser, so no extension call can happen under it.
    expect(effective(extension, pinned)).toBe("playwright")
    // The user's own off wins over everything, and an organization's off is the same refusal.
    expect(effective({ ...extension, backend: "off" }, allowed)).toBe("off")
    expect(effective({ ...extension, backend: "off" }, pinned)).toBe("off")
    expect(effective(extension, off)).toBe("off")
  })

  test("no reachable extension still yields the actionable error through the tool layer", async () => {
    const host = await boot({ backend: "extension" })
    const result = await host.call("browser_snapshot")
    expect(result._tag).toBe("Failure")
    const error = result._tag === "Failure" ? (result.failure as Tool.Error) : undefined
    expect(error?.message).toBe(`${UNAVAILABLE_MESSAGE} ${EXTENSION_HINT}`)
    expect(error?.metadata).toMatchObject({ hint: EXTENSION_HINT })
  })

  test("a call with no reachable browser raises the setup notice for the UI", async () => {
    const host = await boot({ backend: "extension" })
    await host.call("browser_snapshot", {}, "ses_unavailable")
    expect(host.notices).toEqual([{ kind: "unavailable", sessionID: "ses_unavailable", hint: EXTENSION_HINT }])
  })

  test("a call in a stopped session raises the stopped notice and keeps the model text", async () => {
    const hub = fakeHub({ call: () => Promise.reject(new BrowserHub.Failure({ kind: "stopped", message: "stop" })) })
    const host = await boot({ backend: "extension" }, { hub: hub.service })
    const result = await host.call("browser_snapshot", {}, "ses_stopped")
    expect(result._tag === "Failure" ? (result.failure as Tool.Error).message : undefined).toBe(STOPPED)
    expect(host.notices).toEqual([{ kind: "stopped", sessionID: "ses_stopped" }])
  })

  test("a successful call or an ordinary refusal raises no notice", async () => {
    const hub = fakeHub({
      call: (input) =>
        input.name === "browser_click"
          ? Promise.reject(new BrowserHub.Failure({ kind: "blocked", message: "The browser refused this page." }))
          : Promise.resolve({ content: [{ type: "text", text: "- Page URL: http://localhost:3000" }] }),
    })
    const host = await boot({ backend: "extension" }, { hub: hub.service })
    await host.call("browser_snapshot")
    await host.call("browser_click", { element: "a", target: "e1" })
    expect(host.notices).toEqual([])
  })

  test("/browser share moves the active tab into the session's own browser session", async () => {
    const hub = fakeHub()
    const host = await boot({ backend: "extension" }, { hub: hub.service })
    expect(await host.control("share", "ses_share")).toEqual({ kind: "shared" })
    expect(hub.opened.map((entry) => entry.sessionId)).toEqual(["ses_share"])
    expect(hub.shared).toEqual(["handle-1"])
    // The next tool call of that session runs on the same browser session, and so does the page read after it.
    await host.call("browser_snapshot", {}, "ses_share")
    expect(hub.calls.map((call) => [call.name, call.sessionHandle])).toEqual([
      ["browser_snapshot", "handle-1"],
      ["browser_tabs", "handle-1"],
    ])
    expect(hub.opened).toHaveLength(1)
  })

  test("/browser adopt answers what the browser did", async () => {
    for (const kind of ["adopted", "none", "kept", "unconfirmed"] as const) {
      const host = await boot(
        { backend: "extension" },
        { hub: fakeHub({ adopt: () => Promise.resolve(kind) }).service },
      )
      expect(await host.control("adopt")).toEqual({ kind })
    }
  })

  test("share and adopt report the setup step, the browser's refusal, or the backend to choose", async () => {
    expect(await (await boot({ backend: "extension" })).control("share")).toEqual({
      kind: "unavailable",
      hint: EXTENSION_HINT,
    })
    const refusing = fakeHub({
      adopt: () =>
        Promise.reject(new BrowserHub.Failure({ kind: "blocked", message: "The browser has no active tab to share." })),
    })
    expect(await (await boot({ backend: "extension" }, { hub: refusing.service })).control("adopt")).toEqual({
      kind: "refused",
      message: "The browser has no active tab to share.",
    })
    expect(await (await boot({ backend: "playwright" })).control("share")).toEqual({ kind: "not_extension" })
  })
})

// The extension answers a step with its own outcome only: navigate with the page's identity, a click with what it did,
// a snapshot with the bare tree, the tab list as JSON. The tool layer reads the page state the Playwright MCP reports
// after the same steps, so every observation mode reads the same on both backends.
describe("observation over the extension backend", () => {
  const URL = "http://localhost:3000/list"
  const tree = (open: string) =>
    ['- RootWebArea "Checklist"', '  - checkbox "Notes" [ref=e2]', `  - text: Open items: ${open}`].join("\n")

  function extension(options: { snapshot?: (input: BrowserHub.CallInput) => Promise<BrowserHub.Reply> } = {}) {
    const page = { open: "3" }
    const text = (value: string) => Promise.resolve({ content: [{ type: "text" as const, text: value }] })
    return fakeHub({
      call: (input) => {
        if (input.name === "browser_navigate") return text(JSON.stringify({ title: "Checklist", url: URL }))
        if (input.name === "browser_click") {
          page.open = "2"
          return text('Clicked "Notes checkbox" with the left button.')
        }
        if (input.name === "browser_snapshot") return options.snapshot ? options.snapshot(input) : text(tree(page.open))
        if (input.name === "browser_tabs") {
          return text(
            JSON.stringify({
              tabs: [
                { index: 0, selected: false, title: "Mail", url: "[origin withheld]" },
                { index: 1, selected: true, title: "Checklist", url: URL },
              ],
            }),
          )
        }
        if (input.name === "browser_evaluate") return text('{"done":true}')
        return text("")
      },
    })
  }

  /** One tool call's outcome, as `boot().call` settles it. */
  type Outcome = { _tag: "Success"; success: unknown } | { _tag: "Failure"; failure: unknown }

  const textIn = (result: Outcome) => {
    if (result._tag !== "Success") throw new Error(`the call failed: ${String(result.failure)}`)
    const content = (result.success as Tool.Result).content
    if (typeof content === "string") return content
    const block = content?.find((item) => item.type === "text")
    return block?.type === "text" ? block.text : ""
  }

  test("full mode reports the URL, the title and the snapshot after navigate and after a click", async () => {
    const hub = extension()
    const host = await boot({ backend: "extension", observation: "full" }, { hub: hub.service })
    const navigated = textIn(await host.call("browser_navigate", { url: URL }))
    expect(navigated).toContain(`- Page URL: ${URL}`)
    expect(navigated).toContain("- Page Title: Checklist")
    expect(navigated).toContain("### Snapshot\n```yaml\n" + tree("3") + "\n```")
    // The navigate answer's own identity JSON is the Page section now, not repeated as a result.
    expect(navigated).not.toContain('"title"')
    const clicked = textIn(await host.call("browser_click", { target: "e2" }))
    expect(clicked).toContain(`- Page URL: ${URL}`)
    expect(clicked).toContain("- Page Title: Checklist")
    expect(clicked).toContain("Open items: 2")
    expect(clicked).toContain('Clicked "Notes checkbox" with the left button.')
    expect(hub.calls.map((call) => call.name)).toEqual([
      "browser_navigate",
      "browser_snapshot",
      "browser_click",
      "browser_snapshot",
      "browser_tabs",
    ])
  })

  test("diff mode reports only the changed snapshot lines after a click", async () => {
    const hub = extension()
    const host = await boot({ backend: "extension", observation: "diff" }, { hub: hub.service })
    const navigated = textIn(await host.call("browser_navigate", { url: URL }))
    expect(navigated).toContain(tree("3"))
    const clicked = textIn(await host.call("browser_click", { target: "e2" }))
    expect(clicked).toContain(`- Page URL: ${URL}`)
    expect(clicked).toContain("### Page changes\n- changed 1")
    expect(clicked).toContain("~   - text: Open items: 3\n  - text: Open items: 2")
    expect(clicked).not.toContain("### Snapshot")
    expect(clicked).not.toContain('checkbox "Notes"')
  })

  test("an explicit snapshot is the diff baseline for the next step", async () => {
    const hub = extension()
    const host = await boot({ backend: "extension", observation: "diff" }, { hub: hub.service })
    const read = textIn(await host.call("browser_snapshot"))
    expect(read).toContain(`- Page URL: ${URL}`)
    expect(read).toContain(tree("3"))
    const clicked = textIn(await host.call("browser_click", { target: "e2" }))
    expect(clicked).toContain("### Page changes\n- changed 1")
  })

  test("none mode reports status, URL and title without reading the page", async () => {
    const hub = extension()
    const host = await boot({ backend: "extension", observation: "none" }, { hub: hub.service })
    const navigated = textIn(await host.call("browser_navigate", { url: URL }))
    expect(navigated).toBe(`### Status\n- ok\n- Page URL: ${URL}\n- Page Title: Checklist`)
    const clicked = textIn(await host.call("browser_click", { target: "e2" }))
    expect(clicked).toBe(
      `### Status\n- ok\n- Page URL: ${URL}\n- Page Title: Checklist\n### Result\nClicked "Notes checkbox" with the left button.`,
    )
    // A result that is not page state survives none mode too.
    expect(textIn(await host.call("browser_evaluate", { function: "() => true" }))).toContain('{"done":true}')
    expect(hub.calls.map((call) => call.name)).toEqual([
      "browser_navigate",
      "browser_click",
      "browser_tabs",
      "browser_evaluate",
    ])
  })

  test("the page read carries the session's grants and no step token, and never prompts", async () => {
    const { asserts, service } = recorder()
    const hub = extension({
      snapshot: () =>
        Promise.reject(
          new BrowserHub.Failure({
            kind: "permission",
            message: "needs permission",
            items: [{ class: "read", origin: "https://shop.example.com" }],
          }),
        ),
    })
    // The click first asks for an act grant with a step token, then runs with both.
    const port = hub.service.port()
    const original = port.call
    let asked = false
    port.call = (input) => {
      if (input.name !== "browser_click" || asked) return original(input)
      asked = true
      return Promise.reject(
        new BrowserHub.Failure({
          kind: "permission",
          message: "needs permission",
          items: [{ class: "act", origin: "https://shop.example.com" }],
          stepToken: "tok",
        }),
      )
    }
    const host = await boot({ backend: "extension", observation: "diff" }, { hub: hub.service, permission: service })
    const clicked = textIn(await host.call("browser_click", { target: "e2" }))
    expect(clicked).toContain(`- Page URL: ${URL}`)
    expect(clicked).toContain("- Page Title: Checklist")
    expect(clicked).toContain("reading https://shop.example.com needs the user's permission")
    expect(clicked).toContain("browser_snapshot")
    expect(clicked).not.toContain("Open items")
    // The act grant was asked for the click; the refused follow-up read is never asked for.
    expect(asserts.map((entry) => entry.action)).toEqual(["browser_click", "browser"])
    const click = hub.calls.find((call) => call.name === "browser_click")
    expect(click?.sensitive).toEqual(["tok"])
    const read = hub.calls.find((call) => call.name === "browser_snapshot")
    expect(read?.authorized).toEqual([{ class: "act", origin: "https://shop.example.com" }])
    expect(read?.sensitive).toBeUndefined()
  })

  test("a read the session's own rules allow is granted for the page read without asking anyone", async () => {
    const asserts: { action: string }[] = []
    const service = {
      assert: (input: { action: string }) => Effect.sync(() => void asserts.push(input)),
      allows: (input: { action: string; resources: readonly string[] }) =>
        Effect.succeed(input.action !== "browser" || input.resources[0] === "read:http://localhost:3000"),
    } as unknown as Permission.Interface
    const hub = extension({
      snapshot: (input) =>
        input.authorized.some((pair) => pair.class === "read" && pair.origin === "http://localhost:3000")
          ? Promise.resolve({ content: [{ type: "text", text: tree("2") }] })
          : Promise.reject(
              new BrowserHub.Failure({
                kind: "permission",
                message: "needs permission",
                items: [{ class: "read", origin: "http://localhost:3000" }],
              }),
            ),
    })
    const host = await boot(
      { backend: "extension", observation: "full" },
      { hub: hub.service, permission: Option.some(service) },
    )
    expect(textIn(await host.call("browser_click", { target: "e2" }))).toContain(tree("2"))
    expect(textIn(await host.call("browser_click", { target: "e2" }))).toContain(tree("2"))
    // No prompt beyond the tools' own keys; the first read is refused and repeated once, the second runs granted.
    expect(asserts.map((entry) => entry.action)).toEqual(["browser_click", "browser_click"])
    expect(hub.calls.filter((call) => call.name === "browser_snapshot")).toHaveLength(3)
  })

  test("the page read obeys the per-tool rules: an ask or a deny for browser_snapshot or browser_tabs skips that read", async () => {
    for (const refused of ["browser_snapshot", "browser_tabs"]) {
      const service = {
        assert: () => Effect.void,
        allows: (input: { action: string }) => Effect.succeed(input.action !== refused),
      } as unknown as Permission.Interface
      const hub = extension()
      const host = await boot(
        { backend: "extension", observation: "full" },
        { hub: hub.service, permission: Option.some(service) },
      )
      const clicked = textIn(await host.call("browser_click", { target: "e2" }))
      const names = hub.calls.map((call) => call.name)
      expect(names).not.toContain(refused)
      expect(names).toContain(refused === "browser_snapshot" ? "browser_tabs" : "browser_snapshot")
      if (refused === "browser_tabs") expect(clicked).not.toContain("- Page URL:")
      else expect(clicked).not.toContain("### Snapshot")
    }
  })

  test("a permission service that throws reads nothing it would have to ask for", async () => {
    const service = {
      assert: () => Effect.void,
      allows: () => {
        throw new Error("no rules")
      },
    } as unknown as Permission.Interface
    const hub = extension()
    const host = await boot(
      { backend: "extension", observation: "full" },
      { hub: hub.service, permission: Option.some(service) },
    )
    expect(textIn(await host.call("browser_click", { target: "e2" }))).toContain("Clicked")
    expect(hub.calls.map((call) => call.name)).toEqual(["browser_click"])
  })

  test("a granted post-action read reads the page once and reports it with its URL", async () => {
    const { service } = recorder()
    const hub = extension()
    const port = hub.service.port()
    const original = port.call
    port.call = (input) =>
      input.name === "browser_click"
        ? Promise.reject(
            new BrowserHub.Failure({
              kind: "permission",
              message: "The page moved to http://localhost:3000; its content is withheld until read is granted.",
              items: [{ class: "read", origin: "http://localhost:3000" }],
              afterAction: true,
            }),
          )
        : original(input)
    const host = await boot({ backend: "extension", observation: "full" }, { hub: hub.service, permission: service })
    const clicked = textIn(await host.call("browser_click", { target: "e2" }))
    expect(clicked).toContain(`- Page URL: ${URL}`)
    expect(clicked).toContain(tree("3"))
    expect(hub.calls.map((call) => call.name)).toEqual(["browser_snapshot", "browser_tabs"])
  })

  test("frames the page read withholds stay withheld and reach the metadata", async () => {
    const hub = extension({
      snapshot: () =>
        Promise.resolve({
          content: [{ type: "text", text: `${tree("2")}\n  - iframe [origin withheld: https://pay.example.com]` }],
          meta: { withheldFrames: ["https://pay.example.com"] },
        }),
    })
    const host = await boot({ backend: "extension", observation: "full" }, { hub: hub.service })
    const result = await host.call("browser_click", { target: "e2" })
    expect(textIn(result)).toContain("- iframe [origin withheld: https://pay.example.com]")
    const answer = result._tag === "Success" ? (result.success as Tool.Result) : undefined
    expect(answer?.metadata?.browser).toMatchObject({
      url: URL,
      title: "Checklist",
      withheldFrames: ["https://pay.example.com"],
    })
  })
})
