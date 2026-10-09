import type { Auth } from "@/auth"

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

export function bedrockAuth(auth: Auth.Info | undefined) {
  if (auth?.type !== "api" || auth.metadata?.authType !== "accessKey") return
  const secret = auth.metadata.secretAccessKey
  if (!auth.key || !secret) return
  return {
    credentials: {
      accessKeyId: auth.key,
      secretAccessKey: secret,
      ...(auth.metadata.sessionToken ? { sessionToken: auth.metadata.sessionToken } : {}),
    },
    region: auth.metadata.region,
  }
}

export function vertexAuth(auth: Auth.Info | undefined) {
  if (auth?.type !== "api") return
  const credentials = (() => {
    try {
      const parsed = JSON.parse(auth.key)
      if (!record(parsed) || parsed.type !== "service_account") return
      if (typeof parsed.client_email !== "string" || !parsed.client_email.trim()) return
      if (typeof parsed.private_key !== "string" || !parsed.private_key.trim()) return
      return parsed
    } catch {
      return
    }
  })()
  if (!credentials) return
  const project =
    auth.metadata?.project ??
    (typeof credentials.project_id === "string" && credentials.project_id.trim() ? credentials.project_id : undefined)
  if (!project) return
  return {
    credentials,
    project,
    location: auth.metadata?.location,
  }
}

export function providerKey(providerID: string, auth: Auth.Info) {
  if (auth.type !== "api") return
  if (providerID === "amazon-bedrock" && auth.metadata?.authType === "accessKey") return
  if (
    providerID === "google-vertex" &&
    (auth.metadata?.authType === "serviceAccount" || vertexAuth(auth) !== undefined)
  )
    return
  return auth.key
}

const VERTEX_CREDENTIALS = "kiloVertexCredentials"
const TOOL_CONTENT = "kiloOpenAICompatibleToolCallContent"

type RequestBody = Record<string, unknown>
type RequestTransform = (body: RequestBody) => RequestBody

function isRequestTransform(value: unknown): value is RequestTransform {
  return typeof value === "function"
}

function patchToolContent(npm: string, options: Record<string, unknown>) {
  const mode = options[TOOL_CONTENT]
  delete options[TOOL_CONTENT]
  if (!npm.includes("@ai-sdk/openai-compatible") || mode !== "empty-string") return

  const prev = isRequestTransform(options.transformRequestBody) ? options.transformRequestBody : undefined
  options.transformRequestBody = (body: RequestBody) => {
    const next = prev?.(body) ?? body
    if (!Array.isArray(next.messages)) return next
    return {
      ...next,
      messages: next.messages.map((msg) => {
        if (!record(msg)) return msg
        if (msg.role !== "assistant" || msg.content !== null) return msg
        if (!Array.isArray(msg.tool_calls) || msg.tool_calls.length === 0) return msg
        return { ...msg, content: "" }
      }),
    }
  }
}

export function vertexOptions(providerID: string, npm: string, options: Record<string, unknown>) {
  patchToolContent(npm, options)
  const getter = options[VERTEX_CREDENTIALS]
  delete options[VERTEX_CREDENTIALS]
  if (providerID !== "google-vertex" || npm.includes("@ai-sdk/openai-compatible")) return
  if (typeof getter !== "function") return
  options.googleAuthOptions = { credentials: getter() }
}

export function vertexCredentials(credentials: Record<string, unknown>) {
  return { [VERTEX_CREDENTIALS]: () => credentials }
}
