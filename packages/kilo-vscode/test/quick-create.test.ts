import { describe, expect, it } from "bun:test"
import { createQuickCreate } from "../webview-ui/agent-manager/quick-create"
import type { CreateWorktreeRequest } from "../webview-ui/src/types/messages/agent-manager"

describe("quick create", () => {
  it("posts one request ID and ties the marker and blocker to it", () => {
    const sent: CreateWorktreeRequest[] = []
    const blocked: string[] = []
    const quick = createQuickCreate({ post: (message) => sent.push(message), blocked: (id) => blocked.push(id) })

    quick.start("p1", "release/1.0")

    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      type: "agentManager.createWorktree",
      projectId: "p1",
      baseBranch: "release/1.0",
      requestId: expect.any(String),
    })
    const requestId = sent[0]!.requestId
    expect(quick.quick()).toMatchObject({ requestId, project: "p1" })

    quick.quick()!.blocked("p1")

    expect(blocked).toEqual(["p1"])
    expect(quick.quick()).toBeUndefined()
  })
})
