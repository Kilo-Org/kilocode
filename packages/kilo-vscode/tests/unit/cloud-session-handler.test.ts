import { describe, expect, it } from "bun:test"
import {
  handleImportAndSend,
  handleRequestCloudSessionData,
  type CloudSessionContext,
} from "../../src/kilo-provider/handlers/cloud-session"

function stalled(options?: { signal?: AbortSignal }) {
  return new Promise<never>((_resolve, reject) => {
    options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true })
  })
}

function context(sent: unknown[]) {
  return {
    client: {
      kilo: {
        cloud: {
          session: {
            get: (_params: { id: string }, options?: { signal?: AbortSignal }) => stalled(options),
            import: (_params: { sessionId: string; directory: string }, options?: { signal?: AbortSignal }) =>
              stalled(options),
          },
        },
      },
    },
    currentSession: null,
    trackedSessionIds: new Set<string>(),
    connectionService: { recordMessageSessionId: () => undefined },
    postMessage: (message: unknown) => sent.push(message),
    getWorkspaceDirectory: () => "/repo",
    gatherEditorContext: async () => ({}),
  } as unknown as CloudSessionContext
}

describe("cloud session preview handler", () => {
  it.each(["", "pause", "clear", "resume"])("only shows bare goal status after cloud import: %j", async (args) => {
    const sent: unknown[] = []
    const notices: string[] = []
    const ctx: CloudSessionContext = {
      ...context(sent),
      client: {
        kilo: {
          cloud: {
            session: { import: async () => ({ data: { id: "local", time: { created: 1, updated: 1 } } }) },
          },
        },
        session: {
          command: async () => ({ data: { parts: [{ type: "text", text: "Goal paused" }] } }),
        },
      } as unknown as CloudSessionContext["client"],
      notify: (message) => notices.push(message),
    }
    await handleImportAndSend(
      ctx,
      "cloud",
      "/goal",
      "message",
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      "goal",
      args,
    )
    expect(notices).toEqual(args ? [] : ["Goal paused"])
    expect(sent).toContainEqual({ type: "sessionCommandCompleted", messageID: "message" })
  })

  it("reports a failure when the CLI preview request stalls", async () => {
    const timeout = AbortSignal.timeout
    AbortSignal.timeout = () => {
      const controller = new AbortController()
      queueMicrotask(() => controller.abort(new DOMException("The operation timed out", "TimeoutError")))
      return controller.signal
    }

    try {
      const sent: unknown[] = []
      const outcome = await Promise.race([
        handleRequestCloudSessionData(context(sent), "cloud-session").then(() => "resolved" as const),
        Bun.sleep(50).then(() => "still-pending" as const),
      ])

      expect(outcome).toBe("resolved")
      expect(sent).toEqual([
        {
          type: "cloudSessionImportFailed",
          cloudSessionId: "cloud-session",
          error: "The operation timed out",
        },
      ])
    } finally {
      AbortSignal.timeout = timeout
    }
  })

  it("reports a failure when the CLI import request stalls", async () => {
    const timeout = AbortSignal.timeout
    AbortSignal.timeout = () => {
      const controller = new AbortController()
      queueMicrotask(() => controller.abort(new DOMException("The operation timed out", "TimeoutError")))
      return controller.signal
    }

    try {
      const sent: unknown[] = []
      const outcome = await Promise.race([
        handleImportAndSend(context(sent), "cloud-session", "Continue").then(() => "resolved" as const),
        Bun.sleep(50).then(() => "still-pending" as const),
      ])

      expect(outcome).toBe("resolved")
      expect(sent).toEqual([
        {
          type: "cloudSessionImportFailed",
          cloudSessionId: "cloud-session",
          error: "The operation timed out",
        },
      ])
    } finally {
      AbortSignal.timeout = timeout
    }
  })
})
