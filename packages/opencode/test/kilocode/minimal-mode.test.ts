import { describe, expect, test } from "bun:test"
import { asSchema, tool } from "ai"
import { Effect } from "effect"
import path from "path"
import z from "zod"
import { AppNodeBuilder } from "@opencode-ai/core/effect/app-node-builder"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Database } from "@opencode-ai/core/database/database"
import { SessionProjector } from "@opencode-ai/core/session/projector"
import { OutputFormatJsonSchema } from "@opencode-ai/core/v1/session"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { Agent } from "@/agent/agent"
import { KiloSessions } from "@/kilo-sessions/kilo-sessions"
import { KiloMinimal } from "@/kilocode/session/minimal"
import { Permission } from "@/permission"
import { SessionPrompt } from "@/session/prompt"
import { Session } from "@/session/session"
import { Skill } from "@/skill"
import { provideTmpdirInstance, provideTmpdirServer } from "../fixture/fixture"
import { pollWithTimeout, testEffect } from "../lib/effect"
import { TestLLMServer } from "../lib/llm-server"

const unit = testEffect(AppNodeBuilder.build(LayerNode.group([Agent.node, CrossSpawnSpawner.node])))
const it = testEffect(
  LayerNode.compile(
    LayerNode.group([
      SessionPrompt.node,
      SessionProjector.node,
      Session.node,
      Skill.node,
      Database.node,
      CrossSpawnSpawner.node,
      LayerNode.make({ service: TestLLMServer, layer: TestLLMServer.layer, deps: [] }),
      LayerNode.make({ service: MemoryService.Service, layer: MemoryService.layer, deps: [] }),
    ]),
    [[KiloSessions.node, KiloSessions.testLayer]],
  ),
)

function config(url: string, model = "test-model") {
  return {
    model: `test/${model}`,
    small_model: `test/${model}`,
    enabled_providers: ["test"],
    snapshot: false,
    experimental: { minimal_mode: true },
    provider: {
      test: {
        npm: "@ai-sdk/openai-compatible",
        models: { [model]: { name: "Test", limit: { context: 100000, output: 10000 } } },
        options: { apiKey: "test-key", baseURL: url },
      },
    },
  }
}

const request = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })),
  tool_choice: z.unknown().optional(),
})

describe("Minimal mode", () => {
  unit.live("does not register a native agent without an enabled experiment", () =>
    Effect.gen(function* () {
      for (const flag of [undefined, false]) {
        yield* provideTmpdirInstance(
          () =>
            Effect.gen(function* () {
              const agents = yield* Agent.Service
              expect(yield* agents.get("minimal")).toBeUndefined()
              expect((yield* agents.list()).map((agent) => agent.name)).not.toContain("minimal")
              expect((yield* agents.get("code"))?.mode).toBe("primary")
              expect(KiloMinimal.enabled({ experimental: { minimal_mode: flag } }, { name: "minimal" })).toBe(false)
            }),
          { config: { experimental: { minimal_mode: flag } } },
        )
      }
    }),
  )

  unit.instance(
    "registers a primary agent without weakening inherited or per-agent permissions",
    () =>
      Effect.gen(function* () {
        const agents = yield* Agent.Service
        const minimal = yield* agents.get("minimal")
        const code = yield* agents.get("code")
        expect(minimal).toMatchObject({ name: "minimal", mode: "primary", native: true, prompt: KiloMinimal.prompt })
        expect(KiloMinimal.enabled({ experimental: { minimal_mode: true } }, minimal)).toBe(true)
        expect(KiloMinimal.enabled({ experimental: { minimal_mode: true } }, code)).toBe(false)
        expect((yield* agents.list()).filter((agent) => agent.name === "minimal")).toHaveLength(1)
        for (const agent of [minimal, code]) {
          expect(Permission.evaluate("edit", "src/app.ts", agent.permission).action).toBe("deny")
          expect(Permission.evaluate("read", "secrets/token.txt", agent.permission).action).toBe("deny")
          expect(Permission.evaluate("read", ".env", agent.permission).action).toBe("ask")
          expect(Permission.evaluate("read", ".env.example", agent.permission).action).toBe("allow")
          expect(Permission.evaluate("read", "src/app.ts", agent.permission).action).toBe("allow")
          expect(Permission.evaluate("bash", "npm run deploy", agent.permission).action).toBe("deny")
          expect(Permission.evaluate("external_directory", "/outside/project", agent.permission).action).toBe("ask")
          expect(Permission.evaluate("doom_loop", "*", agent.permission).action).toBe("ask")
          expect(Permission.disabled(["read", "write", "edit", "apply_patch"], agent.permission)).toEqual(
            new Set(["write", "edit", "apply_patch"]),
          )
        }
        expect(Permission.evaluate("read", "minimal-only.txt", minimal.permission).action).toBe("deny")
        expect(Permission.evaluate("read", "minimal-only.txt", code.permission).action).toBe("allow")
      }),
    {
      config: {
        experimental: { minimal_mode: true },
        permission: { edit: "deny", read: { "secrets/*": "deny" }, bash: { "npm run deploy": "deny" } },
        agent: { minimal: { permission: { read: { "minimal-only.txt": "deny" } } } },
      },
    },
  )

  test("filters exact tool names while preserving schemas, validation, execution, and protocol tools", async () => {
    const schema = z.object({ filePath: z.string().min(1) })
    const execute = async (input: z.infer<typeof schema>) => input.filePath
    const convert = ({ output }: { output: string }) => ({ type: "text" as const, value: output })
    const core = tool({ description: "Original description", inputSchema: schema, execute, toModelOutput: convert })
    const protocol = tool({ description: "Protocol description", inputSchema: z.object({}) })
    const input = {
      read: core,
      write: core,
      edit: core,
      bash: core,
      apply_patch: core,
      StructuredOutput: protocol,
      _noop: protocol,
      skill: core,
      task: core,
      grep: core,
      read_mcp_resource: core,
      server_read: core,
      Read: core,
      constructor: core,
    }
    const output = KiloMinimal.tools(input)

    expect(Object.keys(output).sort()).toEqual(
      ["read", "write", "edit", "bash", "apply_patch", "StructuredOutput", "_noop"].sort(),
    )
    for (const name of ["read", "write", "edit", "bash", "apply_patch"]) {
      expect(KiloMinimal.allows(name)).toBe(true)
      expect(output[name].inputSchema).toBe(schema)
      expect(output[name].execute).toBe(execute)
      expect(output[name].toModelOutput).toBe(convert)
      expect(output[name].description).not.toBe(core.description)
    }
    expect(KiloMinimal.allows("constructor")).toBe(false)
    expect(KiloMinimal.allows("read_mcp_resource")).toBe(false)
    expect(output.StructuredOutput).toBe(protocol)
    expect(output._noop).toBe(protocol)
    expect(input.read.description).toBe("Original description")
    expect((await asSchema(output.read.inputSchema).validate?.({ filePath: "" }))?.success).toBe(false)
    expect((await asSchema(output.read.inputSchema).validate?.({ filePath: "/project/file.ts" }))?.success).toBe(true)
    const result = await output.read.execute?.({ filePath: "/project/file.ts" }, { toolCallId: "read-1", messages: [] })
    expect(result).toBe("/project/file.ts")
    expect(KiloMinimal.tools({ task: core })).toEqual({})
  })

  test("derives a bounded title from real user text without synthetic context", () => {
    expect(
      KiloMinimal.title([
        { type: "text", text: "Editor context", synthetic: true },
        { type: "file", text: "Attachment" },
        { type: "text", text: " \n " },
        { type: "text", text: "  Fix the parser\nKeep the current API  " },
      ]),
    ).toBe("Fix the parser")
    expect(KiloMinimal.title([{ type: "text", text: "x".repeat(120) }])).toBe("x".repeat(100))
    expect(KiloMinimal.title([{ type: "text", text: "Synthetic", synthetic: true }])).toBe("Minimal session")
  })

  it.live(
    "sends four core tools and project rules without skill, persona, editor lists, or title inference",
    () =>
      provideTmpdirServer(
        ({ dir, llm }) =>
          Effect.gen(function* () {
            yield* Effect.promise(() =>
              Promise.all([
                Bun.write(path.join(dir, "AGENTS.md"), "MINIMAL_PROJECT_RULE: Keep the public API unchanged.\n"),
                Bun.write(
                  path.join(dir, ".kilo", "skills", "minimal-hidden", "SKILL.md"),
                  "---\nname: minimal-hidden\ndescription: MINIMAL_SKILL_DESCRIPTION\n---\nMINIMAL_SKILL_BODY\n",
                ),
              ]),
            )
            const skills = yield* Skill.Service
            expect(yield* skills.get("minimal-hidden")).toBeDefined()
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const session = yield* sessions.create({})
            yield* llm.text("Minimal response")
            const result = yield* prompt.prompt({
              sessionID: session.id,
              agent: "minimal",
              system: "MINIMAL_USER_RULE: Preserve tests.",
              parts: [{ type: "text", text: "Fix the parser\nKeep the current API" }],
              editorContext: {
                activeFile: "src/active.ts",
                shell: "/bin/sh",
                openTabs: ["MINIMAL_OPEN_TAB.ts"],
                visibleFiles: ["MINIMAL_VISIBLE_FILE.ts"],
              },
            })
            expect(result.parts.some((part) => part.type === "text" && part.text === "Minimal response")).toBe(true)
            const title = yield* pollWithTimeout(
              sessions
                .get(session.id)
                .pipe(Effect.map((item) => (Session.isDefaultTitle(item.title) ? undefined : item.title))),
              "Minimal session title was not set",
            )
            expect(title).toBe("Fix the parser")
            expect(yield* llm.calls).toBe(1)
            const body = request.parse((yield* llm.inputs).at(0))
            expect(body.tools.map((item) => item.function.name).sort()).toEqual(["bash", "edit", "read", "write"])
            const system = body.messages
              .filter((message) => message.role === "system")
              .map((message) => message.content)
              .join("\n")
            expect(system).toContain(KiloMinimal.prompt)
            expect(system).toContain("MINIMAL_PROJECT_RULE")
            expect(system).toContain("MINIMAL_USER_RULE")
            expect(system).toContain(`Working directory: ${dir}`)
            expect(system).toContain("Shell: /bin/sh")
            expect(system).not.toContain("Active file:")
            expect(JSON.stringify(body.messages.filter((message) => message.role === "user"))).toContain(
              "Active file: src/active.ts",
            )
            const messages = JSON.stringify(body.messages)
            for (const text of [
              "MINIMAL_SKILL_DESCRIPTION",
              "MINIMAL_SKILL_BODY",
              "<available_skills>",
              "MINIMAL_OPEN_TAB.ts",
              "MINIMAL_VISIBLE_FILE.ts",
              "# Personality",
            ]) {
              expect(messages).not.toContain(text)
            }

            yield* llm.text("Follow-up response")
            yield* prompt.prompt({
              sessionID: session.id,
              agent: "minimal",
              system: "MINIMAL_USER_RULE: Preserve tests.",
              parts: [{ type: "text", text: "Check the next file." }],
              editorContext: { activeFile: "src/next.ts", shell: "/bin/sh", openTabs: ["MINIMAL_NEXT_TAB.ts"] },
            })
            const next = request.parse((yield* llm.inputs).at(-1))
            expect(next.messages.slice(0, body.messages.length)).toEqual(body.messages)
            expect(next.messages.filter((message) => message.role === "system")).toEqual(
              body.messages.filter((message) => message.role === "system"),
            )
            const users = next.messages.filter((message) => message.role === "user")
            expect(JSON.stringify(users.at(-1))).toContain("Active file: src/next.ts")
            expect(JSON.stringify(next.messages)).not.toContain("MINIMAL_NEXT_TAB")
          }),
        { git: true, config },
      ),
    30_000,
  )

  it.live(
    "keeps required structured output executable after session and user tool restrictions",
    () =>
      provideTmpdirServer(
        ({ llm }) =>
          Effect.gen(function* () {
            const prompt = yield* SessionPrompt.Service
            const sessions = yield* Session.Service
            const session = yield* sessions.create({
              title: "Restricted structured output",
              permission: [{ permission: "edit", pattern: "*", action: "deny" }],
            })
            yield* llm.tool("StructuredOutput", { answer: 4 })
            const result = yield* prompt.prompt({
              sessionID: session.id,
              agent: "minimal",
              tools: { bash: false },
              parts: [{ type: "text", text: "What is 2 + 2?" }],
              format: new OutputFormatJsonSchema({
                type: "json_schema",
                schema: {
                  type: "object",
                  properties: { answer: { type: "integer" } },
                  required: ["answer"],
                  additionalProperties: false,
                },
                retryCount: 0,
              }),
            })
            expect(result.info).toMatchObject({ role: "assistant", structured: { answer: 4 } })
            expect(yield* llm.calls).toBe(1)
            const body = request.parse((yield* llm.inputs).at(0))
            expect(body.tools.map((item) => item.function.name).sort()).toEqual(["StructuredOutput", "read"])
            expect(body.tool_choice).toBe("required")
          }),
        { config: (url) => config(url, "gpt-5-minimal") },
      ),
    30_000,
  )
})
