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

const injected = new Map<string, string | undefined>()

export function applyEnv(key: string, value: string | undefined) {
  if (value) {
    if (!injected.has(key)) injected.set(key, process.env[key])
    process.env[key] = value
    return
  }
  if (!injected.has(key)) return
  const prev = injected.get(key)
  if (prev === undefined) delete process.env[key]
  else process.env[key] = prev
  injected.delete(key)
}

export function bedrockFields(input: {
  options?: Record<string, unknown>
  auth?: CloudAuth
  env: Record<string, string | undefined>
}) {
  const meta = apiMeta(input.auth)
  const region = text(input.options?.region) ?? text(meta?.region) ?? text(input.env.AWS_REGION) ?? "us-east-1"
  const profile = text(input.options?.profile) ?? text(meta?.profile) ?? text(input.env.AWS_PROFILE)
  const metaAccess = text(meta?.accessKeyId)
  const metaSecret = text(meta?.secretAccessKey)
  const metaSession = text(meta?.sessionToken)
  const fromMeta = Boolean(metaAccess || metaSecret)
  applyEnv("AWS_ACCESS_KEY_ID", fromMeta ? metaAccess : undefined)
  applyEnv("AWS_SECRET_ACCESS_KEY", fromMeta ? metaSecret : undefined)
  applyEnv("AWS_SESSION_TOKEN", fromMeta ? metaSession : undefined)
  const accessKey = metaAccess ?? text(input.env.AWS_ACCESS_KEY_ID)
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
