export type CloudAuth = {
  type?: string
  key?: string
  metadata?: Record<string, string>
}

export function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

export function apiMeta(auth: CloudAuth | undefined) {
  if (auth?.type !== "api") return
  return auth.metadata
}

export function bedrockBearer(auth: CloudAuth | undefined) {
  if (auth?.type !== "api") return
  if (text(auth.metadata?.accessKeyId) || text(auth.metadata?.secretAccessKey)) return
  return text(auth.key)
}

export function applyEnv(key: string, value: string | undefined) {
  if (!value) return
  if (process.env[key]) return
  process.env[key] = value
}

export function bedrockFields(input: {
  options?: Record<string, unknown>
  auth?: CloudAuth
  env: Record<string, string | undefined>
}) {
  const meta = apiMeta(input.auth)
  const region = text(input.options?.region) ?? text(meta?.region) ?? text(input.env.AWS_REGION) ?? "us-east-1"
  const profile = text(input.options?.profile) ?? text(meta?.profile) ?? text(input.env.AWS_PROFILE)
  const accessKey = text(input.env.AWS_ACCESS_KEY_ID) ?? text(meta?.accessKeyId)
  const secret = text(input.env.AWS_SECRET_ACCESS_KEY) ?? text(meta?.secretAccessKey)
  const session = text(input.env.AWS_SESSION_TOKEN) ?? text(meta?.sessionToken)
  applyEnv("AWS_ACCESS_KEY_ID", accessKey)
  applyEnv("AWS_SECRET_ACCESS_KEY", secret)
  applyEnv("AWS_SESSION_TOKEN", session)
  return { region, profile, accessKey }
}

export function vertexFields(input: {
  options?: Record<string, unknown>
  auth?: CloudAuth
  env: Record<string, string | undefined>
}) {
  const meta = apiMeta(input.auth)
  const creds = text(meta?.credentials)
  const parsed = creds
    ? (() => {
        try {
          const value = JSON.parse(creds) as unknown
          if (!value || typeof value !== "object" || Array.isArray(value)) return
          return value as Record<string, unknown>
        } catch {
          return
        }
      })()
    : undefined
  const project =
    text(input.options?.project) ??
    text(meta?.project) ??
    text(input.env.GOOGLE_VERTEX_PROJECT) ??
    text(input.env.GOOGLE_CLOUD_PROJECT) ??
    text(input.env.GCP_PROJECT) ??
    text(input.env.GCLOUD_PROJECT) ??
    text(parsed?.project_id)
  const location =
    text(input.options?.location) ??
    text(meta?.location) ??
    text(input.env.GOOGLE_VERTEX_LOCATION) ??
    text(input.env.GOOGLE_CLOUD_LOCATION) ??
    text(input.env.VERTEX_LOCATION) ??
    "us-central1"
  return { project, location, credentials: parsed }
}
