import { describe, expect, test } from "bun:test"
import { OpenApi } from "effect/unstable/httpapi"
import { AgentBuilderPaths } from "../../../src/kilocode/server/httpapi/groups/agent-builder"
import { KiloGatewayPaths } from "../../../src/kilocode/server/httpapi/groups/kilo-gateway"
import { PublicApi } from "../../../src/server/routes/instance/httpapi/public"

type Schema = {
  anyOf?: Schema[]
  properties?: Record<string, Schema>
  type?: string
  minLength?: number
  maxLength?: number
  pattern?: string
}

type Parameter = {
  name?: string
  schema?: Schema
}

type Body = {
  content?: Record<string, { schema?: Schema }>
}

describe("Kilo PublicApi OpenAPI contract", () => {
  test("uses Kilo branding", () => {
    const spec = OpenApi.fromApi(PublicApi)
    expect(spec.info.title).toBe("kilo")
    expect(spec.info.description).toBe("kilo api")
  })

  test("constrains agent builder route ids", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const save = AgentBuilderPaths.save.replace(":id", "{id}")
    const params = spec.paths[save]?.put?.parameters as Parameter[] | undefined
    const schema = params?.find((param) => param.name === "id")?.schema

    expect(schema).toEqual({
      type: "string",
      minLength: 1,
      maxLength: 64,
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9._-]*$",
    })
  })

  test("keeps personal organization resets nullable", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const body = spec.paths[KiloGatewayPaths.organization]?.post?.requestBody as Body | undefined
    const schema = body?.content?.["application/json"]?.schema
    const props = schema?.properties
    expect(props?.organizationId).toEqual({ anyOf: [{ type: "string" }, { type: "null" }] })
  })

  test("keeps transcription prompts in the public contract", () => {
    const spec = OpenApi.fromApi(PublicApi)
    const body = spec.paths[KiloGatewayPaths.audioTranscriptions]?.post?.requestBody as Body | undefined
    const schema = body?.content?.["application/json"]?.schema
    expect(schema?.properties?.prompt).toEqual({ type: "string" })
  })
})
