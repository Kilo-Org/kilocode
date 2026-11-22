import { describe, expect, test } from "bun:test"
import { resolveEndpointOptions } from "../../../src/kilocode/provider/provider"

describe("resolveEndpointOptions", () => {
  test("keeps a configured baseURL as given", () => {
    const options: Record<string, unknown> = { baseURL: "https://proxy.example/v1", location: "proxy.example/x" }
    resolveEndpointOptions("google-vertex", undefined, options)
    expect(options.location).toBe("proxy.example/x")
  })

  test("treats an empty baseURL as unset and validates the location", () => {
    const normalized: Record<string, unknown> = { baseURL: "", location: " US-CENTRAL1 " }
    resolveEndpointOptions("google-vertex", undefined, normalized)
    expect(normalized.location).toBe("us-central1")

    const invalid: Record<string, unknown> = { baseURL: "", location: "proxy.example/x" }
    expect(() => resolveEndpointOptions("google-vertex", undefined, invalid)).toThrow(/Invalid Google Vertex location/)
  })

  test("lets an explicit other host baseURL win over a Vertex template modelURL", () => {
    const options: Record<string, unknown> = {
      baseURL: "https://proxy.example/v1",
      location: "proxy.example/x",
    }
    resolveEndpointOptions("google-vertex", "https://${GOOGLE_VERTEX_LOCATION}-aiplatform.googleapis.com/v1", options)
    expect(options.location).toBe("proxy.example/x")
  })

  test("leaves the location untouched when a concrete model URL is given", () => {
    const options: Record<string, unknown> = { location: "proxy.example/x" }
    resolveEndpointOptions("google-vertex", "https://proxy.example/v1", options)
    expect(options.location).toBe("proxy.example/x")

    const vertexHost: Record<string, unknown> = { location: "proxy.example/x" }
    resolveEndpointOptions(
      "google-vertex",
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1",
      vertexHost,
    )
    expect(vertexHost.location).toBe("proxy.example/x")
  })

  test("leaves the location untouched when a concrete Vertex host baseURL is given", () => {
    const options: Record<string, unknown> = {
      baseURL: "https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1",
      location: "proxy.example/x",
    }
    resolveEndpointOptions("google-vertex", undefined, options)
    expect(options.location).toBe("proxy.example/x")
  })

  test("validates the location when the model URL is a Vertex template", () => {
    const options: Record<string, unknown> = { location: " US-CENTRAL1 " }
    resolveEndpointOptions("google-vertex", "https://${GOOGLE_VERTEX_LOCATION}-aiplatform.googleapis.com/v1", options)
    expect(options.location).toBe("us-central1")

    const invalid: Record<string, unknown> = { location: "proxy.example/x" }
    expect(() =>
      resolveEndpointOptions(
        "google-vertex",
        "https://${GOOGLE_VERTEX_LOCATION}-aiplatform.googleapis.com/v1",
        invalid,
      ),
    ).toThrow(/Invalid Google Vertex location/)
  })

  test("accepts a Google Cloud region and normalizes its case", () => {
    const options: Record<string, unknown> = { location: " US-CENTRAL1 " }
    resolveEndpointOptions("google-vertex", undefined, options)
    expect(options.location).toBe("us-central1")
  })

  test("refuses a value that is not a Google Cloud region", () => {
    const options: Record<string, unknown> = { location: "proxy.example/x" }
    expect(() => resolveEndpointOptions("google-vertex", undefined, options)).toThrow(/Invalid Google Vertex location/)
  })

  test("applies the same region rule to the Vertex Anthropic provider", () => {
    const valid: Record<string, unknown> = { location: "eu" }
    resolveEndpointOptions("google-vertex-anthropic", undefined, valid)
    expect(valid.location).toBe("eu")

    const invalid: Record<string, unknown> = { location: "proxy.example/x" }
    expect(() => resolveEndpointOptions("google-vertex-anthropic", undefined, invalid)).toThrow(
      /Invalid Google Vertex location/,
    )
  })

  test("accepts a single-label Azure resource name", () => {
    const options: Record<string, unknown> = { resourceName: " my-resource " }
    resolveEndpointOptions("azure", undefined, options)
    expect(options.resourceName).toBe("my-resource")
  })

  test("refuses an Azure resource name that is not one label", () => {
    const options: Record<string, unknown> = { resourceName: "proxy.example/" }
    expect(() => resolveEndpointOptions("azure", undefined, options)).toThrow(/Invalid Azure resource name/)
  })

  test("leaves other providers untouched", () => {
    const options: Record<string, unknown> = { location: "proxy.example/x", resourceName: "proxy.example/" }
    resolveEndpointOptions("openai", "https://api.openai.com/v1", options)
    expect(options).toEqual({ location: "proxy.example/x", resourceName: "proxy.example/" })
  })
})
