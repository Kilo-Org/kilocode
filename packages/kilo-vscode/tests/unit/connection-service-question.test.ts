import { describe, expect, test } from "bun:test"
import { KiloConnectionService } from "../../src/services/cli-backend/connection-service"

describe("KiloConnectionService permission routing", () => {
  test("invalidates recovery when permission events arrive or routes are cleared", () => {
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const handler = service as unknown as {
      handlePermissionEvent(event: unknown, directory?: string): void
    }

    handler.handlePermissionEvent(
      { type: "permission.asked", properties: { id: "per_test", sessionID: "ses_child" } },
      "/tmp/worktree",
    )
    expect(service.getPermissionDirectory("per_test")).toBe("/tmp/worktree")
    expect(service.getPermissionRevision()).toBe(1)

    handler.handlePermissionEvent({ type: "permission.replied", properties: { requestID: "per_test" } })
    expect(service.getPermissionDirectory("per_test")).toBeUndefined()
    expect(service.getPermissionRevision()).toBe(2)

    service.clearPermissionDirectory("per_test")
    expect(service.getPermissionRevision()).toBe(3)
    service.recordPermissionDirectory("per_stale", "/tmp/worktree")
    service.prunePermissionDirectories(new Set(), new Set(["/tmp/worktree"]))
    expect(service.getPermissionDirectory("per_stale")).toBeUndefined()
    expect(service.getPermissionRevision()).toBe(4)
  })

  test("keeps live permission routes and claims when a session is temporarily pruned", async () => {
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const gate = Promise.withResolvers<{
      kind: "resolved"
      sessionID: string
      response: "once"
    }>()
    service.recordPermissionDirectory("per_live", "/tmp/worktree", "ses_child")
    const response = service.runPermissionResponse("per_live", "ses_child", async () => gate.promise)

    service.pruneSession("ses_child")

    expect(service.getPermissionDirectory("per_live")).toBe("/tmp/worktree")
    expect(service.getPermissionSession("per_live")).toBe("ses_child")
    expect(service.isPermissionResponseClaimed("per_live")).toBe(true)

    gate.resolve({ kind: "resolved", sessionID: "ses_child", response: "once" })
    await expect(response).resolves.toEqual({ kind: "resolved", sessionID: "ses_child", response: "once" })
    service.dispose()
  })

  test("clears permission state after a session is deleted", async () => {
    const service = new KiloConnectionService({} as ConstructorParameters<typeof KiloConnectionService>[0])
    const gate = Promise.withResolvers<{
      kind: "resolved"
      sessionID: string
      response: "once"
    }>()
    service.recordPermissionDirectory("per_deleted", "/tmp/worktree", "ses_deleted")
    const response = service.runPermissionResponse("per_deleted", "ses_deleted", async () => gate.promise)

    service.clearPermissionSession("ses_deleted")

    expect(service.getPermissionDirectory("per_deleted")).toBeUndefined()
    expect(service.getPermissionSession("per_deleted")).toBeUndefined()
    expect(service.isPermissionResponseClaimed("per_deleted")).toBe(true)

    gate.resolve({ kind: "resolved", sessionID: "ses_deleted", response: "once" })
    await expect(response).resolves.toEqual({ kind: "resolved", sessionID: "ses_deleted", response: "once" })
    expect(service.isPermissionResponseClaimed("per_deleted")).toBe(false)
    service.dispose()
  })
})

describe("KiloConnectionService question routing", () => {
  test.each([undefined, { _tag: "NotFound" }])("invalidates recovery after draining (%j)", async (error) => {
    const service = new KiloConnectionService({} as any)
    const client = {
      permission: {
        list: async () => ({ data: [] }),
      },
      question: {
        list: async () => ({ data: [{ id: "que_test" }] }),
        reject: async () => ({ error }),
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
    service.recordQuestionDirectory("que_test", "/tmp/workspace")
    const revisions: number[] = []
    service.onClearPendingPrompts(() => revisions.push(service.getQuestionRevision()))

    await expect(service.drainPendingPrompts()).resolves.toBeUndefined()

    expect(service.getQuestionDirectory("que_test")).toBeUndefined()
    expect(revisions).toEqual([1])
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
