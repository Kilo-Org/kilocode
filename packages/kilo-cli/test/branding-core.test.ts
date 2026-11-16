import { expect, test } from "bun:test"
import { bundle, coreText, host } from "./fixtures/branding-run"

// The compiled build bundles core through the same plugin (script/build.ts), so the loader's path filter has to
// match the core modules in a bundle as well as in a source run.
for (const hosted of [false, true]) {
  test(`a bundle of the core modules ${hosted ? "names Kilo" : "keeps upstream wording"}`, async () => {
    const output = await bundle(coreText, hosted)
    for (const [file, upstream, kilo] of coreText) {
      expect(output, file).toContain(hosted ? kilo : upstream)
      expect(output, file).not.toContain(hosted ? upstream : kilo)
    }
    // What the Claude Code harness matches on is an identity, in both: the MCP server name and the tool prefix.
    expect(output).toContain('new Server({ name: "opencode", version: "1.0.0" }')
    expect(output).toContain('server.name === "opencode"')
    expect(output).toContain('"mcp__opencode__"')
  }, 60_000)
}

// The host entry from source, as `bun dev` runs it: the server reaches core through `@opencode/core/...`, and a client
// that asks an image model without an image API for a picture reads Kilo as the caller.
test("the host's server names Kilo when a model has no API it can call", async () => {
  const config = {
    providers: {
      fake: {
        package: "@ai-sdk/openai-compatible",
        // Never requested: the model's package is refused before any request is built.
        settings: { baseURL: "http://127.0.0.1:9/v1", apiKey: "none" },
        models: { picture: { type: "image" } },
      },
    },
  }
  await host({ OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }, async (url) => {
    const response = await fetch(new URL("/api/experimental/generate/image", url), {
      method: "POST",
      headers: { authorization: `Basic ${btoa("opencode:secret")}`, "content-type": "application/json" },
      body: JSON.stringify({ model: { providerID: "fake", id: "picture" }, prompt: "a cat" }),
      signal: AbortSignal.timeout(30_000),
    })
    expect(response.status).toBe(422)
    expect(((await response.json()) as { message: string }).message).toBe(
      "fake/picture has no image API Kilo can call (package @opencode/ai/providers/openai-compatible)",
    )
  })
}, 60_000)
