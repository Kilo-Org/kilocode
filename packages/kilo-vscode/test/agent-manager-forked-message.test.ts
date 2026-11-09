import { describe, expect, it } from "bun:test"
import type { SessionInfo } from "@opencode/client"
import { applySessionForked } from "../webview-ui/agent-manager/app-messages"

const session = {
  id: "forked",
  title: "Source (fork #1)",
  location: { directory: "/repo" },
} as unknown as SessionInfo

function deps(project: string | undefined, calls: string[]) {
  return {
    currentProjectId: () => project,
    insertAfter: (_worktreeId: string | undefined, anchor: string, id: string) => calls.push(`insert:${anchor}:${id}`),
    setLocal: () => calls.push("local"),
    persist: (id: string) => calls.push(`persist:${id}`),
    saveTabMemory: () => calls.push("save"),
    setSelection: (id: string) => calls.push(`select:${id}`),
    evictLocal: (id: string) => calls.push(`evict:${id}`),
    selectSession: (id: string) => calls.push(`session:${id}`),
    remember: (value: SessionInfo) => calls.push(`remember:${value.id}`),
    requestChatFocus: () => calls.push("focus"),
  }
}

describe("agent manager session forked message", () => {
  it("remembers the fork before it inserts and selects the tab", () => {
    const calls: string[] = []

    applySessionForked(
      {
        type: "agentManager.sessionForked",
        projectId: "prj",
        sessionId: "forked",
        forkedFromId: "source",
        session,
      },
      deps("prj", calls),
    )

    expect(calls).toEqual([
      "remember:forked",
      "insert:source:forked",
      "local",
      "persist:forked",
      "session:forked",
      "focus",
    ])
  })

  it("ignores a fork from another project", () => {
    const calls: string[] = []

    applySessionForked(
      {
        type: "agentManager.sessionForked",
        projectId: "prj",
        sessionId: "forked",
        forkedFromId: "source",
        session,
      },
      deps("other", calls),
    )

    expect(calls).toEqual([])
  })
})
