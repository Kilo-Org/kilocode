import { describe, expect, it } from "bun:test"
import { cacheReset, createCostNotices, noticeThreshold } from "../../webview-ui/src/context/cost-notice"
import type { ExtensionMessage, Part } from "../../webview-ui/src/types/messages"

const step = (id: string, cost: number, end: number) =>
  ({ id, type: "step-finish", messageID: "m", sessionID: "s", cost, time: { start: end, end } }) as unknown as Part

const update = (sessionID: string, part: Part) => ({ type: "partUpdated", sessionID, part }) as ExtensionMessage

const family = (id: string) => new Set([id, "child"])

describe("cacheReset", () => {
  const claude = { providerID: "kilo", modelID: "anthropic/claude-sonnet-4.6" }
  const gpt = { providerID: "kilo", modelID: "openai/gpt-5" }
  const base = { tokens: 200_000, price: 5, threshold: 1 }

  it("warns when the model changes and the resend reaches the threshold", () => {
    const hit = cacheReset({ ...base, last: { ...gpt }, next: claude })
    expect(hit).toEqual({ kind: "model", tokens: 200_000, cost: 1 })
    expect(cacheReset({ ...base, tokens: 100_000, last: gpt, next: claude })).toBeUndefined()
  })

  it("warns on a reasoning change only for Anthropic models", () => {
    expect(cacheReset({ ...base, last: { ...claude, variant: "high" }, next: claude, variant: "" })?.kind).toBe(
      "variant",
    )
    expect(cacheReset({ ...base, last: { ...gpt, variant: "high" }, next: gpt, variant: "low" })).toBeUndefined()
  })

  it("stays quiet without a change, a price, or a threshold", () => {
    expect(cacheReset({ ...base, last: claude, next: claude, variant: "" })).toBeUndefined()
    expect(cacheReset({ ...base, price: undefined, last: gpt, next: claude })).toBeUndefined()
    expect(cacheReset({ ...base, threshold: 0, last: gpt, next: claude })).toBeUndefined()
    expect(cacheReset({ ...base, next: claude })).toBeUndefined()
  })
})

describe("createCostNotices", () => {
  it("shows live requests at or above the threshold", () => {
    const notices = createCostNotices(() => 1, 100)
    notices.handle(update("root", step("a", 0.5, 200)))
    expect(notices.latest("root", family)).toBeUndefined()
    notices.handle(update("root", step("b", 1, 200)))
    expect(notices.latest("root", family)?.cost).toBe(1)
  })

  it("ignores history and a zero threshold", () => {
    const old = createCostNotices(() => 1, 100)
    old.handle(update("root", step("a", 3, 50)))
    expect(old.latest("root", family)).toBeUndefined()
    const off = createCostNotices(() => 0, 100)
    off.handle(update("root", step("a", 3, 200)))
    expect(off.latest("root", family)).toBeUndefined()
  })

  it("surfaces subagent requests in the parent and keeps dismissed notices hidden", () => {
    const notices = createCostNotices(() => 1, 100)
    notices.handle(update("child", step("a", 3, 200)))
    expect(notices.latest("root", family)?.sessionID).toBe("child")
    expect(notices.latest("other", (id) => new Set([id]))).toBeUndefined()
    notices.dismiss("a")
    notices.handle(update("child", step("a", 3, 200)))
    expect(notices.latest("root", family)).toBeUndefined()
  })

  it("falls back to the default threshold for invalid settings", () => {
    expect(noticeThreshold(undefined)).toBe(1)
    expect(noticeThreshold(-1)).toBe(1)
    expect(noticeThreshold(0)).toBe(0)
    expect(noticeThreshold(2.5)).toBe(2.5)
  })
})
