import { FSUtil } from "@opencode-ai/core/fs-util"
import path from "path"
import { Effect, Option, Schema } from "effect"

export const PROVIDER_ID = "anaconda-desktop"
export const DOWNLOAD_URL = "https://www.anaconda.com/products/desktop"
export const CONFIG_FILE = "config.json"
export const STORE_FILE = "anaconda-desktop-encrypted-store.json"
export const OAUTH_SUFFIX = "_ai-navigator-workos-oauth"
export const REQUEST_TIMEOUT = "4 seconds"

export const ToolCapability = Schema.Literals(["supported", "unsupported", "unknown"])
export type ToolCapability = typeof ToolCapability.Type

export const Modality = Schema.Literals(["text", "audio", "image", "video", "pdf"])
export type Modality = typeof Modality.Type

export const Port = Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65_535 }))
export const ContextSize = Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }))

export const ModelDescriptor = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  family: Schema.optional(Schema.NonEmptyString),
  input: Schema.Array(Modality).check(Schema.isNonEmpty()),
  output: Schema.Array(Modality).check(Schema.isNonEmpty()),
  description: Schema.optional(Schema.NonEmptyString),
})
export type ModelDescriptor = typeof ModelDescriptor.Type

export const Metadata = Schema.Struct({
  version: Schema.Literal("1"),
  serverID: Schema.NonEmptyString,
  baseURL: Schema.NonEmptyString,
  models: Schema.Array(ModelDescriptor).check(Schema.isNonEmpty()),
  context: ContextSize,
  toolcall: ToolCapability,
})
export type Metadata = typeof Metadata.Type

export const EncodedMetadata = Schema.Struct({
  version: Schema.Literal("1"),
  serverID: Schema.NonEmptyString,
  baseURL: Schema.NonEmptyString,
  models: Schema.fromJsonString(Schema.Array(ModelDescriptor).check(Schema.isNonEmpty())),
  context: Schema.NumberFromString.pipe(
    Schema.check(Schema.isInt(), Schema.isBetween({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER })),
  ),
  toolcall: ToolCapability,
})

export const Config = Schema.Struct({
  aiNavApiKey: Schema.RedactedFromValue(Schema.NonEmptyString, { label: "Anaconda Desktop management key" }),
  aiNavApiServerPort: Port,
})
export type Config = typeof Config.Type

const CatalogFile = Schema.Struct({
  id: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
})

const CatalogQuantization = Schema.Struct({
  modelFileName: Schema.optional(Schema.String),
})

const CatalogMetadata = Schema.Struct({
  trainedFor: Schema.optional(Schema.String),
  contextWindowSize: Schema.optional(Schema.Finite),
  description: Schema.optional(Schema.String),
  model_type: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  quantizations: Schema.optional(Schema.Array(CatalogQuantization)),
  files: Schema.optional(Schema.Array(CatalogFile)),
})

export const CatalogModel = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  trainedFor: Schema.optional(Schema.String),
  contextWindowSize: Schema.optional(Schema.Finite),
  model_type: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  metadata: Schema.optional(CatalogMetadata),
  files: Schema.optional(Schema.Array(CatalogFile)),
})
export type CatalogModel = typeof CatalogModel.Type

export const CatalogResponse = Schema.Struct({
  data: Schema.Array(CatalogModel),
})

const KeyFields = {
  apiKey: Schema.optional(Schema.RedactedFromValue(Schema.String, { label: "Anaconda inference key" })),
  api_key: Schema.optional(Schema.RedactedFromValue(Schema.String, { label: "Anaconda inference key" })),
}

const Params = Schema.Struct({
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Finite),
  url: Schema.optional(Schema.String),
  ...KeyFields,
})

const ServerConfig = Schema.Struct({
  modelFileName: Schema.optional(Schema.String),
  apiParams: Schema.optional(Params),
  serverParams: Schema.optional(Params),
  ...KeyFields,
})

const ServerRuntime = Schema.Struct({
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Finite),
  url: Schema.optional(Schema.String),
  ...KeyFields,
})

export const Server = Schema.Struct({
  id: Schema.optional(Schema.NonEmptyString),
  serverProcessId: Schema.optional(Schema.NullOr(Schema.Int)),
  status: Schema.String,
  tag: Schema.optional(Schema.String),
  modelFile: Schema.optional(CatalogFile),
  serverConfig: Schema.optional(ServerConfig),
  server: Schema.optional(ServerRuntime),
  host: Schema.optional(Schema.String),
  port: Schema.optional(Schema.Finite),
  url: Schema.optional(Schema.String),
  ...KeyFields,
})
export type Server = typeof Server.Type

export const ServersResponse = Schema.Struct({
  data: Schema.Array(Server),
})

export const ManagementRoot = Schema.Struct({
  data: Schema.Record(Schema.String, Schema.Unknown),
})

export const HealthResponse = Schema.Struct({
  status: Schema.String,
})

const ReportedModalities = Schema.Struct({
  input: Schema.optional(Schema.Array(Schema.String)),
  output: Schema.optional(Schema.Array(Schema.String)),
})

export const InferenceModel = Schema.Struct({
  id: Schema.NonEmptyString,
  owned_by: Schema.optional(Schema.String),
  family: Schema.optional(Schema.String),
  modalities: Schema.optional(ReportedModalities),
})
export type InferenceModel = typeof InferenceModel.Type

export const InferenceModelsResponse = Schema.Struct({
  data: Schema.Array(InferenceModel),
})

export const PropsResponse = Schema.Record(Schema.String, Schema.Unknown)
export type PropsResponse = typeof PropsResponse.Type

export const StatusModel = Schema.Struct({
  id: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
})
export type StatusModel = typeof StatusModel.Type

export const UnsupportedStatus = Schema.Struct({
  type: Schema.Literal("unsupported-platform"),
  platform: Schema.String,
})

export const NotInstalledStatus = Schema.Struct({
  type: Schema.Literal("not-installed"),
  downloadURL: Schema.String,
})

export const NotRunningStatus = Schema.Struct({
  type: Schema.Literal("not-running"),
})

export const InvalidConfigStatus = Schema.Struct({
  type: Schema.Literal("invalid-config"),
  reason: Schema.Literals(["missing", "malformed", "missing-key", "invalid-port"]),
})

export const SignedOutStatus = Schema.Struct({
  type: Schema.Literal("signed-out"),
})

export const ManagementUnauthorizedStatus = Schema.Struct({
  type: Schema.Literal("management-unauthorized"),
})

export const ManagementUnavailableStatus = Schema.Struct({
  type: Schema.Literal("management-unavailable"),
  reason: Schema.Literals(["timeout", "unexpected-response"]),
})

export const NoDownloadedModelStatus = Schema.Struct({
  type: Schema.Literal("no-downloaded-model"),
})

export const NoRunningServerStatus = Schema.Struct({
  type: Schema.Literal("no-running-server"),
  downloadedModels: Schema.Int,
})

export const InferenceUnhealthyStatus = Schema.Struct({
  type: Schema.Literal("inference-unhealthy"),
  serverID: Schema.NonEmptyString,
})

export const ReadyStatus = Schema.Struct({
  type: Schema.Literal("ready"),
  serverID: Schema.NonEmptyString,
  serverName: Schema.optional(Schema.NonEmptyString),
  models: Schema.Array(StatusModel).check(Schema.isNonEmpty()),
  context: ContextSize,
  toolcall: ToolCapability,
})
export type ReadyStatus = typeof ReadyStatus.Type

export const Status = Schema.Union([
  UnsupportedStatus,
  NotInstalledStatus,
  NotRunningStatus,
  InvalidConfigStatus,
  SignedOutStatus,
  ManagementUnauthorizedStatus,
  ManagementUnavailableStatus,
  NoDownloadedModelStatus,
  NoRunningServerStatus,
  InferenceUnhealthyStatus,
  ReadyStatus,
]).annotate({ discriminator: "type", identifier: "AnacondaDesktopStatus" })
export type Status = typeof Status.Type

export class ConfigError extends Schema.TaggedErrorClass<ConfigError>()("AnacondaDesktopConfigError", {
  reason: Schema.Literals(["missing", "malformed", "missing-key", "invalid-port"]),
}) {}

export class StoreError extends Schema.TaggedErrorClass<StoreError>()("AnacondaDesktopStoreError", {
  reason: Schema.Literals(["missing", "malformed"]),
}) {}

export class PlatformError extends Schema.TaggedErrorClass<PlatformError>()("AnacondaDesktopPlatformError", {
  operation: Schema.Literals(["data-dir", "installation", "open"]),
  reason: Schema.Literals(["unsupported", "not-installed", "failed"]),
}) {}

export class RequestError extends Schema.TaggedErrorClass<RequestError>()("AnacondaDesktopRequestError", {
  target: Schema.Literals(["management", "inference"]),
  reason: Schema.Literals(["timeout", "transport", "unauthorized", "unexpected-status", "malformed"]),
}) {}

export class NotReadyError extends Schema.TaggedErrorClass<NotReadyError>()("AnacondaDesktopNotReadyError", {
  status: Status,
}) {}

export class ToolAcknowledgementError extends Schema.TaggedErrorClass<ToolAcknowledgementError>()(
  "AnacondaDesktopToolAcknowledgementError",
  {
    status: ReadyStatus,
  },
) {}

export class SyncError extends Schema.TaggedErrorClass<SyncError>()("AnacondaDesktopSyncError", {
  operation: Schema.Literals(["encode", "store"]),
}) {}

const json = Schema.decodeUnknownOption(Schema.UnknownFromJsonString)
const config = Schema.decodeUnknownOption(Config)

function record(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input)
}

export const parseConfig = Effect.fn("AnacondaDesktop.parseConfig")(function* (text: string) {
  const parsed = json(text)
  if (Option.isNone(parsed) || !record(parsed.value)) {
    return yield* new ConfigError({ reason: "malformed" })
  }

  const key = parsed.value.aiNavApiKey
  if (typeof key !== "string" || key.trim() === "") {
    return yield* new ConfigError({ reason: "missing-key" })
  }

  const port = parsed.value.aiNavApiServerPort
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65_535) {
    return yield* new ConfigError({ reason: "invalid-port" })
  }

  const result = config({ aiNavApiKey: key.trim(), aiNavApiServerPort: port })
  if (Option.isNone(result)) return yield* new ConfigError({ reason: "malformed" })
  return result.value
})

function present(input: unknown) {
  if (input === null || input === undefined) return false
  if (typeof input === "string") return input.trim() !== ""
  if (Array.isArray(input)) return input.length > 0
  if (record(input)) return Object.keys(input).length > 0
  return true
}

export const parseStore = Effect.fn("AnacondaDesktop.parseStore")(function* (text: string) {
  const parsed = json(text)
  if (Option.isNone(parsed) || !record(parsed.value)) {
    return yield* new StoreError({ reason: "malformed" })
  }

  return Object.entries(parsed.value).some(([key, value]) => key.endsWith(OAUTH_SUFFIX) && present(value))
})

export const readConfig = Effect.fn("AnacondaDesktop.readConfig")(function* (dir: string) {
  const fs = yield* FSUtil.Service
  const text = yield* fs
    .readFileStringSafe(path.join(dir, CONFIG_FILE))
    .pipe(Effect.mapError(() => new ConfigError({ reason: "malformed" as const })))
  if (text === undefined) return yield* new ConfigError({ reason: "missing" })
  return yield* parseConfig(text)
})

export const readStore = Effect.fn("AnacondaDesktop.readStore")(function* (dir: string) {
  const fs = yield* FSUtil.Service
  const text = yield* fs
    .readFileStringSafe(path.join(dir, STORE_FILE))
    .pipe(Effect.mapError(() => new StoreError({ reason: "malformed" as const })))
  if (text === undefined) return yield* new StoreError({ reason: "missing" })
  return yield* parseStore(text)
})

function host(value: string) {
  const trimmed = value.trim().toLowerCase()
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) return trimmed.slice(1, -1)
  return trimmed
}

export function isLoopbackHost(value: string) {
  const name = host(value)
  if (name === "localhost" || name === "::1") return true
  if (name.startsWith("::ffff:")) return isLoopbackHost(name.slice("::ffff:".length))
  const octets = name.split(".")
  if (octets.length !== 4) return false
  if (octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false
  return Number(octets[0]) === 127
}

function clientHost(value: string) {
  const name = host(value)
  if (name === "0.0.0.0") return "127.0.0.1"
  if (name === "::") return "::1"
  return name
}

function parsed(input: string) {
  const value = input.trim()
  if (!URL.canParse(value)) return
  const url = new URL(value)
  if (url.protocol !== "http:") return
  if (url.username || url.password || url.search || url.hash) return
  if (url.pathname !== "/" && url.pathname !== "" && url.pathname !== "/v1" && url.pathname !== "/v1/") return
  const name = clientHost(url.hostname)
  if (!isLoopbackHost(name)) return
  const fallback = url.port || "80"
  const port = Number(fallback)
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return
  const hostname = name.includes(":") ? `[${name}]` : name
  return `http://${hostname}:${port}/v1`
}

export function normalizeLoopbackEndpoint(input: string) {
  return parsed(input)
}

export function endpoint(hostname: string, port: number) {
  if (!Number.isInteger(port) || port < 1 || port > 65_535) return
  const value = hostname.trim()
  if (!value) return
  if (value.startsWith("http://") || value.startsWith("https://")) {
    if (!URL.canParse(value)) return
    const url = new URL(value)
    if (!url.port) url.port = String(port)
    return normalizeLoopbackEndpoint(url.toString())
  }
  const name = host(value)
  const address = name.includes(":") ? `[${name}]` : name
  return normalizeLoopbackEndpoint(`http://${address}:${port}`)
}

function unique(models: ReadonlyArray<ModelDescriptor>) {
  return new Set(models.map((model) => model.id)).size === models.length
}

const decode = Schema.decodeUnknownOption(EncodedMetadata)
const encode = Schema.encodeUnknownOption(EncodedMetadata)

export function decodeMetadata(input: Record<string, string> | undefined): Metadata | undefined {
  if (!input) return
  const result = decode(input)
  if (Option.isNone(result)) return
  const baseURL = normalizeLoopbackEndpoint(result.value.baseURL)
  if (!baseURL || !unique(result.value.models)) return
  return { ...result.value, baseURL }
}

export function encodeMetadata(input: Metadata): Record<string, string> | undefined {
  const checked = Schema.decodeUnknownOption(Metadata)(input)
  if (Option.isNone(checked)) return
  const baseURL = normalizeLoopbackEndpoint(checked.value.baseURL)
  if (!baseURL || !unique(checked.value.models)) return
  const result = encode({ ...checked.value, baseURL })
  if (Option.isNone(result)) return
  return result.value
}

export function warning(toolcall: ToolCapability) {
  if (toolcall === "supported") return
  if (toolcall === "unsupported") {
    return "This local model does not support tool calling, so normal coding-agent actions are limited."
  }
  return "Tool-call support could not be confirmed for this local model, so normal coding-agent actions may be limited."
}
