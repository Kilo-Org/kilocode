import { describe, expect, test } from "bun:test"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { provideTestInstance, tmpdir } from "../fixture/fixture"
import { readStallState } from "./fixture/stall-transport"
import { Server } from "../../src/server/server"

// Regression coverage for https://github.com/Kilo-Org/kilocode/issues/8656
//
// Reported symptom: after a tool call finished, `step-finish:tool-calls` was
// recorded and the next `step-start` never arrived, leaving the session busy
// with no error while the HTTP server stayed responsive.
//
// One transport state produces exactly that symptom: the follow-up request that
// carries the tool result gets response headers and then never receives a byte
// of body. The connection-phase timeout is cleared as soon as headers arrive, so
// before the fix nothing bounded that wait.
//
// The simulated socket is injected as the provider's `fetch` through the plugin
// `config` hook (see ../fixture/stall-plugin.ts), so the SDK, Kilo's fetch
// wrapper, SSE parsing, the processor and the agent loop stay production code
// and nothing global is patched.

const PLUGIN = pathToFileURL(path.join(import.meta.dir, "fixture", "stall-plugin.ts")).href
const ANSWER = "recovered after the stall"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function settings(state: string, timeout: number | false) {
  return {
    $schema: "https://app.kilo.ai/config.json",
    model: "mock/mock-model",
    plugin: [[PLUGIN, { state, answer: ANSWER }]],
    provider: {
      mock: {
        npm: "@ai-sdk/openai-compatible",
        name: "Mock",
        options: { baseURL: "http://127.0.0.1:1/v1", apiKey: "test", timeout },
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
    permission: { bash: "allow" },
  }
}

function project(timeout: number | false) {
  return tmpdir<{ state: string }>({
    init: async (dir) => {
      const state = path.join(dir, "stall-state.json")
      await Bun.write(path.join(dir, "opencode.json"), JSON.stringify(settings(state, timeout), null, 2))
      return { state }
    },
  })
}

type Part = Record<string, any>
type Message = { info: Record<string, any>; parts: Part[] }

function session(dir: string) {
  const app = Server.Default().app
  const headers = { "Content-Type": "application/json", "x-kilo-directory": dir }
  const query = `directory=${encodeURIComponent(dir)}`

  const json = async (route: string, init?: RequestInit, retry = false) => {
    const tries = retry ? 5 : 1
    for (let attempt = 0; attempt < tries; attempt++) {
      const res = await app.request(route, { headers, ...init })
      const body = await res.text()
      try {
        return JSON.parse(body)
      } catch (error) {
        if (!retry || !res.ok || attempt === tries - 1) {
          throw new Error(`${route} -> ${res.status} ${body.slice(0, 200)}`, { cause: error })
        }
        await sleep(100)
      }
    }
    throw new Error(`failed to read JSON response from ${route}`)
  }

  return {
    create: async () => ((await json("/session", { method: "POST", body: "{}" })) as { id: string }).id,
    prompt: (id: string, text: string) =>
      app.request(`/session/${id}/prompt_async`, {
        method: "POST",
        headers,
        body: JSON.stringify({ parts: [{ type: "text", text }] }),
      }),
    abort: (id: string) => app.request(`/session/${id}/abort`, { method: "POST", headers }),
    messages: (id: string) => json(`/session/${id}/message?${query}`, undefined, true) as Promise<Message[]>,
    status: async (id: string) => {
      const all = (await json(`/session/status?${query}`, undefined, true)) as Record<string, { type: string }>
      return all[id]?.type ?? "idle"
    },
  }
}

const timeline = (messages: Message[]) =>
  messages
    .flatMap((m) => m.parts)
    .map((p) =>
      p.type === "tool" ? `tool:${p.tool}:${p.state?.status}` : `${p.type}${p.reason ? `:${p.reason}` : ""}`,
    )
    .join(" | ")

async function until(check: () => Promise<boolean>, budget: number) {
  const deadline = Date.now() + budget
  while (Date.now() < deadline) {
    if (await check()) return true
    await sleep(200)
  }
  return false
}

/** Runs a prompt and waits until the provider has stalled the follow-up request. */
async function stalled(api: ReturnType<typeof session>, state: string) {
  const id = await api.create()
  await api.prompt(id, "run the echo command")
  const ready = await until(async () => {
    const stalls = (await readStallState(state)).stalls
    const parts = timeline(await api.messages(id))
    return stalls > 0 && parts.includes("step-finish:tool-calls")
  }, 30_000)
  expect(ready).toBe(true)
  return id
}

describe("issue #8656: provider stalls after a tool call", () => {
  test("recovers instead of freezing once the stall is bounded", async () => {
    await using tmp = await project(2_000)
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const api = session(tmp.path)
        const id = await stalled(api, tmp.extra.state)

        const done = await until(async () => (await api.status(id)) === "idle", 40_000)
        const messages = await api.messages(id)
        const assistant = messages.findLast((m) => m.info.role === "assistant")
        const text = (assistant?.parts ?? []).find((p) => p.type === "text")?.text
        const state = await readStallState(tmp.extra.state)
        console.log("[repro] bounded ->", JSON.stringify({ timeline: timeline(messages), text, state }))

        // the turn finishes on its own: the stalled request was aborted, retried
        // and answered, so the agent loop never sits frozen
        expect(done).toBe(true)
        expect(timeline(messages)).toContain("tool:bash:completed")
        expect(state.stalls).toBe(1)
        expect(state.recovered).toBeGreaterThan(0)
        expect(text).toContain(ANSWER)
        expect(assistant?.info.error).toBeUndefined()
      },
    })
  }, 120_000)

  test("still hangs while the provider holds the connection open and timeout is disabled", async () => {
    await using tmp = await project(false)
    await provideTestInstance({
      directory: tmp.path,
      fn: async () => {
        const api = session(tmp.path)
        const id = await stalled(api, tmp.extra.state)
        try {
          await sleep(5_000)
          const messages = await api.messages(id)
          const parts = timeline(messages)
          const assistant = messages.findLast((m) => m.info.role === "assistant")
          console.log("[repro] timeout:false ->", JSON.stringify({ timeline: parts, status: await api.status(id) }))

          // the reported freeze, kept reachable only through the documented opt-out
          expect(parts.endsWith("step-finish:tool-calls")).toBe(true)
          expect(await api.status(id)).toBe("busy")
          expect(assistant?.info.error).toBeUndefined()

          // the server itself stays responsive during the freeze
          expect((await Server.Default().app.request("/global/health")).status).toBe(200)
        } finally {
          // never leave a wedged turn behind for fixture teardown
          expect((await api.abort(id)).status).toBe(200)
          expect(await until(async () => (await api.status(id)) === "idle", 15_000)).toBe(true)
        }
      },
    })
  }, 120_000)
})
