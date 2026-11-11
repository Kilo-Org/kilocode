import { describe, expect, test } from "bun:test"
import { definition } from "@opencode/core/tool/runtime"
import type { Tool } from "@opencode/schema/tool"
import { Effect } from "effect"
import { makeTools } from "../src/wakeup/tools"
import type { WakeupService } from "../src/wakeup/service"

const sessionID = "ses_tools"
const context = {
  sessionID,
  agent: "code",
  messageID: "msg_tools",
  id: "call_tools",
  progress: () => Effect.void,
} as unknown as Parameters<Tool.Info["execute"]>[1]

const wakeupItem = {
  id: "wku_a",
  sessionID,
  kind: "wakeup",
  prompt: "check the build",
  dueAt: Date.now() + 60_000,
  recurring: false,
} as const

const cronItem = {
  id: "wku_c",
  sessionID,
  kind: "cron",
  prompt: "check CI",
  dueAt: Date.now() + 120_000,
  recurring: true,
  schedule: "*/5 * * * *",
} as const

function make(wake: Partial<Record<keyof WakeupService, unknown>> = {}) {
  const items = [wakeupItem, cronItem]
  return makeTools({
    list: () => Effect.succeed([...items]),
    cancel: (_sessionID: string, id: string, kind?: string) =>
      Effect.succeed(items.find((item) => item.id === id && (kind === undefined || item.kind === kind)) ?? undefined),
    scheduleWakeup: () => Effect.succeed({ ok: false, error: "not used" }),
    scheduleCron: () => Effect.succeed({ ok: false, error: "not used" }),
    ...wake,
  } as unknown as WakeupService)
}

describe("scheduling tools", () => {
  test("exposes the v1 tool surface", () => {
    const tools = make()
    expect(Object.keys(tools).toSorted()).toEqual(["cancel", "cronCreate", "cronDelete", "cronList", "wakeup"])
    expect(tools.wakeup.name).toBe("schedule_wakeup")
    expect(tools.cancel.name).toBe("cancel_wakeup")
    expect(tools.cronCreate.name).toBe("cron_create")
    expect(tools.cronList.name).toBe("cron_list")
    expect(tools.cronDelete.name).toBe("cron_delete")
  })

  test("keeps the always-on definition budget", () => {
    const tools = make()
    const total = [tools.wakeup, tools.cancel, tools.cronCreate, tools.cronList, tools.cronDelete]
      .map((tool) => definition(tool as Tool.Info))
      .reduce((sum, item) => sum + item.name.length + item.description.length + JSON.stringify(item.inputSchema).length, 0)
    // The action-time reminder carries the policy; the always-on tool prompt stays under 3.3 KB.
    expect(total).toBeLessThan(3_300)
    for (const tool of [tools.wakeup, tools.cancel, tools.cronCreate, tools.cronList, tools.cronDelete])
      expect(tool.description.length).toBeLessThan(500)
  })

  test("a scheduled result carries the action-time policy", async () => {
    const dueAt = Date.now() + 60_000
    const tools = make({
      scheduleWakeup: (input: { prompt: string }) =>
        Effect.succeed({ ok: true, wakeup: { ...wakeupItem, prompt: input.prompt, dueAt } }),
      scheduleCron: (input: { prompt: string }) =>
        Effect.succeed({ ok: true, wakeup: { ...cronItem, prompt: input.prompt, dueAt } }),
    })
    const wakeup = await Effect.runPromise(
      tools.wakeup.execute({ prompt: "check the deploy" }, context) as Effect.Effect<{ content: string }>,
    )
    expect(wakeup.content).toContain("cancel_wakeup wku_a")
    expect(wakeup.content).toContain("self-contained")
    const cron = await Effect.runPromise(
      tools.cronCreate.execute({ prompt: "check CI", cron: "*/5 * * * *" }, context) as Effect.Effect<{
        content: string
      }>,
    )
    expect(cron.content).toContain("cron_delete wku_c")
    expect(cron.content).toContain("self-contained")
  })

  test("cancel lists only wakeups and refuses a cron id", async () => {
    const tools = make()
    const list = await Effect.runPromise(
      tools.cancel.execute({ action: "list" }, context) as Effect.Effect<{ content: string }>,
    )
    expect(list.content).toContain("wku_a")
    expect(list.content).not.toContain("wku_c")
    const cron = await Effect.runPromise(
      tools.cancel.execute({ action: "cancel", id: "wku_c" }, context) as Effect.Effect<{ content: string }>,
    )
    expect(cron.content).toContain("No pending wakeup with id wku_c")
  })

  test("cron_list lists only cron tasks", async () => {
    const tools = make()
    const result = await Effect.runPromise(tools.cronList.execute({}, context) as Effect.Effect<{ content: string }>)
    expect(result.content).toContain("wku_c")
    expect(result.content).not.toContain("wku_a")
  })

  test("cron_delete removes a cron id and refuses a wakeup id", async () => {
    const tools = make()
    const removed = await Effect.runPromise(
      tools.cronDelete.execute({ id: "wku_c" }, context) as Effect.Effect<{ content: string }>,
    )
    expect(removed.content).toStartWith("Deleted cron task wku_c")
    const wakeup = await Effect.runPromise(
      tools.cronDelete.execute({ id: "wku_a" }, context) as Effect.Effect<{ content: string }>,
    )
    expect(wakeup.content).toContain("No cron task with id wku_a")
  })

  test("an unknown id is reported, not thrown", async () => {
    const tools = make()
    const result = await Effect.runPromise(
      tools.cancel.execute({ action: "cancel", id: "wku_missing" }, context) as Effect.Effect<{ content: string }>,
    )
    expect(result.content).toContain("No pending wakeup with id wku_missing")
  })
})
