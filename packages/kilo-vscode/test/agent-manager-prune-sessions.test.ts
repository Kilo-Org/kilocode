import { describe, expect, it } from "bun:test"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import type { SessionInfo } from "@opencode/client"
import { WorktreeStateManager } from "../src/agent-manager/WorktreeStateManager"
import { pruneSubagents, sessionMissing } from "../src/agent-manager/prune-subagents"

describe("pruneSubagents", () => {
  it("drops sessions the server does not have and keeps sessions it cannot check", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kilo-prune-"))
    try {
      const state = new WorktreeStateManager(root, () => undefined)
      state.addSession("ses_live", null)
      state.addSession("ses_gone", null)
      state.addSession("ses_offline", null)
      state.addSession("ses_child", null)
      const infos: Record<string, SessionInfo | null | undefined> = {
        ses_live: { id: "ses_live" } as SessionInfo,
        ses_gone: null,
        ses_offline: undefined,
        ses_child: { id: "ses_child", parentID: "ses_live" } as SessionInfo,
      }
      await pruneSubagents(
        state,
        { getSessionInfo: async (id) => infos[id], clearSessionDirectory: () => undefined },
        () => undefined,
      )
      expect(
        state
          .getSessions()
          .map((item) => item.id)
          .sort(),
      ).toEqual(["ses_live", "ses_offline"])
    } finally {
      fs.rmSync(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
  })

  it("recognizes only the server's missing-session error", () => {
    expect(sessionMissing({ _tag: "SessionNotFoundError", sessionID: "ses_1" })).toBe(true)
    expect(sessionMissing({ name: "SessionNotFoundError" })).toBe(true)
    expect(sessionMissing({ _tag: "MessageNotFoundError" })).toBe(false)
    expect(sessionMissing(new Error("fetch failed"))).toBe(false)
  })
})
