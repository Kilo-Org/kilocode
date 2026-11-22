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

  test("treats an empty baseURL as unset when a concrete model URL is given", () => {
    const options: Record<string, unknown> = { baseURL: "", location: "proxy.example/x" }
    resolveEndpointOptions("google-vertex", "https://proxy.example/v1", options)
    expect(options.location).toBe("proxy.example/x")
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

  test("uses GOOGLE_VERTEX_LOCATION for the region when no location option is set", () => {
    const options: Record<string, unknown> = {}
    resolveEndpointOptions("google-vertex", "https://${GOOGLE_VERTEX_LOCATION}-aiplatform.googleapis.com/v1", options, {
      GOOGLE_VERTEX_LOCATION: "EUROPE-WEST4",
    })
    expect(options.location).toBe("europe-west4")
  })

  test("falls back to GOOGLE_CLOUD_LOCATION when GOOGLE_VERTEX_LOCATION is absent", () => {
    const options: Record<string, unknown> = {}
    resolveEndpointOptions("google-vertex", undefined, options, {
      GOOGLE_VERTEX_LOCATION: undefined,
      GOOGLE_CLOUD_LOCATION: "asia-northeast1",
    })
    expect(options.location).toBe("asia-northeast1")
  })

  test("falls back to VERTEX_LOCATION when the other environment names are absent", () => {
    const options: Record<string, unknown> = {}
    resolveEndpointOptions("google-vertex", undefined, options, {
      GOOGLE_VERTEX_LOCATION: undefined,
      GOOGLE_CLOUD_LOCATION: undefined,
      VERTEX_LOCATION: "us-east5",
    })
    expect(options.location).toBe("us-east5")
  })

  test("lets a location option win over the environment", () => {
    const options: Record<string, unknown> = { location: "europe-west1" }
    resolveEndpointOptions("google-vertex", undefined, options, {
      GOOGLE_VERTEX_LOCATION: "us-central1",
      VERTEX_LOCATION: "asia-east1",
    })
    expect(options.location).toBe("europe-west1")
  })

  test("skips a blank environment value and uses the next one", () => {
    const options: Record<string, unknown> = {}
    resolveEndpointOptions("google-vertex", undefined, options, {
      GOOGLE_VERTEX_LOCATION: "  ",
      GOOGLE_CLOUD_LOCATION: "",
      VERTEX_LOCATION: "europe-west4",
    })
    expect(options.location).toBe("europe-west4")

    const fallback: Record<string, unknown> = {}
    resolveEndpointOptions("google-vertex", undefined, fallback, { GOOGLE_VERTEX_LOCATION: "" })
    expect(fallback.location).toBe("us-central1")
  })

  test("uses the provider default region when neither the option nor the environment names one", () => {
    const options: Record<string, unknown> = {}
    resolveEndpointOptions("google-vertex", undefined, options, {})
    expect(options.location).toBe("us-central1")
  })

  test("uses the Anthropic provider default region when neither the option nor the environment names one", () => {
    const options: Record<string, unknown> = {}
    resolveEndpointOptions("google-vertex-anthropic", undefined, options, {})
    expect(options.location).toBe("global")

    const envOnly: Record<string, unknown> = {}
    resolveEndpointOptions("google-vertex-anthropic", undefined, envOnly, { GOOGLE_VERTEX_LOCATION: "europe-west4" })
    expect(envOnly.location).toBe("global")
  })

  test("refuses an environment value that is not a Google Cloud region", () => {
    const options: Record<string, unknown> = {}
    expect(() =>
      resolveEndpointOptions("google-vertex", undefined, options, { GOOGLE_VERTEX_LOCATION: "proxy.example/x" }),
    ).toThrow(/Invalid Google Vertex location/)
  })

  test("leaves the location untouched for a concrete model URL even when the environment names a region", () => {
    const options: Record<string, unknown> = {}
    resolveEndpointOptions("google-vertex", "https://proxy.example/v1", options, {
      GOOGLE_VERTEX_LOCATION: "europe-west4",
    })
    expect(options.location).toBeUndefined()
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

  test("treats a blank Azure resource name as unset instead of an invalid one", () => {
    for (const value of ["", "   ", "\t"]) {
      const options: Record<string, unknown> = { resourceName: value }
      expect(() => resolveEndpointOptions("azure", undefined, options)).not.toThrow()
      expect("resourceName" in options).toBe(false)
    }
  })

  test("keeps a blank Azure resource name untouched when a baseURL is configured", () => {
    const options: Record<string, unknown> = { baseURL: "https://proxy.example/openai/v1", resourceName: "   " }
    resolveEndpointOptions("azure", undefined, options)
    expect(options.baseURL).toBe("https://proxy.example/openai/v1")
  })

  test("leaves other providers untouched", () => {
    const options: Record<string, unknown> = { location: "proxy.example/x", resourceName: "proxy.example/" }
    resolveEndpointOptions("openai", "https://api.openai.com/v1", options)
    expect(options).toEqual({ location: "proxy.example/x", resourceName: "proxy.example/" })
  })
})
