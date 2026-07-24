import { describe, expect, test } from "bun:test"
import { RemoteCommand } from "../../../src/kilo-sessions/remote-command"
import { RemoteExit } from "../../../src/kilo-sessions/remote-exit"
import type { Info as SessionInfo } from "../../../src/session/session"
import { MessageV2 } from "../../../src/session/message-v2"
import { MessageID, SessionID } from "../../../src/session/schema"

describe("RemoteCommand", () => {
  test("validates list command protocol requests", () => {
    expect(RemoteCommand.ListRequest.safeParse({ protocolVersion: 1 }).success).toBe(true)
    expect(RemoteCommand.ListRequest.safeParse({ protocolVersion: 2 }).success).toBe(false)
    expect(RemoteCommand.ListRequest.safeParse({ protocolVersion: 1, extra: true }).success).toBe(false)
  })

  test("validates strict exit CLI requests", () => {
    expect(RemoteCommand.ExitRequest.safeParse({ protocolVersion: 1 }).success).toBe(true)
    expect(RemoteCommand.ExitRequest.safeParse({}).success).toBe(false)
    expect(RemoteCommand.ExitRequest.safeParse({ protocolVersion: 2 }).success).toBe(false)
    expect(RemoteCommand.ExitRequest.safeParse({ protocolVersion: 1, extra: true }).success).toBe(false)
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
      canExitSession: true,
    })
    expect(JSON.stringify(catalog)).not.toContain("template")
    expect(JSON.stringify(catalog)).not.toContain("secret-skill")
  })

  test("advertises only canonical exit while the embedded worker callback is registered", () => {
    const base = RemoteCommand.build([
      { name: "beta", source: "command", hints: [], template: "beta" },
      { name: "alpha", source: "command", hints: [], template: "alpha" },
    ])
    expect(base.commands.map((item) => item.name)).toEqual(["alpha", "beta", "compact"])
    // kilocode_change - K1 W1: canExitSession is always true, independent of
    // exitAvailable (which gates the synthetic `/exit` entry).
    expect(base.canExitSession).toBe(true)

    const catalog = RemoteCommand.build(
      [
        ...base.commands.map((item) => ({ ...item, template: item.name })),
        { name: "exit", source: "command", hints: ["must-not-leak"], template: "must-not-run" },
      ],
      true,
    )

    expect(catalog.commands).toEqual([
      { name: "alpha", source: "command", hints: [] },
      { name: "beta", source: "command", hints: [] },
      {
        name: "compact",
        description: "compact the current session context",
        hints: [],
      },
      {
        name: "exit",
        description: "Exit the CLI",
        hints: [],
      },
    ])
    expect(catalog.commands.some((item) => item.name === "quit" || item.name === "q")).toBe(false)

    expect(RemoteCommand.build([]).commands.map((item) => item.name)).toEqual(["compact"])
  })

  test("catalog omits exit until the embedded worker TUI is ready", async () => {
    const remote = RemoteCommand.create({
      exitAvailable: () => !!RemoteExit.get(),
      list: async () => [],
      command: async () => {},
      session: { get: async () => null as never, messages: async () => [] },
      agent: { default: async () => "test" },
      provider: { default: async () => ({ providerID: "test", modelID: "test" }) },
      revert: { cleanup: async () => {} },
      compaction: { create: async () => {} },
      prompt: { loop: async () => {} },
    })
    // kilocode_change - K1 W1: canExitSession is true even when the synthetic
    // `/exit` entry is absent (e.g. a headless `kilo remote` host has no
    // RemoteExit callback, so `/exit` is gated off — but the host still
    // interprets `exit_cli` as session-detach).
    const baseList = await remote.list()
    expect(baseList.canExitSession).toBe(true)
    expect(baseList.commands.some((item) => item.name === "exit")).toBe(false)

    const unregister = RemoteExit.register(async () => {})
    try {
      const list = await remote.list()
      expect(list.commands.some((item) => item.name === "exit")).toBe(true)
      expect(list.canExitSession).toBe(true)
    } finally {
      unregister()
    }

    const after = await remote.list()
    expect(after.commands.some((item) => item.name === "exit")).toBe(false)
    expect(after.canExitSession).toBe(true)
  })

  test("keeps compact and exit within command and byte caps", () => {
    const commands = Array.from({ length: RemoteCommand.MAX_COMMANDS + 10 }, (_, index) => ({
      name: `command-${String(index).padStart(3, "0")}`,
      description: "x".repeat(1_900),
      source: "command" as const,
      hints: [],
      template: "hidden",
    }))
    const catalog = RemoteCommand.build(commands, true)

    expect(catalog.commands).toHaveLength(RemoteCommand.MAX_COMMANDS)
    expect(catalog.commands.some((item) => item.name === "compact")).toBe(true)
    expect(catalog.commands.some((item) => item.name === "exit")).toBe(true)
    expect(new TextEncoder().encode(JSON.stringify(catalog)).byteLength).toBeLessThanOrEqual(
      RemoteCommand.MAX_RESULT_BYTES,
    )
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
      catalog: { protocolVersion: 1, commands: [{ name: "review", hints: [] }] },
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
      catalog: { protocolVersion: 1, commands: [{ name: "compact", source: "command", hints: [] }] },
    })

    expect(calls).toEqual([
      {
        sessionID: SessionID.make("ses_remote"),
        command: "compact",
        arguments: "",
      },
    ])
  })

  test("a registered compact in the preflight catalog shadows the built-in", async () => {
    const calls: unknown[] = []
    const steps: unknown[] = []
    const session = {
      id: SessionID.make("ses_remote"),
      agent: "session-agent",
      model: { providerID: "session-provider", id: "session-model" },
    } as SessionInfo
    const remote = RemoteCommand.create({
      list: async () => [],
      command: async (input) => {
        calls.push(input)
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
      agent: { default: async () => "unexpected-agent" },
      provider: { default: async () => ({ providerID: "unexpected", modelID: "unexpected" }) },
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
        source: "command",
        hints: [],
        template: "custom compact",
      },
    ])
    expect(catalog.commands.some((item) => item.name === "compact")).toBe(true)

    await remote.execute({
      sessionID: SessionID.make("ses_remote"),
      protocolVersion: 1,
      command: "compact",
      arguments: "",
      catalog,
    })

    // No compact path steps were taken — the registered command was invoked instead.
    expect(steps).toEqual([])
    expect(calls).toEqual([
      {
        sessionID: SessionID.make("ses_remote"),
        command: "compact",
        arguments: "",
      },
    ])
  })

  test("a built-in compact in the preflight catalog falls back to the built-in path", async () => {
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

    // The preflight catalog contains only the synthesized built-in "compact" (no source).
    const catalog = RemoteCommand.build([])
    expect(catalog.commands.find((item) => item.name === "compact")).toEqual({
      name: "compact",
      description: "compact the current session context",
      hints: [],
    })

    await remote.execute({
      sessionID: SessionID.make("ses_remote"),
      protocolVersion: 1,
      command: "compact",
      arguments: "",
      catalog,
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
      catalog: { protocolVersion: 1, commands: [{ name: "compact", hints: [] }] },
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

  test("compact fallback uses the latest retained user message when no request or session overrides exist", async () => {
    const steps: unknown[] = []
    const session = {
      id: SessionID.make("ses_remote"),
      // No session.agent and no session.model
    } as unknown as SessionInfo
    // Typed retained-message fixture: every field the production
    // session.messages() / compaction.create() path reads is present and
    // matches MessageV2.WithParts. The Assistant entry exists only to
    // exercise the findLast(user) path; the latest User entry is the one
    // that must supply agent + model.
    const sid = SessionID.make("ses_remote")
    const retained: MessageV2.WithParts[] = [
      {
        info: {
          id: MessageID.make("msg_old"),
          role: "assistant",
          sessionID: sid,
          time: { created: 0 },
          parentID: MessageID.make("msg_root"),
          providerID: "user-provider" as never,
          modelID: "user-model" as never,
          mode: "primary",
          agent: "user-agent",
          path: { cwd: "/", root: "/" },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        },
        parts: [],
      },
      {
        info: {
          id: MessageID.make("msg_user"),
          role: "user",
          sessionID: sid,
          time: { created: 1 },
          agent: "user-agent",
          model: { providerID: "user-provider" as never, modelID: "user-model" as never },
        },
        parts: [],
      },
    ]
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
          return retained
        },
      },
      agent: { default: async () => "default-agent" },
      provider: { default: async () => ({ providerID: "default-provider", modelID: "default-model" }) },
      revert: { cleanup: async () => {} },
      compaction: {
        create: async (input) => {
          steps.push(["create", input])
        },
      },
      prompt: { loop: async () => {} },
    })

    await remote.execute({
      sessionID: SessionID.make("ses_remote"),
      protocolVersion: 1,
      command: "compact",
      arguments: "",
      catalog: { protocolVersion: 1, commands: [{ name: "compact", hints: [] }] },
    })

    expect(steps).toEqual([
      "get",
      "messages",
      [
        "create",
        {
          sessionID: SessionID.make("ses_remote"),
          agent: "user-agent",
          model: { providerID: "user-provider", modelID: "user-model" },
          auto: false,
        },
      ],
    ])
  })

  test("execute reuses the supplied catalog and never calls services.list() a second time", async () => {
    let listCalls = 0
    const list = async () => {
      listCalls++
      return []
    }
    const calls: unknown[] = []
    const remote = RemoteCommand.create({
      list,
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
      agent: { default: async () => "default-agent" },
      provider: { default: async () => ({ providerID: "default-provider", modelID: "default-model" }) },
      revert: { cleanup: async () => {} },
      compaction: { create: async () => {} },
      prompt: { loop: async () => {} },
    })

    const catalog: RemoteCommand.Response = {
      protocolVersion: 1,
      commands: [{ name: "review", hints: [] }],
    }

    await remote.execute({
      sessionID: SessionID.make("ses_remote"),
      protocolVersion: 1,
      command: "review",
      arguments: "",
      catalog,
    })

    expect(listCalls).toBe(0)
    expect(calls).toEqual([
      {
        sessionID: SessionID.make("ses_remote"),
        command: "review",
        arguments: "",
      },
    ])
  })

  // execute() is the last line of defense: even if a caller bypasses the
  // dispatcher's preflight, a command absent from the supplied bounded
  // catalog must never reach services.command().
  test("execute rejects commands absent from the supplied catalog before invoking services.command()", async () => {
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
      agent: { default: async () => "default-agent" },
      provider: { default: async () => ({ providerID: "default-provider", modelID: "default-model" }) },
      revert: { cleanup: async () => {} },
      compaction: { create: async () => {} },
      prompt: { loop: async () => {} },
    })

    const catalog: RemoteCommand.Response = {
      protocolVersion: 1,
      commands: [{ name: "review", hints: [] }],
    }

    await expect(
      remote.execute({
        sessionID: SessionID.make("ses_remote"),
        protocolVersion: 1,
        command: "missing",
        arguments: "",
        catalog,
      }),
    ).rejects.toThrow("unknown slash command: missing")
    expect(calls).toEqual([])
  })

  // Even when the catalog advertises "compact" (the synthesized built-in),
  // a name not in the catalog must still be rejected.
  test("execute rejects arbitrary names even when the catalog advertises built-in compact", async () => {
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
      agent: { default: async () => "default-agent" },
      provider: { default: async () => ({ providerID: "default-provider", modelID: "default-model" }) },
      revert: { cleanup: async () => {} },
      compaction: { create: async () => {} },
      prompt: { loop: async () => {} },
    })

    // Catalog seeded with just the built-in compact (no registered "compact"
    // with source=="command"|"mcp"), so the shadow check would fall back to
    // the built-in path for "compact". The interesting case is a different
    // unknown name — it must be rejected regardless.
    const catalog = RemoteCommand.build([])

    await expect(
      remote.execute({
        sessionID: SessionID.make("ses_remote"),
        protocolVersion: 1,
        command: "rm",
        arguments: "",
        catalog,
      }),
    ).rejects.toThrow("unknown slash command: rm")
    expect(calls).toEqual([])
  })
})
