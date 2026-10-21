import { expect } from "bun:test"
import { RequestExecutor } from "@opencode/ai/route"
import { Credential } from "@opencode/core/credential"
import { Integration } from "@opencode/core/integration"
import { Voice } from "@opencode/core/voice"
import { Effect, Layer } from "effect"
import { HttpClient, type HttpClientRequest, HttpClientResponse } from "effect/http"
import { TestClock } from "effect/testing"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)

const credential = (id: string, method: "key" | "oauth") => ({
  type: "credential" as const,
  id: Credential.ID.make(id),
  label: id,
  method,
})

const keys: Record<string, string> = {
  active: "sk-active",
  stored: "sk-stored",
  XAI_API_KEY: "xai-env-key",
  GEMINI_API_KEY: "gemini-env-key",
}

it.effect("uses the first key or env connection Integration lists and never a ChatGPT sign-in", () =>
  Effect.gen(function* () {
    yield* TestClock.setTime(1760000000_000)
    const auths: string[] = []
    const call = (model: string, connections: Integration.Info["connections"]) =>
      Effect.flatMap(Voice.Service, (voice) =>
        voice.session({
          model,
          transport:
            model.startsWith("grok-") || model.startsWith("gemini-")
              ? { type: "websocket" }
              : { type: "webrtc", sdp: "v=0" },
        }),
      ).pipe(
        Effect.provide(
          Voice.layer.pipe(
            Layer.provide(
              Layer.merge(
                Layer.mock(Integration.Service, {
                  revision: () => 0,
                  get: (id) => Effect.succeed({ id, name: id, methods: [], connections }),
                  connection: {
                    active: () => Effect.die("unused"),
                    resolve: (connection) =>
                      connection.type === "credential" && connection.method === "oauth"
                        ? Effect.die("a ChatGPT sign-in was resolved")
                        : Effect.succeed(
                            Credential.Key.make({
                              type: "key",
                              key: keys[connection.type === "env" ? connection.name : connection.id],
                            }),
                          ),
                    key: () => Effect.die("unused"),
                    external: () => Effect.die("unused"),
                    activate: () => Effect.die("unused"),
                    update: () => Effect.die("unused"),
                    remove: () => Effect.die("unused"),
                    status: () => Effect.die("unused"),
                  },
                  oauth: {
                    connect: () => Effect.die("unused"),
                    status: () => Effect.die("unused"),
                    complete: () => Effect.die("unused"),
                    cancel: () => Effect.die("unused"),
                  },
                  command: {
                    connect: () => Effect.die("unused"),
                    status: () => Effect.die("unused"),
                    cancel: () => Effect.die("unused"),
                  },
                }),
                RequestExecutor.layer.pipe(
                  Layer.provide(
                    Layer.succeed(
                      HttpClient.HttpClient,
                      HttpClient.make((req: HttpClientRequest.HttpClientRequest) =>
                        Effect.sync(() => {
                          auths.push(req.headers.authorization ?? req.headers["x-goog-api-key"] ?? "")
                          return HttpClientResponse.fromWeb(
                            req,
                            model.startsWith("gemini-")
                              ? Response.json({ name: "auth_tokens/ek_gemini" })
                              : model.startsWith("grok-")
                                ? Response.json({ value: "ek_xai", expires_at: 1760000999 })
                                : Response.json({ transport: { sdp: "v=0\r\no=answer\r\n" } }),
                          )
                        }),
                      ),
                    ),
                  ),
                ),
              ),
            ),
          ),
        ),
      )

    yield* call("gpt-live-1", [credential("active", "key"), credential("stored", "key")])
    yield* call("gpt-live-1", [credential("chatgpt", "oauth"), credential("stored", "key")])
    const grok = yield* call("grok-voice-3.0", [{ type: "env", name: "XAI_API_KEY" }])
    const gemini = yield* call("gemini-3.8-live", [{ type: "env", name: "GEMINI_API_KEY" }])
    expect(auths).toEqual(["Bearer sk-active", "Bearer sk-stored", "Bearer xai-env-key", "gemini-env-key"])
    expect(grok).toEqual({
      type: "websocket",
      url: "wss://api.x.ai/v1/realtime?model=grok-voice-3.0",
      token: "ek_xai",
      expiresAt: 1760000999,
    })
    expect(gemini).toEqual({
      type: "websocket",
      url: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
      token: "auth_tokens/ek_gemini",
      expiresAt: 1760000060,
    })

    const signInOnly = yield* call("gpt-live-1", [credential("chatgpt", "oauth")]).pipe(Effect.flip)
    expect(signInOnly._tag).toBe("Voice.UnavailableError")
    expect(signInOnly.message).toContain("OpenAI API key")

    const missingGoogle = yield* call("gemini-3.8-live", []).pipe(Effect.flip)
    expect(missingGoogle).toMatchObject({ _tag: "Voice.UnavailableError", service: "google" })
    expect(missingGoogle.message).toContain("GEMINI_API_KEY")
  }),
)
