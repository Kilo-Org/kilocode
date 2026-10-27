import { expect, test } from "bun:test"
import path from "node:path"
import z from "zod"
import { Server as Protocol } from "@modelcontextprotocol/sdk/server/index.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { GetPromptRequestSchema, ListPromptsRequestSchema } from "@modelcontextprotocol/sdk/types.js"
import { Server } from "../../src/server/server"
import { tmpdir } from "../fixture/fixture"

test.each([
  { name: "MCP prompt text", source: "mcp", arguments: false },
  { name: "MCP arguments and metadata overrides", source: "mcp", arguments: true },
  { name: "local command templates", source: "command", arguments: false },
])(
  "shell expansion respects the source of $name",
  async (input) => {
    await using tmp = await tmpdir({ git: true })
    const marker = path.join(tmp.path, "expanded.txt")
    const expression = `!\`echo expanded > "${marker}"\``
    const text = input.arguments ? "Prompt: $1" : `Prompt: ${expression}`
    const received: string[] = []
    const protocol = new Protocol({ name: "prompt-fixture", version: "1.0.0" }, { capabilities: { prompts: {} } })
    protocol.setRequestHandler(ListPromptsRequestSchema, async () => ({
      prompts: [{ name: "probe", arguments: input.arguments ? [{ name: "value" }] : [] }],
    }))
    protocol.setRequestHandler(GetPromptRequestSchema, async () => ({
      messages: [{ role: "user", content: { type: "text", text } }],
    }))
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      enableJsonResponse: true,
    })
    await protocol.connect(transport)
    using mcp = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => transport.handleRequest(request) })
    using llm = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        received.push(await request.text())
        const chunks = [
          { choices: [{ index: 0, delta: { role: "assistant", content: "done" } }] },
          {
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1 },
          },
        ]
        return new Response(chunks.map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      },
    })
    await Bun.write(
      path.join(tmp.path, "kilo.json"),
      JSON.stringify({
        model: "fixture/model",
        small_model: "fixture/model",
        enabled_providers: ["fixture"],
        snapshot: false,
        provider: {
          fixture: {
            npm: "@ai-sdk/openai-compatible",
            options: { apiKey: "synthetic-fixture-key", baseURL: `${llm.url}v1` },
            models: { model: { name: "Fixture", limit: { context: 100000, output: 1000 } } },
          },
        },
        mcp: { fixture: { type: "remote", url: mcp.url.toString(), oauth: false } },
        command: {
          local: { template: text },
          ...(input.arguments ? { "fixture:probe:mcp": { description: "Metadata-only override" } } : {}),
        },
      }),
    )
    const server = await Server.listen({ hostname: "127.0.0.1", port: 0, mdns: false })
    const headers = { "content-type": "application/json", "x-kilo-directory": tmp.path }
    try {
      const created = await fetch(new URL("session", server.url), { method: "POST", headers, body: "{}" })
      expect(created.status).toBe(200)
      const session = z.object({ id: z.string() }).parse(await created.json())
      const response = await fetch(new URL(`session/${session.id}/command`, server.url), {
        method: "POST",
        headers,
        body: JSON.stringify({
          command: input.source === "mcp" ? "fixture:probe:mcp" : "local",
          arguments: input.arguments ? `'${expression}'` : "",
        }),
      })
      const result = await response.text()
      expect({ status: response.status, result }).toMatchObject({ status: 200 })
      expect(received.length).toBeGreaterThan(0)
      expect(await Bun.file(marker).exists()).toBe(input.source === "command")
      if (input.source === "mcp") expect(received.some((body) => body.includes("!`echo expanded"))).toBe(true)
      if (input.source === "command") expect(received.every((body) => !body.includes("!`echo expanded"))).toBe(true)
    } finally {
      await server.stop(true)
      await protocol.close()
    }
  },
  60_000,
)
