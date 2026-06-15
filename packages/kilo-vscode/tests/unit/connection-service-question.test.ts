import { describe, expect, test } from "bun:test"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"

describe("KiloConnectionService question routing", () => {
  test("ignores stale NotFoundError rejects while draining questions", async () => {
    const service = new KiloConnectionService({} as any)
    const client = {
      permission: {
        list: async () => ({ data: [] }),
      },
      question: {
        list: async () => ({ data: [{ id: "que_test" }] }),
        reject: async () => ({ error: { _tag: "NotFound" } }),
      },
      suggestion: {
        list: async () => ({ data: [] }),
      },
      network: {
        list: async () => ({ data: [] }),
      },
    }

    ;(service as any).client = client
    ;(service as any).directoryProviders.add(() => ["/tmp/workspace"])

    await expect(service.drainPendingPrompts()).resolves.toBeUndefined()
  })

  test("records and clears request origins from SSE events", () => {
    const service = new KiloConnectionService({} as any)
    const handler = service as unknown as {
      handleQuestionEvent(event: unknown, directory?: string): void
    }

    handler.handleQuestionEvent(
      { type: "question.asked", properties: { id: "que_test", sessionID: "ses_test", questions: [] } },
      "/tmp/worktree",
    )
    expect(service.getQuestionDirectory("que_test")).toBe("/tmp/worktree")
    expect(service.getQuestionRevision()).toBe(1)

    handler.handleQuestionEvent({
      type: "question.replied",
      properties: { requestID: "que_test", sessionID: "ses_test", answers: [] },
    })
    expect(service.getQuestionDirectory("que_test")).toBeUndefined()
    expect(service.getQuestionRevision()).toBe(2)

    service.recordQuestionDirectory("que_rejected", "/tmp/worktree")
    handler.handleQuestionEvent({
      type: "question.rejected",
      properties: { requestID: "que_rejected", sessionID: "ses_test" },
    })
    expect(service.getQuestionDirectory("que_rejected")).toBeUndefined()
    expect(service.getQuestionRevision()).toBe(3)
  })

  test("prunes stale origins only for successfully scanned directories", () => {
    const service = new KiloConnectionService({} as any)
    service.recordQuestionDirectory("que_active", "/tmp/scanned")
    service.recordQuestionDirectory("que_stale", "/tmp/scanned")
    service.recordQuestionDirectory("que_unknown", "/tmp/failed")

    service.pruneQuestionDirectories(new Set(["que_active"]), new Set(["/tmp/scanned"]))

    expect(service.getQuestionDirectory("que_active")).toBe("/tmp/scanned")
    expect(service.getQuestionDirectory("que_stale")).toBeUndefined()
    expect(service.getQuestionDirectory("que_unknown")).toBe("/tmp/failed")
    expect(service.getQuestionRevision()).toBe(1)
  })
})
