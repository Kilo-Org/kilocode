import { Effect, Layer } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { assertNetwork, assertSandbox, networkHttpLayer, unrestricted } from "@kilocode/sandbox"
import { host, opaque } from "./network-tools"

const Builtin = Symbol("kilo.sandbox.builtinTool")
const Remote = Symbol("kilo.sandbox.remoteMcp")
const indirect = new Set<string>(opaque.map((item) => item.id))
const external = new Set<string>(host.map((item) => item.id))

export const httpLayer = networkHttpLayer.pipe(Layer.provide(FetchHttpClient.layer))

function local(endpoint: URL): boolean {
  return (
    endpoint.protocol === "http:" &&
    endpoint.hostname === "127.0.0.1" &&
    !!endpoint.port &&
    !endpoint.username &&
    !endpoint.password &&
    endpoint.pathname === "/" &&
    !endpoint.search &&
    !endpoint.hash
  )
}

function cancel(signal: AbortSignal) {
  return Effect.callback<never, Error>((resume) => {
    const failure = () => Effect.fail(new Error("The browser request was cancelled"))
    if (signal.aborted) return resume(failure())
    const handler = () => resume(failure())
    signal.addEventListener("abort", handler, { once: true })
    return Effect.sync(() => signal.removeEventListener("abort", handler))
  })
}

export function broker(
  http: HttpClient.HttpClient,
  endpoint: URL,
  token: string,
  input: { sessionID: string; directory: string; url: string },
  signal: AbortSignal,
) {
  return Effect.gen(function* () {
    if (!local(endpoint)) return yield* Effect.fail(new Error("Invalid browser broker endpoint"))
    const request = yield* HttpClientRequest.post(new URL("/browser/open", endpoint).href).pipe(
      HttpClientRequest.bearerToken(token),
      HttpClientRequest.acceptJson,
      HttpClientRequest.bodyJson(input),
    )
    return yield* unrestricted(
      http.execute(request).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" })),
    ).pipe(Effect.raceFirst(cancel(signal)), Effect.timeout("45 seconds"))
  })
}

export function status(http: HttpClient.HttpClient, endpoint: URL, token: string) {
  if (!local(endpoint)) return Effect.succeed(false)
  const request = HttpClientRequest.get(new URL("/browser/status", endpoint).href).pipe(
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.acceptJson,
  )
  return Effect.gen(function* () {
    const response = yield* unrestricted(
      http.execute(request).pipe(Effect.provideService(FetchHttpClient.RequestInit, { redirect: "manual" })),
    ).pipe(Effect.timeout("2 seconds"))
    if (response.status !== 200) return false
    const value = yield* response.json
    return typeof value === "object" && value !== null && "enabled" in value && value.enabled === true
  }).pipe(Effect.catch(() => Effect.succeed(false)))
}

export function available(endpoint: URL, token: string) {
  return Effect.gen(function* () {
    return yield* status(yield* HttpClient.HttpClient, endpoint, token)
  }).pipe(Effect.provide(FetchHttpClient.layer))
}

export function builtin<A extends object>(value: A): A {
  if (!(Builtin in value)) Object.defineProperty(value, Builtin, { value: true })
  return value
}

export function isBuiltin(value: object) {
  return Builtin in value
}

export function remote<A extends object>(value: A): A {
  Object.defineProperty(value, Remote, { value: true })
  return value
}

export function tool<A, E, R>(value: { id: string }, effect: Effect.Effect<A, E, R>) {
  if (!(Builtin in value)) {
    return assertNetwork(`custom tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
  }
  if (external.has(value.id)) return assertSandbox(`tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
  if (!indirect.has(value.id)) return effect
  return assertNetwork(`tool:${value.id}`, "executeTool").pipe(Effect.andThen(effect))
}

export function mcp<A, E, R>(value: object, effect: Effect.Effect<A, E, R>) {
  return assertNetwork(
    Remote in value ? "remote MCP delegated authority" : "local MCP delegated authority",
    "executeMcp",
  ).pipe(Effect.andThen(effect))
}
