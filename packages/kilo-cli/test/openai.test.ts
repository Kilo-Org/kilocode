import { describe, expect } from "bun:test"
import { App } from "@opencode/core/app"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { OauthCallbackPage } from "@opencode/core/oauth/page"
import { Plugin } from "@opencode/core/plugin"
import { PluginHooks } from "@opencode/core/plugin/hooks"
import { PluginHost } from "@opencode/core/plugin/host"
import { ChatGPTPlugin } from "@opencode/core/plugin/provider/chatgpt"
import { OpenAIPlugin } from "@opencode/core/plugin/provider/openai"
import { Provider } from "@opencode/core/provider"
import { Session } from "@opencode/core/session"
import { Agent } from "@opencode/schema/agent"
import { Effect } from "effect"
import { HttpClient, HttpClientResponse } from "effect/http"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { testEffect } from "../../core/test/lib/effect"
import { KiloOpenAIPlugin } from "../../kilo-plugin/src/openai"
import { KiloApp } from "../src/app"

// OpenAI sign-in with the Kilo host, as on v1: the methods it offers and the app identity it gives the server.
const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("openai")

const add = Effect.fn(function* (plugin: typeof OpenAIPlugin | typeof ChatGPTPlugin | typeof KiloOpenAIPlugin) {
  const host = yield* PluginHost.make(yield* Plugin.Service, plugin.id).pipe(
    Effect.provideService(App.Metadata, App.make(KiloApp)),
  )
  yield* plugin.effect(host).pipe(
    Effect.provideService(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.succeed(HttpClientResponse.fromWeb(request, Response.json({}, { status: 503 }))),
      ),
    ),
  )
})

function expectKiloPage(html: string) {
  expect(html).toContain("· Kilo</title>")
  expect(html).toContain('aria-label="Kilo Code"')
  expect(html).not.toContain("OpenCode")
}

describe("Kilo OpenAI sign-in", () => {
  it.effect("offers the v1 sign-in methods: Codex browser and device code, without ChatGPT token sharing", () =>
    Effect.gen(function* () {
      yield* add(ChatGPTPlugin)
      yield* add(OpenAIPlugin)
      yield* add(KiloOpenAIPlugin)
      const integrations = yield* Integration.Service
      expect(
        (yield* integrations.get(integrationID))?.methods.map((method) => method.type === "oauth" && method.id),
      ).toEqual([Integration.MethodID.make("chatgpt-browser"), Integration.MethodID.make("chatgpt-headless")])
    }),
  )

  it.effect("Codex requests send the Kilo originator", () =>
    Effect.gen(function* () {
      const credentials = yield* Credential.Service
      yield* credentials.create({
        integrationID,
        value: Credential.OAuth.make({
          type: "oauth",
          methodID: Integration.MethodID.make("chatgpt-browser"),
          access: "chatgpt-token",
          refresh: "refresh",
          expires: Date.now() + 60_000,
          metadata: { accountID: "acct_123" },
        }),
      })
      const catalog = yield* Provider.Service
      const models = yield* Model.Service
      yield* catalog.transform((editor) => {
        editor.update(Provider.ID.openai, (draft) => {
          draft.package = "@opencode/ai/providers/openai"
        })
        editor.models.update(Provider.ID.openai, Model.ID.make("gpt-5.5"), () => {})
      })
      yield* add(OpenAIPlugin)
      const hooks = yield* PluginHooks.Service
      const event = yield* hooks.trigger("session", "model.request", {
        sessionID: Session.ID.make("ses_test"),
        agent: Agent.ID.make("build"),
        model: Model.Ref.make({ providerID: Provider.ID.openai, id: Model.ID.make("gpt-5.5") }),
        kind: "primary",
        baseURL: "https://api.openai.com/v1",
        headers: {},
      })
      expect(event.headers.originator).toBe("kilo")
      expect((yield* catalog.get(Provider.ID.openai))?.headers?.originator).toBe("kilo")
      expect((yield* models.get(Provider.ID.openai, Model.ID.make("gpt-5.5")))?.headers?.originator).toBe("kilo")
    }),
  )

  it.effect("the callback pages show Kilo, and stays OpenCode without a product", () =>
    Effect.sync(() => {
      const page = OauthCallbackPage.success({ provider: "ChatGPT" })
      const kilo = OauthCallbackPage.brand(page, KiloApp.product)
      expect(kilo).toContain("Kilo is now connected to ChatGPT.")
      expectKiloPage(kilo)
      expectKiloPage(
        OauthCallbackPage.brand(OauthCallbackPage.error("access_denied", { provider: "ChatGPT" }), KiloApp.product),
      )
      expect(OauthCallbackPage.brand(page)).toBe(page)
      expect(page).toContain("OpenCode is now connected to ChatGPT.")
    }),
  )
})
