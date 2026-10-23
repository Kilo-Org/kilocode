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
import { KiloApp } from "../src/app"

// The OpenAI sign-in flows with the app identity the Kilo host gives the server, as on v1.
const it = testEffect(PluginTestLayer)
const integrationID = Integration.ID.make("openai")

const add = Effect.fn(function* (plugin: typeof OpenAIPlugin | typeof ChatGPTPlugin) {
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

// The Codex browser method binds the fixed ports 1455 and 1457, which packages/server tests hold in parallel, so
// only the ChatGPT loopback runs here. Codex uses the same product value for its URL as for the tested headers.
const connect = Effect.fn(function* (methodID: string) {
  const integrations = yield* Integration.Service
  const attempt = yield* integrations.oauth.connect({ integrationID, methodID: Integration.MethodID.make(methodID) })
  return new URL(attempt.url)
})

const callback = (url: URL, params: Record<string, string>) =>
  Effect.promise(async () => {
    const target = new URL(url.searchParams.get("redirect_uri") ?? "")
    for (const [key, value] of Object.entries(params)) target.searchParams.set(key, value)
    const response = await fetch(target)
    return { status: response.status, html: await response.text() }
  })

function expectKiloPage(html: string) {
  expect(html).toContain("· Kilo</title>")
  expect(html).toContain('aria-label="Kilo Code"')
  expect(html).not.toContain("OpenCode")
}

describe("Kilo OpenAI sign-in branding", () => {
  it.live("ChatGPT token sharing suggests the Kilo agent name and shows a Kilo callback page", () =>
    Effect.gen(function* () {
      yield* add(ChatGPTPlugin)
      const url = yield* connect("chatgpt-token-sharing")
      expect(url.searchParams.get("agent_name_hint")).toBe("Kilo")
      expect(url.searchParams.get("client_id")).toBe("dynamic_agent_client")
      const page = yield* callback(url, { code: "test-code", state: url.searchParams.get("state") ?? "" })
      expect(page.status).toBe(400)
      expect(page.html).toContain("Kilo couldn't finish connecting to ChatGPT.")
      expectKiloPage(page.html)
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

  it.effect("the shared success page shows Kilo, and stays OpenCode without a product", () =>
    Effect.sync(() => {
      const page = OauthCallbackPage.success({ provider: "ChatGPT" })
      const kilo = OauthCallbackPage.brand(page, KiloApp.product)
      expect(kilo).toContain("Kilo is now connected to ChatGPT.")
      expectKiloPage(kilo)
      expect(OauthCallbackPage.brand(page)).toBe(page)
      expect(page).toContain("OpenCode is now connected to ChatGPT.")
    }),
  )
})
