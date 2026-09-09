import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Agent } from "../../src/agent/agent"
import { processConfigItem } from "../../src/kilocode/agent"
import { testEffect } from "../lib/effect"

const it = testEffect(AppNodeBuilder.build(Agent.node))

it.instance("default Explore description explains its Bash limits", () =>
  Effect.gen(function* () {
    const svc = yield* Agent.Service
    const agent = yield* svc.get("explore")
    expect(agent.description).toContain("Fast agent specialized for exploring codebases.")
    expect(agent.description).toContain("Bash is limited to an allowlist of read-only commands.")
    expect(agent.description).toContain(
      "For required scripts, tests, or binary-analysis commands outside that allowlist, select an available agent whose permissions allow them while preserving the requested no-change scope.",
    )
  }),
)

it.instance(
  "explicit Explore description overrides the default capability description",
  () =>
    Effect.gen(function* () {
      const svc = yield* Agent.Service
      const agent = yield* svc.get("explore")
      expect(agent.description).toBe("Custom Explore description")
    }),
  {
    config: {
      agent: {
        explore: { description: "Custom Explore description" },
      },
    },
  },
)

describe("processConfigItem", () => {
  test("lifts legacy options-based metadata to typed fields and strips it", () => {
    const item: { options: Record<string, unknown>; displayName?: string; source?: string } = {
      options: { displayName: "Code Reviewer", source: "organization", reasoningEffort: "high" },
    }
    processConfigItem(item)
    expect(item.displayName).toBe("Code Reviewer")
    expect(item.source).toBe("organization")
    // metadata removed from options, genuine provider options preserved
    expect(item.options).toEqual({ reasoningEffort: "high" })
  })

  test("does not overwrite metadata already set as typed fields", () => {
    const item: { options: Record<string, unknown>; displayName?: string; source?: string } = {
      displayName: "Typed Name",
      source: "organization",
      options: { displayName: "Legacy Name", source: "global" },
    }
    processConfigItem(item)
    expect(item.displayName).toBe("Typed Name")
    expect(item.source).toBe("organization")
    expect(item.options).toEqual({})
  })
})
