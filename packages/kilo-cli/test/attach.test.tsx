import { expect, test } from "bun:test"
import path from "node:path"
import { fixture } from "./fixture"

test("TUI attaches, detaches without stopping the daemon, and resumes on reattach", async () => {
  await using input = await fixture()
  const model = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const body: { stream?: boolean } = await request.json()
      if (!body.stream)
        return Response.json({ choices: [{ message: { role: "assistant", content: "Attached session" } }] })
      const frames = [
        {
          choices: [
            { index: 0, delta: { role: "assistant", content: "Attached daemon response" }, finish_reason: null },
          ],
        },
        { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
      ]
      return new Response(
        frames
          .map(
            (frame) =>
              `data: ${JSON.stringify({ id: "attach", object: "chat.completion.chunk", created: 1, model: "chat", ...frame })}\n\n`,
          )
          .join("") + "data: [DONE]\n\n",
        {
          headers: { "content-type": "text/event-stream" },
        },
      )
    },
  })
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        "--no-env-file",
        "--preload",
        "@opentui/solid/preload",
        path.join(import.meta.dir, "attach-fixture.tsx"),
      ],
      {
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
        timeout: 45000,
      },
    )
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    expect(code, `${stdout}\n${stderr}`).toBe(0)
    expect(stdout).toContain("ATTACH_FIXTURE_OK")
  } finally {
    await model.stop(true)
  }
}, 60000)
