import { expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import { Server } from "../../src/server/server"

// Regression coverage for https://github.com/Kilo-Org/kilocode/issues/6905
//
// Reported symptom: a malformed file-write tool call surfaced as
// "Model tried to call unavailable tool 'invalid'" instead of settling.
//
// The repairToolCall fallback in src/session/llm.ts rewrites unrepairable tool
// calls to the registered "invalid" tool so the model receives readable
// feedback and can self-correct. That only works when "invalid" stays callable,
// i.e. is not filtered out of activeTools.
//
// One scripted provider socket drives both paths through the production agent
// loop (see ./fixture/bad-toolcall-transport.ts):
//   turn 1: tool call named "Write" (wrong case)  -> repaired to "write"
//   turn 2: tool call with an unknown name        -> settles into "invalid"

const PLUGIN = pathToFileURL(path.join(import.meta.dir, "fixture", "bad-toolcall-plugin.ts")).href
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function settings(state: string) {
  return {
    $schema: "https://app.kilo.ai/config.json",
    model: "mock/mock-model",
    plugin: [[PLUGIN, { state }]],
    provider: {
      mock: {
        npm: "@ai-sdk/openai-compatible",
        name: "Mock",
        options: { baseURL: "http://127.0.0.1:1/v1", apiKey: "test", timeout: 5_000 },
        models: {
          "mock-model": {
            name: "Mock Model",
            tool_call: true,
            limit: { context: 128000, output: 8192 },
            cost: { input: 0, output: 0 },
          },
        },
      },
    },
    permission: { edit: "allow", invalid: "allow" },
  }
}

type Part = Record<string, any>
type Message = { info: Record<string, any>; parts: Part[] }

const timeline = (messages: Message[]) =>
  messages
    .flatMap((m) => m.parts)
    .map((p) => (p.type === "tool" ? `tool:${p.tool}:${p.state?.status}` : p.type))
    .join(" | ")

async function runPrompt(dir: string) {
  const app = Server.Default().app
  const headers = { "Content-Type": "application/json", "x-kilo-directory": dir }
  const created = await app.request("/session", { method: "POST", headers, body: "{}" })
  const id = ((await created.json()) as { id: string }).id

  await app.request(`/session/${id}/prompt_async`, {
    method: "POST",
    headers,
    body: JSON.stringify({ parts: [{ type: "text", text: "write hello to test.txt" }] }),
  })

  const reply = async () => {
    const res = await app.request(`/session/${id}/message`, { headers })
    const all = JSON.parse(await res.text()) as Message[]
    const last = all.findLast((m) => m.info.role === "assistant")
    return last?.parts.some((p) => p.type === "text") ? all : undefined
  }

  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    await sleep(500)
    const done = await reply()
    if (done) return done
  }
  throw new Error("issue #6905 repro never produced a final assistant message")
}

test("issue #6905: wrong-case tool calls are repaired and unknown names settle into invalid feedback", async () => {
  await using tmp = await tmpdir<string>({
    init: async (dir) => {
      const state = path.join(dir, "calls.json")
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(settings(state), null, 2))
      return state
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const messages = await runPrompt(tmp.path)
      const parts = timeline(messages)

      // the wrong-case call was repaired to the real tool and executed
      expect(parts).toContain("tool:write:completed")

      // the unknown name settled into the invalid tool's readable feedback
      // instead of surfacing "Model tried to call unavailable tool 'invalid'"
      expect(parts).toContain("tool:invalid:completed")
      expect(parts).not.toContain(":error")
      const invalidPart = messages.flatMap((m) => m.parts).find((p) => p.type === "tool" && p.tool === "invalid")
      expect(String(invalidPart?.state?.output)).toContain("arguments provided to the tool are invalid")
      const invalidInput = invalidPart!.state.input
      expect(typeof invalidInput === "string" ? JSON.parse(invalidInput) : invalidInput).toMatchObject({
        tool: "WriteFileToDisk",
      })
    },
  })
}, 120_000)
