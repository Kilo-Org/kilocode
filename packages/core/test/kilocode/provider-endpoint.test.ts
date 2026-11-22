import { describe, expect, test } from "bun:test"
import {
  EndpointConfigError,
  isVertexHost,
  normalizeVertexLocation,
  parseVertexLocation,
} from "../../src/kilocode/provider-endpoint"

describe("Google Vertex location", () => {
  test("keeps every real region and multi-region name", () => {
    expect(normalizeVertexLocation("global")).toBe("global")
    expect(normalizeVertexLocation("eu")).toBe("eu")
    expect(normalizeVertexLocation("us-central1")).toBe("us-central1")
    expect(normalizeVertexLocation("europe-west4")).toBe("europe-west4")
  })

  test("trims and lowercases the location", () => {
    expect(normalizeVertexLocation(" US-CENTRAL1 ")).toBe("us-central1")
    expect(normalizeVertexLocation("\tEU\n")).toBe("eu")
  })

  test("rejects a value that is not a region", () => {
    expect(normalizeVertexLocation("eu-")).toBeUndefined()
    expect(normalizeVertexLocation("-eu")).toBeUndefined()
    expect(normalizeVertexLocation("us--east1")).toBeUndefined()
    expect(normalizeVertexLocation(" a b")).toBeUndefined()
    expect(normalizeVertexLocation("proxy.example/x")).toBeUndefined()
    expect(normalizeVertexLocation("")).toBeUndefined()
    expect(normalizeVertexLocation(undefined)).toBeUndefined()
  })

  test("reports an unusable location as a configuration error", () => {
    expect(() => parseVertexLocation("eu-")).toThrow(EndpointConfigError)
    expect(() => parseVertexLocation("eu-")).toThrow(/Invalid Google Vertex location/)
    expect(() => parseVertexLocation("us--east1")).toThrow(/Invalid Google Vertex location/)
    expect(parseVertexLocation(" EU ")).toBe("eu")
  })
})

describe("Vertex API host", () => {
  test("accepts the global, regional, mTLS and rep hosts", () => {
    expect(isVertexHost("aiplatform.googleapis.com")).toBe(true)
    expect(isVertexHost("us-central1-aiplatform.googleapis.com")).toBe(true)
    expect(isVertexHost("aiplatform.mtls.googleapis.com")).toBe(true)
    expect(isVertexHost("us-central1-aiplatform.mtls.googleapis.com")).toBe(true)
    expect(isVertexHost("aiplatform.eu.rep.googleapis.com")).toBe(true)
    expect(isVertexHost("US-CENTRAL1-AIPLATFORM.GOOGLEAPIS.COM")).toBe(true)
  })

  test("rejects a host whose region label is malformed or whose name is not a Vertex host", () => {
    expect(isVertexHost("eu--aiplatform.googleapis.com")).toBe(false)
    expect(isVertexHost("eu--aiplatform.mtls.googleapis.com")).toBe(false)
    expect(isVertexHost("aiplatform.eu-.rep.googleapis.com")).toBe(false)
    expect(isVertexHost("aiplatform.googleapis.com.evil.example")).toBe(false)
  })
})
