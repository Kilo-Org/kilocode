// kilocode_change - new file
/**
 * Endpoint inputs are validated before a provider builds a request URL.
 *
 * A Vertex location must be a Google Cloud region or multi-region name such as `global`, `eu`, or
 * `us-central1`, and an Azure resource name must be one DNS label. The Google Cloud access token is
 * attached only to a Vertex API host, and an explicit `baseURL` is used as given.
 */

import { isResourceName } from "@opencode-ai/llm/providers/azure"

const REGION = /^[a-z][a-z0-9-]{0,62}$/

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
const VERTEX_REP = /^aiplatform\.([a-z0-9-]+)\.rep\.googleapis\.com$/

/** True for `aiplatform.googleapis.com`, `<region>-aiplatform.googleapis.com`, and the regional rep host. */
export const isVertexHost = (host: string) => {
  const name = host.trim().toLowerCase()
  if (name === "aiplatform.googleapis.com") return true
  if (name.endsWith(VERTEX_SUFFIX)) return REGION.test(name.slice(0, -VERTEX_SUFFIX.length))
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

/**
 * True when the request URL cannot carry the caller's endpoint as given, so a Vertex location must be
 * resolved and validated: an unset, non-string or empty URL, or a catalog template. The location is
 * validated only when the request URL is derived from it; a concrete URL, including a Vertex API
 * host, is used as given by both SDKs.
 */
export const vertexEndpointDerived = (url: unknown): boolean => {
  if (url === undefined || typeof url !== "string") return true
  if (url === "") return true
  return url.includes("GOOGLE_VERTEX_ENDPOINT") || url.includes("GOOGLE_VERTEX_LOCATION")
}
