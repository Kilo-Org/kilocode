import { expect, test } from "bun:test"
import { cp, mkdtemp, rm, truncate, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { OpenCode } from "@opencode-ai/client"
import {
  buildExternalTransfer,
  ExternalResumeError,
  importExternalTranscript,
  parseExternalTranscript,
  readExternalTranscript,
  type ExternalResumeClient,
} from "../src/resume-external"
import { fixture, ready } from "./fixture"

const model = { providerID: "fixture", id: "chat" }

function claude(lines: ReadonlyArray<unknown>) {
  return lines.map((value) => JSON.stringify(value)).join("\n")
}

function codex(lines: ReadonlyArray<unknown>) {
  return lines.map((value) => JSON.stringify(value)).join("\n")
}

function target() {
  return {
    projectID: "prj_fixture",
    location: { directory: "/workspace/project" },
    agent: "build",
    model,
  }
}

function externalFixture(name: "claude" | "codex") {
  return path.join(import.meta.dir, "fixtures/external", `${name}.jsonl`)
}

async function externalFixtureText(name: "claude" | "codex") {
  return Bun.file(externalFixture(name)).text()
}

test("parses the audited Claude fixture while retaining text, reasoning, tools, and source model", async () => {
  const transcript = parseExternalTranscript(await externalFixtureText("claude"))

  expect(transcript).toMatchObject({
    format: "claude",
    version: 2,
    sourceModel: { providerID: "anthropic", id: "claude-sonnet-fixture" },
  })
  expect(transcript.steps.map((step) => step.role)).toEqual(["user", "assistant", "assistant"])
  expect(transcript.steps[0]?.parts).toEqual([{ type: "text", text: "Read src/index.ts and report back." }])
  expect(transcript.steps[1]?.parts).toEqual([
    { type: "reasoning", text: "I will inspect the requested file.", sourceSignature: "sig_claude_fixture" },
    { type: "text", text: "I will read that file." },
    {
      type: "tool",
      id: "toolu_read",
      name: "read",
      input: { file_path: "src/index.ts" },
      result: { text: "export const answer = 42;", error: false },
    },
  ])
  expect(transcript.steps[2]?.parts).toEqual([{ type: "text", text: "The file exports answer = 42." }])
})

test("parses the audited Codex fixture with source ID, status, custom tools, and metadata order", async () => {
  const transcript = parseExternalTranscript(await externalFixtureText("codex"))

  expect(transcript).toMatchObject({
    format: "codex",
    version: 0,
    sourceSessionID: "codex_fixture_session",
    sourceModel: { providerID: "openai", id: "gpt-5-fixture" },
  })
  expect(transcript.steps.map((step) => step.role)).toEqual([
    "user",
    "assistant",
    "assistant",
    "assistant",
    "assistant",
  ])
  expect(transcript.steps[1]?.parts[0]).toMatchObject({
    type: "tool",
    id: "call_read",
    name: "read",
    input: { file_path: "src/index.ts" },
    result: { text: "export const answer = 42;", error: false, status: "completed" },
  })
  expect(transcript.steps[2]?.parts[0]).toMatchObject({
    type: "text",
    text: "The file exports answer = 42.",
  })
  expect(transcript.steps[3]?.parts[0]).toMatchObject({
    type: "tool",
    id: "call_check",
    name: "check",
    input: { command: "bun run typecheck" },
    result: { text: "typecheck failed", error: true, status: "failed" },
  })
})

test("rejects source identity and model changes instead of mislabeling history", () => {
  expect(() =>
    parseExternalTranscript(
      codex([
        { type: "session_meta", payload: { cli_version: "0.8.0", session_id: "source_a" } },
        { type: "session_meta", payload: { cli_version: "0.8.0", session_id: "source_b" } },
      ]),
    ),
  ).toThrow("changes source session ID")
  expect(() =>
    parseExternalTranscript(
      codex([
        { type: "session_meta", payload: { cli_version: "0.8.0", model_provider: "openai" } },
        { type: "turn_context", payload: { model: "gpt-5" } },
        { type: "turn_context", payload: { model: "gpt-5-mini" } },
      ]),
    ),
  ).toThrow("changes source model")
  expect(() =>
    parseExternalTranscript(
      claude([
        { type: "user", version: "2.42.0", message: { role: "user", content: "hello" } },
        {
          type: "assistant",
          version: "2.42.0",
          message: { role: "assistant", model: "claude-sonnet", content: [{ type: "text", text: "one" }] },
        },
        {
          type: "assistant",
          version: "2.42.0",
          message: { role: "assistant", model: "claude-opus", content: [{ type: "text", text: "two" }] },
        },
      ]),
    ),
  ).toThrow("changes source model")
})

test("parses Claude text, reasoning, and paired tool output without dropping content", () => {
  const transcript = parseExternalTranscript(
    claude([
      {
        type: "user",
        version: "2.42.0",
        message: { role: "user", content: [{ type: "text", text: "Read the file" }] },
      },
      {
        type: "assistant",
        version: "2.42.0",
        message: {
          role: "assistant",
          model: "claude-sonnet-fixture",
          content: [
            { type: "thinking", thinking: "I should inspect it", signature: "sig_fixture" },
            { type: "tool_use", id: "tool_1", name: "read", input: { file_path: "README.md" } },
          ],
        },
      },
      {
        type: "user",
        version: "2.42.0",
        message: { role: "user", content: [{ type: "tool_result", tool_use_id: "tool_1", content: "contents" }] },
      },
      {
        type: "assistant",
        version: "2.42.0",
        message: { role: "assistant", content: [{ type: "text", text: "The file contains contents" }] },
      },
    ]),
  )

  expect(transcript).toMatchObject({
    format: "claude",
    version: 2,
    sourceModel: { providerID: "anthropic", id: "claude-sonnet-fixture" },
  })
  expect(transcript.steps.map((step) => step.role)).toEqual(["user", "assistant", "assistant"])
  expect(transcript.steps[1]?.parts).toEqual([
    { type: "reasoning", text: "I should inspect it", sourceSignature: "sig_fixture" },
    {
      type: "tool",
      id: "tool_1",
      name: "read",
      input: { file_path: "README.md" },
      result: { text: "contents", error: false },
    },
  ])

  const transfer = buildExternalTransfer(transcript, target())
  expect(transfer.info.id).toStartWith("ses_")
  expect(transfer.info.projectID).toBe("prj_fixture")
  expect(transfer.messages.map((message) => message.type)).toEqual(["user", "assistant", "assistant"])
  const importedTool = transfer.messages[1]
  if (importedTool?.type !== "assistant") throw new Error("Expected an assistant tool message")
  expect(importedTool.model).toEqual({ providerID: "anthropic", id: "claude-sonnet-fixture" })
  expect(importedTool.metadata).toEqual({ externalResume: { reasoningSignatures: ["sig_fixture"] } })
  expect(importedTool.content[1]).toMatchObject({
    type: "tool",
    id: "tool_1",
    state: { status: "completed", input: { file_path: "README.md" }, content: [{ type: "text", text: "contents" }] },
  })
})

test("parses Codex metadata, text, reasoning, and tool calls with source order intact", () => {
  const transcript = parseExternalTranscript(
    codex([
      {
        type: "session_meta",
        payload: { cli_version: "0.8.0", cwd: "/workspace/project", model_provider: "openai", session_id: "codex_1" },
      },
      { type: "turn_context", payload: { model: "gpt-5" } },
      {
        type: "response_item",
        payload: { type: "message", role: "user", content: [{ type: "input_text", text: "List files" }] },
      },
      {
        type: "response_item",
        payload: { type: "function_call", call_id: "call_1", name: "shell", arguments: '{"command":"ls"}' },
      },
      {
        type: "response_item",
        payload: { type: "function_call_output", call_id: "call_1", output: "file.txt", status: "failed" },
      },
      {
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "There is file.txt" }] },
      },
    ]),
  )

  expect(transcript).toMatchObject({
    format: "codex",
    version: 0,
    sourceSessionID: "codex_1",
    sourceModel: { providerID: "openai", id: "gpt-5" },
  })
  expect(transcript.steps.map((step) => step.role)).toEqual(["user", "assistant", "assistant"])
  expect(transcript.steps[1]?.parts[0]).toMatchObject({
    type: "tool",
    id: "call_1",
    name: "shell",
    input: { command: "ls" },
    result: { text: "file.txt", error: true, status: "failed" },
  })
})

test("rejects unsupported content before any client import and retains incomplete tools", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-resume-external-test-"))
  try {
    const file = path.join(directory, "unsupported.jsonl")
    await writeFile(
      file,
      claude([
        { type: "user", version: "2.42.0", message: { role: "user", content: "hello" } },
        { type: "assistant", version: "2.42.0", message: { role: "assistant", content: [{ type: "custom_block" }] } },
      ]),
    )
    let locations = 0
    let imports = 0
    const client: ExternalResumeClient = {
      location: {
        get: async () => {
          locations++
          return {
            directory: "/workspace/project",
            project: { id: "prj_fixture", directory: "/workspace/project", canonical: "/workspace/project" },
          }
        },
      },
      session: {
        import: async () => {
          imports++
          throw new Error("must not import")
        },
      },
    }

    await expect(
      importExternalTranscript(client, { file, directory: "/workspace/project", agent: "build", model }),
    ).rejects.toThrow("unsupported Claude assistant content block")
    expect(locations).toBe(0)
    expect(imports).toBe(0)

    const incomplete = parseExternalTranscript(
      claude([
        { type: "user", version: "2.42.0", message: { role: "user", content: "hello" } },
        {
          type: "assistant",
          version: "2.42.0",
          message: { role: "assistant", content: [{ type: "tool_use", id: "orphan", name: "read", input: {} }] },
        },
      ]),
    )
    expect(incomplete.steps[1]?.parts).toEqual([
      {
        type: "tool",
        id: "orphan",
        name: "read",
        input: {},
        result: {
          text: "Source transcript ended before this tool returned a result",
          error: true,
          status: "incomplete",
        },
      },
    ])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("rejects external URLs, unsupported versions, and malformed tool structures", () => {
  expect(() => parseExternalTranscript("not-json")).toThrow(ExternalResumeError)
  expect(() =>
    parseExternalTranscript(JSON.stringify({ type: "session_meta", payload: { cli_version: "1.0.0" } })),
  ).toThrow("Unsupported Codex major version: 1")
  expect(() =>
    parseExternalTranscript(
      claude([
        { type: "user", version: "2.42.0", message: { role: "user", content: "hello" } },
        {
          type: "assistant",
          version: "2.42.0",
          message: { role: "assistant", content: [{ type: "tool_use", id: "tool", name: "read", input: [] }] },
        },
      ]),
    ),
  ).toThrow("requires Claude tool input to be an object")
})

test("bounds external transcript reads before parsing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-resume-external-test-"))
  try {
    const file = path.join(directory, "oversized.jsonl")
    await writeFile(file, "{}")
    await truncate(file, 10 * 1024 * 1024 + 1)
    await expect(readExternalTranscript(file)).rejects.toThrow("10 MiB limit")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test("imports into a newly generated v2 session through only public client methods", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kilo-resume-external-test-"))
  try {
    const file = path.join(directory, "claude.jsonl")
    await writeFile(
      file,
      claude([
        { type: "user", version: "2.42.0", message: { role: "user", content: "hello" } },
        { type: "assistant", version: "2.42.0", message: { role: "assistant", content: "hi" } },
      ]),
    )
    const calls: unknown[] = []
    const client: ExternalResumeClient = {
      location: {
        get: async () => ({
          directory: "/workspace/project",
          workspaceID: "wrk_fixture",
          project: { id: "prj_fixture", directory: "/workspace/project", canonical: "/workspace/project" },
        }),
      },
      session: {
        import: async (input) => {
          calls.push(input)
          return { id: "ses_imported" } as Awaited<ReturnType<ExternalResumeClient["session"]["import"]>>
        },
      },
    }

    const result = await importExternalTranscript(client, {
      file,
      directory: "/workspace/project",
      agent: "build",
      model,
    })
    expect(result.id).toBe("ses_imported")
    expect(calls).toHaveLength(1)
    const request = calls[0]
    if (!request || typeof request !== "object") throw new Error("Expected import request")
    const data = request as {
      info: { id: string; metadata?: { externalResume?: { sourceModel?: unknown } } }
      messages: ReadonlyArray<{ type: string; model?: unknown }>
      location: { workspaceID?: string }
    }
    expect(data.info.id).toStartWith("ses_")
    expect(data.messages.map((message) => message.type)).toEqual(["user", "assistant"])
    const assistant = data.messages[1]
    if (!assistant || assistant.type !== "assistant") throw new Error("Expected assistant import message")
    expect(assistant.model).toEqual(model)
    expect(data.info.metadata?.externalResume?.sourceModel).toBeUndefined()
    expect(data.location.workspaceID).toBe("wrk_fixture")
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})

test.skipIf(!Bun.semver.satisfies(Bun.version, ">=1.4.0"))(
  "imports, resumes, and exports Claude and Codex transcripts through an isolated public host",
  async () => {
    await using input = await fixture()
    const responses: string[] = []
    const fakeModel = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      async fetch(request) {
        if (new URL(request.url).pathname !== "/v1/chat/completions") return new Response(null, { status: 404 })
        const body: { stream?: boolean } = await request.json()
        if (!body.stream) {
          return Response.json({
            id: "external-fixture",
            object: "chat.completion",
            created: 1,
            model: "chat",
            choices: [{ index: 0, message: { role: "assistant", content: "External resume response" } }],
          })
        }
        responses.push("External resume response")
        const frames = [
          {
            id: "external-fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "External resume response" },
                finish_reason: null,
              },
            ],
          },
          {
            id: "external-fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "chat",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          },
        ]
        return new Response(frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("") + "data: [DONE]\n\n", {
          headers: { "content-type": "text/event-stream" },
        })
      },
    })
    const child = Bun.spawn([process.execPath, "--no-env-file", path.join(import.meta.dir, "interactive-fixture.ts")], {
      cwd: input.cwd,
      env: {
        ...input.env,
        KILO_FIXTURE_CONFIG: JSON.stringify({
          model: "fixture/chat",
          providers: {
            fixture: {
              package: "aisdk:@ai-sdk/openai-compatible",
              settings: { baseURL: `http://127.0.0.1:${fakeModel.port}/v1`, apiKey: "fixture" },
              models: { chat: {} },
            },
          },
        }),
      },
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      timeout: 20000,
    })
    const errors = new Response(child.stderr).text()
    try {
      const endpoint = await ready(child.stdout, /URL: (http:\/\/127\.0\.0\.1:\d+)/).catch(async (error) => {
        throw new Error(`${String(error)}\n${await errors}`)
      })
      const password = (
        await Bun.file(path.join(input.env.XDG_STATE_HOME, "kilo2/interactive/server.password")).text()
      ).trim()
      const client = OpenCode.make({
        baseUrl: endpoint.value,
        headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
      })
      for (const format of ["claude", "codex"] as const) {
        const file = path.join(input.directory, `${format}.jsonl`)
        await cp(externalFixture(format), file)
        const before = new Uint8Array(await Bun.file(file).arrayBuffer())
        const imported = await importExternalTranscript(client, {
          file,
          directory: input.cwd,
          agent: "build",
          model,
        })
        await client.session.prompt({ sessionID: imported.id, text: `Resume ${format} fixture` })
        await client.session.wait({ sessionID: imported.id }, { signal: AbortSignal.timeout(10000) })
        const exported = await client.session.export({ sessionID: imported.id })
        expect(imported.id).toStartWith("ses_")
        expect(exported.info.id).toBe(imported.id)
        expect(exported.info.metadata).toMatchObject({
          externalResume: {
            format,
            ...(format === "claude"
              ? { sourceModel: { providerID: "anthropic", id: "claude-sonnet-fixture" } }
              : {
                  sourceSessionID: "codex_fixture_session",
                  sourceModel: { providerID: "openai", id: "gpt-5-fixture" },
                }),
          },
        })
        const importedAssistant = exported.messages.find((message) => message.type === "assistant")
        expect(importedAssistant?.type === "assistant" && importedAssistant.model).toEqual(
          format === "claude"
            ? { providerID: "anthropic", id: "claude-sonnet-fixture" }
            : { providerID: "openai", id: "gpt-5-fixture" },
        )
        expect(
          exported.messages.some((message) => message.type === "user" && message.text.includes(`Resume ${format}`)),
        ).toBe(true)
        expect(JSON.stringify(exported.messages)).toContain("External resume response")
        if (format === "codex") expect(JSON.stringify(exported.messages)).toContain('"sourceStatus":"failed"')
        expect(new Uint8Array(await Bun.file(file).arrayBuffer())).toEqual(before)
      }
      expect(responses.length).toBeGreaterThanOrEqual(2)
    } finally {
      child.kill("SIGTERM")
      await child.exited
      await errors
      await fakeModel.stop(true)
    }
  },
)
