import { describe, expect, test } from "bun:test"
import type { SessionMessageInfo } from "@opencode/client"
import {
  active,
  hold,
  showsWorking,
  statusText,
  tracksElapsed,
} from "../webview-ui/src/components/shared/working-indicator-utils"

const t = (key: string) => key
const timing = { active: 0, since: 1 }
const user = (id: string): SessionMessageInfo => ({ id, type: "user", text: id, time: { created: 1 } })
const assistant = (content: Extract<SessionMessageInfo, { type: "assistant" }>["content"]) =>
  ({ id: "a", type: "assistant", content, time: { created: 2 } }) as unknown as SessionMessageInfo
const tool = (name: string) => ({
  type: "tool" as const,
  id: name,
  name,
  state: { status: "running" as const, input: {}, metadata: {} },
  time: { created: 1 },
})

describe("working indicator state", () => {
  test("shows for a running session or a prompt waiting for its execution, unless blocked", () => {
    expect(showsWorking("running", false, false)).toBe(true)
    expect(showsWorking("idle", true, false)).toBe(true)
    expect(showsWorking("idle", false, false)).toBe(false)
    expect(showsWorking("running", false, true)).toBe(false)
  })

  test("tracks elapsed time only with a clock and an active turn", () => {
    expect(tracksElapsed("idle", true, timing)).toBe(true)
    expect(tracksElapsed("running", false, { active: 5000 })).toBe(true)
    expect(tracksElapsed("idle", false, timing)).toBe(false)
    expect(tracksElapsed("running", false, undefined)).toBe(false)
  })

  test("holds the clock while parked", () => {
    const held = hold({ active: 1000, since: 2000 }, 5000)
    expect(held).toEqual({ active: 4000 })
    expect(active(held, 9000)).toBe(4000)
    expect(active({ active: 1000, since: 2000 }, 5000)).toBe(4000)
  })
})

describe("statusText", () => {
  test("labels the last content item of the newest step with main's labels", () => {
    const label = (item: Parameters<typeof assistant>[0][number]) =>
      statusText([user("u"), assistant([item])], new Set(), t)
    expect(label(tool("shell"))).toBe("ui.sessionTurn.status.runningCommands")
    expect(label(tool("subagent"))).toBe("ui.sessionTurn.status.delegating")
    expect(label(tool("read"))).toBe("ui.sessionTurn.status.gatheringContext")
    expect(label(tool("grep"))).toBe("ui.sessionTurn.status.searchingCodebase")
    expect(label(tool("webfetch"))).toBe("ui.sessionTurn.status.searchingWeb")
    expect(label(tool("edit"))).toBe("ui.sessionTurn.status.makingEdits")
    expect(label(tool("todowrite"))).toBe("ui.sessionTurn.status.planning")
    expect(label(tool("patch"))).toBe("ui.sessionTurn.status.consideringNextSteps")
    expect(label({ type: "reasoning", text: "" })).toBe("ui.sessionTurn.status.thinking")
    expect(label({ type: "text", text: "hi" })).toBe("session.status.writingResponse")
  })

  test("thinks before the first step and ignores undelivered input", () => {
    expect(statusText([user("u")], new Set(), t)).toBe("ui.sessionTurn.status.thinking")
    expect(statusText([user("u"), assistant([])], new Set(), t)).toBe("ui.sessionTurn.status.thinking")
    expect(statusText([user("u"), assistant([tool("shell")]), user("p")], new Set(["p"]), t)).toBe(
      "ui.sessionTurn.status.runningCommands",
    )
  })
})
