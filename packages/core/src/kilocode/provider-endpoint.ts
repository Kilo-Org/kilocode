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

/** Accepts a Google Cloud region or multi-region name such as `global`, `eu`, or `us-central1`. */
export const parseVertexLocation = (value: unknown) => {
  const location = typeof value === "string" ? value.trim().toLowerCase() : ""
  if (!REGION.test(location)) {
    throw new EndpointConfigError(
      `Invalid Google Vertex location "${String(value)}". Use a Google Cloud region or multi-region name: for example, global, eu, or us-central1.`,
    )
  }
  return location
}

export const isVertexLocation = (value: unknown) => {
  return typeof value === "string" && REGION.test(value.trim().toLowerCase())
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
