// End to end: a model tool call goes through SessionTools.resolve, the security gate and the real
// shell / write tools. With Security Auto Mode on, a denied action never reaches the executor and the
// model receives a structured blocked result; with the flag off the historical behaviour is unchanged.
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { existsSync } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import type { Tool as AITool, ToolExecutionOptions } from "ai"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Global } from "@opencode-ai/core/global"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { Agent } from "@/agent/agent"
import { Bus } from "@/bus"
import { EventV2Bridge } from "@/event-v2-bridge"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceRef } from "@/effect/instance-ref"
import { Format } from "@/format"
import { LSP } from "@/lsp/lsp"
import * as ToolNetwork from "@/kilocode/sandbox/network"
import { MCP } from "@/mcp"
import { Permission } from "@/permission"
import { ProjectV2 } from "@opencode-ai/core/project"
import type { InstanceContext } from "@/project/instance-context"
import { Plugin } from "@/plugin"
import { MessageV2 } from "@/session/message-v2"
import { Session } from "@/session/session"
import { SessionTools } from "@/session/tools"
import { MessageID, SessionID } from "@/session/schema"
import { ShellTool } from "@/tool/shell"
import * as Tool from "@/tool/tool"
import { ToolRegistry } from "@/tool/registry"
import { Truncate } from "@/tool/truncate"
import { WriteTool } from "@/tool/write"
import { TestConfig } from "../../fixture/config"
import { tmpdirScoped } from "../../fixture/fixture"
import { ProviderTest } from "../../fake/provider"
import { testEffect } from "../../lib/effect"

const projectID = ProjectV2.ID.make("security-session-tools")
const sessionID = SessionID.make("ses_security-session-tools")
const model = ProviderTest.model()
const agent: Agent.Info = {
  name: "build",
  mode: "primary",
  permission: Permission.fromConfig({ "*": "allow", bash: { "*": "ask", "cat *": "allow", "echo *": "allow" } }),
  options: {},
}

function session(directory: string): Session.Info {
  return {
    id: sessionID,
    slug: "security-session-tools",
    projectID,
    directory,
    title: "Security Auto Mode",
    version: "test",
    time: { created: 0, updated: 0 },
  }
}

function message(ctx: InstanceContext): MessageV2.Assistant {
  return {
    id: MessageID.make("msg_security-session-tools"),
    role: "assistant",
    parentID: MessageID.make("msg_security-session-tools-parent"),
    sessionID,
    mode: "build",
    agent: agent.name,
    path: { cwd: ctx.directory, root: ctx.worktree },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: model.id,
    providerID: model.providerID,
    time: { created: 0 },
  }
}

function context(directory: string): InstanceContext {
  return {
    directory,
    worktree: directory,
    project: { id: projectID, worktree: directory, vcs: "git", time: { created: 0, updated: 0 }, sandboxes: [] },
  }
}

const approvals: Permission.AskInput[] = []
let enabled = false
const config = TestConfig.layer({
  get: () => Effect.succeed({}),
  getGlobal: () => Effect.succeed(enabled ? { experimental: { security_auto: true } } : {}),
})
const agents = Layer.mock(Agent.Service)({ get: () => Effect.succeed(agent) })
const sessions = Layer.mock(Session.Service)({ get: () => Effect.succeed(session(os.tmpdir())) })
const permission = Layer.mock(Permission.Service)({
  ask: (input) =>
    Effect.sync(() => {
      approvals.push(input)
      // Auto-approve everything: a blocked action must be blocked by the engine, not by the user.
      return { manual: false } as const
    }),
})
const plugin = Layer.mock(Plugin.Service)({ trigger: (_name, _input, output) => Effect.succeed(output) })
const mcp = Layer.mock(MCP.Service)({ tools: () => Effect.succeed({}), clients: () => Effect.succeed({}) })
const lsp = Layer.mock(LSP.Service)({ touchFile: () => Effect.void, diagnostics: () => Effect.succeed({}) })
const format = Layer.mock(Format.Service)({ file: () => Effect.succeed(false) })
const truncate = Layer.mock(Truncate.Service)({
  output: (text: string) => Effect.succeed({ content: text, truncated: false as const }),
  limits: () => Effect.succeed({ maxLines: Truncate.MAX_LINES, maxBytes: Truncate.MAX_BYTES }),
})
const base = Layer.mergeAll(
  config,
  agents,
  sessions,
  permission,
  plugin,
  mcp,
  lsp,
  format,
  truncate,
  Bus.layer,
  AppNodeBuilder.build(EventV2Bridge.node),
  AppNodeBuilder.build(Database.node),
  AppNodeBuilder.build(FSUtil.node),
  AppNodeBuilder.build(CrossSpawnSpawner.node),
  RuntimeFlags.layer(),
)
const registry = Layer.effect(
  ToolRegistry.Service,
  Effect.gen(function* () {
    const write = yield* WriteTool.pipe(Effect.flatMap(Tool.init))
    const shell = yield* ShellTool.pipe(Effect.flatMap(Tool.init))
    const list = [ToolNetwork.builtin(write), ToolNetwork.builtin(shell)]
    return ToolRegistry.Service.of({
      ids: () => Effect.succeed(list.map((item) => item.id)),
      all: () => Effect.succeed(list),
      named: () => Effect.die(new Error("named tools are not used by this test")),
      tools: () => Effect.succeed(list),
    })
  }),
).pipe(Layer.provideMerge(base))
const it = testEffect(registry)

function resolve(ctx: InstanceContext, metadataCalls: { toolCallID: string; value: Record<string, unknown> }[] = []) {
  return SessionTools.resolve({
    agent,
    model,
    session: session(ctx.directory),
    processor: {
      message: message(ctx),
      metadata: (toolCallID, value) => Effect.sync(() => void metadataCalls.push({ toolCallID, value })),
      completeToolCall: () => Effect.void,
    },
    bypassAgentCheck: false,
    messages: [],
    promptOps: {
      cancel: () => Effect.die(new Error("cancel is not used by this test")),
      resolvePromptParts: () => Effect.die(new Error("resolvePromptParts is not used by this test")),
      prompt: () => Effect.die(new Error("prompt is not used by this test")),
    },
    memoryCache: {},
  }).pipe(Effect.provideService(InstanceRef, ctx))
}

function call(tool: AITool, input: unknown, id: string) {
  const options: ToolExecutionOptions = { toolCallId: id, messages: [], abortSignal: new AbortController().signal }
  if (!tool.execute) return Effect.die(new Error("tool has no execute callback"))
  return Effect.tryPromise({
    try: () => Promise.resolve(tool.execute?.(input, options)) as Promise<Tool.ExecuteResult>,
    catch: (cause) => (cause instanceof Error ? cause : new Error(String(cause))),
  })
}

function fixture() {
  return Effect.gen(function* () {
    const root = yield* tmpdirScoped()
    const home = Global.Path.home
    const ws = path.join(root, "app")
    const ssh = path.join(home, ".ssh")
    yield* Effect.promise(() => fs.mkdir(path.join(ws, "build"), { recursive: true }))
    yield* Effect.promise(() => fs.mkdir(ssh, { recursive: true }))
    yield* Effect.promise(() => fs.writeFile(path.join(ssh, "id_rsa"), "PRIVATE KEY"))
    yield* Effect.promise(() => fs.writeFile(path.join(ws, "build", "out.js"), "x"))
    yield* Effect.addFinalizer(() => Effect.promise(() => fs.rm(ssh, { recursive: true, force: true })))
    return { ws, home, ssh }
  })
}

const shell = process.platform === "win32" ? it.live.skip : it.live

shell("DENY: a destructive shell command never reaches the executor and returns a blocked result", () =>
  Effect.gen(function* () {
    enabled = true
    approvals.length = 0
    const fix = yield* fixture()
    const metadata: { toolCallID: string; value: Record<string, unknown> }[] = []
    const tools = yield* resolve(context(fix.ws), metadata)
    const bash = tools["bash"]!

    const result = yield* call(bash, { command: `rm -rf ${fix.ssh}`, description: "wipe keys" }, "call_deny")
    expect(result.title).toBe("Blocked by security policy")
    expect(result.metadata).toMatchObject({
      security: { status: "blocked", decision: "deny", reasonCode: "SENSITIVE_WRITE" },
    })
    expect(existsSync(path.join(fix.ssh, "id_rsa"))).toBe(true)
    expect(approvals).toHaveLength(0)
    expect(
      metadata.some(
        (item) =>
          item.toolCallID === "call_deny" &&
          Object.keys((item.value.metadata as object | undefined) ?? {}).includes("security"),
      ),
    ).toBe(true)

    const read = yield* call(bash, { command: `cat ${fix.ssh}/id_rsa`, description: "read key" }, "call_read")
    expect(read.title).toBe("Blocked by security policy")
    expect(read.output).not.toContain("PRIVATE KEY")
    expect(approvals).toHaveLength(0)

    const nested = yield* call(bash, { command: `bash -c "rm -rf ${fix.ssh}"`, description: "nested" }, "call_nested")
    expect(nested.title).toBe("Blocked by security policy")
    expect(existsSync(path.join(fix.ssh, "id_rsa"))).toBe(true)

    const config = yield* call(
      bash,
      { command: `echo '{"permission":{"*":"allow"}}' > ${Global.Path.config}/kilo.json`, description: "tamper" },
      "call_tamper",
    )
    expect(config.title).toBe("Blocked by security policy")
    expect(config.metadata).toMatchObject({ security: { reasonCode: "POLICY_TAMPERING" } })
    expect(existsSync(path.join(Global.Path.config, "kilo.json"))).toBe(false)
  }),
)

shell("ALLOW: a workspace action runs and the auto-approval carries security provenance", () =>
  Effect.gen(function* () {
    enabled = true
    approvals.length = 0
    const fix = yield* fixture()
    const metadata: { toolCallID: string; value: Record<string, unknown> }[] = []
    const tools = yield* resolve(context(fix.ws), metadata)
    const bash = tools["bash"]!

    const result = yield* call(bash, { command: "rm -rf build && echo done", description: "clean" }, "call_allow")
    expect(result.title).not.toBe("Blocked by security policy")
    expect(result.output).toContain("done")
    expect(existsSync(path.join(fix.ws, "build"))).toBe(false)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.ruleset.at(-1)).toMatchObject({ permission: "bash", action: "allow", source: "security" })
  }),
)

shell("file tools: a write into a credential store is blocked, a workspace write proceeds", () =>
  Effect.gen(function* () {
    enabled = true
    approvals.length = 0
    const fix = yield* fixture()
    const tools = yield* resolve(context(fix.ws))
    const write = tools["write"]!

    const blocked = yield* call(
      write,
      { filePath: path.join(fix.ssh, "authorized_keys"), content: "ssh-rsa attacker" },
      "call_write_deny",
    )
    expect(blocked.title).toBe("Blocked by security policy")
    expect(existsSync(path.join(fix.ssh, "authorized_keys"))).toBe(false)
    expect(approvals).toHaveLength(0)

    const ok = yield* call(
      write,
      { filePath: path.join(fix.ws, "src", "new.ts"), content: "export {}" },
      "call_write_ok",
    )
    expect(ok.title).not.toBe("Blocked by security policy")
    expect(existsSync(path.join(fix.ws, "src", "new.ts"))).toBe(true)
  }),
)

shell("flag off: the historical permission flow is unchanged and the executor runs", () =>
  Effect.gen(function* () {
    enabled = false
    approvals.length = 0
    const fix = yield* fixture()
    const tools = yield* resolve(context(fix.ws))
    const write = tools["write"]!

    const result = yield* call(
      write,
      { filePath: path.join(fix.ssh, "authorized_keys"), content: "ssh-rsa test" },
      "call_write_off",
    )
    expect(result.title).not.toBe("Blocked by security policy")
    expect(existsSync(path.join(fix.ssh, "authorized_keys"))).toBe(true)
    expect(approvals.map((item) => item.permission)).toEqual(["external_directory", "edit"])
    expect(approvals.every((item) => !("security" in (item.metadata ?? {})))).toBe(true)
    expect(
      approvals.every((item) => !item.ruleset.some((rule) => (rule as { source?: string }).source === "security")),
    ).toBe(true)
  }),
)
