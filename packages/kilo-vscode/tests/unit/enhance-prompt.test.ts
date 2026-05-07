import { describe, expect, it, spyOn } from "bun:test"
import { handleEnhancePrompt } from "../../src/kilo-provider/enhance-prompt"

type Context = Parameters<typeof handleEnhancePrompt>[0]
type Client = NonNullable<Context["client"]>

async function tick() {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

function createCtx(client: Client | null, error = "boom") {
  const calls = {
    posts: [] as unknown[],
    errors: [] as string[],
  }
  const ctx: Context = {
    client,
    postMessage: (msg) => calls.posts.push(msg),
    getErrorMessage: () => error,
    showErrorMessage: (msg) => calls.errors.push(msg),
  }
  return { calls, ctx }
}

describe("handleEnhancePrompt", () => {
  it("posts an error when the client is unavailable", () => {
    const { calls, ctx } = createCtx(null)

    handleEnhancePrompt(ctx, "draft", "req-1")

    expect(calls.posts).toEqual([
      {
        type: "enhancePromptError",
        error: "Not connected to CLI backend",
        requestId: "req-1",
      },
    ])
    expect(calls.errors).toEqual([])
  })

  it("posts enhanced text on success", async () => {
    const client = {
      enhancePrompt: {
        enhance: async (input: { text?: string }) => ({ data: { text: `better ${input.text}` } }),
      },
    } as unknown as Client
    const { calls, ctx } = createCtx(client)

    handleEnhancePrompt(ctx, "draft", "req-2")
    await tick()

    expect(calls.posts).toEqual([{ type: "enhancePromptResult", text: "better draft", requestId: "req-2" }])
    expect(calls.errors).toEqual([])
  })

  it("posts and shows the error message on failure", async () => {
    const log = spyOn(console, "error").mockImplementation(() => {})
    try {
      const client = {
        enhancePrompt: {
          enhance: async () => {
            throw new Error("server failed")
          },
        },
      } as unknown as Client
      const { calls, ctx } = createCtx(client, "server failed")

      handleEnhancePrompt(ctx, "draft", "req-3")
      await tick()

      expect(calls.errors).toEqual(["Enhance prompt failed: server failed"])
      expect(calls.posts).toEqual([
        {
          type: "enhancePromptError",
          error: "server failed",
          requestId: "req-3",
        },
      ])
    } finally {
      log.mockRestore()
    }
  })
})
