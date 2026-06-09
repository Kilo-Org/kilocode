import type { Session } from "@kilocode/sdk/v2/client"

type ListOptions = {
  url: string
  token: string
  gitUrl: string
  fetch?: typeof fetch
}

const INVALID_URL = "Cloud Agent facade URL must be a secure origin"
const INVALID_RESPONSE = "Cloud Agent session list returned an invalid response"

export class CloudAgentSessionListError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = "CloudAgentSessionListError"
  }
}

export async function listCloudAgentSessions(opts: ListOptions): Promise<Session[]> {
  const url = endpoint(opts.url)
  url.searchParams.set("gitUrl", opts.gitUrl)
  url.searchParams.set("limit", "100")
  const response = await Promise.resolve()
    .then(() =>
      (opts.fetch ?? fetch)(url, {
        method: "GET",
        headers: { Authorization: `Bearer ${opts.token}` },
        redirect: "error",
      }),
    )
    .catch(() => {
      throw new Error("Cloud Agent session list request failed")
    })

  if (!response.ok) throw new CloudAgentSessionListError(response.status, "Cloud Agent session list request failed")
  const body = await response.json().then(
    (value) => value,
    () => undefined,
  )
  if (!Array.isArray(body)) throw new Error(INVALID_RESPONSE)
  return body.map(session)
}

function endpoint(value: string): URL {
  const url = parse(value)
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "[::1]"
  const protocol = url.protocol === "https:" || (url.protocol === "http:" && loopback)
  if (!protocol || url.username || url.password || url.search || url.hash) throw new Error(INVALID_URL)
  url.pathname = url.pathname.endsWith("/") ? `${url.pathname}session` : `${url.pathname}/session`
  return url
}

function parse(value: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new Error(INVALID_URL)
  }
}

function session(value: unknown): Session {
  const data = record(value)
  const time = record(data?.time)
  if (
    typeof data?.id !== "string" ||
    !data.id ||
    typeof data.slug !== "string" ||
    typeof data.projectID !== "string" ||
    typeof data.directory !== "string" ||
    typeof data.title !== "string" ||
    typeof data.version !== "string" ||
    typeof time?.created !== "number" ||
    !Number.isFinite(time.created) ||
    typeof time.updated !== "number" ||
    !Number.isFinite(time.updated)
  )
    throw new Error(INVALID_RESPONSE)
  return {
    id: data.id,
    slug: data.slug,
    projectID: data.projectID,
    directory: data.directory,
    title: data.title,
    version: data.version,
    time: { created: time.created, updated: time.updated },
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value instanceof Object ? (value as Record<string, unknown>) : undefined
}
