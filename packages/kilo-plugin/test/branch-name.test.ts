import { describe, expect, test } from "bun:test"
import { Model } from "@opencode/schema/model"
import { Provider } from "@opencode/schema/provider"
import { Effect, Exit } from "effect"
import { BranchNameGenerate } from "../src/branch-name/generate"

const ref = Model.Ref.make({ providerID: Provider.ID.make("test"), id: Model.ID.make("test-small") })

function user(text: string) {
  return { type: "user", text }
}

describe("branch name generation helpers", () => {
  test("sanitizes model output into a safe branch segment", () => {
    expect(BranchNameGenerate.parse("fix-token-refresh-race")).toBe("fix-token-refresh-race")
    expect(BranchNameGenerate.parse("Fix OAuth / Token Refresh!")).toBe("fix-oauth-token-refresh")
    expect(BranchNameGenerate.parse("feature")).toBe("feature")
    expect(BranchNameGenerate.parse("null")).toBeNull()
    expect(BranchNameGenerate.parse("!!!")).toBeNull()
  })

  test("removes reasoning wrappers before parsing", () => {
    expect(BranchNameGenerate.parse("\u003cthink\u003eChoose a durable outcome\u003c/think\u003e\nadd-health-check-endpoint")).toBe(
      "add-health-check-endpoint",
    )
    expect(BranchNameGenerate.parse("\u003cTHINK\u003eChoose a durable outcome\u003c/THINK\u003e\nadd-health-check-endpoint")).toBe(
      "add-health-check-endpoint",
    )
  })

  test("uses recent real user messages and appends the pending prompt once", () => {
    const history = ["hi", "Can you inspect auth?"]
    expect(BranchNameGenerate.messages(history, "Fix the token refresh race")).toEqual([
      "hi",
      "Can you inspect auth?",
      "Fix the token refresh race",
    ])
    expect(BranchNameGenerate.messages([...history, "Fix the token refresh race"], "Fix the token refresh race")).toEqual([
      "hi",
      "Can you inspect auth?",
      "Fix the token refresh race",
    ])
    expect(BranchNameGenerate.messages([...history, "Fix   the token refresh race"], "Fix the token refresh race")).toEqual([
      "hi",
      "Can you inspect auth?",
      "Fix   the token refresh race",
    ])
  })

  test("ignores synthetic messages and keeps the latest four user messages", () => {
    const stored = [
      user("one"),
      { type: "synthetic", text: "internal" },
      user("two"),
      user("three"),
      user("four"),
      user("five"),
    ]
    expect(BranchNameGenerate.userMessages(stored)).toEqual(["one", "two", "three", "four", "five"])
    expect(BranchNameGenerate.messages(BranchNameGenerate.userMessages(stored), "six")).toEqual([
      "three",
      "four",
      "five",
      "six",
    ])
  })

  test("truncates large messages before generation", () => {
    const big = "x".repeat(2_000)

    expect(BranchNameGenerate.messages([big], big)).toEqual(["x".repeat(1_000)])
  })

  test("keeps the instructions in the system prompt and the messages in the user prompt", async () => {
    const calls: Array<{ prompt: string; system: string; temperature: number; model?: Model.Ref }> = []
    const branch = await Effect.runPromise(
      BranchNameGenerate.generate(
        { messages: ["Fix auth", "Add a test"], providerID: "test", modelID: "test-small" },
        {
          model: () => Effect.succeed(ref),
          text: (input) =>
            Effect.sync(() => {
              calls.push(input)
              return "fix-auth-flow"
            }),
        },
      ),
    )

    expect(branch).toBe("fix-auth-flow")
    expect(calls).toHaveLength(1)
    expect(calls[0]!.model).toEqual(ref)
    expect(calls[0]!.system).toContain("Generate a Git branch name")
    expect(calls[0]!.system).toContain("Return exactly one line")
    expect(calls[0]!.prompt).toBe("User messages, oldest to newest:\n\n1. Fix auth\n\n2. Add a test")
    expect(calls[0]!.prompt).not.toContain("Generate a Git branch name")
    expect(calls[0]!.temperature).toBe(0.1)
  })

  test("returns null without a model call when there is no user message", async () => {
    let called = false
    const branch = await Effect.runPromise(
      BranchNameGenerate.generate(
        { messages: [] },
        {
          model: () => Effect.succeed(ref),
          text: () => {
            called = true
            return Effect.succeed("unused")
          },
        },
      ),
    )

    expect(branch).toBeNull()
    expect(called).toBe(false)
  })

  test("returns null when generation fails", async () => {
    const branch = await Effect.runPromise(
      BranchNameGenerate.generate(
        { messages: ["Fix auth"] },
        {
          model: () => Effect.succeed(undefined),
          text: () => Effect.fail(new Error("provider unavailable")),
        },
      ),
    )

    expect(branch).toBeNull()
  })

  test("returns null when the model answers null", async () => {
    const exit = await Effect.runPromiseExit(
      BranchNameGenerate.generate(
        { messages: ["Fix auth"] },
        { model: () => Effect.succeed(undefined), text: () => Effect.succeed("null") },
      ),
    )

    expect(Exit.isSuccess(exit) && exit.value).toBeNull()
  })
})
