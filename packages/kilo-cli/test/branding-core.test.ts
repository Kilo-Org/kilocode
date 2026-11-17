import { expect, test } from "bun:test"
import path from "node:path"
import { bundle, coreText, host, pluginText, run, temporary } from "./fixtures/branding-run"

// The compiled build bundles core through the same plugin (script/build.ts), so the loader's path filter has to
// match the core modules in a bundle as well as in a source run.
for (const hosted of [false, true]) {
  test(`a bundle of the core and plugin modules ${hosted ? "names Kilo" : "keeps upstream wording"}`, async () => {
    const output = await bundle([...coreText, ...pluginText], hosted)
    for (const [file, upstream, kilo] of [...coreText, ...pluginText]) {
      expect(output, file).toContain(hosted ? kilo : upstream)
      expect(output, file).not.toContain(hosted ? upstream : kilo)
    }
    // What the Claude Code harness matches on is an identity, in both: the MCP server name and the tool prefix.
    expect(output).toContain('new Server({ name: "opencode", version: "1.0.0" }')
    expect(output).toContain('server.name === "opencode"')
    expect(output).toContain('"mcp__opencode__"')
    // The package a plugin imports keeps its name.
    expect(output).toContain('"@opencode/plugin" modules.')
  }, 60_000)

  // The loader the host installs for user plugins, reached through `@opencode/plugin/runtime` as the host entry
  // imports it: a plugin that ships its own copy of `effect` reads the host's name in the error.
  test(`the plugin loader error ${hosted ? "names Kilo" : "keeps upstream wording"}`, async () => {
    await using root = await temporary()
    const fixture = path.join(import.meta.dir, "fixtures/branding-plugin-runtime.ts")
    expect(JSON.parse(await run([process.execPath, fixture], root.path, hosted))).toBe(
      `Cannot load "effect/RemovedLegacySubpath.js" from plugin node_modules: "effect/RemovedLegacySubpath.js" is not provided by ${hosted ? "Kilo" : "OpenCode"}; plugins must use the host's "effect" and "@opencode/plugin" modules.`,
    )
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
