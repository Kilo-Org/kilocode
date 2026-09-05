import { expect, test } from "bun:test"
import path from "node:path"
import { OpenCode } from "@opencode-ai/client"
import { executeCommand } from "../src/commands"
import { fixture, ready } from "./fixture"

test("native conversation reaches idle and reopens through the public client", async () => {
  await using input = await fixture()
  const requests: string[] = []
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
      const body: { stream?: boolean; model: string } = await request.json()
      requests.push(body.model)
      if (!body.stream)
        return Response.json({
          id: "fixture",
          object: "chat.completion",
          created: 1,
          model: "chat",
          choices: [
            { index: 0, message: { role: "assistant", content: "Fixture native response" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        })
      const frames = [
        {
          id: "fixture",
          object: "chat.completion.chunk",
          created: 1,
          model: "chat",
          choices: [
            { index: 0, delta: { role: "assistant", content: "Fixture native response" }, finish_reason: null },
          ],
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
  const env = {
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
  }
  const children: Bun.Subprocess<"ignore", "pipe", "pipe">[] = []
  const boot = async () => {
    const child = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "interactive-fixture.ts")], {
      cwd: input.cwd,
      env,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20000,
    })
    children.push(child)
    const errors = new Response(child.stderr).text()
    const endpoint = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/).catch(async (error) => {
      throw new Error(`${String(error)}\n${await errors}`)
    })
    const password = (
      await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
    ).trim()
    return {
      child,
      errors,
      client: OpenCode.make({
        baseUrl: endpoint.value,
        headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
      }),
    }
  }
  try {
    const first = await boot()
    const session = await first.client.session.create({
      location: { directory: input.cwd },
      model: { providerID: "fixture", id: "chat" },
    })
    await first.client.session.prompt({ sessionID: session.id, text: "Greet me" })
    await first.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) })
    const messages = await first.client.message.list({ sessionID: session.id })
    expect(JSON.stringify(messages)).toContain("Fixture native response")
    expect(requests.length).toBeGreaterThan(0)
    expect(await first.client.session.active()).toEqual({})
    first.child.kill("SIGTERM")
    expect(await first.child.exited, await first.errors).toBe(0)
    const second = await boot()
    expect(JSON.stringify(await second.client.message.list({ sessionID: session.id }))).toContain(
      "Fixture native response",
    )
    await second.client.session.prompt({ sessionID: session.id, text: "Greet me again" })
    await second.client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10000) })
    expect(await second.client.session.active()).toEqual({})
    expect(requests.length).toBeGreaterThan(1)
    const exported = await second.client.session.export({ sessionID: session.id })
    const file = path.join(input.directory, "transcript.json")
    await Bun.write(
      file,
      JSON.stringify({
        ...exported,
        info: {
          ...exported.info,
          parentID: "ses_unavailable",
          fork: { sessionID: "ses_unavailable", boundary: { type: "through", messageID: exported.messages[0].id } },
          revert: { messageID: exported.messages[0].id },
          metadata: { nested: ["preserved", { enabled: true }] },
        },
        messages: exported.messages.map((message) => ({
          ...message,
          ...(message.type === "assistant" ? { snapshot: { start: "unavailable", files: [] } } : {}),
        })),
      }),
    )
    const imported = await executeCommand(second.client, { type: "import", file, directory: input.cwd })
    expect("id" in imported).toBe(true)
    if (!("id" in imported)) throw new Error("Expected imported session")
    expect(imported.id).not.toBe(session.id)
    expect(imported.parentID).toBeUndefined()
    expect(imported.fork).toBeUndefined()
    expect(imported.revert).toBeUndefined()
    expect(imported.metadata).toEqual({ nested: ["preserved", { enabled: true }] })
    const copy = await second.client.session.export({ sessionID: imported.id })
    expect(copy.messages).toHaveLength(exported.messages.length)
    expect(copy.messages.every((message) => !exported.messages.some((source) => source.id === message.id))).toBe(true)
    expect(copy.messages.filter((message) => message.type === "assistant").every((message) => !message.snapshot)).toBe(
      true,
    )
    expect(JSON.stringify(copy.messages)).toContain("Fixture native response")
    await second.client.session.prompt({ sessionID: imported.id, text: "Continue this imported transcript" })
    await second.client.session.wait({ sessionID: imported.id }, { signal: AbortSignal.timeout(10000) })
    expect(requests.length).toBeGreaterThan(2)
    const listed = await executeCommand(second.client, { type: "sessions", directory: input.cwd })
    expect(JSON.stringify(listed)).toContain(imported.id)
    expect(await executeCommand(second.client, { type: "export", sessionID: session.id, sanitize: false })).toEqual(
      exported,
    )
    const invalid = path.join(input.directory, "invalid.json")
    await Bun.write(invalid, '{"messages":[]}')
    await expect(
      executeCommand(second.client, { type: "import", file: invalid, directory: input.cwd }),
    ).rejects.toThrow()
    second.child.kill("SIGTERM")
    expect(await second.child.exited, await second.errors).toBe(0)
  } finally {
    children.forEach((child) => child.kill("SIGTERM"))
    await Promise.all(children.map((child) => child.exited))
    await model.stop(true)
  }
})
