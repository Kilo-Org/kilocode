import { afterAll, describe, expect, it } from "bun:test"
import { fetchGatewayModels, isGatewaySignedIn } from "../src/speech-to-text/catalog"

const server = Bun.serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    const directory = url.searchParams.get("location[directory]")
    if (url.pathname.endsWith("/authStatus"))
      return Response.json({ output: { authenticated: directory === "/signed-in", organizationID: null, server: "" } })
    if (directory === "/unauthenticated")
      return Response.json({ type: "unauthorized", message: "Not signed in to Kilo Gateway" }, { status: 400 })
    if (directory === "/empty") return Response.json({ output: [] })
    return Response.json({
      output: [{ id: "openai/gpt-4o-mini-transcribe", name: "OpenAI: GPT-4o Mini Transcribe" }],
    })
  },
})

afterAll(() => server.stop(true))

const target = { url: `http://localhost:${server.port}`, authorization: "Basic test" }

describe("fetchGatewayModels", () => {
  it("splits the provider prefix from the model name", async () => {
    expect(await fetchGatewayModels(target, "/repo")).toEqual({
      ok: true,
      models: [{ id: "openai/gpt-4o-mini-transcribe", label: "GPT-4o Mini Transcribe", provider: "OpenAI" }],
    })
  })

  it("reports a signed-out Gateway separately from a broken catalog", async () => {
    expect(await fetchGatewayModels(target, "/unauthenticated")).toMatchObject({
      ok: false,
      unauthenticated: true,
    })
    const empty = await fetchGatewayModels(target, "/empty")
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.unauthenticated).toBeUndefined()
  })
})

describe("isGatewaySignedIn", () => {
  it("reads the authenticated flag", async () => {
    expect(await isGatewaySignedIn(target, "/signed-in")).toBe(true)
    expect(await isGatewaySignedIn(target, "/signed-out")).toBe(false)
  })
})
