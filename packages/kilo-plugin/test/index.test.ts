import { expect, test } from "bun:test"
import { KiloPlugins, KiloPostPlugins } from "../src/index"

test("Gateway modes override built-in agents before config, and post-config steps keep policy, the ceiling, options and the free-tier filter", () => {
  expect(KiloPlugins.map((plugin) => plugin.id)).toEqual([
    "kilocode.handshake",
    "kilo.agent",
    "kilocode.plan",
    "kilocode.goal",
    "kilocode.request-identity",
    "kilocode.gateway",
    "kilocode.provider-usage",
    "kilocode.openai",
    "kilocode.marketplace",
    "kilocode.flow",
    "kilocode.session-sync",
    "kilocode.remote",
    "kilocode.skill",
    "kilocode.skill-config",
    "kilocode.agent",
    "kilocode.read",
    "kilocode.tool-todo",
    "kilocode.tool-write",
    "kilocode.tool-browser",
    "kilocode.tool-notebook",
    "kilocode.chart",
    "kilocode.commit-message",
    "kilocode.privacy",
    "kilocode.settings",
    "kilocode.branch-name",
    "kilocode.agent-manager",
    "kilocode.background-jobs",
    "kilocode.session-drain",
    "kilocode.retention",
    "kilocode.subagent-background",
    "kilocode.recall",
    "kilocode.indexing",
    "kilocode.pages",
    "kilocode.review",
    "kilocode.question",
    "kilocode.wakeup",
    "kilocode.board",
  ])
  expect(KiloPostPlugins.map((plugin) => plugin.id)).toEqual([
    "kilocode.gateway.policy",
    "kilo.agent.ceiling",
    "kilocode.gateway.options",
    "kilocode.gateway.opencode-free-tier",
    "kilocode.request-identity.referer",
    "kilocode.sandbox",
    "kilocode.soul",
  ])
  expect([...KiloPlugins, ...KiloPostPlugins].every((plugin) => typeof plugin.effect === "function")).toBe(true)
})
