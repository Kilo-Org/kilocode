import { describe, expect } from "bun:test"
import { fixture } from "@kilocode/gateway-core/testing"
import { Effect } from "effect"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { PluginHost } from "@opencode/core/plugin/host"
import { KiloPlugin } from "@opencode/core/plugin/provider/kilo"
import { Provider } from "@opencode/core/provider"
import { Rpc } from "@opencode/core/rpc"
import { Global } from "@opencode/util/global"
import { withEnv } from "../../core/test/fixture/env"
import { testEffect } from "../../core/test/lib/effect"
import { PluginTestLayer } from "../../core/test/plugin/fixture"
import { KiloGatewayPlugin } from "../src/gateway"

const it = testEffect(PluginTestLayer)
const kilo = Provider.ID.make("kilo")
// Keep the developer environment out of the requests.
const env = {
  KILO_API_KEY: undefined,
  KILOCODE_TOKEN: undefined,
  KILO_AUTH_CONTENT: undefined,
  KILO_API_URL: undefined,
  KILO_AI_GATEWAY_URL: undefined,
  KILO_ORG_ID: undefined,
  KILO_MACHINE_ID: undefined,
  KILOCODE_EDITOR_NAME: undefined,
  KILOCODE_VERSION: undefined,
  MISTRAL_API_KEY: undefined,
  INCEPTION_API_KEY: undefined,
}
const edit = {
  currentFilePath: "src/index.ts",
  currentFileContent: "export const value = 1\n",
  cursorLine: 0,
  cursorCharacter: 0,
  editableRegionStartLine: 0,
  editableRegionEndLine: 0,
  recentlyViewedSnippets: [],
  editDiffHistory: [],
}

const addPlugin = Effect.fn(function* () {
  const providers = yield* Provider.Service
  yield* providers.transform((editor) => {
    editor.update(kilo, (provider) => {
      provider.integrationID = Integration.ID.make("kilo")
      provider.package = "@opencode/ai/providers/openai-compatible"
      provider.settings = { baseURL: "https://api.kilo.ai/api/gateway" }
    })
    editor.models.set(kilo, [Model.Info.default(kilo, Model.ID.make("models-dev/only"))])
  })
  const host = yield* PluginHost.make(yield* Plugin.Service, "test")
  yield* KiloPlugin.effect(host)
  yield* KiloGatewayPlugin.effect(host).pipe(Effect.provide(Global.layerWith({})))
})

describe("Kilo Gateway autocomplete RPC", () => {
  it.live("sends FIM and Next Edit requests with the Kilo token, team and autocomplete feature header", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "env-token", KILO_ORG_ID: "selected" }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const rpc = yield* Rpc.Service
            expect(
              yield* rpc.call("kilocode.gateway", "autocomplete.fim", {
                prefix: "const a = ",
                suffix: "\n",
                provider: "kilo",
                model: "mistralai/codestral-2508",
                maxTokens: 256,
                temperature: 0.2,
              }),
            ).toEqual({ text: "fixture completion", cost: 0.0001, inputTokens: 5, outputTokens: 2 })
            expect(
              yield* rpc.call("kilocode.gateway", "autocomplete.edit", {
                ...edit,
                provider: "kilo",
                model: "inception/mercury-next-edit",
              }),
            ).toEqual({ content: "fixture edit", usage: { prompt_tokens: 7, completion_tokens: 3 } })

            expect(backend.state.autocompleteRequests).toEqual([
              {
                path: "/api/gateway/v1/fim/completions",
                feature: "autocomplete",
                body: {
                  model: "mistralai/codestral-2508",
                  prompt: "const a = ",
                  suffix: "\n",
                  max_tokens: 256,
                  temperature: 0.2,
                  stream: true,
                },
              },
              {
                path: "/api/gateway/v1/edit/completions",
                feature: "autocomplete",
                body: expect.objectContaining({ model: "inception/mercury-edit-2", max_tokens: 512 }),
              },
            ])
            const sent = backend.requests.filter((request) => request.path.endsWith("/completions"))
            expect(sent).toEqual([
              { method: "POST", path: "/api/gateway/v1/fim/completions", authorization: "Bearer env-token", organizationID: "selected" },
              { method: "POST", path: "/api/gateway/v1/edit/completions", authorization: "Bearer env-token", organizationID: "selected" },
            ])
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("reports the upstream status and rejects Next Edit for FIM models", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, KILO_API_KEY: "env-token" }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const rpc = yield* Rpc.Service
            backend.state.fimStatus = 402
            expect(
              yield* rpc.call("kilocode.gateway", "autocomplete.fim", { prefix: "", suffix: "" }).pipe(Effect.flip),
            ).toMatchObject({ type: "request", message: "FIM request failed: 402 fim failed", data: { status: 402 } })
            backend.state.editStatus = 429
            expect(
              yield* rpc.call("kilocode.gateway", "autocomplete.edit", { ...edit }).pipe(Effect.flip),
            ).toMatchObject({ type: "request", data: { status: 429 } })
            expect(
              yield* rpc
                .call("kilocode.gateway", "autocomplete.edit", { ...edit, provider: "kilo", model: "mistralai/codestral-2508" })
                .pipe(Effect.flip),
            ).toMatchObject({ type: "request", data: { status: 400 } })
            expect(backend.state.autocompleteRequests).toHaveLength(2)
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("fails without credentials and without sending a request", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const rpc = yield* Rpc.Service
            expect(
              yield* rpc.call("kilocode.gateway", "autocomplete.fim", { prefix: "", suffix: "" }).pipe(Effect.flip),
            ).toMatchObject({ type: "unauthorized", message: "Not authenticated with Kilo Gateway" })
            expect(
              yield* rpc.call("kilocode.gateway", "autocomplete.edit", { ...edit }).pipe(Effect.flip),
            ).toMatchObject({ type: "unauthorized", message: "Not authenticated with Kilo Gateway" })
            expect(
              yield* rpc
                .call("kilocode.gateway", "autocomplete.fim", { prefix: "", suffix: "", provider: "mistral", model: "codestral-2508" })
                .pipe(Effect.flip),
            ).toMatchObject({ type: "unauthorized", message: "Missing mistral provider API key" })
            expect(
              yield* rpc
                .call("kilocode.gateway", "autocomplete.edit", { ...edit, provider: "inception", model: "mercury-next-edit" })
                .pipe(Effect.flip),
            ).toMatchObject({ type: "unauthorized", message: "Missing inception provider API key" })
            expect(backend.state.autocompleteRequests).toEqual([])
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("uses the stored key of a direct provider before the environment", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_URL: backend.url, MISTRAL_API_KEY: "env-key" }, () =>
          Effect.gen(function* () {
            yield* addPlugin()
            const credentials = yield* Credential.Service
            yield* credentials.create({
              integrationID: Integration.ID.make("mistral"),
              value: Credential.Key.make({ type: "key", key: "stored-key" }),
            })
            const original = globalThis.fetch
            const authorization: string[] = []
            const urls: string[] = []
            globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
              urls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url)
              authorization.push(new Headers(init?.headers).get("authorization") ?? "")
              return new Response('data: {"choices":[{"text":"stored"}]}\n\ndata: [DONE]\n\n', {
                headers: { "content-type": "text/event-stream" },
              })
            }) as typeof globalThis.fetch
            const rpc = yield* Rpc.Service
            const result = yield* rpc
              .call("kilocode.gateway", "autocomplete.fim", {
                prefix: "x = ",
                suffix: "",
                provider: "mistral",
                model: "codestral-2508",
              })
              .pipe(Effect.ensuring(Effect.sync(() => (globalThis.fetch = original))))
            expect(result).toEqual({ text: "stored", cost: 0, inputTokens: 0, outputTokens: 0 })
            expect(authorization).toEqual(["Bearer stored-key"])
            expect(urls).toEqual(["https://api.mistral.ai/v1/fim/completions"])
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )

  it.live("refuses Kilo requests when the team conflicts with the token scope", () =>
    Effect.acquireUseRelease(
      Effect.sync(() => fixture()),
      (backend) =>
        withEnv({ ...env, KILO_API_KEY: `${backend.url}/api/organizations/first:secret`, KILO_ORG_ID: "selected" }, () =>
          Effect.gen(function* () {
            const host = yield* PluginHost.make(yield* Plugin.Service, "test")
            yield* host.storage.set("organization:env", { organizationID: "selected" })
            yield* addPlugin()
            const rpc = yield* Rpc.Service
            expect(
              yield* rpc.call("kilocode.gateway", "autocomplete.fim", { prefix: "", suffix: "" }).pipe(Effect.flip),
            ).toMatchObject({ type: "unauthorized", message: "Organization conflicts with the Kilo token scope" })
            expect(backend.state.autocompleteRequests).toEqual([])
          }),
        ),
      (backend) => Effect.sync(() => backend[Symbol.dispose]()),
    ),
  )
})
