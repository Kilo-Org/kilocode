export const BEDROCK_ID = "amazon-bedrock"
export const VERTEX_ID = "google-vertex"

export type CloudAuth = {
  type: "api"
  key: string
  metadata?: Record<string, string>
}

export type CloudConnect = {
  options?: Record<string, string>
  auth?: CloudAuth
}

const PLACEHOLDER = "configured"

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function meta(input?: Record<string, unknown>) {
  const next: Record<string, string> = {}
  for (const [key, value] of Object.entries(input ?? {})) {
    const field = text(value)
    if (field) next[key] = field
  }
  return next
}

function parseJson(raw: string) {
  const value = JSON.parse(raw) as unknown
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Service account credentials must be a JSON object")
  }
  return value as Record<string, unknown>
}

function parseBedrock(apiKey: string | undefined, input?: Record<string, unknown>): CloudConnect {
  const fields = meta(input)
  const mode = fields.mode ?? (text(apiKey) ? "apiKey" : fields.profile ? "profile" : "accessKeys")
  const region = fields.region
  const endpoint = fields.endpoint
  const options: Record<string, string> = {}
  if (region) options.region = region
  if (endpoint) options.endpoint = endpoint

  if (mode === "profile") {
    if (fields.profile) options.profile = fields.profile
    return { options: Object.keys(options).length > 0 ? options : undefined }
  }

  if (mode === "accessKeys") {
    const metadata: Record<string, string> = {}
    if (fields.accessKeyId) metadata.accessKeyId = fields.accessKeyId
    if (fields.secretAccessKey) metadata.secretAccessKey = fields.secretAccessKey
    if (fields.sessionToken) metadata.sessionToken = fields.sessionToken
    return {
      options: Object.keys(options).length > 0 ? options : undefined,
      auth: {
        type: "api",
        key: PLACEHOLDER,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
      },
    }
  }

  const key = text(apiKey) ?? fields.apiKey
  return {
    options: Object.keys(options).length > 0 ? options : undefined,
    auth: key ? { type: "api", key } : undefined,
  }
}

function parseVertex(apiKey: string | undefined, input?: Record<string, unknown>): CloudConnect {
  const fields = meta(input)
  const blob = fields.credentials ?? text(apiKey)
  const parsed = blob
    ? (() => {
        try {
          return parseJson(blob)
        } catch {
          return undefined
        }
      })()
    : undefined
  const project = fields.project ?? text(parsed?.project_id)
  const location = fields.location
  const options: Record<string, string> = {}
  if (project) options.project = project
  if (location) options.location = location
  if (!parsed) return { options: Object.keys(options).length > 0 ? options : undefined }
  return {
    options: Object.keys(options).length > 0 ? options : undefined,
    auth: {
      type: "api",
      key: PLACEHOLDER,
      metadata: { credentials: JSON.stringify(parsed) },
    },
  }
}

export function isCloudProvider(id: string): id is typeof BEDROCK_ID | typeof VERTEX_ID {
  return id === BEDROCK_ID || id === VERTEX_ID
}

export function parseCloudConnect(
  id: string,
  apiKey: string | undefined,
  input?: Record<string, unknown>,
): CloudConnect | undefined {
  if (id === BEDROCK_ID) return parseBedrock(apiKey, input)
  if (id === VERTEX_ID) return parseVertex(apiKey, input)
  return
}
