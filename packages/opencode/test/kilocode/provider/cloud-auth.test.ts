import { describe, expect, test } from "bun:test"
import { bedrockAuth, providerKey, vertexAuth, vertexCredentials, vertexOptions } from "@/kilocode/provider/cloud-auth"

describe("cloud provider auth", () => {
  test("resolves Bedrock access key credentials", () => {
    expect(
      bedrockAuth({
        type: "api",
        key: "AKIATEST",
        metadata: {
          authType: "accessKey",
          secretAccessKey: "secret",
          sessionToken: "token",
          region: "eu-west-1",
        },
      }),
    ).toEqual({
      credentials: {
        accessKeyId: "AKIATEST",
        secretAccessKey: "secret",
        sessionToken: "token",
      },
      region: "eu-west-1",
    })
  })

  test("resolves Vertex service-account credentials", () => {
    const credentials = {
      type: "service_account",
      project_id: "json-project",
      client_email: "test@example.com",
      private_key: "private-key",
    }
    expect(
      vertexAuth({
        type: "api",
        key: JSON.stringify(credentials),
        metadata: { project: "override-project", location: "europe-west1" },
      }),
    ).toEqual({ credentials, project: "override-project", location: "europe-west1" })
  })

  test("rejects malformed Vertex credentials", () => {
    expect(vertexAuth({ type: "api", key: "not json" })).toBeUndefined()
  })

  test("does not expose structured credentials as generic provider API keys", () => {
    expect(
      providerKey("amazon-bedrock", {
        type: "api",
        key: "AKIATEST",
        metadata: { authType: "accessKey", secretAccessKey: "secret" },
      }),
    ).toBeUndefined()
    expect(
      providerKey("google-vertex", {
        type: "api",
        key: JSON.stringify({
          type: "service_account",
          project_id: "test-project",
          client_email: "test@example.com",
          private_key: "private-key",
        }),
      }),
    ).toBeUndefined()
    expect(providerKey("anthropic", { type: "api", key: "sk-test" })).toBe("sk-test")
  })

  test("keeps Vertex credentials out of serialized provider options", () => {
    const credentials = {
      type: "service_account",
      client_email: "test@example.com",
      private_key: "private-key",
    }
    const options: Record<string, unknown> = { project: "test-project", ...vertexCredentials(credentials) }

    expect(JSON.stringify(options)).toBe('{"project":"test-project"}')
    vertexOptions("google-vertex", "@ai-sdk/google-vertex", options)
    expect(options).toEqual({ project: "test-project", googleAuthOptions: { credentials } })
  })

  test("normalizes null content for OpenAI-compatible tool-only assistant messages", () => {
    const options: Record<string, unknown> = {}
    vertexOptions("custom", "@ai-sdk/openai-compatible", options)

    const transform = options.transformRequestBody as (body: Record<string, unknown>) => Record<string, unknown>
    expect(transform).toBeFunction()
    expect(
      transform({
        messages: [
          { role: "user", content: "hello" },
          {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call-1", type: "function", function: { name: "test", arguments: "{}" } }],
          },
          { role: "assistant", content: null },
        ],
      }),
    ).toEqual({
      messages: [
        { role: "user", content: "hello" },
        {
          role: "assistant",
          content: "",
          tool_calls: [{ id: "call-1", type: "function", function: { name: "test", arguments: "{}" } }],
        },
        { role: "assistant", content: null },
      ],
    })
  })

  test("does not install the request transform for non OpenAI-compatible providers", () => {
    const options: Record<string, unknown> = {}
    vertexOptions("custom", "@ai-sdk/openai", options)
    expect(options.transformRequestBody).toBeUndefined()
  })
})
