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

const unused = () => Effect.die("unused")

const mockIntegration = (
  connections: (id: Integration.ID) => Integration.Info["connections"],
  resolve: Integration.Interface["connection"]["resolve"] = () => Effect.die("Voice.models resolved a credential"),
) =>
  Layer.mock(Integration.Service, {
    revision: () => 0,
    get: (id) => Effect.succeed({ id, name: id, methods: [], connections: connections(id) }),
    connection: {
      active: unused,
      resolve,
      key: unused,
      external: unused,
      activate: unused,
      update: unused,
      remove: unused,
      status: unused,
    },
    oauth: { connect: unused, status: unused, complete: unused, cancel: unused },
    command: { connect: unused, status: unused, cancel: unused },
  })

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
                mockIntegration(
                  () => connections,
                  (connection) =>
                    connection.type === "credential" && connection.method === "oauth"
                      ? Effect.die("a ChatGPT sign-in was resolved")
                      : Effect.succeed(
                          Credential.Key.make({
                            type: "key",
                            key: keys[connection.type === "env" ? connection.name : connection.id],
                          }),
                        ),
                ),
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
      transport: {
        type: "websocket",
        url: "wss://api.x.ai/v1/realtime?model=grok-voice-3.0",
        token: "ek_xai",
        expiresAt: 1760000999,
      },
    })
    expect(gemini).toEqual({
      transport: {
        type: "websocket",
        url: "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained",
        token: "auth_tokens/ek_gemini",
        expiresAt: 1760000060,
      },
    })

    const signInOnly = yield* call("gpt-live-1", [credential("chatgpt", "oauth")]).pipe(Effect.flip)
    expect(signInOnly._tag).toBe("Voice.UnavailableError")
    expect(signInOnly.message).toContain("OpenAI API key")

    const missingGoogle = yield* call("gemini-3.8-live", []).pipe(Effect.flip)
    expect(missingGoogle).toMatchObject({ _tag: "Voice.UnavailableError", service: "google" })
    expect(missingGoogle.message).toContain("GEMINI_API_KEY")
  }),
)

it.effect("lists voice models with availability and default without resolving credentials", () =>
  Effect.gen(function* () {
    const list = (connections: Partial<Record<string, Integration.Info["connections"]>>) =>
      Effect.flatMap(Voice.Service, (voice) => voice.models()).pipe(
        Effect.provide(
          Voice.layer.pipe(
            Layer.provide(
              Layer.merge(
                mockIntegration((id) => connections[id] ?? []),
                Layer.mock(RequestExecutor.Service, {}),
              ),
            ),
          ),
        ),
      )

    expect(
      yield* list({
        openai: [credential("chatgpt", "oauth")],
        xai: [{ type: "env", name: "XAI_API_KEY" }],
        google: [credential("gemini", "key")],
      }),
    ).toEqual({
      models: [
        { model: "gpt-live-1", provider: "openai", transports: ["webrtc"], available: false },
        { model: "gpt-realtime-2.1", provider: "openai", transports: ["webrtc", "websocket"], available: false },
        { model: "grok-voice-3.0", provider: "xai", transports: ["websocket"], available: true, integration: "xai" },
        {
          model: "gemini-3.8-live",
          provider: "google",
          transports: ["websocket"],
          available: true,
          integration: "google",
        },
      ],
      default: "grok-voice-3.0",
    })

    const none = yield* list({ openai: [credential("chatgpt", "oauth")] })
    expect(none).toEqual({
      models: [
        { model: "gpt-live-1", provider: "openai", transports: ["webrtc"], available: false },
        { model: "gpt-realtime-2.1", provider: "openai", transports: ["webrtc", "websocket"], available: false },
        { model: "grok-voice-3.0", provider: "xai", transports: ["websocket"], available: false },
        { model: "gemini-3.8-live", provider: "google", transports: ["websocket"], available: false },
      ],
    })
    expect("default" in none).toBe(false)
  }),
)

// An OpenAI key the server could use instead, and the requests that reach OpenAI with it.
const withStoredKey = (requests: string[]) =>
  Voice.layer.pipe(
    Layer.provide(
      Layer.merge(
        mockIntegration(
          (id) => (id === "openai" ? [credential("stored", "key")] : []),
          () => Effect.succeed(Credential.Key.make({ type: "key", key: "sk-stored" })),
        ),
        RequestExecutor.layer.pipe(
          Layer.provide(
            Layer.succeed(
              HttpClient.HttpClient,
              HttpClient.make((req: HttpClientRequest.HttpClientRequest) =>
                Effect.sync(() => {
                  requests.push(req.headers.authorization ?? "")
                  return HttpClientResponse.fromWeb(req, Response.json({ transport: { sdp: "answer:openai" } }))
                }),
              ),
            ),
          ),
        ),
      ),
    ),
  )

const hostedLive = (instructed: Voice.InstructInput[]): Voice.Host => ({
  integration: "opencode",
  models: ["gpt-live-1"],
  workspace: "Anomaly",
  session: (input) =>
    Effect.succeed({
      transport: { type: "webrtc", sdp: input.transport.type === "webrtc" ? `answer:hosted:${input.transport.sdp}` : "" },
      id: "sess_hosted",
    }),
  instruct: (input) =>
    Effect.sync(() => {
      instructed.push(input)
    }),
})

const offer = { model: "gpt-live-1", transport: { type: "webrtc", sdp: "v=0" } } as const

it.effect("starts a host's models and relays their instructions on it, even beside a stored key", () => {
  const requests: string[] = []
  return Effect.gen(function* () {
    const voice = yield* Voice.Service
    const instructed: Voice.InstructInput[] = []
    yield* voice.host(hostedLive(instructed))

    expect(yield* voice.session(offer)).toEqual({
      transport: { type: "webrtc", sdp: "answer:hosted:v=0" },
      id: "sess_hosted",
    })
    expect((yield* voice.models()).models.find((item) => item.model === "gpt-live-1")).toEqual({
      model: "gpt-live-1",
      provider: "openai",
      transports: ["webrtc"],
      available: true,
      integration: "opencode",
      workspace: "Anomaly",
    })
    yield* voice.instruct({ id: "sess_hosted", instructions: "The screen shows ses_1." })
    expect(instructed).toEqual([{ id: "sess_hosted", instructions: "The screen shows ses_1." }])
    expect(requests).toEqual([])
  }).pipe(Effect.provide(withStoredKey(requests)))
})

it.effect("goes back to the stored key once the host is removed, and refuses instructions", () => {
  const requests: string[] = []
  return Effect.gen(function* () {
    const voice = yield* Voice.Service
    yield* voice.host(hostedLive([]))
    yield* voice.host(undefined)

    expect(yield* voice.session(offer)).toEqual({ transport: { type: "webrtc", sdp: "answer:openai" } })
    expect(requests).toEqual(["Bearer sk-stored"])
    const refused = yield* voice.instruct({ id: "sess_hosted", instructions: "Hello" }).pipe(Effect.flip)
    expect(refused._tag).toBe("Voice.InvalidRequestError")
  }).pipe(Effect.provide(withStoredKey(requests)))
})
