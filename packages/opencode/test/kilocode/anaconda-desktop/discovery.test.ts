import { expect } from "bun:test"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { FetchHttpClient } from "effect/unstable/http"
import { Effect, Layer, Redacted } from "effect"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Discovery from "../../../src/kilocode/anaconda-desktop/discovery"
import * as DesktopPlatform from "../../../src/kilocode/anaconda-desktop/platform"
import { CONFIG_FILE, STORE_FILE } from "../../../src/kilocode/anaconda-desktop/domain"
import { testEffect } from "../../lib/effect"

const it = testEffect(Layer.empty)
const managementKey = "fixture-management-key"
const inferenceKey = "fixture-inference-key"

interface Settings {
  readonly installed?: boolean
  readonly config?: unknown
  readonly signed?: boolean
  readonly rootStatus?: number
  readonly root?: unknown
  readonly closed?: boolean
  readonly models?: ReadonlyArray<unknown>
  readonly servers?: (port: number) => ReadonlyArray<unknown>
  readonly health?: unknown
  readonly inferenceModels?: ReadonlyArray<unknown>
  readonly props?: unknown
  readonly delay?: number
}

function defaults(port: number) {
  return [
    {
      serverProcessId: 4242,
      status: "RUNNING",
      tag: "inference",
      modelFile: { id: "file-1", name: "model-q4.gguf" },
      server: { host: "0.0.0.0", port, api_key: inferenceKey },
    },
  ]
}

function fixture(settings: Settings = {}) {
  return Effect.acquireRelease(
    Effect.promise(() => mkdtemp(path.join(os.tmpdir(), "anaconda-desktop-test-"))),
    (dir) => Effect.promise(() => rm(dir, { recursive: true, force: true })),
  ).pipe(
    Effect.flatMap((home) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          const hits: Array<{ method: string; path: string; authorized: boolean }> = []
          const inference = Bun.serve({
            port: 0,
            fetch(request) {
              const url = new URL(request.url)
              hits.push({
                method: request.method,
                path: url.pathname,
                authorized: request.headers.get("authorization") === `Bearer ${inferenceKey}`,
              })
              if (url.pathname === "/health") return Response.json(settings.health ?? { status: "ok" })
              if (url.pathname === "/v1/models") {
                return Response.json({
                  data: settings.inferenceModels ?? [{ id: "model-q4.gguf", owned_by: "llamacpp" }],
                })
              }
              if (url.pathname === "/props") {
                return Response.json(
                  settings.props ?? {
                    default_generation_settings: { n_ctx: 16_384 },
                    chat_template_caps: { supports_tools: true },
                    modalities: { vision: true, audio: false },
                  },
                )
              }
              return new Response(null, { status: 404 })
            },
          })
          const port = inference.port
          if (port === undefined) throw new Error("inference fixture did not bind a port")
          const management = Bun.serve({
            port: 0,
            async fetch(request) {
              const url = new URL(request.url)
              hits.push({
                method: request.method,
                path: url.pathname,
                authorized: request.headers.get("authorization") === `Bearer ${managementKey}`,
              })
              if (settings.delay) await Bun.sleep(settings.delay)
              if (url.pathname === "/api") {
                return Response.json(settings.root ?? { data: { version: "fixture" } }, {
                  status: settings.rootStatus ?? 200,
                })
              }
              if (url.pathname === "/api/models") {
                return Response.json({
                  data: settings.models ?? [
                    {
                      id: "model-1",
                      name: "Fixture Model",
                      metadata: {
                        trainedFor: "text-generation",
                        contextWindowSize: 8192,
                        model_type: "fixture-family",
                        quantizations: [{ modelFileName: "model-q4.gguf" }],
                      },
                    },
                  ],
                })
              }
              if (url.pathname === "/api/servers") {
                return Response.json({ data: settings.servers?.(port) ?? defaults(port) })
              }
              return new Response(null, { status: 404 })
            },
          })
          const managementPort = management.port
          if (managementPort === undefined) {
            management.stop(true)
            inference.stop(true)
            throw new Error("management fixture did not bind a port")
          }
          return { home, hits, inference, inferencePort: port, management, managementPort }
        }),
        (value) =>
          Effect.sync(() => {
            value.management.stop(true)
            value.inference.stop(true)
          }),
      ).pipe(
        Effect.tap((value) =>
          Effect.promise(async () => {
            const dir = path.join(value.home, ".local", "share", "anaconda-desktop")
            const bin = path.join(value.home, "bin")
            await mkdir(dir, { recursive: true })
            await mkdir(bin, { recursive: true })
            if (settings.installed !== false) await writeFile(path.join(bin, "anaconda-desktop"), "fixture")
            await writeFile(
              path.join(dir, CONFIG_FILE),
              JSON.stringify(
                settings.config ?? {
                  aiNavApiKey: managementKey,
                  aiNavApiServerPort: value.managementPort,
                },
              ),
            )
            if (settings.signed !== false) {
              await writeFile(
                path.join(dir, STORE_FILE),
                JSON.stringify({ "fixture_ai-navigator-workos-oauth": "opaque-fixture" }),
              )
            }
            if (settings.closed) value.management.stop(true)
          }),
        ),
        Effect.map((value) => {
          const info: DesktopPlatform.Info = {
            platform: "linux",
            arch: "x64",
            home: value.home,
            env: { PATH: path.join(value.home, "bin") },
          }
          const platform = DesktopPlatform.makeLayer(info).pipe(Layer.provide(FSUtil.defaultLayer))
          const layer = Discovery.makeLayer({ timeout: "100 millis" }).pipe(
            Layer.provide(platform),
            Layer.provide(FSUtil.defaultLayer),
            Layer.provide(FetchHttpClient.layer),
          )
          return { ...value, layer }
        }),
      ),
    ),
  )
}

it.live("discovers a healthy text-generation server without exposing either key", () =>
  Effect.gen(function* () {
    const test = yield* fixture()
    const found = yield* Discovery.Service.use((service) => service.discover()).pipe(Effect.provide(test.layer))

    expect(found.status).toEqual({
      type: "ready",
      serverID: "process-4242",
      serverName: "Fixture Model",
      models: [{ id: "model-q4.gguf", name: "Fixture Model" }],
      context: 16_384,
      toolcall: "supported",
    })
    expect(found.connection?.metadata).toMatchObject({
      baseURL: `http://127.0.0.1:${test.inferencePort}/v1`,
      context: 16_384,
      toolcall: "supported",
      models: [{ family: "fixture-family", input: ["text", "image"], output: ["text"] }],
    })
    expect(found.connection && Redacted.isRedacted(found.connection.key)).toBe(true)
    const serialized = JSON.stringify(found)
    expect(serialized).not.toContain(managementKey)
    expect(serialized).not.toContain(inferenceKey)
    expect(test.hits.every((hit) => hit.method === "GET")).toBe(true)
    expect(test.hits.filter((hit) => hit.path.startsWith("/api")).every((hit) => hit.authorized)).toBe(true)
    expect(test.hits.filter((hit) => !hit.path.startsWith("/api")).every((hit) => hit.authorized)).toBe(true)
  }),
)

it.live("classifies setup states before inference discovery", () =>
  Effect.gen(function* () {
    const absent = yield* fixture({ installed: false })
    const absentStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(absent.layer),
    )
    expect(absentStatus.status.type).toBe("not-installed")

    const invalid = yield* fixture({ config: { aiNavApiKey: "", aiNavApiServerPort: 8001 } })
    const invalidStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(invalid.layer),
    )
    expect(invalidStatus.status).toEqual({ type: "invalid-config", reason: "missing-key" })

    const signed = yield* fixture({ signed: false })
    const signedStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(signed.layer),
    )
    expect(signedStatus.status).toEqual({ type: "signed-out" })

    const unauthorized = yield* fixture({ rootStatus: 401 })
    const unauthorizedStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(unauthorized.layer),
    )
    expect(unauthorizedStatus.status).toEqual({ type: "management-unauthorized" })

    const stopped = yield* fixture({ closed: true })
    const stoppedStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(stopped.layer),
    )
    expect(stoppedStatus.status).toEqual({ type: "not-running" })

    const malformed = yield* fixture({ root: { unexpected: true } })
    const malformedStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(malformed.layer),
    )
    expect(malformedStatus.status).toEqual({
      type: "management-unavailable",
      reason: "unexpected-response",
    })
  }),
)

it.live("classifies downloaded and running-server inventory", () =>
  Effect.gen(function* () {
    const empty = yield* fixture({ models: [] })
    const emptyStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(Effect.provide(empty.layer))
    expect(emptyStatus.status).toEqual({ type: "no-downloaded-model" })

    const stopped = yield* fixture({
      servers: () => [],
      models: [
        {
          id: "active",
          name: "Active",
          metadata: { trainedFor: "text-generation", files: [{ name: "active.gguf" }] },
        },
        {
          id: "deleted",
          name: "Deleted",
          metadata: { trainedFor: "text-generation", files: [] },
        },
        {
          id: "embedding",
          name: "Embedding",
          metadata: { trainedFor: "sentence-similarity", files: [{ name: "embedding.gguf" }] },
        },
      ],
    })
    const stoppedStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(stopped.layer),
    )
    expect(stoppedStatus.status).toEqual({ type: "no-running-server", downloadedModels: 1 })
  }),
)

it.live("marks unusable inference servers unhealthy", () =>
  Effect.gen(function* () {
    const remote = yield* fixture({
      servers: (port) => [{ ...defaults(port)[0], server: { host: "192.168.1.10", port, apiKey: inferenceKey } }],
    })
    const remoteStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(remote.layer),
    )
    expect(remoteStatus.status).toMatchObject({ type: "inference-unhealthy" })

    const empty = yield* fixture({ inferenceModels: [] })
    const emptyStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(Effect.provide(empty.layer))
    expect(emptyStatus.status).toMatchObject({ type: "inference-unhealthy" })

    const embedding = yield* fixture({
      models: [
        {
          id: "embed",
          name: "Embed",
          metadata: {
            trainedFor: "sentence-similarity",
            quantizations: [{ modelFileName: "model-q4.gguf" }],
          },
        },
      ],
    })
    const embeddingStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(embedding.layer),
    )
    expect(embeddingStatus.status).toEqual({ type: "no-downloaded-model" })

    const unhealthy = yield* fixture({ health: { status: "loading" } })
    const unhealthyStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(unhealthy.layer),
    )
    expect(unhealthyStatus.status).toMatchObject({ type: "inference-unhealthy" })
  }),
)

it.live("distinguishes false and unknown tool support and accepts an empty inference key", () =>
  Effect.gen(function* () {
    const unsupported = yield* fixture({ props: { chat_template_caps: { supports_tools: false } } })
    const unsupportedStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(unsupported.layer),
    )
    expect(unsupportedStatus.status).toMatchObject({ type: "ready", toolcall: "unsupported" })
    expect(unsupportedStatus.connection?.metadata.models[0].description).toContain("does not support tool calling")

    const unknown = yield* fixture({
      props: {},
      servers: (port) => [
        {
          id: "server-1",
          status: "running",
          tag: "inference",
          modelFile: { name: "model-q4.gguf" },
          serverConfig: { apiParams: { host: "127.0.0.1", port, apiKey: "" } },
        },
      ],
    })
    const unknownStatus = yield* Discovery.Service.use((service) => service.discover()).pipe(
      Effect.provide(unknown.layer),
    )
    expect(unknownStatus.status).toMatchObject({ type: "ready", toolcall: "unknown" })
    expect(unknownStatus.connection && Redacted.value(unknownStatus.connection.key)).toBe("")
    expect(unknown.hits.filter((hit) => !hit.path.startsWith("/api")).every((hit) => !hit.authorized)).toBe(true)
  }),
)

it.live("bounds management calls with a typed timeout state", () =>
  Effect.gen(function* () {
    const slow = yield* fixture({ delay: 200 })
    const status = yield* Discovery.Service.use((service) => service.discover()).pipe(Effect.provide(slow.layer))
    expect(status.status).toEqual({ type: "management-unavailable", reason: "timeout" })
  }),
)
