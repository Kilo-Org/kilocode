import { describe, expect, it } from "bun:test"
import { createRoot, createSignal } from "solid-js"
import { useGoalComposer } from "../../webview-ui/src/components/chat/goal/useGoalComposer"

describe("goal composer", () => {
  it.each(["accepted", "rejected", "changed"])("preserves submission ownership when %s", (result) => {
    createRoot((dispose) => {
      const [key, setKey] = createSignal("pending:first")
      const sent: Parameters<Parameters<typeof useGoalComposer>[1]["send"]>[] = []
      const cleared: string[] = []
      const goal = useGoalComposer(key, {
        send: (...args) => {
          sent.push(args)
          return result !== "rejected"
        },
        fingerprint: () => (result === "changed" ? "edited" : "draft"),
        clear: (scope) => cleared.push(scope),
      })
      let resets = 0
      expect(goal.prepare("/goal", () => resets++)).toBe(false)
      expect(resets).toBe(1)
      expect(goal.active()).toBe(true)
      expect(goal.prepare("pause", () => resets++)).toBe(true)
      const files = [{ type: "file" as const, mime: "text/plain", url: "data:text/plain,context" }]
      goal.send("other", "draft", ["goal", "-- pause"])
      expect(sent).toHaveLength(0)
      goal.send(key(), "draft", ["goal", "-- pause", "provider", "model", files, "draft-id", "context", null])
      expect(sent).toHaveLength(1)
      expect(sent.at(0)?.slice(0, 8)).toEqual([
        "goal",
        "-- pause",
        "provider",
        "model",
        files,
        "draft-id",
        "context",
        null,
      ])
      const id = sent.at(0)?.[8]
      if (!id?.messageID) throw new Error("Missing message ID")
      expect(goal.pending()).toBe(result !== "rejected")
      goal.move(key(), "session:first")
      setKey("session:first")
      goal.finish(id.messageID, true)
      expect(goal.pending()).toBe(false)
      expect(goal.active()).toBe(result === "rejected")
      expect(cleared).toEqual(result === "accepted" ? ["session:first"] : [])
      dispose()
    })
  })

  it("keeps goal mode on failure and exits only on its successful acknowledgement", () => {
    createRoot((dispose) => {
      const goal = useGoalComposer(() => "session:first", {
        send: () => true,
        fingerprint: () => "draft",
        clear: () => {
          throw new Error("No submitted draft to clear")
        },
      })
      goal.activate()
      expect(goal.ready("")).toBe(false)
      expect(goal.ready(" \n ")).toBe(false)
      expect(goal.ready("pause")).toBe(true)
      expect(goal.ready("First step\n\nSecond step")).toBe(true)
      goal.begin("request:first", "session:first")
      expect(goal.pending()).toBe(true)
      expect(goal.finish("other", true)).toBeUndefined()
      expect(goal.active()).toBe(true)
      expect(goal.finish("request:first", false)).toBe("session:first")
      expect(goal.active()).toBe(true)
      expect(goal.pending()).toBe(false)
      goal.begin("request:second", "session:first")
      expect(goal.finish("request:second", true)).toBe("session:first")
      expect(goal.active()).toBe(false)
      dispose()
    })
  })

  it("scopes mode and pending sends to their draft, including session creation", () => {
    createRoot((dispose) => {
      const [key, setKey] = createSignal("pending:first")
      const goal = useGoalComposer(key, {
        send: () => true,
        fingerprint: () => "draft",
        clear: () => {
          throw new Error("No submitted draft to clear")
        },
      })
      goal.activate()
      goal.begin("request", key())
      goal.move(key(), "session:first")
      setKey("session:first")
      expect(goal.active()).toBe(true)
      expect(goal.pending()).toBe(true)
      setKey("session:second")
      expect(goal.active()).toBe(false)
      expect(goal.pending()).toBe(false)
      goal.activate()
      expect(goal.finish("request", true)).toBe("session:first")
      expect(goal.active()).toBe(true)
      goal.cancel()
      expect(goal.active()).toBe(false)
      expect(goal.ready("")).toBe(true)
      dispose()
    })
  })
})
