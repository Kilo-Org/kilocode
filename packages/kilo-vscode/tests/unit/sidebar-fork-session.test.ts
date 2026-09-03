import { describe, expect, it, mock } from "bun:test"
import type { Session } from "@kilocode/sdk/v2/client"
import { handleForkSession, type ForkContext } from "../../src/kilo-provider/fork-session"

const session = { id: "fork", title: "fork", createdAt: "", updatedAt: "" } as Session

function ctx(overrides: Partial<ForkContext> = {}): ForkContext {
  const client = {
    session: {
      fork: mock(async () => ({ data: session })),
      promptAsync: mock(async () => ({})),
    },
  }
  return {
    connection: { getClient: () => client } as never,
    post: () => undefined,
    register: () => undefined,
    forked: () => undefined,
    status: () => "idle",
    directory: () => "/repo",
    ...overrides,
  }
}

describe("sidebar fork session", () => {
  it("registers the fork before reporting its source tab", async () => {
    const order: string[] = []
    const forked = mock((_session: Session, sourceID: string) => order.push(`forked:${sourceID}`))
    const register = mock(() => order.push("registered"))

    await handleForkSession(ctx({ forked, register }), "source", "message")

    expect(order).toEqual(["registered", "forked:source"])
    expect(forked).toHaveBeenCalledWith(session, "source")
  })

  it("rejects a non-idle source before forking", async () => {
    const forked = mock(() => undefined)
    const post = mock(() => undefined)

    await handleForkSession(ctx({ forked, post, status: () => "busy" }), "source")

    expect(forked).not.toHaveBeenCalled()
    expect(post).toHaveBeenCalledWith({ type: "error", message: "Wait for the session to finish before forking it." })
  })
})
