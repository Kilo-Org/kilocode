import { expect, test } from "bun:test"
import { mkdir } from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { fixture } from "./fixture"

for (const poisoned of [false, true]) {
  test(
    poisoned
      ? "Kilo TUI excludes poisoned project plugins that default discovery imports"
      : "Kilo TUI renders its footer, selects a model, submits a native prompt, and shuts down",
    async () => {
      await using input = await fixture()
      const sentinel = path.join(input.cwd, "plugin-imported")
      if (poisoned) {
        const directory = path.join(input.cwd, ".opencode/plugins/poison")
        await mkdir(directory, { recursive: true })
        await Bun.write(
          path.join(directory, "package.json"),
          JSON.stringify({ name: "fixture-poison", type: "module", exports: { "./tui": "./tui.ts" } }),
        )
        await Bun.write(
          path.join(directory, "tui.ts"),
          `await Bun.write(${JSON.stringify(sentinel)}, "imported"); throw new Error("POISON_PROJECT_PLUGIN_IMPORTED")`,
        )
      }
      const requests: { stream?: boolean; model: string; messages: unknown }[] = []
      const model = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        async fetch(request) {
          if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
          const body: { stream?: boolean; model: string; messages: unknown } = await request.json()
          requests.push(body)
          const content = body.stream ? "Fixture native TUI response" : "Fixture TUI title"
          const base = { id: "fixture-tui", created: 1, model: body.model }
          const usage = { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
          if (!body.stream)
            return Response.json({
              ...base,
              object: "chat.completion",
              choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
              usage,
            })
          const frames = [
            { choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: null }] },
            { choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage },
          ]
          return new Response(
            frames
              .map((frame) => `data: ${JSON.stringify({ ...base, object: "chat.completion.chunk", ...frame })}\n\n`)
              .join("") + "data: [DONE]\n\n",
            { headers: { "content-type": "text/event-stream" } },
          )
        },
      })
      const boot = async (mode: "conversation" | "discovery-control") => {
        const child = Bun.spawn(
          [
            process.execPath,
            "--no-env-file",
            "--preload",
            fileURLToPath(import.meta.resolve("@opentui/solid/preload")),
            path.join(import.meta.dir, "tui-fixture.tsx"),
            mode,
          ],
          {
            cwd: input.cwd,
            env: {
              ...input.env,
              KILO_FIXTURE_CONFIG: JSON.stringify({
                model: "fixture/fixture-initial",
                providers: {
                  fixture: {
                    package: "aisdk:@ai-sdk/openai-compatible",
                    settings: { baseURL: `http://127.0.0.1:${model.port}/v1`, apiKey: "fixture" },
                    models: { "fixture-initial": {}, "fixture-selected": {} },
                  },
                },
              }),
            },
            stdin: "ignore",
            stdout: "pipe",
            stderr: "pipe",
            timeout: 25000,
            killSignal: "SIGKILL",
          },
        )
        try {
          const [code, stdout, stderr] = await Promise.all([
            child.exited,
            new Response(child.stdout).text(),
            new Response(child.stderr).text(),
          ])
          expect(code, `${mode}\n${stdout}\n${stderr}`).toBe(0)
          expect(stdout, stderr).toContain(`TUI_FIXTURE_OK:${mode}`)
          if (mode === "conversation") expect(stderr).not.toContain("MaxListenersExceededWarning")
        } finally {
          child.kill()
          await child.exited
        }
      }
      try {
        await boot("conversation")
        expect(
          requests.some(
            (request) =>
              request.stream === true &&
              request.model === "fixture-selected" &&
              JSON.stringify(request.messages).includes("Greet the isolated TUI fixture"),
          ),
        ).toBe(true)
        expect(await Bun.file(sentinel).exists()).toBe(false)
        if (!poisoned) return
        await boot("discovery-control")
        expect(await Bun.file(sentinel).text()).toBe("imported")
      } finally {
        await model.stop(true)
      }
    },
    60000,
  )
}
