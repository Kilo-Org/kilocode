type Schema = {
  $ref?: string
  additionalProperties?: Schema | boolean
  anyOf?: Schema[]
  const?: string
  default?: unknown
  enum?: string[]
  items?: Schema
  properties?: Record<string, Schema>
  type?: string
}

type Parameter = {
  in?: string
  name?: string
  schema?: Schema
}

type Response = {
  content?: Record<string, { schema?: Schema }>
  description?: string
}

type Operation = {
  parameters?: Parameter[]
  requestBody?: {
    content?: Record<string, { schema?: Schema }>
  }
  responses?: Record<string, Response>
}

type Spec = {
  components?: {
    schemas?: Record<string, Schema>
  }
  paths?: Record<string, Partial<Record<"get" | "post" | "put" | "patch", Operation>>>
}

export function matchLegacyKiloOpenApi(input: Record<string, unknown>) {
  rebrand(input)
  const spec = input as Spec
  const rules = spec.paths?.["/config/rules"]?.get?.parameters?.find(
    (param) => param.in === "query" && param.name === "scope",
  )
  if (rules) rules.schema = { const: "project", default: "project", type: "string" }

  const body = spec.paths?.["/kilo/organization"]?.post?.requestBody?.content?.["application/json"]?.schema
  const ref = body?.$ref?.replace("#/components/schemas/", "")
  const props = ref ? spec.components?.schemas?.[ref]?.properties : body?.properties
  if (props?.organizationId) props.organizationId = nullable(props.organizationId)

  const json = (path: string) => spec.paths?.[path]?.get?.responses?.["200"]?.content?.["application/json"]
  const profile = json("/kilo/profile")?.schema?.properties
  const pass = profile?.kiloPass?.properties
  if (pass?.nextBillingAt) pass.nextBillingAt = nullable(pass.nextBillingAt)
  if (profile?.balance) profile.balance = nullable(profile.balance)
  if (profile?.kiloPass) profile.kiloPass = nullable(profile.kiloPass)
  if (profile?.currentOrgId) profile.currentOrgId = nullable(profile.currentOrgId)

  const sessions = json("/kilo/cloud-sessions")?.schema?.properties
  const session = sessions?.cliSessions?.items?.properties
  if (session?.title) session.title = nullable(session.title)
  if (sessions?.nextCursor) sessions.nextCursor = nullable(sessions.nextCursor)

  const claw = json("/kilo/claw/status")?.schema?.properties
  if (claw?.status) claw.status = nullable(claw.status)
  if (claw?.openclawVersion) claw.openclawVersion = nullable(claw.openclawVersion)
  if (claw?.lastStartedAt) claw.lastStartedAt = nullable(claw.lastStartedAt)
  if (claw?.lastStoppedAt) claw.lastStoppedAt = nullable(claw.lastStoppedAt)
  if (claw?.botName) claw.botName = nullable(claw.botName)

  const credentials = json("/kilo/claw/chat-credentials")
  if (credentials?.schema) credentials.schema = nullable(credentials.schema)

  const provider = spec.components?.schemas?.Config?.properties?.provider
  if (provider?.additionalProperties && typeof provider.additionalProperties === "object")
    provider.additionalProperties = nullable(provider.additionalProperties)

  const pty = spec.components?.schemas?.Pty?.properties
  if (pty?.sessionID) pty.sessionID = nullable(pty.sessionID)

  const out = spec.paths?.["/session/{sessionID}/branch-name"]?.post?.responses?.["200"]?.content?.[
    "application/json"
  ]?.schema?.properties
  if (out?.branch) out.branch = nullable(out.branch)

  const update = spec.paths?.["/pty/{ptyID}"]?.put?.requestBody?.content?.["application/json"]?.schema
  const name = update?.$ref?.replace("#/components/schemas/", "")
  const fields = name ? spec.components?.schemas?.[name]?.properties : update?.properties
  if (fields?.sessionID) fields.sessionID = nullable(fields.sessionID)

  const fim = spec.paths?.["/kilo/fim"]?.post?.responses
  if (!fim) return
  fim["200"] = {
    description: "Streaming FIM completion response",
    content: {
      "text/event-stream": {
        schema: {
          type: "object",
          properties: {
            choices: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  delta: {
                    type: "object",
                    properties: {
                      content: { type: "string" },
                    },
                  },
                  text: { type: "string" },
                },
              },
            },
            usage: {
              type: "object",
              properties: {
                prompt_tokens: { type: "number" },
                completion_tokens: { type: "number" },
              },
            },
            cost: { type: "number" },
          },
        },
      },
    },
  }
}

function rebrand(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rebrand(item)
    return
  }
  if (!value || typeof value !== "object") return
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      rebrand(item)
      continue
    }
    ;(value as Record<string, unknown>)[key] = item
      .replaceAll("OpenCode", "Kilo")
      .replaceAll("opencode.local", "kilo.local")
      .replaceAll("opencode serve", "kilo serve")
      .replaceAll("https://opencode.ai/", "https://kilo.ai/")
  }
}

function nullable(schema: Schema): Schema {
  if (schema.anyOf?.some((item) => item.type === "null")) return schema
  return { anyOf: [schema, { type: "null" }] }
}
