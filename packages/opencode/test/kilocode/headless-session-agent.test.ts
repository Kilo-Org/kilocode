import { afterEach, expect, test } from "bun:test"
import { Server } from "../../src/server/server"
import { disposeAllInstances, provideTestInstance, tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await disposeAllInstances()
  await resetDatabase()
})

test("headless prompts preserve the agent selected when the session was created", async () => {
  await using tmp = await tmpdir({
    config: {
      formatter: false,
      lsp: false,
      agent: {
        "test-engineer": {
          mode: "primary",
          model: "mock/custom-model",
        },
      },
      provider: {
        mock: {
          npm: "@ai-sdk/openai-compatible",
          name: "Mock",
          options: { baseURL: "http://127.0.0.1:1/v1", apiKey: "test" },
          models: {
            "custom-model": {
              name: "Custom Model",
              limit: { context: 128000, output: 8192 },
            },
          },
        },
      },
    },
  })

  await provideTestInstance({
    directory: tmp.path,
    fn: async () => {
      const app = Server.Default().app
      const headers = { "content-type": "application/json", "x-kilo-directory": tmp.path }
      const created = await app.request("/session", {
        method: "POST",
        headers,
        body: JSON.stringify({ agent: "test-engineer" }),
      })
      expect(created.status).toBe(200)
      const session = (await created.json()) as { id: string; agent?: string }
      expect(session.agent).toBe("test-engineer")

      const prompted = await app.request(`/session/${session.id}/message`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          noReply: true,
          parts: [{ type: "text", text: "hello" }],
        }),
      })
      expect(prompted.status).toBe(200)
      const message = (await prompted.json()) as {
        info: { agent: string; model: { providerID: string; modelID: string } }
      }
      expect(message.info.agent).toBe("test-engineer")
      expect(message.info.model).toEqual({ providerID: "mock", modelID: "custom-model" })

      const loaded = await app.request(`/session/${session.id}`, { headers })
      expect(loaded.status).toBe(200)
      const current = (await loaded.json()) as { agent?: string }
      expect(current.agent).toBe("test-engineer")
    },
  })
})
