import { Effect, Layer, PlatformError } from "effect"
import { HttpClient, HttpClientError, type HttpClientRequest } from "effect/unstable/http"
import { current } from "./context"
import type { Profile } from "./profile"

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

function unsupported(value: string, method: string) {
  return PlatformError.systemError({
    _tag: "BadResource",
    module: "Sandbox",
    method,
    pathOrDescriptor: target(value),
    description: "Sandbox proxy network mode and allowedHosts are not supported",
  })
}

function unsupportedProfile(profile: Profile) {
  return profile.network.mode === "proxy" || profile.network.allowedHosts.length > 0
}

export function networkEnvironment(profile: Profile, environment: Record<string, string>) {
  if (profile.network.mode === "allow" && profile.network.allowedHosts.length === 0) return environment
  return Object.fromEntries(Object.entries(environment).filter(([key]) => !proxies.has(key)))
}

export function assertProcessNetwork(profile: Profile, command: string) {
  if (!unsupportedProfile(profile)) return Effect.void
  return Effect.fail(unsupported(command, "prepareNetwork"))
}

export function assertNetwork(value: string, method = "network") {
  return Effect.gen(function* () {
    const profile = yield* current
    if (!profile) return
    if (unsupportedProfile(profile)) yield* Effect.fail(unsupported(value, method))
    if (profile.network.mode === "allow") return
    yield* Effect.fail(denied(value, method))
  })
}

function requestError(request: HttpClientRequest.HttpClientRequest, description: string) {
  return new HttpClientError.HttpClientError({
    reason: new HttpClientError.TransportError({ request, description }),
  })
}

function assertRequest(request: HttpClientRequest.HttpClientRequest) {
  return Effect.gen(function* () {
    const profile = yield* current
    if (!profile) return request
    if (profile.network.mode === "allow" && profile.network.allowedHosts.length === 0) return request
    const description = unsupportedProfile(profile)
      ? "Sandbox proxy network mode and allowedHosts are not supported"
      : "Sandbox denied outbound network access"
    return yield* Effect.fail(requestError(request, description))
  })
}

export function decorateHttpClient(http: HttpClient.HttpClient): HttpClient.HttpClient {
  return HttpClient.mapRequestEffect(http, assertRequest)
}

export const httpLayer = Layer.effect(HttpClient.HttpClient, Effect.map(HttpClient.HttpClient, decorateHttpClient))
