// kilocode_change - new file: covers configuration recovery for invalid values
import { describe, expect } from "bun:test"
import { Effect, Layer } from "effect"
import { type ParseError, parse } from "jsonc-parser"
import { Config } from "@opencode-ai/core/config"
import { ConfigRecover } from "@opencode-ai/core/config/recover"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)

describe("ConfigRecover", () => {
  it.effect("keeps valid settings when one top-level value is invalid", () =>
    Effect.sync(() => {
      const result = ConfigRecover.recover(Config.Info, {
        model: "openrouter/openai/gpt-5",
        share: "sometimes",
        autoupdate: "sure",
      })
      if (result.type !== "recovered") throw new Error("expected the document to keep its valid settings")
      expect(result.value.model).toBe("openrouter/openai/gpt-5")
      expect(result.value.share).toBeUndefined()
      expect(result.value.autoupdate).toBeUndefined()
      expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(["$.share", "$.autoupdate"])
    }),
  )

  it.effect("drops only the invalid agent field and keeps its permissions", () =>
    Effect.sync(() => {
      const result = ConfigRecover.recover(Config.Info, {
        agents: {
          reviewer: {
            description: "reviews changes",
            steps: "twelve",
            permissions: [{ action: "edit", resource: "*", effect: "deny" }],
          },
          other: { description: "unaffected" },
        },
      })
      if (result.type !== "recovered") throw new Error("expected the agent map to survive")
      expect(result.value.agents?.reviewer?.steps).toBeUndefined()
      expect(result.value.agents?.reviewer?.description).toBe("reviews changes")
      expect(result.value.agents?.reviewer?.permissions).toEqual([{ action: "edit", resource: "*", effect: "deny" }])
      expect(result.value.agents?.other?.description).toBe("unaffected")
      expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(["$.agents.reviewer.steps"])
    }),
  )

  it.effect("keeps the valid rules beside an invalid rule and an invalid policy", () =>
    Effect.sync(() => {
      const result = ConfigRecover.recover(Config.Info, {
        permissions: [
          { action: "bash", resource: "git push*", effect: "deny" },
          { action: "bash", resource: 2, effect: "deny" },
          { action: "read", resource: "*", effect: "ask" },
        ],
        experimental: {
          policies: [
            { effect: "deny", action: "provider.use", resource: "openai" },
            { effect: "maybe", action: "provider.use", resource: "anthropic" },
          ],
        },
      })
      if (result.type !== "recovered") throw new Error("expected the rules to survive")
      expect(result.value.permissions).toEqual([
        { action: "bash", resource: "git push*", effect: "deny" },
        { action: "read", resource: "*", effect: "ask" },
      ])
      expect(result.value.experimental?.policies).toEqual([
        { effect: "deny", action: "provider.use", resource: "openai" },
      ])
      expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual([
        "$.permissions[1]",
        "$.experimental.policies[1]",
      ])
    }),
  )

  it.effect("reports one diagnostic per dropped entry across nested fields", () =>
    Effect.sync(() => {
      const result = ConfigRecover.recover(Config.Info, {
        agents: { a: { steps: "twelve" }, b: { steps: "thirteen" } },
        skills: ["./skills", 7],
      })
      if (result.type !== "recovered") throw new Error("expected the document to survive")
      expect(result.value.agents).toEqual({})
      expect(result.value.skills).toEqual(["./skills"])
      expect(result.diagnostics.map((diagnostic) => diagnostic.path).toSorted()).toEqual([
        "$.agents.a.steps",
        "$.agents.b.steps",
        "$.skills[1]",
      ])
    }),
  )

  it.effect("rejects a document whose root is not an object", () =>
    Effect.sync(() => {
      expect(ConfigRecover.recover(Config.Info, [1, 2]).type).toBe("rejected")
      expect(ConfigRecover.recover(Config.Info, null).type).toBe("rejected")
      expect(ConfigRecover.recover(Config.Info, "text").type).toBe("rejected")
    }),
  )

  it.effect("loads a document with every setting dropped as an empty configuration", () =>
    Effect.sync(() => {
      const result = ConfigRecover.recover(Config.Info, { share: "sometimes" })
      if (result.type !== "recovered") throw new Error("expected an empty configuration")
      expect(result.value.share).toBeUndefined()
      expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toEqual(["$.share"])
    }),
  )

  it.effect("leaves a valid document and its input untouched", () =>
    Effect.sync(() => {
      const input = { share: "manual", permissions: [{ action: "bash", resource: "*", effect: "deny" }] }
      const result = ConfigRecover.recover(Config.Info, input)
      if (result.type !== "recovered") throw new Error("expected the document to load")
      expect(result.diagnostics).toEqual([])
      expect(result.value.share).toBe("manual")
      expect(input.share).toBe("manual")
      expect(input.permissions).toHaveLength(1)
    }),
  )

  it.effect("describes a JSON syntax error with its line and column", () =>
    Effect.sync(() => {
      const text = '{\n  "share": "manual",\n  "model":\n}'
      const errors: ParseError[] = []
      parse(text, errors, { allowTrailingComma: true })
      expect(errors.length).toBeGreaterThan(0)
      const diagnostics = ConfigRecover.syntax(text, errors)
      expect(diagnostics).toHaveLength(errors.length)
      expect(diagnostics.every((diagnostic) => diagnostic.path === "$")).toBe(true)
      expect(diagnostics[0]?.message).toContain("line 4, column 1")
    }),
  )
})
