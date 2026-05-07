import { describe, expect, test } from "bun:test"
import { Effect, Layer, ManagedRuntime } from "effect"
import { MessageID, SessionID } from "../../src/session/schema"
import { provideTmpdirInstance } from "../fixture/fixture"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { AgentManagerTool } from "../../src/kilocode/tool/agent-manager"
import { Bus } from "../../src/bus"
import { Tool } from "../../src/tool/tool"
import { Truncate } from "../../src/tool/truncate"
import { Agent } from "../../src/agent/agent"
import path from "node:path"
import { mkdir } from "node:fs/promises"

const runtime = ManagedRuntime.make(
  Layer.mergeAll(Truncate.defaultLayer, Agent.defaultLayer, Bus.defaultLayer, CrossSpawnSpawner.defaultLayer),
)

async function init() {
  return runtime.runPromise(
    Effect.gen(function* () {
      const info = yield* AgentManagerTool
      return yield* Tool.init(info)
    }),
  )
}

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  callID: "call_agent_manager",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => Effect.void,
  ask: () => Effect.void,
}

describe("agent_manager tool", () => {
  test("asks for agent_manager permission", async () => {
    const tool = await init()
    const calls: unknown[] = []

    await runtime.runPromise(
      provideTmpdirInstance(() =>
        tool.execute(
          { mode: "local", tasks: [{ prompt: "Fix issue" }] },
          { ...ctx, ask: (input: unknown) => Effect.sync(() => calls.push(input)) },
        ),
      ).pipe(Effect.scoped),
    )

    expect(calls).toEqual([
      {
        permission: "agent_manager",
        patterns: ["local"],
        always: ["local"],
        metadata: { mode: "local", count: 1 },
      },
    ])
  })

  test("rejects empty tasks", async () => {
    const tool = await init()

    await expect(
      runtime.runPromise(
        provideTmpdirInstance(() =>
          tool.execute({ mode: "local", tasks: [{}] }, { ...ctx, ask: () => Effect.void }),
        ).pipe(Effect.scoped),
      ),
    ).rejects.toThrow("Each task must include prompt, name, or branchName")
  })

  test("returns read-only overview from snapshot", async () => {
    const tool = await init()

    await runtime.runPromise(
      provideTmpdirInstance((dir) =>
        Effect.promise(async () => {
          await mkdir(path.join(dir, ".kilo"), { recursive: true })
          await Bun.write(
            path.join(dir, ".kilo", "agent-manager-overview.json"),
            JSON.stringify({
              version: 1,
              generatedAt: new Date().toISOString(),
              root: dir,
              active: { sessionId: "ses_wt", worktreeId: "wt_1", tabId: "worktree:wt_1:ses_wt" },
              summary: {
                total: 1,
                running: 1,
                waiting: 0,
                idle: 0,
                done: 0,
                failed: 0,
                stale: 0,
                worktrees: 1,
                localTabs: 0,
              },
              requests: [
                { id: "am-1", sessionIds: ["ses_wt"], worktreeIds: ["wt_1"], status: "running", summary: { total: 1 } },
              ],
              sections: [],
              tabs: [],
              worktrees: [
                {
                  id: "wt_1",
                  section: "Review",
                  name: "overview prototype",
                  path: path.join(dir, ".kilo", "worktrees", "overview"),
                  branch: "overview",
                  selected: true,
                  status: "running",
                  sessionIds: ["ses_wt"],
                  tabIds: ["worktree:wt_1:ses_wt"],
                  git: { files: 1, additions: 10, deletions: 2, behind: 0 },
                  pr: { attached: false },
                  stale: false,
                },
              ],
              sessions: [
                {
                  id: "ses_wt",
                  tabId: "worktree:wt_1:ses_wt",
                  worktreeId: "wt_1",
                  requestId: "am-1",
                  kind: "worktree",
                  section: "Review",
                  name: "overview prototype",
                  cwd: path.join(dir, ".kilo", "worktrees", "overview"),
                  status: "running",
                  selected: true,
                  stale: false,
                  attention: "none",
                },
              ],
            }),
          )

          const result = await runtime.runPromise(tool.execute({ action: "overview" }, ctx))
          expect(result.title).toBe("Agent Manager overview")
          expect(result.output).toContain("## Agent Manager Overview")
          expect(result.output).toContain("overview prototype")
          expect(result.output).toContain("ses_wt")
        }),
      ).pipe(Effect.scoped),
    )
  })
})
