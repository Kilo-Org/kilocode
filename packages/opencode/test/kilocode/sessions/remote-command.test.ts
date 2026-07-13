import { describe, expect, test } from "bun:test"
import { RemoteCommand } from "../../../src/kilo-sessions/remote-command"
import type { Info as SessionInfo } from "../../../src/session/session"
import { SessionID } from "../../../src/session/schema"

describe("RemoteCommand", () => {
  test("validates list command protocol requests", () => {
    expect(RemoteCommand.ListRequest.safeParse({ protocolVersion: 1 }).success).toBe(true)
    expect(RemoteCommand.ListRequest.safeParse({ protocolVersion: 2 }).success).toBe(false)
    expect(RemoteCommand.ListRequest.safeParse({ protocolVersion: 1, extra: true }).success).toBe(false)
  })

  test("validates structured command requests without duplicating session identity", () => {
    const valid = {
      protocolVersion: 1 as const,
      command: "review",
      arguments: "  main\nkeep spacing  ",
      messageID: "msg_remote",
      model: { providerID: "kilo", modelID: "anthropic/claude-sonnet-4" },
      variant: "high",
    }

    expect(RemoteCommand.SendRequest.parse(valid)).toEqual(valid)
    expect(RemoteCommand.SendRequest.safeParse({ ...valid, protocolVersion: 2 }).success).toBe(false)
    expect(RemoteCommand.SendRequest.safeParse({ ...valid, sessionID: "ses_duplicate" }).success).toBe(false)
    expect(RemoteCommand.SendRequest.safeParse({ ...valid, messageID: "bad" }).success).toBe(false)
    expect(
      RemoteCommand.SendRequest.safeParse({ ...valid, arguments: "x".repeat(RemoteCommand.MAX_ARGUMENTS_LENGTH + 1) })
        .success,
    ).toBe(false)
    expect(
      RemoteCommand.SendRequest.safeParse({ ...valid, messageID: "msg" + "x".repeat(RemoteCommand.MAX_STRING_LENGTH) })
        .success,
    ).toBe(false)
  })

  test("builds an allowlisted command catalog", () => {
    const catalog = RemoteCommand.build([
      {
        name: "review",
        description: "Review changes",
        agent: "reviewer",
        model: "kilo/review-model",
        source: "command",
        hints: ["$ARGUMENTS"],
        subtask: true,
        template: "must-not-leak",
      },
      {
        name: "alpha",
        description: "MCP prompt",
        source: "mcp",
        hints: ["$1"],
        get template(): string {
          throw new Error("template must not be read")
        },
      },
      {
        name: "secret-skill",
        description: "Skill",
        source: "skill",
        hints: [],
        template: "must-not-leak",
      },
      {
        name: "review",
        description: "Duplicate",
        source: "mcp",
        hints: [],
        template: "must-not-leak",
      },
    ])

    expect(catalog).toEqual({
      protocolVersion: 1,
      commands: [
        {
          name: "alpha",
          description: "MCP prompt",
          source: "mcp",
          hints: ["$1"],
        },
        {
          name: "compact",
          description: "compact the current session context",
          hints: [],
        },
        {
          name: "review",
          description: "Review changes",
          agent: "reviewer",
          model: "kilo/review-model",
          source: "command",
          hints: ["$ARGUMENTS"],
          subtask: true,
        },
      ],
    })
    expect(JSON.stringify(catalog)).not.toContain("template")
    expect(JSON.stringify(catalog)).not.toContain("secret-skill")
  })

  test("truncates catalogs over the command limit", () => {
    const commands = Array.from({ length: RemoteCommand.MAX_COMMANDS + 10 }, (_, index) => ({
      name: `command-${String(index).padStart(3, "0")}`,
      source: "command" as const,
      hints: [],
      template: "hidden",
    }))

    const catalog = RemoteCommand.build(commands)
    expect(catalog.commands).toHaveLength(RemoteCommand.MAX_COMMANDS)
    expect(catalog.commands[0]?.name).toBe("command-000")
    expect(catalog.commands.some((item) => item.name === "compact")).toBe(true)
  })

  test("skips entries over the per-field caps instead of failing the catalog", () => {
    const catalog = RemoteCommand.build([
      {
        name: "x".repeat(RemoteCommand.MAX_STRING_LENGTH + 1),
        source: "command",
        hints: [],
        template: "hidden",
      },
      {
        name: "too-many-hints",
        source: "command",
        hints: Array.from({ length: RemoteCommand.MAX_HINTS + 1 }, () => "$ARGUMENTS"),
        template: "hidden",
      },
      {
        name: "review",
        source: "command",
        hints: ["$ARGUMENTS"],
        template: "hidden",
      },
    ])

    expect(catalog.commands.map((item) => item.name)).toEqual(["compact", "review"])
  })

  test("truncates to the serialized catalog limit measured in UTF-8 bytes", () => {
    const commands = Array.from({ length: RemoteCommand.MAX_COMMANDS - 1 }, (_, index) => ({
      name: `command-${index}`,
      description: "🧪".repeat(900),
      source: "command" as const,
      hints: [],
      template: "hidden",
    }))

    const catalog = RemoteCommand.build(commands)
    expect(catalog.commands.length).toBeGreaterThan(0)
    expect(catalog.commands.length).toBeLessThan(commands.length)
    expect(catalog.commands.some((item) => item.name === "compact")).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(catalog)).byteLength).toBeLessThanOrEqual(
      RemoteCommand.MAX_RESULT_BYTES,
    )
  })

  test("executes registered commands with verbatim structured input", async () => {
    const calls: unknown[] = []
    const remote = RemoteCommand.create({
      list: async () => [],
      command: async (input) => {
        calls.push(input)
      },
      session: {
        get: async () => {
          throw new Error("unexpected session lookup")
        },
        messages: async () => {
          throw new Error("unexpected message lookup")
        },
      },
      agent: { default: async () => "unexpected-agent" },
      provider: { default: async () => ({ providerID: "unexpected", modelID: "unexpected" }) },
      revert: { cleanup: async () => {} },
      compaction: { create: async () => {} },
      prompt: { loop: async () => {} },
    })

    await remote.execute({
      sessionID: SessionID.make("ses_remote"),
      protocolVersion: 1,
      command: "review",
      arguments: "  main\nkeep spacing  ",
      messageID: "msg_remote",
      model: { providerID: "custom:edge", modelID: "deployment/model" },
      variant: "high",
    })

    expect(calls).toEqual([
      {
        sessionID: SessionID.make("ses_remote"),
        command: "review",
        arguments: "  main\nkeep spacing  ",
        messageID: "msg_remote",
        model: "custom:edge/deployment/model",
        variant: "high",
      },
    ])
  })

  test("lets a registered compact command shadow the built-in", async () => {
    const calls: unknown[] = []
    const remote = RemoteCommand.create({
      list: async () => [{ name: "compact", source: "command", hints: [], template: "custom compact" }],
      command: async (input) => {
        calls.push(input)
      },
      session: {
        get: async () => {
          throw new Error("unexpected session lookup")
        },
        messages: async () => {
          throw new Error("unexpected message lookup")
        },
      },
      agent: { default: async () => "unexpected-agent" },
      provider: { default: async () => ({ providerID: "unexpected", modelID: "unexpected" }) },
      revert: { cleanup: async () => {} },
      compaction: {
        create: async () => {
          throw new Error("unexpected built-in compaction")
        },
      },
      prompt: { loop: async () => {} },
    })

    await remote.execute({
      sessionID: SessionID.make("ses_remote"),
      protocolVersion: 1,
      command: "compact",
      arguments: "",
    })

    expect(calls).toEqual([
      {
        sessionID: SessionID.make("ses_remote"),
        command: "compact",
        arguments: "",
      },
    ])
  })

  test("falls back to built-in compact when a registered compact fails catalog validation", async () => {
    const steps: unknown[] = []
    const session = {
      id: SessionID.make("ses_remote"),
      agent: "session-agent",
      model: { providerID: "session-provider", id: "session-model" },
    } as SessionInfo
    const remote = RemoteCommand.create({
      list: async () => [
        {
          name: "compact",
          description: "x".repeat(RemoteCommand.MAX_STRING_LENGTH + 1),
          source: "command",
          hints: [],
          template: "malformed compact",
        },
      ],
      command: async () => {
        throw new Error("unexpected registered command")
      },
      session: {
        get: async () => {
          steps.push("get")
          return session
        },
        messages: async () => {
          steps.push("messages")
          return []
        },
      },
      agent: { default: async () => "default-agent" },
      provider: { default: async () => ({ providerID: "default-provider", modelID: "default-model" }) },
      revert: {
        cleanup: async () => {
          steps.push("cleanup")
        },
      },
      compaction: {
        create: async () => {
          steps.push("create")
        },
      },
      prompt: {
        loop: async () => {
          steps.push("loop")
        },
      },
    })

    const catalog = RemoteCommand.build([
      {
        name: "compact",
        description: "x".repeat(RemoteCommand.MAX_STRING_LENGTH + 1),
        source: "command",
        hints: [],
        template: "malformed compact",
      },
    ])
    expect(catalog.commands.some((item) => item.name === "compact")).toBe(true)

    await remote.execute({
      sessionID: SessionID.make("ses_remote"),
      protocolVersion: 1,
      command: "compact",
      arguments: "",
    })

    expect(steps).toEqual(["get", "cleanup", "messages", "create", "loop"])
  })

  test("executes compact through cleanup, compaction, and prompt loop", async () => {
    const steps: unknown[] = []
    const session = {
      id: SessionID.make("ses_remote"),
      agent: "session-agent",
      model: { providerID: "session-provider", id: "session-model" },
    } as SessionInfo
    const remote = RemoteCommand.create({
      list: async () => [],
      command: async () => {
        throw new Error("unexpected registered command")
      },
      session: {
        get: async () => {
          steps.push("get")
          return session
        },
        messages: async () => {
          steps.push("messages")
          return []
        },
      },
      agent: { default: async () => "default-agent" },
      provider: { default: async () => ({ providerID: "default-provider", modelID: "default-model" }) },
      revert: {
        cleanup: async (info) => {
          steps.push(["cleanup", info.id])
        },
      },
      compaction: {
        create: async (input) => {
          steps.push(["create", input])
        },
      },
      prompt: {
        loop: async (sessionID) => {
          steps.push(["loop", sessionID])
        },
      },
    })

    await remote.execute({
      sessionID: SessionID.make("ses_remote"),
      protocolVersion: 1,
      command: "compact",
      arguments: "",
      model: { providerID: "request-provider", modelID: "request-model" },
    })

    expect(steps).toEqual([
      "get",
      ["cleanup", SessionID.make("ses_remote")],
      "messages",
      [
        "create",
        {
          sessionID: SessionID.make("ses_remote"),
          agent: "session-agent",
          model: { providerID: "request-provider", modelID: "request-model" },
          auto: false,
        },
      ],
      ["loop", SessionID.make("ses_remote")],
    ])
  })
})
