import { describe, expect, it } from "bun:test"

const { KiloProvider } = await import("../../src/KiloProvider")

type Internals = {
  webview: { postMessage: (message: unknown) => Promise<unknown> } | null
  fetchAndSendCommands: () => Promise<void>
}

function provider(client: unknown) {
  const value = new KiloProvider(
    {} as never,
    {
      getClient: () => client,
    } as never,
  )
  const internal = value as unknown as Internals
  const sent: unknown[] = []
  internal.webview = {
    postMessage: async (message: unknown) => {
      sent.push(message)
      return true
    },
  }
  return { internal, sent }
}

describe("KiloProvider commands", () => {
  it("completes a command request when the backend is unavailable", async () => {
    const { internal, sent } = provider(null)

    await internal.fetchAndSendCommands()

    expect(sent).toEqual([{ type: "commandsLoaded", commands: [] }])
  })

  it("completes a command request when loading commands fails", async () => {
    const { internal, sent } = provider({
      command: {
        list: async () => {
          throw new Error("command load rejected")
        },
      },
    })

    await internal.fetchAndSendCommands()

    expect(sent).toEqual([{ type: "commandsLoaded", commands: [] }])
  })
})
