// kilocode_change - new file
/**
 * Endpoint inputs are validated before a provider builds a request URL.
 *
 * A Vertex location must be a Google Cloud region or multi-region name such as `global`, `eu`, or
 * `us-central1`, and an Azure resource name must be one DNS label. The Google Cloud access token is
 * attached only to a Vertex API host, and an explicit `baseURL` is used as given.
 */

import { isResourceName } from "@opencode-ai/llm/providers/azure"

// A region is one DNS label: it starts with a letter, ends with a letter or digit, has at most 63
// characters, and never repeats a hyphen.
const REGION = /^(?!.*--)[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/

/** Configuration error for a provider endpoint input. Its message is safe to show to the user. */
export class EndpointConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "EndpointConfigError"
  }
}

/**
 * Trims and lowercases a Google Vertex location, or returns `undefined` when it is not a region.
 * Never throws, so a catalog transform can skip an unusable value instead of failing everyone.
 */
export const normalizeVertexLocation = (value: unknown): string | undefined => {
  const location = typeof value === "string" ? value.trim().toLowerCase() : ""
  return REGION.test(location) ? location : undefined
}

/** Accepts a Google Cloud region or multi-region name such as `global`, `eu`, or `us-central1`. */
export const parseVertexLocation = (value: unknown) => {
  const location = normalizeVertexLocation(value)
  if (location === undefined) {
    throw new EndpointConfigError(
      `Invalid Google Vertex location "${String(value)}". Use a Google Cloud region or multi-region name: for example, global, eu, or us-central1.`,
    )
  }
  return location
}

/** Provider whose request endpoint is built from a Google Vertex location. */
export type VertexLocationProvider = "google-vertex" | "google-vertex-anthropic"

/** Environment names that carry the region, in the order each provider reads them. */
const VERTEX_LOCATION_ENV: Record<VertexLocationProvider, readonly string[]> = {
  "google-vertex": ["GOOGLE_VERTEX_LOCATION", "GOOGLE_CLOUD_LOCATION", "VERTEX_LOCATION"],
  "google-vertex-anthropic": ["GOOGLE_CLOUD_LOCATION", "VERTEX_LOCATION"],
}

/** Region a provider uses when neither the option nor the environment names one. */
export const VERTEX_LOCATION_DEFAULT: Record<VertexLocationProvider, string> = {
  "google-vertex": "us-central1",
  "google-vertex-anthropic": "global",
}

/**
 * Resolves a Google Vertex location: the value when it is set, otherwise the environment names the
 * region in the order the provider reads it, otherwise the provider default. The environment names the
 * region when the option does not. A blank entry is treated as unset, so an exported but empty variable
 * falls through. The result is raw, and the caller validates it before a request URL is built.
 */
export const resolveVertexLocation = (
  value: unknown,
  env: Record<string, string | undefined>,
  providerID: VertexLocationProvider,
): string => {
  const names = VERTEX_LOCATION_ENV[providerID]
  const chain = [value, ...names.map((name) => env[name])]
  const raw = chain.find((entry) => typeof entry === "string" && entry.trim() !== "")
  return typeof raw === "string" ? raw : VERTEX_LOCATION_DEFAULT[providerID]
}

/** Accepts an Azure resource name, which is one DNS label and never a URL. */
export const parseAzureResourceName = (value: string) => {
  if (!isResourceName(value)) {
    throw new EndpointConfigError(
      `Invalid Azure resource name "${value}". Use the resource name alone, not a URL: for example, my-resource.`,
    )
  }
  return value.trim()
}

const VERTEX_SUFFIX = "-aiplatform.googleapis.com"
const VERTEX_MTLS = "-aiplatform.mtls.googleapis.com"
const VERTEX_REP = /^aiplatform\.([a-z0-9-]+)\.rep\.googleapis\.com$/

/**
 * True for `aiplatform.googleapis.com`, `<region>-aiplatform.googleapis.com`, the regional rep host,
 * and the mTLS hosts `aiplatform.mtls.googleapis.com` and `<region>-aiplatform.mtls.googleapis.com`.
 */
export const isVertexHost = (host: string) => {
  const name = host.trim().toLowerCase()
  if (name === "aiplatform.googleapis.com") return true
  if (name === "aiplatform.mtls.googleapis.com") return true
  if (name.endsWith(VERTEX_SUFFIX)) return REGION.test(name.slice(0, -VERTEX_SUFFIX.length))
  if (name.endsWith(VERTEX_MTLS)) return REGION.test(name.slice(0, -VERTEX_MTLS.length))
  const rep = VERTEX_REP.exec(name)
  return rep !== null && REGION.test(rep[1])
}

/** Host name of a fetch input, or `undefined` when it cannot be parsed. */
export const requestHost = (input: unknown) => {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : typeof input === "object" && input !== null && "url" in input && typeof input.url === "string"
          ? input.url
          : undefined
  if (raw === undefined) return undefined
  try {
    return new URL(raw).hostname
  } catch {
    return undefined
  }
}

/** Removes a blank `baseURL` so it counts as unset on every provider endpoint path. */
export const dropBlankEndpoint = (options: Record<string, any>) => {
  if (typeof options.baseURL === "string" && options.baseURL.trim() === "") delete options.baseURL
  return options
}

/**
 * True when the request URL cannot carry the caller's endpoint as given, so a Vertex location must be
 * resolved and validated: an unset, blank or whitespace-only URL, or a catalog template. The location
 * is validated only when the request URL is derived from it; a concrete URL, including a Vertex API
 * host, is used as given by both SDKs.
 */
export const vertexEndpointDerived = (url: unknown): boolean => {
  if (url === undefined || typeof url !== "string") return true
  if (url.trim() === "") return true
  return url.includes("GOOGLE_VERTEX_ENDPOINT") || url.includes("GOOGLE_VERTEX_LOCATION")
}
