import { expect, test } from "bun:test"
import path from "node:path"
import { OpenCode } from "@opencode-ai/client"
import { run } from "../src/run"
import { fixture, ready } from "./fixture"

test("headless run returns idle text and resumes the same session", async () => {
  await using input = await fixture()
  const requests: string[] = []
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { stream?: boolean; messages: Array<{ role: string; content?: unknown }> } = await request.json()
      const prompt = [...body.messages].reverse().find((message) => message.role === "user")?.content
      const text = String(prompt).includes("again") ? "Fixture resumed response" : "Fixture headless response"
      if (!body.stream)
        return Response.json({
          id: "fixture",
          object: "chat.completion",
          created: 1,
          model: "chat",
          choices: [{ index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      requests.push(text)
      const frames = [
        {
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "chat",
          choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: null }],
        },
        {
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "chat",
          choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        },
      ]
      return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", {
        headers: { "content-type": "text/event-stream" },
      })
    },
  })
  const child = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "interactive-fixture.ts")], {
    cwd: input.cwd,
    env: {
      ...input.env,
      KILO_FIXTURE_CONFIG: JSON.stringify({
        model: "fixture/chat",
        providers: {
          fixture: {
            package: "aisdk:@ai-sdk/openai-compatible",
            settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
            models: { chat: {} },
          },
        },
      }),
    },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 20000,
  })
  const errors = new Response(child.stderr).text()
  try {
    const endpoint = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/)
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    const client = OpenCode.make({
      baseUrl: endpoint.value,
      headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
    })
    const first = await run(client, {
      directory: input.cwd,
      text: "Greet me",
      model: { providerID: "fixture", id: "chat" },
    })
    expect(first.text).toBe("Fixture headless response")
    for (let index = 0; index < 25; index++) {
      await client.session.prompt({ sessionID: first.sessionID, text: `Padding prompt ${index}` })
      await client.session.wait({ sessionID: first.sessionID }, { signal: AbortSignal.timeout(10000) })
    }
    const second = await run(client, {
      directory: input.cwd,
      text: "Greet me again",
      sessionID: first.sessionID,
    })
    expect(second).toEqual({ sessionID: first.sessionID, text: "Fixture resumed response" })
    expect(requests.at(-1)).toBe("Fixture resumed response")
    expect(requests.length).toBeGreaterThanOrEqual(27)
  } finally {
    child.kill("SIGTERM")
    await child.exited
    await errors
    await model.stop(true)
  }
})
