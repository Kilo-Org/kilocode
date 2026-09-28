import { describe, expect, it } from "bun:test"
import { authorizeProviderOAuth } from "../../src/provider-actions"

function createCtx() {
  const calls: Array<{ providerID: string; method: number; directory?: string; inputs?: Record<string, string> }> = []
  const posts: unknown[] = []

  const ctx = {
    client: {
      provider: {
        oauth: {
          authorize: async (input: {
            providerID: string
            method: number
            directory?: string
            inputs?: Record<string, string>
          }) => {
            calls.push(input)
            return { data: { url: "", method: "auto", instructions: "sign in with az login" } }
          },
        },
      },
    },
    postMessage: (message: unknown) => posts.push(message),
    getErrorMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
    workspaceDir: "/tmp",
    disposeGlobal: async () => {},
    fetchAndSendProviders: async () => {},
  }

  return { calls, posts, ctx }
}

describe("authorizeProviderOAuth", () => {
  it("forwards prompt inputs to the oauth authorize call", async () => {
    const { calls, posts, ctx } = createCtx()
    const inputs = { endpointType: "resourceName", resourceName: "my-resource" }

    await authorizeProviderOAuth(ctx as never, "req-1", "azure", 1, inputs)

    expect(calls).toEqual([{ providerID: "azure", method: 1, directory: "/tmp", inputs }])
    expect(posts).toContainEqual({
      type: "providerOAuthReady",
      requestId: "req-1",
      providerID: "azure",
      authorization: { url: "", method: "auto", instructions: "sign in with az login" },
    })
  })

  it("omits inputs when none are supplied", async () => {
    const { calls, ctx } = createCtx()

    await authorizeProviderOAuth(ctx as never, "req-2", "azure", 0)

    expect(calls).toEqual([{ providerID: "azure", method: 0, directory: "/tmp", inputs: undefined }])
  })
})
