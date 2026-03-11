import { describe, expect, it } from "bun:test"

const { KiloProvider } = await import("../../src/KiloProvider")

type ProviderInternals = {
  getProjectDirectory: (sessionId?: string) => string | undefined
}

describe("KiloProvider project directory", () => {
  it("uses the explicit panel project directory for standalone panels", () => {
    const provider = new KiloProvider({} as never, {} as never, undefined, {
      projectDirectory: "/repo-b",
    })
    const internal = provider as unknown as ProviderInternals

    expect(internal.getProjectDirectory()).toBe("/repo-b")
  })

  it("lets standalone panels disable project scope", () => {
    const provider = new KiloProvider({} as never, {} as never, undefined, {
      projectDirectory: null,
    })
    const internal = provider as unknown as ProviderInternals

    expect(internal.getProjectDirectory()).toBeUndefined()
  })
})
