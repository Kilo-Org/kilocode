import { afterEach, describe, expect, mock, test } from "bun:test"
import { Config } from "@opencode/core/config"
import { Permission } from "@opencode/core/permission"
import { KiloConfigPolicy } from "@opencode/core/kilocode/config/policy"
import { Document } from "@opencode/schema/config"
import { Tool } from "@opencode/schema/tool"
import { Skill } from "@opencode/schema/skill"
import { Effect, Exit, Option, Scope, Stream } from "effect"
import { UNAVAILABLE_MESSAGE } from "../../src/browser/backend"
import { BrowserContract } from "../../src/browser/contract"
import { EXTENSION_HINT } from "../../src/browser/extension"
import { BrowserHub } from "../../src/browser/hub"
import { resetSteps } from "../../src/browser/steps"
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
function fakeHub(options: { call?: (input: BrowserHub.CallInput) => Promise<BrowserHub.Reply> } = {}) {
  const calls: BrowserHub.CallInput[] = []
  const opened: { sessionId: string; title: string; cwd: string }[] = []
  const began: BrowserHub.Upload[] = []
  let handles = 0
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
    onRevoked: () => () => {},
  }
  return { calls, opened, began, service: { port: () => port } satisfies BrowserHub.Interface }
}

/** No extension is reachable: the backend reports the model-facing unavailable error. */
function unreachable(): BrowserHub.Interface {
  return {
    port: () =>
      ({
        ready: () => Promise.reject(new BrowserHub.Failure({ kind: "unavailable", message: "no extension is connected" })),
        reported: () => Promise.resolve(undefined),
        onRevoked: () => () => {},
      }) as never,
  }
}

/** A stand-in permission service that records what it was asked. */
function recorder() {
  const asserts: { action: string; resources: readonly string[]; save?: readonly string[] }[] = []
  const service = {
    assert: (input: { action: string; resources: readonly string[]; save?: readonly string[] }) =>
      Effect.sync(() => void asserts.push(input)),
  } as unknown as Permission.Interface
  return { asserts, service: Option.some(service) }
}

/** The plugin against a stand-in tool editor and a config document holding one `browser` block. */
type Hook = (event: Record<string, unknown>) => Effect.Effect<void, unknown>

async function boot(
  browser?: Browser | (() => Browser),
  options: { hub?: BrowserHub.Interface; permission?: Option.Option<Permission.Interface> } = {},
) {
  const transforms: ((editor: { add: (tool: Tool.Info) => void }) => void)[] = []
  const hooks: Hook[] = []
  const skills: Skill.Info[] = []
  const registrations: string[] = []
  const statuses: (() => Effect.Effect<unknown>)[] = []
  const ctx = {
    location: { directory: "/tmp/browser-tools-test" },
    skill: {
      transform: (fn: (editor: { add: (skill: Skill.Info) => void }) => void) =>
        Effect.sync(() => fn({ add: (skill) => skills.push(skill) })),
    },
    // The status RPC the settings dialog reads; `status` below calls the handler the plugin registers.
    rpc: {
      register: (definition: { id: string }, handlers: { status: () => Effect.Effect<unknown> }) =>
        Effect.sync(() => {
          registrations.push(definition.id)
          statuses.push(handlers.status)
          return { events: { emit: () => Effect.void }, dispose: Effect.void }
        }),
    },
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
    Option.isSome(permission)
      ? provided.pipe(Effect.provideService(Permission.Service, permission.value))
      : provided,
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
  return { tools, skills, call, evaluate, registrations, status }
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

  test("registers the whole pinned contract with the vendored schemas", async () => {
    const host = await boot()
    const tools = host.tools()
    expect(host.skills.map((skill) => skill.id)).toEqual([Skill.ID.make("browser-automation")])
    expect(tools.length).toBe(26)
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
    expect(host.tools().length).toBe(26)
  })

  test("registers the browser status RPC even when the backend is off", async () => {
    const host = await boot({ backend: "off" })
    expect(host.registrations).toEqual(["kilocode.browser"])
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

describe("browser tools over the extension backend", () => {
  const page = (url: string, title: string, lines: string[] = []) =>
    ["### Page", `- Page URL: ${url}`, `- Page Title: ${title}`, "", "### Snapshot", "```yaml", ...lines, "```"].join(
      "\n",
    )

  test("a call reaches the extension and the metadata names its backend and page", async () => {
    const hub = fakeHub({
      call: () =>
        Promise.resolve({
          content: [{ type: "text", text: page("http://localhost:3000", "Local", ["- button \"Send\""]) }],
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
        return Promise.resolve({ content: [{ type: "text", text: page("https://example.com", "Example", ["- link \"Hi\""]) }] })
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

  test("browser_snapshot diff mode compares the extension's snapshots", async () => {
    let index = 0
    const hub = fakeHub({
      call: () => {
        index += 1
        const lines = index === 1 ? ["- button \"Send\""] : ["- button \"Pay\"", "- text \"Thanks\""]
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
    const extension = { backend: "extension" as const, observation: "diff" as const, allowSensitive: false, target: null, headless: true }
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
})
