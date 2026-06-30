import { AppFileSystem } from "@opencode-ai/core/filesystem"
import { Context, Duration, Effect, Layer, Option, Redacted, Result, Schema } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import * as DesktopPlatform from "./platform"
import {
  endpoint,
  normalizeLoopbackEndpoint,
  readConfig,
  readStore,
  warning,
  CatalogResponse,
  DOWNLOAD_URL,
  HealthResponse,
  InferenceModelsResponse,
  ManagementRoot,
  PropsResponse,
  REQUEST_TIMEOUT,
  RequestError,
  ServersResponse,
  type CatalogModel,
  type InferenceModel,
  type Metadata,
  type ModelDescriptor,
  type PropsResponse as Props,
  type Server,
  type Status,
  type ToolCapability,
} from "./domain"

export interface Connection {
  readonly key: Redacted.Redacted<string>
  readonly metadata: Metadata
}

export interface DiscoveryResult {
  readonly status: Status
  readonly connection?: Connection
}

export interface Interface {
  readonly discover: () => Effect.Effect<DiscoveryResult>
}

export class Service extends Context.Service<Service, Interface>()("@kilocode/AnacondaDesktopDiscovery") {}

interface Options {
  readonly timeout?: Duration.Input
}

function record(input: unknown): input is Readonly<Record<string, unknown>> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

function secret(input: Redacted.Redacted<string> | undefined) {
  return input ?? Redacted.make("", { label: "Anaconda inference key" })
}

const decodeRoot = Schema.decodeUnknownOption(ManagementRoot)
const decodeCatalog = Schema.decodeUnknownOption(CatalogResponse)
const decodeServers = Schema.decodeUnknownOption(ServersResponse)
const decodeHealth = Schema.decodeUnknownOption(HealthResponse)
const decodeModels = Schema.decodeUnknownOption(InferenceModelsResponse)
const decodeProps = Schema.decodeUnknownOption(PropsResponse)

function request(
  http: HttpClient.HttpClient,
  target: "management" | "inference",
  url: string,
  key: Redacted.Redacted<string>,
  timeout: Duration.Input,
) {
  const base = HttpClientRequest.get(url).pipe(HttpClientRequest.acceptJson)
  const auth = Redacted.value(key) === "" ? base : base.pipe(HttpClientRequest.bearerToken(key))
  return http.execute(auth).pipe(
    Effect.flatMap((response) => {
      if (response.status === 401 || response.status === 403) {
        return Effect.fail(new RequestError({ target, reason: "unauthorized" }))
      }
      if (response.status < 200 || response.status >= 300) {
        return Effect.fail(new RequestError({ target, reason: "unexpected-status" }))
      }
      return response.json.pipe(Effect.mapError(() => new RequestError({ target, reason: "malformed" })))
    }),
    Effect.timeoutOrElse({
      duration: timeout,
      orElse: () => Effect.fail(new RequestError({ target, reason: "timeout" })),
    }),
    Effect.mapError((error) =>
      error instanceof RequestError ? error : new RequestError({ target, reason: "transport" }),
    ),
  )
}

function management(error: RequestError): DiscoveryResult {
  if (error.reason === "transport") return { status: { type: "not-running" } }
  if (error.reason === "unauthorized") return { status: { type: "management-unauthorized" } }
  return {
    status: {
      type: "management-unavailable",
      reason: error.reason === "timeout" ? "timeout" : "unexpected-response",
    },
  }
}

function unhealthy(serverID: string): DiscoveryResult {
  return { status: { type: "inference-unhealthy", serverID } }
}

function identity(server: Server) {
  if (server.id) return server.id
  if (typeof server.serverProcessId === "number") return `process-${server.serverProcessId}`
  return server.modelFile?.id ?? "unknown"
}

function running(server: Server) {
  if (server.status.trim().toLowerCase() !== "running") return false
  return !server.tag || server.tag.trim().toLowerCase() === "inference"
}

function params(server: Server) {
  return server.server ?? server.serverConfig?.serverParams ?? server.serverConfig?.apiParams ?? server
}

function key(server: Server) {
  const runtime = server.server
  const config = server.serverConfig
  return secret(
    runtime?.api_key ??
      runtime?.apiKey ??
      config?.serverParams?.api_key ??
      config?.serverParams?.apiKey ??
      config?.apiParams?.api_key ??
      config?.apiParams?.apiKey ??
      config?.api_key ??
      config?.apiKey ??
      server.api_key ??
      server.apiKey,
  )
}

function location(server: Server) {
  const source = params(server)
  const url = source.url ?? server.url
  if (url) return normalizeLoopbackEndpoint(url)

  const hostname = source.host ?? server.host
  const port = source.port ?? server.port
  if (!hostname || typeof port !== "number" || !Number.isInteger(port)) return
  return endpoint(hostname, port)
}

function files(model: CatalogModel) {
  return [
    ...(model.files ?? []),
    ...(model.metadata?.files ?? []),
    ...(model.metadata?.quantizations ?? []).map((item) => ({ name: item.modelFileName })),
  ]
}

function catalog(models: ReadonlyArray<CatalogModel>, server: Server) {
  const file = server.modelFile
  if (!file) return
  return models.find((model) => {
    if (file.id && files(model).some((item) => "id" in item && item.id === file.id)) return true
    if (file.name && files(model).some((item) => item.name === file.name)) return true
    return file.name === model.name
  })
}

function generation(model: CatalogModel) {
  const task = (model.trainedFor ?? model.metadata?.trainedFor)?.trim().toLowerCase()
  return !task || task === "text-generation"
}

function text(model: CatalogModel | undefined, props: Props) {
  if (model && !generation(model)) return false
  const kind = [props.type, props.model_type, props.task]
    .filter((item): item is string => typeof item === "string")
    .join(" ")
    .toLowerCase()
  if (/embed|rerank|sentence[-_ ]similarity/.test(kind)) return false
  const capabilities = record(props.capabilities) ? props.capabilities : undefined
  if (capabilities?.chat === false || capabilities?.completion === false) return false
  return true
}

function size(props: Props, model: CatalogModel | undefined) {
  const defaults = record(props.default_generation_settings) ? props.default_generation_settings : undefined
  const values = [
    defaults?.n_ctx,
    props.n_ctx,
    props.context_size,
    props.contextWindowSize,
    model?.contextWindowSize,
    model?.metadata?.contextWindowSize,
  ]
  const found = values.find((item) => typeof item === "number" && Number.isFinite(item) && item >= 0)
  return typeof found === "number" ? Math.floor(found) : 0
}

function tools(props: Props): ToolCapability {
  const caps = record(props.chat_template_caps) ? props.chat_template_caps : undefined
  if (!caps) return "unknown"
  const values = [caps.supports_tools, caps.supports_tool_calls, caps.supportsToolCalls].filter(
    (item): item is boolean => typeof item === "boolean",
  )
  if (values.includes(true)) return "supported"
  if (values.length > 0) return "unsupported"
  return "unknown"
}

type Modality = "text" | "audio" | "image" | "video" | "pdf"

function modality(input: string): input is Modality {
  if (input === "text") return true
  if (input === "audio") return true
  if (input === "image") return true
  if (input === "video") return true
  return input === "pdf"
}

function list(input: ReadonlyArray<string> | undefined) {
  return (input ?? []).map((item) => item.toLowerCase()).filter(modality)
}

function descriptors(
  entries: ReadonlyArray<InferenceModel>,
  model: CatalogModel | undefined,
  server: Server,
  props: Props,
  toolcall: ToolCapability,
): ModelDescriptor[] {
  const reported = record(props.modalities) ? props.modalities : undefined
  const vision = reported?.vision === true
  const audio = reported?.audio === true
  const file = server.modelFile?.name
  const base = model?.name ?? file
  const note = warning(toolcall)
  return entries.map((entry) => {
    const input = new Set<Modality>(["text", ...list(entry.modalities?.input)])
    const output = new Set<Modality>(["text", ...list(entry.modalities?.output)])
    if (vision) input.add("image")
    if (audio) input.add("audio")
    const name = entries.length === 1 && base ? base : entry.id
    const family =
      model?.family ?? model?.metadata?.family ?? model?.model_type ?? model?.metadata?.model_type ?? entry.family
    return {
      id: entry.id,
      name,
      ...(family?.trim() ? { family: family.trim() } : {}),
      input: [...input],
      output: [...output],
      ...(note ? { description: note } : {}),
    }
  })
}

export function makeLayer(options: Options = {}) {
  return Layer.effect(
    Service,
    Effect.gen(function* () {
      const fs = yield* AppFileSystem.Service
      const http = yield* HttpClient.HttpClient
      const platform = yield* DesktopPlatform.Service
      const timeout = options.timeout ?? REQUEST_TIMEOUT

      const discover = Effect.fn("AnacondaDesktopDiscovery.discover")(function* () {
        if (!DesktopPlatform.supported(platform.info)) {
          return {
            status: { type: "unsupported-platform", platform: platform.info.platform },
          } satisfies DiscoveryResult
        }

        const install = yield* platform.installation().pipe(Effect.orElseSucceed(() => undefined))
        if (!install) {
          return { status: { type: "not-installed", downloadURL: DOWNLOAD_URL } } satisfies DiscoveryResult
        }

        const dir = yield* platform.dataDir().pipe(Effect.orElseSucceed(() => undefined))
        if (!dir) {
          return {
            status: { type: "unsupported-platform", platform: platform.info.platform },
          } satisfies DiscoveryResult
        }

        const cfg = yield* readConfig(dir).pipe(Effect.provideService(AppFileSystem.Service, fs), Effect.result)
        if (Result.isFailure(cfg)) {
          return {
            status: { type: "invalid-config", reason: cfg.failure.reason },
          } satisfies DiscoveryResult
        }

        const origin = `http://127.0.0.1:${cfg.success.aiNavApiServerPort}`
        const root = yield* request(http, "management", `${origin}/api`, cfg.success.aiNavApiKey, timeout).pipe(
          Effect.result,
        )
        if (Result.isFailure(root)) return management(root.failure)
        if (Option.isNone(decodeRoot(root.success))) {
          return management(new RequestError({ target: "management", reason: "malformed" }))
        }

        const signed = yield* readStore(dir).pipe(Effect.provideService(AppFileSystem.Service, fs), Effect.result)
        if (Result.isFailure(signed) || !signed.success) {
          return { status: { type: "signed-out" } } satisfies DiscoveryResult
        }

        const found = yield* request(
          http,
          "management",
          `${origin}/api/models?downloaded=true`,
          cfg.success.aiNavApiKey,
          timeout,
        ).pipe(Effect.result)
        if (Result.isFailure(found)) return management(found.failure)
        const decodedModels = decodeCatalog(found.success)
        if (Option.isNone(decodedModels)) {
          return management(new RequestError({ target: "management", reason: "malformed" }))
        }
        const downloaded = decodedModels.value.data.filter((model) => files(model).length > 0 && generation(model))
        if (downloaded.length === 0) {
          return { status: { type: "no-downloaded-model" } } satisfies DiscoveryResult
        }

        const queried = yield* request(
          http,
          "management",
          `${origin}/api/servers?status=running&tag=inference`,
          cfg.success.aiNavApiKey,
          timeout,
        ).pipe(Effect.result)
        if (Result.isFailure(queried)) return management(queried.failure)
        const decodedServers = decodeServers(queried.success)
        if (Option.isNone(decodedServers)) {
          return management(new RequestError({ target: "management", reason: "malformed" }))
        }
        const servers = decodedServers.value.data.filter(running)
        if (servers.length === 0) {
          return {
            status: {
              type: "no-running-server",
              downloadedModels: downloaded.length,
            },
          } satisfies DiscoveryResult
        }

        const server = servers[0]
        const serverID = identity(server)
        const baseURL = location(server)
        if (!baseURL) return unhealthy(serverID)
        const api = baseURL.replace(/\/v1$/, "")
        const inferenceKey = key(server)

        const health = yield* request(http, "inference", `${api}/health`, inferenceKey, timeout).pipe(Effect.result)
        if (Result.isFailure(health)) return unhealthy(serverID)
        const decodedHealth = decodeHealth(health.success)
        if (Option.isNone(decodedHealth) || !["ok", "healthy"].includes(decodedHealth.value.status.toLowerCase())) {
          return unhealthy(serverID)
        }

        const listed = yield* request(http, "inference", `${api}/v1/models`, inferenceKey, timeout).pipe(Effect.result)
        if (Result.isFailure(listed)) return unhealthy(serverID)
        const decodedInference = decodeModels(listed.success)
        if (Option.isNone(decodedInference) || decodedInference.value.data.length === 0) return unhealthy(serverID)

        const properties = yield* request(http, "inference", `${api}/props`, inferenceKey, timeout).pipe(Effect.result)
        if (Result.isFailure(properties)) return unhealthy(serverID)
        const decodedProps = decodeProps(properties.success)
        if (Option.isNone(decodedProps)) return unhealthy(serverID)

        const model = catalog(downloaded, server)
        if (!text(model, decodedProps.value)) return unhealthy(serverID)
        const context = size(decodedProps.value, model)
        const toolcall = tools(decodedProps.value)
        const models = descriptors(decodedInference.value.data, model, server, decodedProps.value, toolcall)
        const metadata: Metadata = {
          version: "1",
          serverID,
          baseURL,
          models,
          context,
          toolcall,
        }
        return {
          status: {
            type: "ready",
            serverID,
            ...(model?.name
              ? { serverName: model.name }
              : server.modelFile?.name
                ? { serverName: server.modelFile.name }
                : {}),
            models: models.map((item) => ({
              id: item.id,
              name: item.name,
            })),
            context,
            toolcall,
          },
          connection: { key: inferenceKey, metadata },
        } satisfies DiscoveryResult
      })

      return Service.of({ discover })
    }),
  )
}

export const layer = makeLayer()
export const defaultLayer = layer.pipe(
  Layer.provide(DesktopPlatform.defaultLayer),
  Layer.provide(AppFileSystem.defaultLayer),
  Layer.provide(FetchHttpClient.layer),
)
