import { describe, expect, it } from "bun:test"
import { buildCloudConnect } from "../../webview-ui/src/components/settings/cloud-provider-form"

const empty = {
  region: "",
  profile: "",
  accessKeyId: "",
  secretAccessKey: "",
  sessionToken: "",
  apiKey: "",
  endpoint: "",
  project: "",
  location: "",
  credentials: "",
}

const t = (key: string) => key

describe("buildCloudConnect", () => {
  it("requires a bedrock region and api key", () => {
    expect(buildCloudConnect("amazon-bedrock", empty, "apiKey", t)).toEqual({
      ok: false,
      field: "region",
      message: "provider.connect.prompt.required",
    })
    const fields = { ...empty, region: "us-east-1", apiKey: "token" }
    expect(buildCloudConnect("amazon-bedrock", fields, "apiKey", t)).toEqual({
      ok: true,
      metadata: { mode: "apiKey", region: "us-east-1" },
      apiKey: "token",
    })
  })

  it("reads project_id from vertex service account json", () => {
    const blob = JSON.stringify({ type: "service_account", project_id: "from-json" })
    const fields = { ...empty, location: "us-central1", credentials: blob }
    expect(buildCloudConnect("google-vertex", fields, "apiKey", t)).toEqual({
      ok: true,
      metadata: { project: "from-json", location: "us-central1", credentials: blob },
      apiKey: "",
    })
  })
})
