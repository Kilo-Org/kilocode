import { describe, expect, it } from "bun:test"
import { parseCloudConnect } from "../../src/shared/cloud-provider"

describe("parseCloudConnect", () => {
  it("stores bedrock bearer tokens as api auth", () => {
    expect(
      parseCloudConnect("amazon-bedrock", " bedrock-key ", {
        mode: "apiKey",
        region: "us-east-1",
      }),
    ).toEqual({
      options: { region: "us-east-1" },
      auth: { type: "api", key: "bedrock-key" },
    })
  })

  it("stores bedrock access keys in metadata", () => {
    expect(
      parseCloudConnect("amazon-bedrock", "", {
        mode: "accessKeys",
        region: "eu-west-1",
        accessKeyId: "AKIA",
        secretAccessKey: "secret",
        sessionToken: "token",
      }),
    ).toEqual({
      options: { region: "eu-west-1" },
      auth: {
        type: "api",
        key: "configured",
        metadata: { accessKeyId: "AKIA", secretAccessKey: "secret", sessionToken: "token" },
      },
    })
  })

  it("stores a bedrock profile in options only", () => {
    expect(
      parseCloudConnect("amazon-bedrock", "", {
        mode: "profile",
        region: "us-west-2",
        profile: "default",
      }),
    ).toEqual({
      options: { region: "us-west-2", profile: "default" },
    })
  })

  it("stores vertex project and location without credentials", () => {
    expect(
      parseCloudConnect("google-vertex", "", {
        project: "demo",
        location: "us-central1",
      }),
    ).toEqual({
      options: { project: "demo", location: "us-central1" },
    })
  })

  it("reads project_id from a service account json blob", () => {
    const blob = JSON.stringify({ type: "service_account", project_id: "from-json" })
    expect(
      parseCloudConnect("google-vertex", "", {
        location: "europe-west1",
        credentials: blob,
      }),
    ).toEqual({
      options: { project: "from-json", location: "europe-west1" },
      auth: { type: "api", key: "configured", metadata: { credentials: blob } },
    })
  })
})
