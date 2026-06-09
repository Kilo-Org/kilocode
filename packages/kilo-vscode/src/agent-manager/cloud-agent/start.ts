import type { CloudRepository } from "./repository"

export type CloudAgentStartInput = {
  message: { prompt: string }
  agent: { mode: string; model: string }
  repository: CloudRepository
  options: { createdOnPlatform: "agent-manager"; kilocodeOrganizationId?: string }
}

export type CloudAgentStartResult = {
  cloudAgentSessionId: string
  kiloSessionId: string
  messageId: string
  delivery: "sent" | "queued"
}

export type CloudAgentStartErrorKind = "unauthorized" | "rejected" | "indeterminate"

export class CloudAgentStartError extends Error {
  constructor(
    readonly kind: CloudAgentStartErrorKind,
    message: string,
  ) {
    super(message)
    this.name = "CloudAgentStartError"
  }
}

type StartOptions = {
  url: string
  token: string
  input: CloudAgentStartInput
  fetch?: typeof fetch
  timeout?: (ms: number) => AbortSignal
}

const INVALID_URL = "Cloud Agent worker URL must be a secure origin"
const INDETERMINATE =
  "Cloud Agent session creation may already have succeeded. Check Cloud Agents before manually starting another session."
const TRPC_CODES = new Set([
  "BAD_REQUEST",
  "UNAUTHORIZED",
  "PAYMENT_REQUIRED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_SUPPORTED",
  "TIMEOUT",
  "CONFLICT",
  "PRECONDITION_FAILED",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNPROCESSABLE_CONTENT",
  "TOO_MANY_REQUESTS",
  "CLIENT_CLOSED_REQUEST",
])

function validateCloudAgentUrl(value: string): URL {
  const url = parse(value)
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
  const protocol = url.protocol === "https:" || (url.protocol === "http:" && loopback)
  if (!protocol || url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error(INVALID_URL)
  }
  return url
}

export async function startCloudAgent(opts: StartOptions): Promise<CloudAgentStartResult> {
  const url = new URL("/trpc/start", validateCloudAgentUrl(opts.url))
  const signal = (opts.timeout ?? AbortSignal.timeout)(30_000)
  const response = await Promise.resolve()
    .then(() =>
      (opts.fetch ?? fetch)(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(opts.input),
        redirect: "error",
        signal,
      }),
    )
    .catch(() => {
      throw new CloudAgentStartError("indeterminate", INDETERMINATE)
    })

  if (response.status === 401) {
    throw new CloudAgentStartError("unauthorized", "Cloud Agent authentication failed")
  }
  if (!response.ok && (response.status < 400 || response.status >= 500)) {
    throw new CloudAgentStartError("indeterminate", INDETERMINATE)
  }
  if (!response.ok) {
    const body = await json(response)
    if (unauthorized(body) || !trpc(body, response.status) || uncertain(body)) {
      throw new CloudAgentStartError("indeterminate", INDETERMINATE)
    }
    throw new CloudAgentStartError("rejected", rejection(body))
  }

  const body = await json(response)
  const data = record(record(body)?.result)?.data
  if (!result(data)) throw new CloudAgentStartError("indeterminate", INDETERMINATE)
  return data
}

function parse(value: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new Error(INVALID_URL)
  }
}

function json(response: Response): Promise<unknown> {
  return response.json().then(
    (value) => value,
    () => undefined,
  )
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value instanceof Object ? (value as Record<string, unknown>) : undefined
}

function result(value: unknown): value is CloudAgentStartResult {
  const data = record(value)
  return (
    typeof data?.cloudAgentSessionId === "string" &&
    data.cloudAgentSessionId.length > 0 &&
    typeof data.kiloSessionId === "string" &&
    data.kiloSessionId.length > 0 &&
    typeof data.messageId === "string" &&
    data.messageId.length > 0 &&
    (data.delivery === "sent" || data.delivery === "queued")
  )
}

function trpc(value: unknown, status: number): boolean {
  const json = record(record(value)?.error)?.json
  const data = record(record(json)?.data)
  return (
    typeof record(json)?.message === "string" &&
    typeof record(json)?.code === "number" &&
    typeof data?.code === "string" &&
    TRPC_CODES.has(data.code) &&
    data.httpStatus === status
  )
}

function uncertain(value: unknown): boolean {
  const code = record(record(record(record(value)?.error)?.json)?.data)?.code
  return code === "TIMEOUT" || code === "CLIENT_CLOSED_REQUEST"
}

function rejection(value: unknown): string {
  const code = record(record(record(record(value)?.error)?.json)?.data)?.code
  if (code === "PAYMENT_REQUIRED") return "Add credits or update billing before starting another Cloud Agent session."
  if (code === "FORBIDDEN")
    return "Check your account and repository access before starting another Cloud Agent session."
  if (code === "BAD_REQUEST" || code === "UNPROCESSABLE_CONTENT") {
    return "Check the Cloud Agent session details and try again."
  }
  if (code === "NOT_FOUND") return "Check the repository and Cloud Agent configuration before trying again."
  if (code === "TOO_MANY_REQUESTS") return "Wait before starting another Cloud Agent session."
  return "Cloud Agent could not start the session. Check the session details and try again."
}

function unauthorized(value: unknown): boolean {
  if (typeof value === "string") return /\b401\b|unauthori[sz]ed/i.test(value)
  if (Array.isArray(value)) return value.some(unauthorized)
  const data = record(value)
  return data ? Object.values(data).some(unauthorized) : false
}
