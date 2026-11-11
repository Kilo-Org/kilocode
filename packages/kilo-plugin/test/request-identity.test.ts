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
import { KiloPlugins } from "../src"
import { KiloGatewayPlugin } from "../src/gateway"
import { KiloRequestIdentity } from "../src/request-identity"

const it = testEffect(PluginTestLayer)
const app = { name: "vscode", version: "7.1.0", channel: "latest" }
const client = { "User-Agent": "kilo/latest/7.1.0/vscode" }
const product = { "HTTP-Referer": "https://kilocode.ai", "X-Title": "Kilo Code", "User-Agent": "Kilo-Code/7.1.0" }
const untouched = ["kilo", "openai", "github-copilot", "github-copilot-enterprise", "snowflake-cortex", "claude-agent"]

describe("KiloRequestIdentity.headers", () => {
  test.each(["opencode", "opencode-go", "opencode-anything", "anthropic"])(
    "%s gets the client user agent only",
    (id) => {
      expect(KiloRequestIdentity.headers(id, app)).toEqual(client)
    },
  )

  test.each(["openrouter", "azure", "xai", "google", "amazon-bedrock", "my-proxy", "anthropic-proxy", "xopencode"])(
    "%s gets the product user agent, referer and title",
    (id) => {
      expect(KiloRequestIdentity.headers(id, app)).toEqual(product)
    },
  )

  test.each(untouched)("%s is left as built", (id) => {
    expect(KiloRequestIdentity.headers(id, app)).toBeUndefined()
  })

  // A user names a custom provider. IDs that look like object members or like another provider in a different
  // case are ordinary providers.
  test.each([
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
  ])("the provider ID %j is an ordinary provider", (id) => {
    expect(KiloRequestIdentity.headers(id, app)).toEqual(product)
  })

  test("a missing or empty build value becomes unknown", () => {
    expect(KiloRequestIdentity.headers("anthropic", {})).toEqual({ "User-Agent": "kilo/unknown/unknown/unknown" })
    expect(KiloRequestIdentity.headers("anthropic", { name: "", version: "", channel: "" })).toEqual({
      "User-Agent": "kilo/unknown/unknown/unknown",
    })
    expect(KiloRequestIdentity.headers("openrouter", {})).toEqual({ ...product, "User-Agent": "Kilo-Code/unknown" })
  })

  test("a client name cannot add a segment, a line or a second header", () => {
    const value = KiloRequestIdentity.headers("anthropic", {
      name: "vs code/../x\r\nX-Injected: 1",
      version: "7.1.0-beta.3+abc",
      channel: "latest\n",
    })
    expect(value).toEqual({ "User-Agent": "kilo/latest/7.1.0-beta.3+abc/vscode..xX-Injected1" })
  })
})

describe("KiloRequestIdentity.apply", () => {
  test("replaces a header that is present in another case instead of adding a second one", () => {
    const headers: Record<string, string> = {
      "user-agent": "first",
      "USER-AGENT": "second",
      "http-referer": "https://opencode.ai/",
      "x-title": "opencode",
      "x-opencode-client": "vscode",
    }
    KiloRequestIdentity.apply(headers, product)
    expect(headers).toEqual({ "x-opencode-client": "vscode", ...product })
    expect(Object.keys(headers).filter((name) => name.toLowerCase() === "user-agent")).toEqual(["User-Agent"])
  })

  test("leaves the referer and title of a request that only gets the client user agent", () => {
    const headers: Record<string, string> = { "User-Agent": "opencode/latest/7.1.0/vscode", "X-Title": "other" }
    KiloRequestIdentity.apply(headers, client)
    expect(headers).toEqual({ "User-Agent": "kilo/latest/7.1.0/vscode", "X-Title": "other" })
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
  return yield* PluginHost.make(yield* Plugin.Service, "test").pipe(Effect.provideService(App.Metadata, App.make(app)))
})

describe("KiloRequestIdentity.Plugin", () => {
  it.effect("names Kilo per provider and keeps every other header of the request", () =>
    Effect.gen(function* () {
      yield* KiloRequestIdentity.Plugin.effect(yield* host())
      const hooks = yield* PluginHooks.Service
      const base = built("ses_fixture")
      for (const id of ["anthropic", "opencode", "opencode-go"])
        expect((yield* hooks.trigger("session", "model.request", request(id))).headers).toEqual({ ...base, ...client })
      for (const id of ["openrouter", "azure", "my-proxy"])
        expect((yield* hooks.trigger("session", "model.request", request(id))).headers).toEqual({ ...base, ...product })
      for (const id of untouched)
        expect((yield* hooks.trigger("session", "model.request", request(id))).headers).toEqual(base)
    }),
  )

  it.effect("sends one user agent when an earlier hook wrote it in another case", () =>
    Effect.gen(function* () {
      const plugin = yield* host()
      yield* plugin.session.hook("model.request", (event) =>
        Effect.sync(() => {
          event.headers["user-agent"] = "earlier"
          event.headers["Http-Referer"] = "https://earlier.example"
        }),
      )
      yield* KiloRequestIdentity.Plugin.effect(plugin)
      const hooks = yield* PluginHooks.Service
      const headers = (yield* hooks.trigger("session", "model.request", request("openrouter"))).headers
      expect(headers).toEqual({ ...built("ses_fixture"), ...product })
      expect(new Headers(headers).get("user-agent")).toBe("Kilo-Code/7.1.0")
      expect(new Headers(headers).get("http-referer")).toBe("https://kilocode.ai")
    }),
  )

  it.effect("a plugin that registers later can still replace the identity", () =>
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
        ...product,
        "User-Agent": "user-plugin/1",
      })
    }),
  )

  test("registers before the Gateway and before the config plugins", () => {
    const ids = KiloPlugins.map((plugin) => plugin.id)
    expect(ids).toContain(KiloRequestIdentity.Plugin.id)
    expect(ids.indexOf(KiloRequestIdentity.Plugin.id)).toBeLessThan(ids.indexOf(KiloGatewayPlugin.id))
  })

  // The Gateway request keeps the Gateway's own headers in either registration order: this plugin does not write a
  // `kilo` request at all.
  for (const order of ["identity first", "gateway first"] as const)
    it.live(`the Gateway user agent wins with ${order}`, () =>
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
                if (order === "gateway first") yield* gateway
                yield* KiloRequestIdentity.Plugin.effect(plugin)
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
                ).toBe("Kilo-Code/7.1.0")
              }),
          ),
        (backend) => Effect.sync(() => backend[Symbol.dispose]()),
      ),
    )
})
