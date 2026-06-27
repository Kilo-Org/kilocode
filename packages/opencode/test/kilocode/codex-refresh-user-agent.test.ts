import { expect, test } from "bun:test"
import type { PluginInput } from "@kilocode/plugin"
import { CodexAuthPlugin } from "../../src/plugin/openai/codex"

test("identifies Codex refresh requests as Kilo", async () => {
  const original = globalThis.fetch
  const seen: Request[] = []
  const signals: (AbortSignal | null | undefined)[] = []
  let auth = {
    type: "oauth" as const,
    access: "old-access",
    refresh: "old-refresh",
    expires: 0,
  }
  const input = {
    client: {
      auth: {
        set: async (req: { body: typeof auth }) => {
          auth = req.body
        },
      },
    },
  } as unknown as PluginInput
  globalThis.fetch = Object.assign(
    async (...args: Parameters<typeof globalThis.fetch>) => {
      const req = new Request(...args)
      seen.push(req)
      signals.push(args[1]?.signal)
      if (req.url === "https://auth.openai.com/oauth/token") {
        return Response.json({
          id_token: "",
          access_token: "next-access",
          refresh_token: "next-refresh",
          expires_in: 60,
        })
      }
      return new Response("", { status: 200 })
    },
    { preconnect: original.preconnect },
  )

  try {
    const plugin = await CodexAuthPlugin(input)
    const loaded = await plugin.auth!.loader!(async () => auth, {} as never)
    await loaded.fetch("https://api.openai.com/v1/responses")
  } finally {
    globalThis.fetch = original
  }

  const refresh = seen[0]
  expect(refresh.url).toBe("https://auth.openai.com/oauth/token")
  expect(refresh.headers.get("user-agent")).toMatch(/^kilo\//)
  expect(signals[0]).toBeInstanceOf(AbortSignal)
  expect(await refresh.text()).toContain("refresh_token=old-refresh")
})
