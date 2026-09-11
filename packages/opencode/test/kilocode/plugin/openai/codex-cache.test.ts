import { describe, expect, test } from "bun:test"
import { CodexAuthPlugin } from "@/plugin/openai/codex"

describe("Codex OAuth cache controls", () => {
  test("removes unsupported GPT-5.6+ cache fields from forwarded requests", async () => {
    const bodies: string[] = []
    using server = Bun.serve({
      port: 0,
      async fetch(request) {
        bodies.push(await request.text())
        return new Response("{}", { status: 200 })
      },
    })
    const hooks = await CodexAuthPlugin({} as never, {
      codexApiEndpoint: new URL("/backend-api/codex/responses", server.url).toString(),
    })
    const loaded = await hooks.auth!.loader!(
      async () =>
        ({
          type: "oauth",
          refresh: "refresh",
          access: "access",
          expires: Date.now() + 60_000,
        }) as never,
      {} as never,
    )
    const send = (body: RequestInit["body"]) =>
      loaded.fetch!("https://api.openai.com/v1/responses", {
        method: "POST",
        body,
      })

    await send(
      JSON.stringify({
        model: "gpt-5.6-luna",
        prompt_cache_retention: "24h",
        prompt_cache_options: { mode: "explicit", ttl: "30m" },
        prompt_cache_key: "session-1",
        input: "hello",
      }),
    )
    await send(
      JSON.stringify({
        model: "gpt-5.6-sol-fast",
        prompt_cache_retention: "in_memory",
        input: "hello",
      }),
    )
    await send(
      JSON.stringify({
        model: "gpt-5.5",
        prompt_cache_retention: "24h",
        prompt_cache_options: { ttl: "1h" },
        input: "hello",
      }),
    )
    const unchanged = '{\n  "model": "gpt-5.6-terra",\n  "input": "hello"\n}'
    await send(unchanged)
    await send("{not-json")
    await send(new URLSearchParams({ model: "gpt-5.6-luna", prompt_cache_retention: "24h" }))

    expect(JSON.parse(bodies[0]!)).toEqual({
      model: "gpt-5.6-luna",
      prompt_cache_key: "session-1",
      input: "hello",
    })
    expect(JSON.parse(bodies[1]!)).toEqual({
      model: "gpt-5.6-sol-fast",
      input: "hello",
    })
    expect(JSON.parse(bodies[2]!)).toEqual({
      model: "gpt-5.5",
      prompt_cache_retention: "24h",
      prompt_cache_options: { ttl: "1h" },
      input: "hello",
    })
    expect(bodies[3]).toBe(unchanged)
    expect(bodies[4]).toBe("{not-json")
    expect(bodies[5]).toBe("model=gpt-5.6-luna&prompt_cache_retention=24h")
  })
})
