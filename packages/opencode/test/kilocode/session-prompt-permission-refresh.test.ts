import { NodeFileSystem } from "@effect/platform-node"
import { expect } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { FetchHttpClient } from "effect/unstable/http"
import fs, { rename, rm, symlink } from "fs/promises"
import os from "os"
import { Database } from "@opencode-ai/core/database/database"
import path from "path"
import { pathToFileURL } from "url"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Global } from "@opencode-ai/core/global"
import * as Log from "@opencode-ai/core/util/log"
import { Agent as AgentSvc } from "../../src/agent/agent"
import { BackgroundJob } from "../../src/background/job"
import { Bus } from "../../src/bus"
import { Command } from "../../src/command"
import { Auth } from "../../src/auth" // kilocode_change
import { Config } from "../../src/config/config"
import { RuntimeFlags } from "../../src/effect/runtime-flags"
import { EventV2Bridge } from "../../src/event-v2-bridge"
import { Env } from "../../src/env"
import { Format } from "../../src/format"
import { Git } from "../../src/git"
import { Image } from "../../src/image/image"
import { LSP } from "../../src/lsp/lsp"
import { MCP } from "../../src/mcp"
import { Permission } from "../../src/permission"
import { Plugin } from "../../src/plugin"
import { Provider as ProviderSvc } from "../../src/provider/provider"
import { Question } from "../../src/question"
import { Reference } from "../../src/reference/reference"
import { RepositoryCache } from "../../src/reference/repository-cache"
import { SessionCompaction } from "../../src/session/compaction"
import { Instruction } from "../../src/session/instruction"
import { LLM } from "../../src/session/llm"
import { SessionProcessor } from "../../src/session/processor"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionRevert } from "../../src/session/revert"
import { SessionRunState } from "../../src/session/run-state"
import { Session } from "../../src/session/session"
import { SessionStatus } from "../../src/session/status"
import { SystemPrompt } from "../../src/session/system"
import { SessionSummary } from "../../src/session/summary"
import { Todo } from "../../src/session/todo"
import { Skill } from "../../src/skill"
import { Snapshot } from "../../src/snapshot"
import { Storage } from "../../src/storage/storage"
import { SyncEvent } from "../../src/sync"
import { Ripgrep } from "@opencode-ai/core/filesystem/ripgrep"
import { ToolRegistry } from "../../src/tool/registry"
import { Truncate } from "../../src/tool/truncate"
import { KiloHeadless } from "../../src/kilocode/permission/headless"
import { KiloSessionPrompt } from "../../src/kilocode/session/prompt"
import { KiloReadObject } from "../../src/kilocode/tool/read-object"
import { MemoryService } from "@kilocode/kilo-memory/effect/service"
import { provideTmpdirServer } from "../fixture/fixture"
import { awaitWithTimeout, pollWithTimeout, testEffect } from "../lib/effect"
import { reply, TestLLMServer } from "../lib/llm-server"

void Log.init({ print: false })

const waitFor = <A, E, R>(label: string, run: Effect.Effect<A | undefined, E, R>) =>
  Effect.gen(function* () {
    const end = Date.now() + 5_000
    while (Date.now() < end) {
      const result = yield* run
      if (result !== undefined) return result
      yield* Effect.sleep(20)
    }
    throw new Error(`timed out waiting for ${label}`)
  })

const summary = Layer.succeed(
  SessionSummary.Service,
  SessionSummary.Service.of({
    summarize: () => Effect.void,
    diff: () => Effect.succeed([]),
    computeDiff: () => Effect.succeed([]),
  }),
)

const mcp = Layer.succeed(
  MCP.Service,
  MCP.Service.of({
    status: () => Effect.succeed({}),
    clients: () => Effect.succeed({}),
    tools: () => Effect.succeed({}),
    prompts: () => Effect.succeed({}),
    resources: () => Effect.succeed({}),
    add: () => Effect.succeed({ status: { status: "disabled" as const } }),
    connect: () => Effect.void,
    disconnect: () => Effect.void,
    getPrompt: () => Effect.succeed(undefined),
    readResource: () => Effect.succeed(undefined),
    startAuth: () => Effect.die("unexpected MCP auth in permission refresh tests"),
    authenticate: () => Effect.die("unexpected MCP auth in permission refresh tests"),
    finishAuth: () => Effect.die("unexpected MCP auth in permission refresh tests"),
    removeAuth: () => Effect.void,
    supportsOAuth: () => Effect.succeed(false),
    hasStoredTokens: () => Effect.succeed(false),
    getAuthStatus: () => Effect.succeed("not_authenticated" as const),
  }),
)

const lsp = Layer.succeed(
  LSP.Service,
  LSP.Service.of({
    init: () => Effect.void,
    status: () => Effect.succeed([]),
    hasClients: () => Effect.succeed(false),
    touchFile: () => Effect.void,
    diagnostics: () => Effect.succeed({}),
    hover: () => Effect.succeed(undefined),
    definition: () => Effect.succeed([]),
    references: () => Effect.succeed([]),
    implementation: () => Effect.succeed([]),
    documentSymbol: () => Effect.succeed([]),
    workspaceSymbol: () => Effect.succeed([]),
    prepareCallHierarchy: () => Effect.succeed([]),
    incomingCalls: () => Effect.succeed([]),
    outgoingCalls: () => Effect.succeed([]),
  }),
)

const status = Layer.mergeAll(SessionStatus.defaultLayer, Bus.layer)
const run = SessionRunState.layer.pipe(Layer.provide(status))
const infra = Layer.mergeAll(NodeFileSystem.layer, CrossSpawnSpawner.defaultLayer)

function makeHttp() {
  const deps = Layer.mergeAll(
    Session.defaultLayer,
    BackgroundJob.defaultLayer,
    Snapshot.defaultLayer,
    LLM.defaultLayer,
    Env.defaultLayer,
    AgentSvc.defaultLayer,
    Command.defaultLayer,
    Permission.defaultLayer,
    Plugin.defaultLayer,
    Config.defaultLayer,
    RuntimeFlags.layer(),
    ProviderSvc.defaultLayer,
    lsp,
    mcp,
    FSUtil.defaultLayer,
    Reference.defaultLayer,
    SyncEvent.defaultLayer,
    EventV2Bridge.defaultLayer,
    Database.defaultLayer,
    status,
    MemoryService.layer,
  ).pipe(Layer.provideMerge(infra))
  const question = Question.layer.pipe(Layer.provideMerge(deps))
  const todo = Todo.layer.pipe(Layer.provideMerge(deps))
  const registry = ToolRegistry.layer.pipe(
    Layer.provide(Skill.defaultLayer),
    Layer.provide(FetchHttpClient.layer),
    Layer.provide(CrossSpawnSpawner.defaultLayer),
    Layer.provide(RepositoryCache.defaultLayer),
    Layer.provide(Ripgrep.defaultLayer),
    Layer.provide(Format.defaultLayer),
    Layer.provide(Git.defaultLayer),
    Layer.provide(Reference.defaultLayer),
    Layer.provide(Command.defaultLayer),
    Layer.provide(Auth.defaultLayer), // kilocode_change
    Layer.provideMerge(todo),
    Layer.provideMerge(question),
    Layer.provideMerge(deps),
  )
  const trunc = Truncate.layer.pipe(Layer.provideMerge(deps))
  const proc = SessionProcessor.layer.pipe(
    Layer.provide(summary),
    Layer.provide(Image.defaultLayer),
    Layer.provideMerge(deps),
  )
  const compact = SessionCompaction.layer.pipe(Layer.provideMerge(proc), Layer.provideMerge(deps))
  return Layer.mergeAll(
    TestLLMServer.layer,
    SessionPrompt.layer.pipe(
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(Image.defaultLayer),
      Layer.provide(summary),
      Layer.provideMerge(run),
      Layer.provideMerge(compact),
      Layer.provideMerge(proc),
      Layer.provideMerge(registry),
      Layer.provideMerge(trunc),
      Layer.provideMerge(question),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(SystemPrompt.defaultLayer),
      Layer.provideMerge(deps),
    ),
  ).pipe(
    Layer.provide(
      Layer.mergeAll(
        summary,
        deps,
        Config.defaultLayer,
        RuntimeFlags.layer(),
        BackgroundJob.defaultLayer,
        Bus.layer,
        infra,
        Storage.defaultLayer,
        Reference.defaultLayer,
      ),
    ),
  )
}

const it = testEffect(makeHttp())
const symlinkIt = process.platform === "win32" ? it.live.skip : it.live

it.live("recognizes Windows named-pipe paths before filesystem inspection", () =>
  Effect.sync(() => {
    expect(KiloReadObject.namedPipe("\\\\.\\pipe\\secret")).toBe(true)
    expect(KiloReadObject.namedPipe("\\\\server\\pipe\\secret")).toBe(true)
    expect(KiloReadObject.namedPipe("C:\\project\\secret.txt")).toBe(false)
  }),
)

const cfg = {
  provider: {
    test: {
      name: "Test",
      id: "test",
      env: [],
      npm: "@ai-sdk/openai-compatible",
      models: {
        "test-model": {
          id: "test-model",
          name: "Test Model",
          attachment: false,
          reasoning: false,
          temperature: false,
          tool_call: true,
          release_date: "2025-01-01",
          limit: { context: 100000, output: 10000 },
          cost: { input: 0, output: 0 },
          options: {},
        },
      },
      options: {
        apiKey: "test-key",
        baseURL: "http://localhost:1/v1",
      },
    },
  },
}

function providerCfg(url: string) {
  return {
    ...cfg,
    provider: {
      ...cfg.provider,
      test: {
        ...cfg.provider.test,
        options: {
          ...cfg.provider.test.options,
          baseURL: url,
        },
      },
    },
  }
}

it.live(
  "blocks @file content denied by .kilocodeignore",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const sentinel = "KILO_12133_MENTION_SENTINEL"
        yield* Effect.promise(() =>
          Promise.all([
            Bun.write(path.join(dir, "my_file.txt"), sentinel),
            Bun.write(path.join(dir, ".kilocodeignore"), "my_file.txt\n"),
          ]),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({})
        const parts = yield* prompt.resolvePromptParts("Please list the contents of @my_file.txt")
        const message = yield* prompt.prompt({ sessionID: session.id, noReply: true, parts })
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")

        expect(parts.some((part) => part.type === "file" && part.filename === "my_file.txt")).toBe(true)
        expect(text).not.toContain(sentinel)
        expect(text).toContain("prevents you from using this specific tool call")
        expect(message.parts.some((part) => part.type === "file")).toBe(false)
        expect(yield* permission.list()).toEqual([])
      }),
      { git: true, config: providerCfg },
    ),
  30_000,
)

it.live(
  "fails closed when an @file path changes while permission is pending",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const sentinel = "KILO_12133_ASK_SENTINEL"
        const denied = "KILO_12133_REPLACEMENT_SENTINEL"
        const file = path.join(dir, "ask.txt")
        const replacement = path.join(dir, "replacement.txt")
        yield* Effect.promise(() => Promise.all([Bun.write(file, sentinel), Bun.write(replacement, denied)]))

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const agents = yield* AgentSvc.Service
        const agent = yield* agents.defaultInfo()
        const session = yield* sessions.create({})
        expect(Permission.evaluate("read", "ask.txt", agent.permission).action).toBe("ask")
        const fiber = yield* prompt
          .prompt({
            sessionID: session.id,
            noReply: true,
            parts: yield* prompt.resolvePromptParts("Read @ask.txt"),
          })
          .pipe(Effect.forkScoped)
        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const requests = yield* permission.list()
            return requests.find((request) => request.sessionID === session.id && request.permission === "read")
          }),
          "file mention read permission was never requested",
          "15 seconds",
        )

        expect(pending.patterns).toEqual(["ask.txt"])
        yield* Effect.promise(() => rename(replacement, file))
        yield* permission.reply({ requestID: pending.id, reply: "once" })
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          const text = exit.value.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
          expect(text).not.toContain(sentinel)
          expect(text).not.toContain(denied)
          expect(text).toContain("changed after authorization")
        }
      }),
      {
        git: true,
        config: (url) => ({
          ...providerCfg(url),
          permission: { read: { "*": "allow", "ask.txt": "ask" } },
        }),
      },
    ),
  30_000,
)

it.live(
  "adds @file content after read permission approval",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const sentinel = "KILO_12133_APPROVED_SENTINEL"
        const file = path.join(dir, "approved.txt")
        yield* Effect.promise(() => Bun.write(file, sentinel))

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({})
        const fiber = yield* prompt
          .prompt({
            sessionID: session.id,
            noReply: true,
            parts: yield* prompt.resolvePromptParts("Read @approved.txt"),
          })
          .pipe(Effect.forkScoped)
        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const requests = yield* permission.list()
            return requests.find((request) => request.sessionID === session.id && request.permission === "read")
          }),
          "approved file read permission was never requested",
          "15 seconds",
        )

        yield* permission.reply({ requestID: pending.id, reply: "once" })
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          const text = exit.value.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
          expect(text).toContain(sentinel)
        }
      }),
      {
        git: true,
        config: (url) => ({
          ...providerCfg(url),
          permission: { read: { "*": "allow", "approved.txt": "ask" } },
        }),
      },
    ),
  30_000,
)

it.live(
  "stops a prompt while an attachment read permission is pending",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir, llm }) {
        const sentinel = "KILO_12133_ABORT_SENTINEL"
        const file = path.join(dir, "abort.txt")
        yield* Effect.promise(() => Bun.write(file, sentinel))

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({})
        const fiber = yield* prompt
          .prompt({
            sessionID: session.id,
            parts: yield* prompt.resolvePromptParts("Read @abort.txt"),
          })
          .pipe(Effect.forkScoped)
        yield* pollWithTimeout(
          Effect.gen(function* () {
            const requests = yield* permission.list()
            return requests.find((request) => request.sessionID === session.id && request.permission === "read")
          }),
          "attachment read permission was never requested",
          "15 seconds",
        )

        yield* prompt.cancel(session.id)
        yield* pollWithTimeout(
          Effect.gen(function* () {
            const requests = yield* permission.list()
            return requests.some((request) => request.sessionID === session.id) ? undefined : true
          }),
          "attachment read permission remained after cancellation",
          "15 seconds",
        )
        const messages = yield* sessions.messages({ sessionID: session.id })
        expect(
          messages.flatMap((message) => message.parts).some((part) => "text" in part && part.text.includes(sentinel)),
        ).toBe(false)
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        expect(yield* llm.calls).toBe(0)
      }),
      {
        git: true,
        config: (url) => ({ ...providerCfg(url), permission: { read: "ask" } }),
      },
    ),
  30_000,
)

it.live(
  "stops a legacy command while an attachment read permission is pending",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const sentinel = "KILO_12133_COMMAND_ABORT_SENTINEL"
        const file = path.join(dir, "command.txt")
        yield* Effect.promise(() => Bun.write(file, sentinel))

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({})
        const fiber = yield* prompt
          .command({
            sessionID: session.id,
            command: "local-review",
            arguments: "",
            parts: [
              {
                type: "file",
                mime: "text/plain",
                filename: "command.txt",
                url: pathToFileURL(file).href,
              },
            ],
          })
          .pipe(Effect.forkScoped)
        yield* pollWithTimeout(
          Effect.gen(function* () {
            const requests = yield* permission.list()
            return requests.find((request) => request.sessionID === session.id && request.permission === "read")
          }),
          "legacy command attachment permission was never requested",
          "15 seconds",
        )

        yield* prompt.cancel(session.id)
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isFailure(exit) && Cause.hasInterruptsOnly(exit.cause)).toBe(true)
        expect((yield* permission.list()).some((request) => request.sessionID === session.id)).toBe(false)
        const messages = yield* sessions.messages({ sessionID: session.id })
        expect(
          messages.flatMap((message) => message.parts).some((part) => "text" in part && part.text.includes(sentinel)),
        ).toBe(false)
      }),
      {
        git: true,
        config: (url) => ({ ...providerCfg(url), permission: { read: "ask" } }),
      },
    ),
  30_000,
)

it.live(
  "fails closed when a direct attachment path changes while permission is pending",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const allowed = "KILO_12133_ALLOWED_BINARY_SENTINEL"
        const denied = "KILO_12133_REPLACEMENT_BINARY_SENTINEL"
        const file = path.join(dir, "binary.bin")
        const replacement = path.join(dir, "replacement.bin")
        yield* Effect.promise(() => Promise.all([Bun.write(file, allowed), Bun.write(replacement, denied)]))

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({})
        const fiber = yield* prompt
          .prompt({
            sessionID: session.id,
            noReply: true,
            parts: [
              { type: "text", text: "Read @binary.bin" },
              {
                type: "file",
                mime: "application/octet-stream",
                filename: "binary.bin",
                url: pathToFileURL(file).href,
              },
            ],
          })
          .pipe(Effect.forkScoped)
        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const requests = yield* permission.list()
            return requests.find((request) => request.sessionID === session.id && request.permission === "read")
          }),
          "binary attachment read permission was never requested",
          "15 seconds",
        )

        yield* Effect.promise(() => rename(replacement, file))
        yield* permission.reply({ requestID: pending.id, reply: "once" })
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          const text = exit.value.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
          expect(text).not.toContain(allowed)
          expect(text).not.toContain(denied)
          expect(text).toContain("changed after authorization")
          expect(exit.value.parts.some((part) => part.type === "file")).toBe(false)
        }
      }),
      {
        git: true,
        config: (url) => ({
          ...providerCfg(url),
          permission: { read: { "*": "allow", "binary.bin": "ask" } },
        }),
      },
    ),
  30_000,
)

it.live(
  "does not load nearby instructions while expanding a file mention",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const allowed = "KILO_12133_ALLOWED_FILE_SENTINEL"
        const denied = "KILO_12133_DENIED_INSTRUCTION_SENTINEL"
        const fs = yield* FSUtil.Service
        yield* fs.ensureDir(path.join(dir, "nested"))
        yield* Effect.promise(() =>
          Promise.all([
            Bun.write(path.join(dir, "nested", "file.txt"), allowed),
            Bun.write(path.join(dir, "nested", "AGENTS.md"), denied),
            Bun.write(path.join(dir, ".kilocodeignore"), "nested/AGENTS.md\n"),
          ]),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})
        const message = yield* prompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: yield* prompt.resolvePromptParts("Read @nested/file.txt"),
        })
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")

        expect(text).toContain(allowed)
        expect(text).not.toContain(denied)
        expect(text).not.toContain("Instructions from:")
      }),
      { git: true, config: providerCfg },
    ),
  30_000,
)

it.live(
  "does not inline directory children and blocks denied binary attachments",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const folder = path.join(dir, "folder")
        const binary = path.join(dir, "secret.bin")
        const nested = "KILO_12133_DIRECTORY_SENTINEL"
        const direct = "KILO_12133_BINARY_SENTINEL"
        const fs = yield* FSUtil.Service
        yield* fs.ensureDir(folder)
        yield* Effect.promise(() =>
          Promise.all([
            Bun.write(path.join(folder, "public.txt"), "public content"),
            Bun.write(path.join(folder, "private.txt"), nested),
            Bun.write(binary, direct),
          ]),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})
        const directory = yield* prompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: yield* prompt.resolvePromptParts("Read @folder"),
        })
        const file = yield* prompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [
            { type: "text", text: "Read @secret.bin" },
            { type: "file", mime: "application/octet-stream", filename: "secret.bin", url: pathToFileURL(binary).href },
          ],
        })
        const text = [...directory.parts, ...file.parts]
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")

        expect(text).not.toContain(nested)
        expect(text).not.toContain(direct)
        expect(text.match(/prevents you from using this specific tool call/g)).toHaveLength(1)
        expect(file.parts.some((part) => part.type === "file")).toBe(false)
      }),
      {
        git: true,
        config: (url) => ({
          ...providerCfg(url),
          permission: {
            read: {
              "*": "allow",
              "folder/private.txt": "deny",
              "secret.bin": "deny",
            },
          },
        }),
      },
    ),
  30_000,
)

symlinkIt(
  "checks read rules for both symlink names and targets",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const text = "KILO_12133_SYMLINK_TEXT_SENTINEL"
        const binary = "KILO_12133_SYMLINK_BINARY_SENTINEL"
        const privateText = path.join(dir, "private.txt")
        const publicText = path.join(dir, "public.txt")
        const privateBinary = path.join(dir, "private.bin")
        const publicBinary = path.join(dir, "public.bin")
        yield* Effect.promise(async () => {
          await Promise.all([Bun.write(privateText, text), Bun.write(privateBinary, binary)])
          await Promise.all([symlink("private.txt", publicText), symlink("private.bin", publicBinary)])
        })

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})
        const mention = yield* prompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: yield* prompt.resolvePromptParts("Read @public.txt"),
        })
        const attachment = yield* prompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [
            { type: "text", text: "Read @public.bin" },
            {
              type: "file",
              mime: "application/octet-stream",
              filename: "public.bin",
              url: pathToFileURL(publicBinary).href,
            },
          ],
        })
        const content = [...mention.parts, ...attachment.parts]
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")

        expect(content).not.toContain(text)
        expect(content).not.toContain(binary)
        expect(content.match(/prevents you from using this specific tool call/g)).toHaveLength(2)
        expect(attachment.parts.some((part) => part.type === "file")).toBe(false)
      }),
      {
        git: true,
        config: (url) => ({
          ...providerCfg(url),
          permission: {
            read: {
              "*": "allow",
              "private.txt": "deny",
              "private.bin": "deny",
            },
          },
        }),
      },
    ),
  30_000,
)

symlinkIt(
  "does not trust symlink targets outside configured references",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const docs = path.join(dir, "docs")
        const outside = path.join(os.tmpdir(), `kilo-12133-${crypto.randomUUID()}.txt`)
        const sentinel = "KILO_12133_REFERENCE_SYMLINK_SENTINEL"
        const fs = yield* FSUtil.Service
        yield* fs.ensureDir(docs)
        yield* Effect.promise(() => Bun.write(outside, sentinel))
        yield* Effect.addFinalizer(() => Effect.promise(() => rm(outside, { force: true })))
        yield* Effect.promise(() => symlink(outside, path.join(docs, "public.txt")))

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})
        const message = yield* prompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [
            { type: "text", text: "Read @docs/public.txt" },
            {
              type: "file",
              mime: "text/plain",
              filename: "docs/public.txt",
              url: pathToFileURL(path.join(docs, "public.txt")).href,
            },
          ],
        })
        const content = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")

        expect(content).not.toContain(sentinel)
        expect(content).toContain("prevents you from using this specific tool call")
      }),
      {
        git: true,
        config: (url) => ({
          ...providerCfg(url),
          reference: { docs: "./docs" },
          permission: { read: "allow", external_directory: "deny" },
        }),
      },
    ),
  30_000,
)

symlinkIt(
  "does not disclose suggestions through an external symlinked parent",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const outside = path.join(os.tmpdir(), `kilo-12133-missing-${crypto.randomUUID()}`)
        const fs = yield* FSUtil.Service
        yield* fs.ensureDir(outside)
        yield* Effect.addFinalizer(() => Effect.promise(() => rm(outside, { recursive: true, force: true })))
        yield* Effect.promise(() =>
          Promise.all([
            Bun.write(path.join(outside, "missing-secret-name.txt"), "secret"),
            symlink(outside, path.join(dir, "link")),
          ]),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})
        const missing = path.join(dir, "link", "missing-secret")
        const message = yield* prompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [
            { type: "text", text: "Read @link/missing-secret" },
            {
              type: "file",
              mime: "text/plain",
              filename: "link/missing-secret",
              url: pathToFileURL(missing).href,
            },
          ],
        })
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")

        expect(text).not.toContain("missing-secret-name.txt")
        expect(text).toContain("prevents you from using this specific tool call")
      }),
      {
        git: true,
        config: (url) => ({
          ...providerCfg(url),
          permission: { read: "allow", external_directory: "deny" },
        }),
      },
    ),
  30_000,
)

symlinkIt(
  "does not expand a directory attachment after permission approval",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const folder = path.join(dir, "folder")
        const moved = path.join(dir, "moved")
        const outside = path.join(os.tmpdir(), `kilo-12133-directory-${crypto.randomUUID()}`)
        const fs = yield* FSUtil.Service
        yield* fs.ensureDir(folder)
        yield* fs.ensureDir(outside)
        yield* Effect.addFinalizer(() => Effect.promise(() => rm(outside, { recursive: true, force: true })))
        yield* Effect.promise(() =>
          Promise.all([
            Bun.write(path.join(folder, "allowed-name.txt"), "allowed"),
            Bun.write(path.join(outside, "secret-name.txt"), "secret"),
          ]),
        )

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const session = yield* sessions.create({})
        const fiber = yield* prompt
          .prompt({
            sessionID: session.id,
            noReply: true,
            parts: yield* prompt.resolvePromptParts("Read @folder"),
          })
          .pipe(Effect.forkScoped)
        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const requests = yield* permission.list()
            return requests.find((request) => request.sessionID === session.id && request.permission === "read")
          }),
          "directory read permission was never requested",
          "15 seconds",
        )

        yield* Effect.promise(async () => {
          await rename(folder, moved)
          await symlink(outside, folder)
        })
        yield* permission.reply({ requestID: pending.id, reply: "once" })
        const exit = yield* Fiber.await(fiber)
        expect(Exit.isSuccess(exit)).toBe(true)
        if (Exit.isSuccess(exit)) {
          const text = exit.value.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
          expect(text).not.toContain("allowed-name.txt")
          expect(text).not.toContain("secret-name.txt")
          expect(text).toContain("Directory attachments cannot be expanded")
        }
      }),
      {
        git: true,
        config: (url) => ({ ...providerCfg(url), permission: { read: "ask" } }),
      },
    ),
  30_000,
)

it.live(
  "checks read permission without enumerating missing-file suggestions",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const folder = path.join(dir, "private")
        const fs = yield* FSUtil.Service
        yield* fs.ensureDir(folder)
        yield* Effect.promise(() => Bun.write(path.join(folder, "missing-secret-name.txt"), "secret"))

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})
        const missing = path.join(folder, "missing-secret")
        const message = yield* prompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [
            { type: "text", text: "Read @private/missing-secret" },
            {
              type: "file",
              mime: "text/plain",
              filename: "private/missing-secret",
              url: pathToFileURL(missing).href,
            },
          ],
        })
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")

        expect(text).not.toContain("missing-secret-name.txt")
        expect(text).toContain("prevents you from using this specific tool call")
      }),
      {
        git: true,
        config: (url) => ({
          ...providerCfg(url),
          permission: { read: { "*": "allow", "private/*": "deny" } },
        }),
      },
    ),
  30_000,
)

symlinkIt(
  "rejects a denied FIFO attachment without waiting for a writer",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ dir }) {
        const fifo = path.join(dir, "secret.pipe")
        const child = Bun.spawn(["mkfifo", fifo], { stdout: "ignore", stderr: "pipe", windowsHide: true })
        expect(yield* Effect.promise(() => child.exited)).toBe(0)

        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const session = yield* sessions.create({})
        const message = yield* prompt.prompt({
          sessionID: session.id,
          noReply: true,
          parts: [
            { type: "text", text: "Read @secret.pipe" },
            {
              type: "file",
              mime: "text/plain",
              filename: "secret.pipe",
              url: pathToFileURL(fifo).href,
            },
          ],
        })
        const text = message.parts
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n")

        expect(text).toContain("Not a regular file")
      }),
      {
        git: true,
        config: (url) => ({ ...providerCfg(url), permission: { read: "deny" } }),
      },
    ),
  30_000,
)

it.live(
  "global skill shell access can be approved permanently",
  () =>
    provideTmpdirServer(
      Effect.fnUntraced(function* ({ llm }) {
        const prompt = yield* SessionPrompt.Service
        const sessions = yield* Session.Service
        const permission = yield* Permission.Service
        const chat = yield* sessions.create({ title: "Global skill permission" })
        const skill = path.join(Global.Path.config, "skills", chat.id)
        const call = { command: "pwd", workdir: skill, description: "Run global skill resource" }

        yield* Effect.promise(() => fs.mkdir(skill, { recursive: true }))
        yield* Effect.addFinalizer(() =>
          Effect.promise(() => rm(skill, { recursive: true, force: true }).catch(() => {})),
        )
        yield* llm.push(reply().tool("bash", call), reply().text("first complete").stop())

        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "run the skill" }],
        })
        const first = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkScoped)

        const pending = yield* pollWithTimeout(
          Effect.gen(function* () {
            const list = yield* permission.list()
            return list.find((item) => item.sessionID === chat.id)
          }),
          "global skill permission was never surfaced",
          "15 seconds",
        )
        expect(pending?.permission).toBe("external_directory")
        const always = (pending?.always ?? []) as string[]
        expect(always).toHaveLength(1)
        expect(always[0]?.endsWith(`/skills/${chat.id}/*`)).toBe(true)
        const rules = (pending?.metadata?.rules ?? []) as string[]
        expect(rules).toHaveLength(1)
        expect(rules[0]?.endsWith(`/skills/${chat.id}/*`)).toBe(true)
        expect(pending.metadata).not.toMatchObject({ disableAlways: true, configProtected: true })

        yield* permission.reply({ requestID: pending.id, reply: "always" })
        expect(
          Exit.isSuccess(
            yield* awaitWithTimeout(Fiber.await(first), "first global skill run did not finish", "15 seconds"),
          ),
        ).toBe(true)

        yield* llm.push(reply().tool("bash", call), reply().text("second complete").stop())
        yield* prompt.prompt({
          sessionID: chat.id,
          agent: "build",
          noReply: true,
          parts: [{ type: "text", text: "run the skill again" }],
        })
        const second = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkScoped)
        expect(
          Exit.isSuccess(
            yield* awaitWithTimeout(
              Fiber.await(second),
              "trusted global skill prompted a second time",
              "15 seconds",
            ),
          ),
        ).toBe(true)
        expect(yield* permission.list()).toEqual([])
      }),
      {
        git: true,
        config: (url) => ({
          ...providerCfg(url),
          permission: { bash: "allow", external_directory: "allow" },
        }),
      },
    ),
  { timeout: 30_000 },
)

it.live("active tool calls use permissions changed after model streaming starts", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* ({ dir, llm }) {
      const config = yield* Config.Service
      const prompt = yield* SessionPrompt.Service
      const sessions = yield* Session.Service
      const permission = yield* Permission.Service
      const file = path.join(dir, "note.txt")
      const gate = Promise.withResolvers<void>()

      yield* Effect.promise(() => Bun.write(file, "old"))
      yield* llm.push(reply().wait(gate.promise).tool("edit", { filePath: file, oldString: "old", newString: "new" }))

      const chat = yield* sessions.create({ title: "Pinned" })
      yield* prompt.prompt({
        sessionID: chat.id,
        agent: "build",
        noReply: true,
        parts: [{ type: "text", text: "edit note" }],
      })

      const fiber = yield* prompt.loop({ sessionID: chat.id }).pipe(Effect.forkScoped)
      yield* llm.wait(1)
      yield* config.update({ permission: { edit: { "*": "allow" } } } as Config.Info)
      gate.resolve(undefined)

      yield* waitFor(
        "edit without permission prompt",
        Effect.gen(function* () {
          const pending = yield* permission.list()
          if (pending.length) throw new Error("edit permission was requested after config allowed it")
          const text = yield* Effect.promise(() => Bun.file(file).text())
          if (text === "new") return text
        }),
      )

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isSuccess(exit)).toBe(true)
    }),
    {
      git: true,
      config: (url) => ({
        ...providerCfg(url),
        permission: { edit: "ask" },
      }),
    },
  ),
)

const worker = (mode: "subagent" | "all"): AgentSvc.Info => ({
  name: "worker",
  mode,
  permission: Permission.fromConfig({ bash: "ask" }),
  options: {},
})

const bash = (sessionID: Session.Info["id"]) => ({
  sessionID,
  permission: "bash",
  patterns: ["echo 1"],
  always: ["echo 1"],
  metadata: {},
})

// Reproduces #11903: a sync subagent hitting an "ask" rule in a headless run
// used to block forever on a permission prompt no client would ever answer.
it.live("headless run: subagent permission asks fail instead of waiting forever", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* () {
      const permission = yield* Permission.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "Root" })
      const child = yield* sessions.create({ parentID: root.id, title: "Subagent" })
      KiloHeadless.mark(root.id)

      // mode "all" agents are valid subagents too; the deny must not key off agent mode
      const agent = worker("all")
      const err = yield* awaitWithTimeout(
        KiloSessionPrompt.askPermission({
          permission,
          agents: { get: () => Effect.succeed(agent) },
          sessions,
          agent,
          session: child,
          request: bash(child.id),
        }).pipe(Effect.flip),
        "subagent permission ask queued waiting for a human reply instead of failing",
      )

      expect(err).toBeInstanceOf(Permission.DeniedError)
      expect(yield* permission.list()).toEqual([])
      expect(yield* KiloHeadless.denies(child.id)).toBe(true)
      expect(yield* KiloHeadless.denies(root.id)).toBe(false)

      KiloHeadless.clear(root.id)
    }),
    { git: true },
  ),
)

it.live("interactive run: subagent permission asks still queue for a human reply", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* () {
      const permission = yield* Permission.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "Root" })
      const child = yield* sessions.create({ parentID: root.id, title: "Subagent" })

      const agent = worker("subagent")
      const fiber = yield* KiloSessionPrompt.askPermission({
        permission,
        agents: { get: () => Effect.succeed(agent) },
        sessions,
        agent,
        session: child,
        request: bash(child.id),
      }).pipe(Effect.forkScoped)

      const pending = yield* pollWithTimeout(
        Effect.gen(function* () {
          const list = yield* permission.list()
          return list.find((item) => item.sessionID === child.id)
        }),
        "subagent permission ask was never surfaced",
      )
      yield* permission.reply({ requestID: pending.id, reply: "reject" })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
    }),
    { git: true },
  ),
)

it.live("headless run: root session permission asks still queue (only subagents fail)", () =>
  provideTmpdirServer(
    Effect.fnUntraced(function* () {
      const permission = yield* Permission.Service
      const sessions = yield* Session.Service
      const root = yield* sessions.create({ title: "Root" })
      KiloHeadless.mark(root.id)

      const agent = { ...worker("subagent"), mode: "primary" as const }
      const fiber = yield* KiloSessionPrompt.askPermission({
        permission,
        agents: { get: () => Effect.succeed(agent) },
        sessions,
        agent,
        session: root,
        request: bash(root.id),
      }).pipe(Effect.forkScoped)

      const pending = yield* pollWithTimeout(
        Effect.gen(function* () {
          const list = yield* permission.list()
          return list.find((item) => item.sessionID === root.id)
        }),
        "root permission ask was never surfaced",
      )
      yield* permission.reply({ requestID: pending.id, reply: "reject" })

      const exit = yield* Fiber.await(fiber)
      expect(Exit.isFailure(exit)).toBe(true)
      KiloHeadless.clear(root.id)
    }),
    { git: true },
  ),
)
