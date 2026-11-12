import { describe, expect, test } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { App } from "@opencode/core/app"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { KiloPlugin } from "@opencode/core/plugin/provider/kilo"
import { Provider } from "@opencode/core/provider"
import { Agent } from "@opencode/schema/agent"
import { Session } from "@opencode/schema/session"
import { Global } from "@opencode/util/global"
import { Effect } from "effect"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloPlugins, KiloPostPlugins } from "../src"
import { KiloGatewayPlugin } from "../src/gateway"
import { KiloRequestIdentity } from "../src/request-identity"

const it = testEffect(PluginTestLayer)
const app = { name: "vscode", version: "7.1.0", channel: "latest" }
const clientAgent = "kilo/latest/7.1.0/vscode"
const productAgent = "Kilo-Code/7.1.0"
const kilo = { "HTTP-Referer": "https://kilocode.ai", "X-Title": "Kilo Code" }
const upstream = { "HTTP-Referer": "https://opencode.ai/", "X-Title": "opencode" }
const clients = ["opencode", "opencode-go", "opencode-anything", "anthropic"]
const untouched = ["kilo", "openai", "github-copilot", "xai", "snowflake-cortex", "claude-agent"]
// A user names a custom provider. IDs that look like object members, like another provider in a different case or
// like a longer form of an untouched one are ordinary providers.
const ordinary = [
  "openrouter",
  "azure",
  "google",
  "amazon-bedrock",
  "my-proxy",
  "anthropic-proxy",
  "xopencode",
  "github-copilot-proxy",
  "",
  " ",
  "__proto__",
  "constructor",
  "toString",
  "hasOwnProperty",
  "Kilo",
  "OpenAI",
  "Anthropic",
  " openai",
]

describe("KiloRequestIdentity.userAgent", () => {
  test.each(clients)("%s gets the client user agent", (id) => {
    expect(KiloRequestIdentity.userAgent(id, app)).toBe(clientAgent)
  })

  test.each(ordinary)("the provider %j gets the product user agent", (id) => {
    expect(KiloRequestIdentity.userAgent(id, app)).toBe(productAgent)
  })

  test.each(untouched)("%s keeps its user agent", (id) => {
    expect(KiloRequestIdentity.userAgent(id, app)).toBeUndefined()
  })

  test("a missing or empty build value becomes unknown", () => {
    expect(KiloRequestIdentity.userAgent("anthropic", {})).toBe("kilo/unknown/unknown/unknown")
    expect(KiloRequestIdentity.userAgent("anthropic", { name: "", version: "", channel: "" })).toBe(
      "kilo/unknown/unknown/unknown",
    )
    expect(KiloRequestIdentity.userAgent("openrouter", {})).toBe("Kilo-Code/unknown")
  })

  test("a client name cannot add a segment, a line or a second header", () => {
    expect(
      KiloRequestIdentity.userAgent("anthropic", {
        name: "vs code/../x\r\nX-Injected: 1",
        version: "7.1.0-beta.3+abc",
        channel: "latest\n",
      }),
    ).toBe("kilo/latest/7.1.0-beta.3+abc/vscode..xX-Injected1")
  })
})

describe("KiloRequestIdentity.referer", () => {
  test.each(ordinary)("the provider %j gets the Kilo referer and title when it has none", (id) => {
    expect(KiloRequestIdentity.referer(id)).toEqual(kilo)
    expect(KiloRequestIdentity.referer(id, { "X-Other": "kept" })).toEqual({ "X-Other": "kept", ...kilo })
  })

  test("the upstream default is replaced, in any header case", () => {
    expect(KiloRequestIdentity.referer("openrouter", upstream)).toEqual(kilo)
    expect(
      KiloRequestIdentity.referer("openrouter", { "http-referer": "https://opencode.ai/", "x-title": "opencode" }),
    ).toEqual(kilo)
  })

  test("a configured referer or title is kept, each on its own and in any header case", () => {
    expect(
      KiloRequestIdentity.referer("my-proxy", {
        "HTTP-Referer": "https://configured.example",
        "X-Title": "Configured",
      }),
    ).toBeUndefined()
    expect(KiloRequestIdentity.referer("my-proxy", { "http-referer": "https://configured.example" })).toEqual({
      "http-referer": "https://configured.example",
      "X-Title": "Kilo Code",
    })
    expect(
      KiloRequestIdentity.referer("openrouter", { "HTTP-Referer": "https://opencode.ai/", "x-title": "Configured" }),
    ).toEqual({ "x-title": "Configured", "HTTP-Referer": "https://kilocode.ai" })
    // A record that names the title twice keeps both when one of them is configured.
    expect(KiloRequestIdentity.referer("openrouter", { ...upstream, "x-title": "Configured" })).toEqual({
      "X-Title": "opencode",
      "x-title": "Configured",
      "HTTP-Referer": "https://kilocode.ai",
    })
    // Also when the configured value is an empty string.
    expect(KiloRequestIdentity.referer("my-proxy", { "HTTP-Referer": "", "X-Title": "" })).toBeUndefined()
  })

  test("writing the defaults a second time changes nothing", () => {
    expect(
      KiloRequestIdentity.referer("openrouter", KiloRequestIdentity.referer("openrouter", upstream)),
    ).toBeUndefined()
  })

  test.each([...clients, ...untouched])("%s gets no referer or title", (id) => {
    expect(KiloRequestIdentity.referer(id)).toBeUndefined()
    expect(KiloRequestIdentity.referer(id, upstream)).toBeUndefined()
  })
})

// What the server puts on every model request before the hooks run (packages/core/src/session/model-request.ts).
const built = (id: string) => ({
  "x-opencode-session-id": id,
  "x-session-affinity": id,
  "X-Session-Id": id,
  "User-Agent": App.useragent(App.make(app)),
  "x-opencode-project": "prj_fixture",
  "x-opencode-session": id,
  "x-opencode-client": app.name,
})

const request = (providerID: string, headers: Record<string, string> = built("ses_fixture")) => ({
  sessionID: Session.ID.make("ses_fixture"),
  agent: Agent.ID.make("code"),
  model: Model.Ref.make({ providerID: Provider.ID.make(providerID), id: Model.ID.make("echo") }),
  kind: "primary" as const,
  headers,
})

const host = Effect.fn(function* () {
  return yield* PluginHost.make(yield* Plugin.Service, "test").pipe(Effect.provideService(App.Service, App.make(app)))
})

describe("KiloRequestIdentity.Plugin", () => {
  it.effect("replaces the user agent per provider and keeps every other header of the request", () =>
    Effect.gen(function* () {
      yield* KiloRequestIdentity.Plugin.effect(yield* host())
      const hooks = yield* PluginHooks.Service
      const base = { ...built("ses_fixture"), "X-Title": "from an earlier hook" }
      const send = (id: string) => hooks.trigger("session", "model.request", request(id, { ...base }))
      for (const id of clients) expect((yield* send(id)).headers).toEqual({ ...base, "User-Agent": clientAgent })
      for (const id of ["openrouter", "azure", "my-proxy"])
        expect((yield* send(id)).headers).toEqual({ ...base, "User-Agent": productAgent })
      for (const id of untouched) expect((yield* send(id)).headers).toEqual(base)
    }),
  )

  it.effect("sends one user agent when an earlier hook wrote it in another case", () =>
    Effect.gen(function* () {
      const plugin = yield* host()
      yield* plugin.session.hook("model.request", (event) =>
        Effect.sync(() => {
          event.headers["user-agent"] = "earlier"
          event.headers["USER-AGENT"] = "earlier still"
        }),
      )
      yield* KiloRequestIdentity.Plugin.effect(plugin)
      const hooks = yield* PluginHooks.Service
      const headers = (yield* hooks.trigger("session", "model.request", request("openrouter"))).headers
      expect(headers).toEqual({ ...built("ses_fixture"), "User-Agent": productAgent })
      expect(new Headers(headers).get("user-agent")).toBe(productAgent)
    }),
  )

  it.effect("a plugin that registers later can still replace the user agent", () =>
    Effect.gen(function* () {
      const plugin = yield* host()
      yield* KiloRequestIdentity.Plugin.effect(plugin)
      yield* plugin.session.hook("model.request", (event) =>
        Effect.sync(() => {
          event.headers["User-Agent"] = "user-plugin/1"
        }),
      )
      const hooks = yield* PluginHooks.Service
      expect((yield* hooks.trigger("session", "model.request", request("openrouter"))).headers).toEqual({
        ...built("ses_fixture"),
        "User-Agent": "user-plugin/1",
      })
    }),
  )

  test("registers before the Gateway and the config plugins, and the referer default after the config plugins", () => {
    const ids = KiloPlugins.map((plugin) => plugin.id)
    expect(ids).toContain(KiloRequestIdentity.Plugin.id)
    expect(ids.indexOf(KiloRequestIdentity.Plugin.id)).toBeLessThan(ids.indexOf(KiloGatewayPlugin.id))
    expect(KiloPostPlugins.map((plugin) => plugin.id)).toContain(KiloRequestIdentity.Referer.id)
  })

  // The Gateway request keeps the Gateway's own headers in either registration order: neither part writes a `kilo`
  // request or the `kilo` provider.
  for (const order of ["identity first", "gateway first"] as const)
    it.live(`the Gateway identity wins with ${order}`, () =>
      Effect.acquireUseRelease(
        Effect.sync(() => fixture()),
        (backend) =>
          withEnv(
            {
              KILO_API_URL: backend.url,
              KILO_API_KEY: "env-token",
              KILOCODE_TOKEN: undefined,
              KILO_AUTH_CONTENT: undefined,
              KILO_AI_GATEWAY_URL: undefined,
              KILO_ORG_ID: undefined,
              KILO_MACHINE_ID: "mach-test",
              KILOCODE_EDITOR_NAME: undefined,
              KILOCODE_FEATURE: undefined,
              KILO_PLATFORM: undefined,
              KILOCODE_VERSION: undefined,
            },
            () =>
              Effect.gen(function* () {
                const providers = yield* Provider.Service
                yield* providers.transform((editor) => {
                  editor.update(Provider.ID.make("kilo"), (provider) => {
                    provider.package = "@opencode/ai/providers/openai-compatible"
                    provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
                  })
                })
                const plugin = yield* host()
                yield* KiloPlugin.effect(plugin)
                const gateway = KiloGatewayPlugin.effect(plugin).pipe(Effect.provide(Global.layerWith({})))
                const identity = Effect.gen(function* () {
                  yield* KiloRequestIdentity.Plugin.effect(plugin)
                  yield* KiloRequestIdentity.Referer.effect(plugin)
                })
                if (order === "gateway first") yield* gateway
                yield* identity
                if (order === "identity first") yield* gateway
                const hooks = yield* PluginHooks.Service
                const session = yield* plugin.session.create({ title: "gateway" })
                const headers = (yield* hooks.trigger("session", "model.request", {
                  ...request("kilo", built(session.id)),
                  sessionID: session.id,
                })).headers
                expect(headers["User-Agent"]).toBe("Kilo-Code/v2/7.1.0")
                expect(headers["X-KILOCODE-TASKID"]).toBe(session.id)
                expect(Object.keys(headers).filter((name) => name.toLowerCase() === "user-agent")).toEqual([
                  "User-Agent",
                ])
                // The same pipeline still names Kilo on another provider.
                expect(
                  (yield* hooks.trigger("session", "model.request", request("openrouter"))).headers["User-Agent"],
                ).toBe(productAgent)
              }),
          ),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      ),
    )
})

describe("KiloRequestIdentity.Referer", () => {
  const id = (value: string) => Provider.ID.make(value)
  const echo = Model.ID.make("echo")

  it.effect("sets the default on the provider record, and a header configured on the provider or a model wins", () =>
    Effect.gen(function* () {
      const providers = yield* Provider.Service
      const models = yield* Model.Service
      // The state a post plugin sees: the upstream defaults and the config are already applied.
      yield* providers.transform((editor) => {
        const add = (provider: string, headers?: Record<string, string>, model?: Record<string, string>) => {
          editor.update(id(provider), (draft) => {
            draft.package = "@opencode/ai/providers/openai-compatible"
            draft.headers = headers
          })
          editor.models.update(id(provider), echo, (draft) => {
            draft.headers = model
          })
        }
        add("plain")
        add("openrouter", upstream)
        add("configured", { "http-referer": "https://configured.example", "X-Other": "kept" })
        add("model", undefined, { "x-title": "Configured on the model" })
        add("anthropic")
        add("opencode", upstream)
        for (const provider of untouched) add(provider, upstream)
      })
      yield* KiloRequestIdentity.Referer.effect(yield* host())

      expect((yield* providers.get(id("plain")))?.headers).toEqual(kilo)
      expect((yield* providers.get(id("openrouter")))?.headers).toEqual(kilo)
      expect((yield* providers.get(id("configured")))?.headers).toEqual({
        "http-referer": "https://configured.example",
        "X-Other": "kept",
        "X-Title": "Kilo Code",
      })
      expect((yield* providers.get(id("anthropic")))?.headers).toBeUndefined()
      expect((yield* providers.get(id("opencode")))?.headers).toEqual(upstream)
      for (const provider of untouched) expect((yield* providers.get(id(provider)))?.headers).toEqual(upstream)

      // What a request of the model carries: the provider headers under the model's own.
      const sent = (provider: string) =>
        models.get(id(provider), echo).pipe(Effect.map((model) => new Headers(model?.headers)))
      expect((yield* sent("plain")).get("x-title")).toBe("Kilo Code")
      expect((yield* sent("model")).get("x-title")).toBe("Configured on the model")
      expect((yield* sent("model")).get("http-referer")).toBe("https://kilocode.ai")
      expect((yield* sent("configured")).get("http-referer")).toBe("https://configured.example")
      expect([...(yield* sent("anthropic")).keys()]).toEqual([])
    }),
  )
})
