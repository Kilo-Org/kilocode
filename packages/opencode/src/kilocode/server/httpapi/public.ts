type Schema = {
  $ref?: string
  additionalProperties?: Schema | boolean
  anyOf?: Schema[]
  items?: Schema
  properties?: Record<string, Schema>
  type?: string
}

type Response = {
  content?: Record<string, { schema?: Schema }>
  description?: string
}

type Spec = {
  components?: {
    schemas?: Record<string, Schema>
  }
  paths?: Record<
    string,
    {
      post?: {
        requestBody?: {
          content?: Record<string, { schema?: Schema }>
        }
        responses?: Record<string, Response>
      }
    }
  >
}

export function matchLegacyKiloOpenApi(input: Record<string, unknown>) {
  const spec = input as Spec
  const body = spec.paths?.["/kilo/organization"]?.post?.requestBody?.content?.["application/json"]?.schema
  const ref = body?.$ref?.replace("#/components/schemas/", "")
  const props = ref ? spec.components?.schemas?.[ref]?.properties : body?.properties
  if (props?.organizationId) props.organizationId = nullable(props.organizationId)

  const provider = spec.components?.schemas?.Config?.properties?.provider
  if (provider?.additionalProperties && typeof provider.additionalProperties === "object")
    provider.additionalProperties = nullable(provider.additionalProperties)

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

function nullable(schema: Schema): Schema {
  if (schema.anyOf?.some((item) => item.type === "null")) return schema
  return { anyOf: [schema, { type: "null" }] }
}
