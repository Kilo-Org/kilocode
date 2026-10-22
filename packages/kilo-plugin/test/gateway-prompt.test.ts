import { describe, expect, test } from "bun:test"
import { SessionSystemPrompt } from "@opencode/core/session/system-prompt"
import ANTHROPIC from "../../core/src/plugin/system-prompt/anthropic.txt"
import ASTRA from "../../core/src/plugin/system-prompt/gpt-astra.txt"
import GPT from "../../core/src/plugin/system-prompt/gpt.txt"
import DEFAULT from "../../core/src/session/runner/prompt/system.txt"
import { GatewayPrompt } from "../src/gateway/prompt"

const directives = [
  ["codex", "# Editing and verification"],
  ["gemini", "# Gemini workflow"],
  ["beast", "# Persistence and research"],
  ["anthropic", "# Code comments"],
  ["trinity", "# Proactiveness"],
  ["anthropic_without_todo", "# Working in codebases"],
  ["ling", "# Ling workflow"],
  ["gpt55", "# Editing and verification"],
] as const

describe("GatewayPrompt", () => {
  test.each(directives)("renders the supported %s directive with native tool guidance", (prompt, marker) => {
    const text = GatewayPrompt.render({ id: "router", prompt }, ["shell", "write", "edit"])
    expect(text).toContain(marker)
    expect(text).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
    expect(text?.match(/Prefer dedicated tools over shell commands/g)).toHaveLength(1)
    expect(text).toContain("Use the write tool to create files")
    expect(text).toContain("Use the edit tool for targeted changes")
    expect(text).not.toContain("Use Bash")
    expect(text).not.toContain("TodoWrite")
  })

  test.each(directives)("lets explicit %s override the model ID and family", (prompt) => {
    expect(GatewayPrompt.render({ id: "claude-router", family: "GPT Gemini Ling", prompt }, [])).toBe(
      GatewayPrompt.render({ id: "router", prompt }, []),
    )
  })

  test("renders Claude aliases as generic plus the native Anthropic appendix exactly once", () => {
    const text = GatewayPrompt.render({ id: "router", family: "CLAUDE" }, ["shell", "edit"])
    expect(text).toBe(SessionSystemPrompt.render(`${DEFAULT}\n\n${ANTHROPIC}`, ["shell", "edit"]))
    expect(text?.match(/# Harness/g)).toHaveLength(1)
    expect(text?.match(/# Code comments/g)).toHaveLength(1)
    expect(text?.match(/Use the edit tool for targeted changes/g)).toHaveLength(1)
  })

  test("adds task tracking only for Anthropic when todowrite is available", () => {
    expect(GatewayPrompt.render({ id: "router", prompt: "anthropic" }, ["todowrite"])).toContain("# Task management")
    expect(GatewayPrompt.render({ id: "router", prompt: "anthropic" }, [])).not.toContain("# Task management")
    expect(GatewayPrompt.render({ id: "claude", prompt: "anthropic_without_todo" }, ["todowrite"])).toBe(
      SessionSystemPrompt.make(["todowrite"]),
    )
  })

  test("keeps the current native templates for equivalent model behavior", () => {
    expect(GatewayPrompt.render({ id: "router", prompt: "codex" }, [])).toStartWith(
      SessionSystemPrompt.render(ASTRA, []),
    )
    expect(GatewayPrompt.render({ id: "router", prompt: "gpt55" }, [])).toStartWith(
      SessionSystemPrompt.render(ASTRA, []),
    )
    expect(GatewayPrompt.render({ id: "router", prompt: "beast" }, [])).toStartWith(SessionSystemPrompt.render(GPT, []))
  })

  test("keeps explicit Trinity serial tooling and GPT55 proactive delegation", () => {
    const trinity = GatewayPrompt.render({ id: "router", prompt: "trinity" }, [])
    expect(trinity).toContain("Use exactly one tool call per assistant message")
    expect(trinity).not.toContain("Run independent tool calls in parallel")
    const gpt = GatewayPrompt.render({ id: "router", prompt: "gpt55" }, ["subagent"])
    expect(gpt).toContain("Use the subagent tool proactively")
    expect(gpt).not.toContain("Do not spawn subagents unless")
  })

  test("carries Gemini workflow and library checks without Anthropic guidance", () => {
    const text = GatewayPrompt.render({ id: "router", family: "claude", prompt: "gemini" }, [])
    expect(text).toContain("Verify that a library or framework is already used")
    expect(text).toContain("implement it, then verify behavior and project standards")
    expect(text).toContain("If asked how to do something, explain first")
    expect(text).toContain("get approval before implementation")
    expect(text).toContain("Use absolute paths for filesystem tool calls")
    expect(text).not.toContain("# Code comments")
  })

  test("carries Ling's planning, bugfix, and completion discipline", () => {
    const text = GatewayPrompt.render({ id: "router", family: "gpt", prompt: "ling" }, [])
    expect(text).toContain("list a short sequence of implementation steps")
    expect(text).toContain("state the root cause before editing")
    expect(text).toContain("Do not add code comments unless asked")
    expect(text).toContain("at most two final verification checks")
    expect(text).toContain("report the conclusion in text and stop calling tools")
    expect(text).toContain("Prefer parallelizing independent tool calls")
    expect(text).not.toContain("# Intermediate Commentary")
  })

  test("uses family fallbacks without requiring a recognizable router ID", () => {
    expect(GatewayPrompt.render({ id: "router", family: "gpt-astra" }, [])).toStartWith(
      SessionSystemPrompt.render(ASTRA, []),
    )
    expect(GatewayPrompt.render({ id: "router", family: "gemini" }, [])).toContain("# Gemini workflow")
    expect(GatewayPrompt.render({ id: "router", family: "Ling-2.6" }, [])).toContain("# Ling workflow")
    expect(GatewayPrompt.render({ id: "kling-video" }, [])).toBeUndefined()
    expect(GatewayPrompt.render({ id: "unknown" }, [])).toBeUndefined()
  })

  test("does not invent guidance for unavailable tools", () => {
    const text = GatewayPrompt.render({ id: "router", prompt: "gemini" }, [])
    expect(text).not.toContain("${OPENCODE_TOOL_GUIDANCE}")
    expect(text).not.toContain("Use the write tool")
    expect(text).not.toContain("Use the edit tool")
    expect(text).not.toContain("Prefer dedicated tools over shell commands")
  })
})
