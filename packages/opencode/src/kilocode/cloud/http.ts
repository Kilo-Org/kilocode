import { CloudError, ServiceRedirectError, ServiceTransportError } from "./errors"
import type { ServiceOrigin } from "./origin"

export const DEFAULT_HTTP_TIMEOUT_MS = 30_000

export interface BearerRequest {
  readonly method: "GET" | "POST"
  readonly path: `/${string}`
  readonly headers?: Readonly<Record<string, string>>
  readonly body?: BodyInit
  /** Overrides the client default. Use `0` for a long-lived stream. */
  readonly timeoutMs?: number
}

export interface BearerHttpClient {
  request(request: BearerRequest): Promise<Response>
}

export interface BearerHttpClientOptions {
  readonly origin: ServiceOrigin
  readonly apiKey: string
  readonly fetch?: typeof globalThis.fetch
  readonly timeoutMs?: number
}

export function createBearerHttpClient(options: BearerHttpClientOptions): BearerHttpClient {
  const fetcher = options.fetch ?? globalThis.fetch

  return {
    async request(request) {
      const url = resolve(options.origin, request.path)
      const headers = new Headers(request.headers)
      if (headers.has("authorization")) {
        throw new CloudError("Authorization headers are managed by Kilo")
      }
      headers.set("authorization", `Bearer ${options.apiKey}`)
      const timeout = request.timeoutMs ?? options.timeoutMs ?? DEFAULT_HTTP_TIMEOUT_MS

      const response = await fetcher(url, {
        method: request.method,
        headers,
        ...(request.body === undefined ? {} : { body: request.body }),
        redirect: "manual",
        ...(timeout > 0 ? { signal: AbortSignal.timeout(timeout) } : {}),
      }).catch(() => {
        throw new ServiceTransportError()
      })

      if ((response.status >= 300 && response.status < 400) || response.redirected) {
        await discard(response)
        throw new ServiceRedirectError()
      }
      return response
    },
  }
}

async function discard(response: Response) {
  await response.body?.cancel().catch(() => undefined)
}

function resolve(origin: ServiceOrigin, path: `/${string}`) {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.includes("#")) {
    throw new CloudError("Unsafe service request path")
  }

  const url = new URL(path, origin)
  if (url.origin !== origin) throw new CloudError("Unsafe service request path")
  return url
}
