import { Effect, Layer, PlatformError, Stream } from "effect"
import { HttpClient, HttpClientError, HttpClientResponse, type HttpClientRequest } from "effect/unstable/http"
import { current } from "./context"
import type { Profile } from "./profile"
import { currentProxy, type ProxyRuntime } from "./proxy"
import { normalizeDestinations } from "./destination"

const proxies = new Set([
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
  "no_proxy",
])

function target(value: string) {
  if (!URL.canParse(value)) return value
  const url = new URL(value)
  return url.origin
}

function denied(value: string, method: string) {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "Sandbox",
    method,
    pathOrDescriptor: target(value),
    description: "Sandbox denied outbound network access",
  })
}

function unavailable(value: string, method: string, description = "Sandbox network proxy is unavailable") {
  return PlatformError.systemError({
    _tag: "BadResource",
    module: "Sandbox",
    method,
    pathOrDescriptor: target(value),
    description,
  })
}

function outside(value: string, method: string) {
  return PlatformError.systemError({
    _tag: "PermissionDenied",
    module: "Sandbox",
    method,
    pathOrDescriptor: target(value),
    description: "Sandbox denied execution outside its process boundary",
  })
}

function matches(profile: Profile, runtime: ProxyRuntime) {
  return normalizeDestinations(profile.network.allowedHosts).join("\0") === runtime.allowedHosts.join("\0")
}

export function networkEnvironment(profile: Profile, environment: Record<string, string>, runtime?: ProxyRuntime) {
  if (profile.network.mode === "allow" && profile.network.allowedHosts.length === 0) return environment
  const clean = Object.fromEntries(Object.entries(environment).filter(([key]) => !proxies.has(key)))
  if (profile.network.mode !== "proxy" || !runtime) return clean
  const url = runtime.socket ? `http://kilo:${encodeURIComponent(runtime.token)}@127.0.0.1:3128` : runtime.url
  return {
    ...clean,
    HTTP_PROXY: url,
    HTTPS_PROXY: url,
    http_proxy: url,
    https_proxy: url,
    NO_PROXY: "",
    no_proxy: "",
  }
}

export function assertProcessNetwork(profile: Profile, command: string) {
  if (profile.network.mode !== "proxy" && profile.network.allowedHosts.length > 0) {
    return Effect.fail(unavailable(command, "prepareNetwork", "Sandbox allowedHosts require proxy network mode"))
  }
  if (profile.network.mode !== "proxy") return Effect.void
  return Effect.flatMap(currentProxy, (runtime) =>
    runtime && matches(profile, runtime)
      ? Effect.void
      : Effect.fail(unavailable(command, "prepareNetwork", "Sandbox network proxy policy does not match the session")),
  )
}

export function assertSandbox(value: string, method = "sandbox") {
  return Effect.flatMap(current, (profile) =>
    profile ? Effect.fail(outside(value, method)) : Effect.void,
  )
}

export function assertNetwork(value: string, method = "network") {
  return Effect.gen(function* () {
    const profile = yield* current
    if (!profile) return
    if (profile.network.mode === "allow") return
    yield* Effect.fail(denied(value, method))
  })
}

function requestError(request: HttpClientRequest.HttpClientRequest, description: string) {
  return new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, description }),
  })
}

function proxied(request: HttpClientRequest.HttpClientRequest, url: URL, signal: AbortSignal, runtime: ProxyRuntime) {
  const send = (body: BodyInit | undefined) =>
    Effect.tryPromise({
      try: () =>
        fetch(url, {
          method: request.method,
          headers: request.headers,
          body,
          duplex: request.body._tag === "Stream" ? "half" : undefined,
          signal,
          proxy: runtime.url,
        } as RequestInit),
      catch: (cause) => requestError(request, cause instanceof Error ? cause.message : "Sandbox proxy request failed"),
    }).pipe(Effect.map((response) => HttpClientResponse.fromWeb(request, response)))
  switch (request.body._tag) {
    case "Raw":
    case "Uint8Array":
      return send(request.body.body as BodyInit)
    case "FormData":
      return send(request.body.formData)
    case "Stream":
      return Effect.flatMap(Stream.toReadableStreamEffect(request.body.stream), send)
  }
  return send(undefined)
}

export function decorateHttpClient(http: HttpClient.HttpClient): HttpClient.HttpClient {
  return HttpClient.make((request, url, signal) =>
    Effect.gen(function* () {
      const profile = yield* current
      if (!profile || profile.network.mode === "allow") return yield* http.execute(request)
      if (profile.network.mode === "deny") {
        return yield* Effect.fail(requestError(request, "Sandbox denied outbound network access"))
      }
      const runtime = yield* currentProxy
      if (!runtime || !matches(profile, runtime)) {
        return yield* Effect.fail(requestError(request, "Sandbox network proxy policy does not match the session"))
      }
      return yield* proxied(request, url, signal, runtime)
    }),
  )
}

export const httpLayer = Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, decorateHttpClient))
