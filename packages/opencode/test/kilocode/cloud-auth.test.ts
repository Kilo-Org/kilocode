import { describe, expect, test } from "bun:test"
import { bedrockBearer, bedrockFields, vertexFields } from "../../src/kilocode/provider/cloud-auth"

function env(key: string) {
  return process.env[key]
}

describe("cloud auth fields", () => {
  test("bedrock prefers config region and profile over env", () => {
    expect(
      bedrockFields({
        options: { region: "eu-west-1", profile: "bedrock" },
        env: { AWS_REGION: "us-east-1", AWS_PROFILE: "default" },
      }),
    ).toEqual({
      region: "eu-west-1",
      profile: "bedrock",
      accessKey: undefined,
    })
  })

  test("bedrock reads access keys from auth metadata", () => {
    const prev = {
      AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      AWS_SESSION_TOKEN: process.env.AWS_SESSION_TOKEN,
    }
    delete process.env.AWS_ACCESS_KEY_ID
    delete process.env.AWS_SECRET_ACCESS_KEY
    delete process.env.AWS_SESSION_TOKEN
    expect(
      bedrockFields({
        auth: {
          type: "api",
          key: "configured",
          metadata: { accessKeyId: "AKIA", secretAccessKey: "secret", sessionToken: "token" },
        },
        env: {},
      }),
    ).toEqual({
      region: "us-east-1",
      profile: undefined,
      accessKey: "AKIA",
    })
    expect(env("AWS_ACCESS_KEY_ID")).toBe("AKIA")
    expect(env("AWS_SECRET_ACCESS_KEY")).toBe("secret")
    expect(env("AWS_SESSION_TOKEN")).toBe("token")
    bedrockFields({ env: {} })
    expect(env("AWS_ACCESS_KEY_ID")).toBe(prev.AWS_ACCESS_KEY_ID)
    expect(env("AWS_SECRET_ACCESS_KEY")).toBe(prev.AWS_SECRET_ACCESS_KEY)
    expect(env("AWS_SESSION_TOKEN")).toBe(prev.AWS_SESSION_TOKEN)
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  })

  test("bedrock bearer ignores iam metadata placeholders", () => {
    expect(
      bedrockBearer({
        type: "api",
        key: "configured",
        metadata: { accessKeyId: "AKIA", secretAccessKey: "secret" },
      }),
    ).toBeUndefined()
    expect(bedrockBearer({ type: "api", key: "bedrock-token" })).toBe("bedrock-token")
  })

  test("vertex reads project and credentials from auth metadata", () => {
    const blob = JSON.stringify({ type: "service_account", project_id: "from-json" })
    expect(
      vertexFields({
        auth: { type: "api", key: "configured", metadata: { credentials: blob, location: "europe-west1" } },
        env: {},
      }),
    ).toEqual({
      project: "from-json",
      location: "europe-west1",
      credentials: { type: "service_account", project_id: "from-json" },
    })
  })
})
