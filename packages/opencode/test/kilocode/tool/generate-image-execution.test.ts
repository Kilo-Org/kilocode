import { expect } from "bun:test"
import { Cause, Effect, Exit, Layer } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Agent } from "@/agent/agent"
import { Auth } from "@/auth"
import { Config } from "@/config/config"
import { Image } from "@/image/image"
import { GenerateImageTool } from "@/kilocode/tool/generate-image"
import * as Images from "@/kilocode/image-generation"
import * as Network from "@/kilocode/sandbox/network"
import { run } from "@kilocode/sandbox"
import { MessageID, PartID, SessionID } from "@/session/schema"
import { Truncate } from "@/tool/truncate"
import { TestInstance } from "../../fixture/fixture"
import { TestConfig } from "../../fixture/config"
import { testEffect } from "../../lib/effect"

const png =
  "iVBORw0KGgoAAAANSUhEUgAAAGAAAABACAYAAADlNHIOAAAAj0lEQVR4nO3RMREAIBDAsJeFDPxPOAEZDM3QvXeZs/bVv+b3QD0AANoBANAOAIB2AAC0AwCgHQAA7QAAaAcAQDsAANoBANAOAIB2AAC0AwCgHQAA7QAAaAcAQDsAANoBANAOAIB2AAC0AwCgHQAA7QAAaAcAQDsAANoBANAOAIB2AAC0AwCgHQAA7QAAaPcAgg6rWP9fiGMAAAAASUVORK5CYII="
const url = `data:image/png;base64,${png}`
const gateway: unknown[] = []
const it = testEffect(
  Layer.mergeAll(
    AppNodeBuilder.build(FSUtil.node),
    AppNodeBuilder.build(Agent.node),
    AppNodeBuilder.build(Truncate.node),
    AppNodeBuilder.build(Config.node),
    AppNodeBuilder.build(Image.node),
    Layer.mock(Auth.Service, { get: () => Effect.succeed({ type: "api", key: "test" }) }),
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) =>
        Effect.sync(() => {
          if (request.body._tag !== "Uint8Array") throw new Error("Expected a JSON request")
          gateway.push(JSON.parse(new TextDecoder().decode(request.body.body)))
          return HttpClientResponse.fromWeb(
            request,
            Response.json({ choices: [{ message: { images: [{ image_url: { url } }] } }] }),
          )
        }),
      ),
    ),
  ),
)

it.instance("uses the global Images API for generation and multipart edits without gateway credentials", () =>
  Effect.gen(function* () {
    const requests: Request[] = []
    const server = yield* Effect.acquireRelease(
      Effect.sync(() =>
        Bun.serve({
          port: 0,
          async fetch(request) {
            requests.push(new Request(request, { body: await request.arrayBuffer() }))
            if (new URL(request.url).pathname.startsWith("/denied"))
              return new Response("Unauthorized", { status: 401 })
            return Response.json({ data: [{ b64_json: png }] })
          },
        }),
      ),
      (server) => Effect.promise(() => server.stop(true)),
    )
    const host = {
      image_generation_base_url: `http://127.0.0.1:${server.port}/v1/`,
      image_generation_model: "gufo",
      image_generation_api_key: undefined as string | undefined,
      image_generation_options: { size: "512x512", background: "opaque" as const, seed: 7, steps: 12 },
    }
    const limits = { max_base64_bytes: png.length }
    const config = TestConfig.make({
      get: () =>
        Effect.succeed({ experimental: { image_generation_model: "project-model" }, attachment: { image: limits } }),
      getGlobal: () => Effect.succeed({ experimental: host }),
    })
    const tool = yield* GenerateImageTool.pipe(
      Effect.provideService(Config.Service, config),
      Effect.provide(Network.httpLayer),
      Effect.flatMap((tool) => tool.init()),
    )
    const permissions: string[] = []
    const ctx = {
      sessionID: SessionID.make("ses_custom_image"),
      messageID: MessageID.make("msg_custom_image"),
      agent: "code",
      messages: [],
      abort: new AbortController().signal,
      metadata: () => Effect.void,
      ask: (request: { permission: string }) =>
        Effect.sync(() => {
          permissions.push(request.permission)
        }),
    }
    const result = yield* tool.execute({ prompt: "Generate", path: "generated.png", seed: 0 }, ctx)
    expect(result.attachments?.at(0)?.url).toBe(url)
    const generation = requests.at(0)!
    expect(new URL(generation.url).pathname).toBe("/v1/images/generations")
    expect(generation.headers.get("authorization")).toBeNull()
    expect(yield* Effect.promise(() => generation.json())).toEqual({
      prompt: "Generate",
      model: "gufo",
      n: 1,
      size: "512x512",
      background: "opaque",
      seed: 0,
      steps: 12,
    })

    host.image_generation_api_key = "custom-key"
    yield* tool.execute(
      { prompt: "Edit", image: "generated.png", path: "edited.png", steps: 20, background: "transparent" },
      ctx,
    )
    const edit = requests.at(1)!
    expect(new URL(edit.url).pathname).toBe("/v1/images/edits")
    expect(edit.headers.get("authorization")).toBe("Bearer custom-key")
    const form = yield* Effect.promise(() => edit.formData())
    expect(form.get("prompt")).toBe("Edit")
    expect(form.get("model")).toBe("gufo")
    expect(form.get("seed")).toBe("7")
    expect(form.get("steps")).toBe("20")
    expect(form.get("background")).toBe("transparent")
    expect(form.get("size")).toBe("512x512")
    const file = form.get("image")
    if (!(file instanceof File)) throw new Error("Missing image upload")
    expect(yield* Effect.promise(() => file.bytes())).toEqual(Buffer.from(png, "base64"))
    expect(permissions).toEqual(["write", "read", "write"])

    yield* tool.execute({ prompt: "Combine", images: ["edited.png", "generated.png"], path: "combined.png" }, ctx)
    const combined = yield* Effect.promise(() => requests.at(2)!.formData())
    expect(combined.get("image")).toBeNull()
    expect(combined.getAll("image[]").map((file) => (file instanceof File ? file.name : file))).toEqual([
      "edited.png",
      "generated.png",
    ])
    expect(permissions).toEqual(["write", "read", "write", "read", "read", "write"])
    const conflict = yield* tool
      .execute({ prompt: "Invalid", image: "generated.png", images: ["edited.png"], path: "invalid.png" }, ctx)
      .pipe(Effect.exit)
    expect(Exit.isFailure(conflict)).toBe(true)

    const http = yield* HttpClient.HttpClient.pipe(Effect.provide(Network.httpLayer))
    const denied = yield* Images.generate(
      http,
      { url: `http://127.0.0.1:${server.port}/denied`, key: undefined, model: undefined },
      { prompt: "Generate", signal: ctx.abort },
    ).pipe(Effect.exit)
    expect(Exit.isFailure(denied)).toBe(true)
    if (Exit.isFailure(denied)) expect(String(Cause.squash(denied.cause))).toContain("HTTP 401")
    const cancelled = yield* Images.generate(http, Images.source({ experimental: host })!, {
      prompt: "Cancel",
      signal: AbortSignal.abort(),
    }).pipe(Effect.exit)
    expect(Exit.isFailure(cancelled)).toBe(true)
    const blocked = yield* run(
      {
        filesystem: { allowWrite: [], denyWrite: [], denyNames: [] },
        network: { mode: "deny", allowedHosts: [] },
        environment: { deny: [], set: {} },
      },
      tool.execute({ prompt: "Blocked", path: "blocked.png" }, ctx),
    ).pipe(Effect.exit)
    expect(Exit.isFailure(blocked)).toBe(true)
    if (Exit.isFailure(blocked)) expect(Cause.pretty(blocked.cause)).toContain("Sandbox denied outbound network access")

    limits.max_base64_bytes = png.length - 4
    const oversized = yield* tool
      .execute({ prompt: "Edit", image: "generated.png", path: "too-big.png" }, ctx)
      .pipe(Effect.exit)
    expect(Exit.isFailure(oversized)).toBe(true)
    if (Exit.isFailure(oversized))
      expect(String(Cause.squash(oversized.cause))).toContain("exceeds the image attachment limit")

    host.image_generation_base_url = "localhost:8080/v1"
    const malformed = yield* tool.execute({ prompt: "Generate", path: "invalid.png" }, ctx).pipe(Effect.exit)
    expect(Exit.isFailure(malformed)).toBe(true)
    if (Exit.isFailure(malformed))
      expect(String(Cause.squash(malformed.cause))).toContain("Image generation base URL must be an HTTP(S) URL")
    expect(requests).toHaveLength(4)
  }),
)

it.instance("sends ordered gateway references and preserves the generated image attachment", () =>
  Effect.gen(function* () {
    const instance = yield* TestInstance
    const tool = yield* (yield* GenerateImageTool).init()
    const sessionID = SessionID.make("ses_image")
    const messageID = MessageID.make("msg_image")
    const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"
    yield* Effect.promise(() => Bun.write(`${instance.directory}/first.png`, Buffer.from(png, "base64")))
    yield* Effect.promise(() => Bun.write(`${instance.directory}/second.gif`, Buffer.from(gif, "base64")))
    const permissions: string[] = []
    const result = yield* tool.execute(
      { prompt: "A red pixel", images: ["second.gif", "first.png"], path: "assets/pixel" },
      {
        sessionID,
        messageID,
        agent: "code",
        messages: [],
        abort: new AbortController().signal,
        metadata: () => Effect.void,
        ask: (request) =>
          Effect.sync(() => {
            permissions.push(request.permission)
          }),
      },
    )
    expect(permissions).toEqual(["read", "read", "write"])
    expect(gateway.at(-1)).toMatchObject({
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "A red pixel" },
            { type: "image_url", image_url: { url: `data:image/gif;base64,${gif}` } },
            { type: "image_url", image_url: { url } },
          ],
        },
      ],
    })
    expect(yield* Effect.promise(() => Bun.file(`${instance.directory}/assets/pixel.png`).bytes())).toEqual(
      Buffer.from(png, "base64"),
    )
    const attachment = result.attachments?.at(0)
    expect(attachment?.url).toBe(url)
    if (!attachment) throw new Error("Missing generated image attachment")
    const image = yield* Image.Service
    expect((yield* image.normalize({ ...attachment, sessionID, messageID, id: PartID.ascending() })).url).toStartWith(
      "data:image/png;base64,",
    )
  }),
)
