import { describe, expect, it } from "bun:test"
import { AGENT_MANAGER_UPSELL, showAgentManagerUpsell } from "../../webview-ui/src/components/chat/agent-manager-upsell"
import { handleUpsellMessage } from "../../src/kilo-provider/upsell"

describe("Agent Manager upsell", () => {
  it("requires every display condition and keeps the development gate off", () => {
    const state = {
      enabled: true,
      sidebar: true,
      git: true,
      status: "idle",
      reason: "completed",
      files: 1,
      dismissed: false,
    }
    expect(AGENT_MANAGER_UPSELL).toBe(false)
    expect(showAgentManagerUpsell(state)).toBe(true)
    for (const change of [
      { enabled: false },
      { sidebar: false },
      { git: false },
      { status: "busy" },
      { reason: "error" },
      { reason: "interrupted" },
      { reason: "superseded" },
      { reason: undefined },
      { files: 0 },
      { files: undefined },
      { dismissed: true },
    ])
      expect(showAgentManagerUpsell({ ...state, ...change })).toBe(false)
  })

  it("persists dismissal and returns it on the next load", async () => {
    const values = new Map<string, unknown>()
    const state = {
      get: <T>(key: string, fallback: T): T => (values.get(key) as T | undefined) ?? fallback,
      update: async (key: string, value: boolean) => {
        values.set(key, value)
      },
    }
    const messages: unknown[] = []
    const post = (message: unknown) => {
      messages.push(message)
    }
    expect(await handleUpsellMessage("requestAgentManagerUpsell", state, post)).toBe(true)
    expect(messages.pop()).toEqual({ type: "agentManagerUpsellLoaded", dismissed: false })
    await handleUpsellMessage("dismissAgentManagerUpsell", state, post)
    expect(values.get("kilo.agentManagerUpsell.dismissed")).toBe(true)
    expect(messages.pop()).toEqual({ type: "agentManagerUpsellLoaded", dismissed: true })
    await handleUpsellMessage("requestAgentManagerUpsell", state, post)
    expect(messages.pop()).toEqual({ type: "agentManagerUpsellLoaded", dismissed: true })
    expect(await handleUpsellMessage("other", state, post)).toBe(false)
    expect(messages).toEqual([])
    await handleUpsellMessage("requestAgentManagerUpsell", undefined, post)
    expect(messages.pop()).toEqual({ type: "agentManagerUpsellLoaded", dismissed: true })
  })
})
