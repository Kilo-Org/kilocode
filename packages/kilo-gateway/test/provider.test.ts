import { describe, expect, test } from "bun:test"
import { buildRequestHeaders, watchResponse } from "../src/provider"

describe("Kilo provider request headers", () => {
  test("request headers override provider defaults", () => {
    const headers = buildRequestHeaders(
      {
        "content-type": "application/json",
        "x-kilocode-feature": "vscode-extension",
        "x-default-only": "kept",
      },
      {
        "x-kilocode-feature": "agent-manager",
        "x-request-only": "kept-too",
      },
    )

    expect(headers.get("content-type")).toBe("application/json")
    expect(headers.get("x-kilocode-feature")).toBe("agent-manager")
    expect(headers.get("x-default-only")).toBe("kept")
    expect(headers.get("x-request-only")).toBe("kept-too")
  })
})

describe("Kilo provider responses", () => {
  test("reports a response closed before it is fully consumed", async () => {
    const reasons: unknown[] = []
    const upstream: unknown[] = []
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("partial"))
      },
      cancel(reason) {
        upstream.push(reason)
      },
    })
    const response = watchResponse(new Response(source), (reason) => reasons.push(reason))
    const reader = response.body!.getReader()

    expect(new TextDecoder().decode((await reader.read()).value)).toBe("partial")
    await reader.cancel("stopped")

    expect(reasons).toEqual(["stopped"])
    expect(upstream).toEqual(["stopped"])
  })

  test("does not report a fully consumed response", async () => {
    const reasons: unknown[] = []
    const response = watchResponse(new Response("complete"), (reason) => reasons.push(reason))

    expect(await response.text()).toBe("complete")
    expect(reasons).toEqual([])
  })

  test("reports an upstream failure", async () => {
    const failure = new Error("connection closed")
    const reasons: unknown[] = []
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(failure)
      },
    })
    const response = watchResponse(new Response(source), (reason) => reasons.push(reason))

    await expect(response.text()).rejects.toBe(failure)
    expect(reasons).toEqual([failure])
  })

  test("preserves response metadata", () => {
    const original = new Response("body", {
      status: 202,
      statusText: "Accepted",
      headers: { "x-test": "value" },
    })
    Object.defineProperties(original, {
      redirected: { value: true },
      type: { value: "cors" },
      url: { value: "https://example.com/final" },
    })
    const response = watchResponse(original, () => {})

    expect(response.status).toBe(202)
    expect(response.statusText).toBe("Accepted")
    expect(response.headers.get("x-test")).toBe("value")
    expect(response.redirected).toBe(true)
    expect(response.type).toBe("cors")
    expect(response.url).toBe("https://example.com/final")
  })
})
