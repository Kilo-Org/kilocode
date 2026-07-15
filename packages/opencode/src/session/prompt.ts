import { PermissionV1 } from "@opencode-ai/core/v1/permission"
import path from "path"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import os from "os"
import { KiloSessionPrompt } from "@/kilocode/session/prompt" // kilocode_change
import { KiloSessionMessageOrder } from "@/kilocode/session/message-order" // kilocode_change
import { KiloSessionPromptQueue } from "@/kilocode/session/prompt-queue" // kilocode_change
import { KiloSession } from "@/kilocode/session" // kilocode_change
import { KiloCostPropagation } from "@/kilocode/session/cost-propagation" // kilocode_change
import { KiloSessionProcessor } from "@/kilocode/session/processor" // kilocode_change
import { KiloSessionOverflow } from "@/kilocode/session/overflow" // kilocode_change
import { KiloReference } from "@/kilocode/reference/contains" // kilocode_change
import { KiloReadObject } from "@/kilocode/tool/read-object" // kilocode_change
import { isInterrupted } from "@/kilocode/effect/cause" // kilocode_change
import * as SandboxPolicy from "@/kilocode/sandbox/policy" // kilocode_change
import { CommandTimeout } from "@/kilocode/command-timeout" // kilocode_change
import { Suggestion } from "@/kilocode/suggestion" // kilocode_change
import { Question } from "@/question" // kilocode_change
import { BUILTIN_COMMANDS } from "@/kilocode/session/builtin-commands" // kilocode_change
import { legacyReviewMessage } from "@/kilocode/review/command" // kilocode_change
import { zod } from "@opencode-ai/core/effect-zod" // kilocode_change
import { withStatics } from "@opencode-ai/core/schema" // kilocode_change
import { configEntryNameFromPath } from "@/config/entry-name" // kilocode_change
import { SessionID, MessageID, PartID } from "./schema"
import type { NotFoundError } from "@/storage/storage"
import { MessageV2 } from "./message-v2"
import { Log } from "@opencode-ai/core/util/log"
import { SessionRevert } from "./revert"
import { Session } from "./session"
import { Agent } from "../agent/agent"
import { Provider } from "@/provider/provider"

import { type Tool as AITool, tool, jsonSchema } from "ai"
import type { JSONSchema7 } from "@ai-sdk/provider"
import { SessionCompaction } from "./compaction"
import { SystemPrompt } from "./system"
import { Instruction } from "./instruction"
import { Plugin } from "../plugin"
import MAX_STEPS from "../session/prompt/max-steps.txt"
import { ToolRegistry } from "@/tool/registry"
import { MCP } from "../mcp"
import { LSP } from "@/lsp/lsp"
import { ulid } from "ulid"
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import * as Stream from "effect/Stream"
import { Command } from "../command"
import { pathToFileURL, fileURLToPath } from "url"
import { Config } from "@/config/config"
import { ConfigMarkdown } from "@/config/markdown"
import { SessionSummary } from "./summary"
import { NamedError } from "@opencode-ai/core/util/error"
import { SessionProcessor } from "./processor"
import { Tool } from "@/tool/tool"
import { Permission } from "@/permission"
import { SessionStatus } from "./status"
import { LLM } from "./llm"
import { Shell } from "@/shell/shell"
import { ShellID } from "@/tool/shell/id"
import { FSUtil } from "@opencode-ai/core/fs-util"
import { Truncate } from "@/tool/truncate"
import { Image } from "@/image/image"
import { decodeDataUrl } from "@/util/data-url"
import { Cause, Effect, Exit, Latch, Layer, Option, Scope, Context, Schema, Types } from "effect"
import * as EffectLogger from "@opencode-ai/core/effect/logger"
import { InstanceState } from "@/effect/instance-state"
import { InstanceRef } from "@/effect/instance-ref"
import { Instance } from "@/kilocode/instance"
import { EffectBridge } from "@/effect/bridge"
import { TaskTool, type TaskPromptOps } from "@/tool/task"
import { assertExternalDirectoryEffect } from "@/tool/external-directory" // kilocode_change
import { SessionRunState } from "./run-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Database } from "@opencode-ai/core/database/database"
import { SessionEvent } from "@opencode-ai/core/session/event"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { AgentAttachment, FileAttachment, Prompt, ReferenceAttachment, Source } from "@opencode-ai/core/session/prompt"
import { Reference } from "@/reference/reference"
import * as DateTime from "effect/DateTime"
import { eq } from "drizzle-orm"
import { SessionTable } from "@opencode-ai/core/session/sql"
import { referencePromptMetadata, referenceTextPart } from "./prompt/reference"
import { SessionReminders } from "./reminders"
import { SessionTools } from "./tools"
import { LLMEvent } from "@opencode-ai/llm"

// @ts-ignore
globalThis.AI_SDK_LOG_WARNINGS = false

const decodeMessageInfo = Schema.decodeUnknownExit(SessionV1.Info)
const decodeMessagePart = Schema.decodeUnknownExit(SessionV1.Part)

const STRUCTURED_OUTPUT_DESCRIPTION = `Use this tool to return your final response in the requested structured format.

IMPORTANT:
- You MUST call this tool exactly once at the end of your response
- The input must be valid JSON matching the required schema
- Complete all necessary research and tool calls BEFORE calling this tool
- This tool provides your final answer - no further actions are taken after calling it`

const STRUCTURED_OUTPUT_SYSTEM_PROMPT = `IMPORTANT: The user has requested structured output. You MUST use the StructuredOutput tool to provide your final response. Do NOT respond with plain text - you MUST call the StructuredOutput tool with your answer formatted according to the schema.`

export const shouldAskPlanFollowup = KiloSessionPrompt.shouldAskPlanFollowup // kilocode_change - retain Kilo plan handoff policy

// kilocode_change start - persistent tool-output pruning when payload is already large
const REQUEST_PRUNE_BYTES = 1_250_000
// kilocode_change end

const log = Log.create({ service: "session.prompt" })
const elog = EffectLogger.create({ service: "session.prompt" })

function isOrphanedInterruptedTool(part: SessionV1.ToolPart) {
  // cleanup() marks abandoned tool_use blocks this way after retries/aborts.
  // They are not pending work and must not trigger an assistant-prefill request.
  return part.state.status === "error" && part.state.metadata?.interrupted === true
}

export interface Interface {
  readonly cancel: (sessionID: SessionID) => Effect.Effect<void>
  // kilocode_change start - prompt can fail on unmet agent requirements
  readonly prompt: (
    input: PromptInput,
  ) => Effect.Effect<SessionV1.WithParts, Image.Error | Agent.RequirementBlockedError>
  // kilocode_change end
  readonly loop: (input: LoopInput) => Effect.Effect<SessionV1.WithParts>
  readonly shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError>
  // kilocode_change start - commands can fail on unmet agent requirements
  readonly command: (
    input: CommandInput,
  ) => Effect.Effect<SessionV1.WithParts, Image.Error | Agent.RequirementBlockedError>
  // kilocode_change end
  readonly resolvePromptParts: (template: string) => Effect.Effect<PromptInput["parts"]>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/SessionPrompt") {}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const status = yield* SessionStatus.Service
    const sessions = yield* Session.Service
    const agents = yield* Agent.Service
    const provider = yield* Provider.Service
    const processor = yield* SessionProcessor.Service
    const compaction = yield* SessionCompaction.Service
    const plugin = yield* Plugin.Service
    const commands = yield* Command.Service
    const config = yield* Config.Service
    const permission = yield* Permission.Service
    const question = yield* Question.Service // kilocode_change - dismiss superseded pending questions through the shared service
    const fsys = yield* FSUtil.Service
    const mcp = yield* MCP.Service
    const lsp = yield* LSP.Service
    const registry = yield* ToolRegistry.Service
    const truncate = yield* Truncate.Service
    const image = yield* Image.Service
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
    const scope = yield* Scope.Scope
    const instruction = yield* Instruction.Service
    const state = yield* SessionRunState.Service
    const revert = yield* SessionRevert.Service
    const summary = yield* SessionSummary.Service
    const sys = yield* SystemPrompt.Service
    const llm = yield* LLM.Service
    const references = yield* Reference.Service

    // kilocode_change start - helper to enrich "Agent not found" with frontmatter parse warnings
    const prefixes = ["agent/", "agents/", "mode/", "modes/"]
    const entry = (file: string) => {
      const normalized = file.replaceAll("\\", "/")
      const relative = normalized.match(/(?:^|\/)((?:agents?|modes?)\/.+)$/)?.[1]
      return relative ? configEntryNameFromPath(relative, prefixes) : undefined
    }
    const agentNotFoundMessage = Effect.fn("SessionPrompt.agentNotFoundMessage")(function* (name: string) {
      const available = (yield* agents.list()).filter((a) => !a.hidden).map((a) => a.name)
      const hint = available.length ? ` Available agents: ${available.join(", ")}.` : ""
      const list = yield* config.warnings()
      const reason = list.find((warning) => entry(warning.path) === name)
      if (reason)
        return `Agent "${name}" could not be loaded because its config file has invalid frontmatter: ${reason.message}${hint}`
      return `Agent not found: "${name}".${hint}`
    })
    // kilocode_change end
    const events = yield* EventV2Bridge.Service
    const flags = yield* RuntimeFlags.Service
    const database = yield* Database.Service
    const { db } = database
    const ops = Effect.fn("SessionPrompt.ops")(function* () {
      return {
        cancel: (sessionID: SessionID) => cancel(sessionID),
        resolvePromptParts: (template: string) => resolvePromptParts(template),
        prompt: (input: PromptInput) => prompt(input).pipe(Effect.catch(Effect.die)),
      } satisfies TaskPromptOps
    })

    const cancel = Effect.fn("SessionPrompt.cancel")(function* (sessionID: SessionID) {
      yield* elog.info("cancel", { sessionID })
      yield* KiloSessionPrompt.cancelTree({ sessionID, sessions, cancel: state.cancel }) // kilocode_change - stop queued work and subagents
    })

    const resolveReferenceParts = Effect.fnUntraced(function* (template: string) {
      const parts: Types.DeepMutable<PromptInput["parts"]> = []
      const seen = new Set<string>()
      yield* Effect.forEach(
        ConfigMarkdown.files(template),
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          const alias = name.split("/")[0]
          if (!alias || seen.has(alias)) return
          const reference = yield* references.get(alias)
          if (!reference) return
          seen.add(alias)

          const start = match.index ?? 0
          const source = { value: match[0], start, end: start + match[0].length }
          if (reference.kind === "invalid") {
            parts.push(referenceTextPart({ reference, source }))
            return
          }

          yield* references.ensure(reference.path)
          parts.push({
            type: "file",
            url: pathToFileURL(reference.path).href,
            filename: alias,
            mime: "application/x-directory",
            source: { type: "file", text: source, path: alias },
          })
        }),
        { concurrency: 1, discard: true },
      )
      return parts
    })

    const resolvePromptParts = Effect.fn("SessionPrompt.resolvePromptParts")(function* (template: string) {
      const ctx = yield* InstanceState.context
      const parts: Types.DeepMutable<PromptInput["parts"]> = [
        { type: "text", text: template },
        ...(yield* resolveReferenceParts(template)),
      ]
      const files = ConfigMarkdown.files(template)
      const seen = new Set<string>()
      yield* Effect.forEach(
        files,
        Effect.fnUntraced(function* (match) {
          const name = match[1]
          if (!name) return
          if (seen.has(name)) return
          seen.add(name)

          const slash = name.indexOf("/")
          const alias = slash === -1 ? name : name.slice(0, slash)
          if (yield* references.get(alias)) return

          const filepath = name.startsWith("~/")
            ? path.join(os.homedir(), name.slice(2))
            : path.resolve(ctx.worktree, name)

          const info = yield* fsys.stat(filepath).pipe(Effect.option)
          if (Option.isNone(info)) {
            const found = yield* agents.get(name)
            if (found) parts.push({ type: "agent", name: found.name })
            return
          }
          const stat = info.value
          parts.push({
            type: "file",
            url: pathToFileURL(filepath).href,
            filename: name,
            mime: stat.type === "Directory" ? "application/x-directory" : "text/plain",
          })
        }),
        { concurrency: "unbounded", discard: true },
      )
      return parts
    })

    const title = Effect.fn("SessionPrompt.ensureTitle")(function* (input: {
      session: Session.Info
      history: SessionV1.WithParts[]
      providerID: ProviderV2.ID
      modelID: ModelV2.ID
    }) {
      if (input.session.parentID) return
      if (!Session.isDefaultTitle(input.session.title)) return

      const real = (m: SessionV1.WithParts) =>
        m.info.role === "user" && !m.parts.every((p) => "synthetic" in p && p.synthetic)
      const idx = input.history.findIndex(real)
      if (idx === -1) return
      if (input.history.filter(real).length !== 1) return

      const context = input.history.slice(0, idx + 1)
      const firstUser = context[idx]
      if (!firstUser || firstUser.info.role !== "user") return
      const firstInfo = firstUser.info

      const subtasks = firstUser.parts.filter((p): p is SessionV1.SubtaskPart => p.type === "subtask")
      const onlySubtasks = subtasks.length > 0 && firstUser.parts.every((p) => p.type === "subtask")

      const ag = yield* agents.get("title")
      if (!ag) return
      const mdl = ag.model
        ? yield* provider.getModel(ag.model.providerID, ag.model.modelID)
        : ((yield* provider.getSmallModel(input.providerID)) ??
          (yield* provider.getModel(input.providerID, input.modelID)))
      const msgs = onlySubtasks
        ? [{ role: "user" as const, content: subtasks.map((p) => p.prompt).join("\n") }]
        : yield* MessageV2.toModelMessagesEffect(context, mdl).pipe(
            Effect.provideService(Database.Service, database), // kilocode_change - provide the migrated message store
          )
      const text = yield* llm
        .stream({
          agent: ag,
          user: firstInfo,
          system: [],
          small: true,
          tools: {},
          model: mdl,
          sessionID: KiloSessionPrompt.titleID(input.session.id), // kilocode_change - isolate title requests from the agent task
          retries: 2,
          messages: [{ role: "user", content: "Generate a title for this conversation:\n" }, ...msgs],
        })
        .pipe(
          Stream.filter(LLMEvent.is.textDelta),
          Stream.map((e) => e.text),
          Stream.mkString,
          Effect.orDie,
        )
      const cleaned = text
        .replace(/<think>[\s\S]*?<\/think>\s*/g, "")
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0)
      if (!cleaned) return
      const t = cleaned.length > 100 ? cleaned.substring(0, 97) + "..." : cleaned
      yield* sessions
        .setTitle({ sessionID: input.session.id, title: t })
        .pipe(Effect.catchCause((cause) => elog.error("failed to generate title", { error: Cause.squash(cause) })))
    })

    const handleSubtask = Effect.fn("SessionPrompt.handleSubtask")(function* (input: {
      task: SessionV1.SubtaskPart
      model: Provider.Model
      lastUser: SessionV1.User
      sessionID: SessionID
      session: Session.Info
      msgs: SessionV1.WithParts[]
    }) {
      const { task, model, lastUser, sessionID, session, msgs } = input
      const ctx = yield* InstanceState.context
      const promptOps = yield* ops()
      const { task: taskTool } = yield* registry.named()
      const taskModel = task.model ? yield* getModel(task.model.providerID, task.model.modelID, sessionID) : model
      const assistantMessage: SessionV1.Assistant = yield* sessions.updateMessage({
        id: MessageID.ascending(),
        role: "assistant",
        parentID: lastUser.id,
        sessionID,
        mode: task.agent,
        agent: task.agent,
        variant: lastUser.model.variant,
        path: { cwd: ctx.directory, root: ctx.worktree },
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
        modelID: taskModel.id,
        providerID: taskModel.providerID,
        time: { created: Date.now() },
      })
      let part: SessionV1.ToolPart = yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: assistantMessage.id,
        sessionID: assistantMessage.sessionID,
        type: "tool",
        callID: ulid(),
        tool: TaskTool.id,
        state: {
          status: "running",
          input: {
            prompt: task.prompt,
            description: task.description,
            subagent_type: task.agent,
            command: task.command,
          },
          time: { start: Date.now() },
        },
      })
      const taskArgs = {
        prompt: task.prompt,
        description: task.description,
        subagent_type: task.agent,
        command: task.command,
      }
      yield* plugin.trigger(
        "tool.execute.before",
        { tool: TaskTool.id, sessionID, callID: part.id },
        { args: taskArgs },
      )

      const taskAgent = yield* agents.get(task.agent)
      if (!taskAgent) {
        const message = yield* agentNotFoundMessage(task.agent)
        const error = new NamedError.Unknown({ message })
        yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
        throw error
      }

      let error: Error | undefined
      const taskAbort = new AbortController()
      // kilocode_change start - shared reader for the child session id written by task.ts ctx.metadata (#6321)
      const childID = () => {
        const meta = part.state.status !== "pending" ? part.state.metadata : undefined
        return (meta as { sessionId?: string } | undefined)?.sessionId
      }
      // kilocode_change end
      const result = yield* taskTool
        .execute(taskArgs, {
          agent: task.agent,
          messageID: assistantMessage.id,
          sessionID,
          abort: taskAbort.signal,
          callID: part.callID,
          extra: { bypassAgentCheck: true, promptOps },
          messages: msgs,
          metadata: (val: { title?: string; metadata?: Record<string, any> }) =>
            Effect.gen(function* () {
              part = yield* sessions.updatePart({
                ...part,
                type: "tool",
                state: { ...part.state, ...val },
              } satisfies SessionV1.ToolPart)
            }),
          // kilocode_change start - resolve permissions at ask time so active tools see config edits
          ask: (req: any) =>
            KiloSessionPrompt.askPermission({
              permission,
              agents,
              sessions,
              agent: taskAgent,
              session,
              request: {
                ...req,
                sessionID,
              },
            }).pipe(Effect.orDie),
          // kilocode_change end
        })
        .pipe(
          Effect.catchCause((cause) => {
            const defect = Cause.squash(cause)
            error = defect instanceof Error ? defect : new Error(String(defect))
            log.error("subtask execution failed", { error, agent: task.agent, description: task.description })
            return Effect.void
          }),
          Effect.onInterrupt(() =>
            Effect.gen(function* () {
              taskAbort.abort()
              assistantMessage.finish = "tool-calls"
              assistantMessage.time.completed = Date.now()
              // kilocode_change start - propagate partial subagent cost on cancel (#6321)
              const cid = childID()
              if (cid) {
                assistantMessage.cost = yield* KiloCostPropagation.childCost(sessions, SessionID.make(cid))
              }
              // kilocode_change end
              yield* sessions.updateMessage(assistantMessage)
              if (part.state.status === "running") {
                yield* sessions.updatePart({
                  ...part,
                  state: {
                    status: "error",
                    error: "Cancelled",
                    time: { start: part.state.time.start, end: Date.now() },
                    metadata: part.state.metadata,
                    input: part.state.input,
                  },
                } satisfies SessionV1.ToolPart)
              }
            }),
          ),
        )

      const attachments = result?.attachments?.map((attachment) => ({
        ...attachment,
        id: PartID.ascending(),
        sessionID,
        messageID: assistantMessage.id,
      }))

      yield* plugin.trigger(
        "tool.execute.after",
        { tool: TaskTool.id, sessionID, callID: part.id, args: taskArgs },
        result,
      )

      assistantMessage.finish = "tool-calls"
      assistantMessage.time.completed = Date.now()
      // kilocode_change start - include subagent total cost on the wrapper message (#6321)
      const cid = result?.metadata?.sessionId ?? childID()
      if (cid) {
        assistantMessage.cost = yield* KiloCostPropagation.childCost(sessions, SessionID.make(cid))
      }
      // kilocode_change end
      yield* sessions.updateMessage(assistantMessage)

      if (result && part.state.status === "running") {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "completed",
            input: part.state.input,
            title: result.title,
            metadata: result.metadata,
            output: result.output,
            attachments,
            time: { ...part.state.time, end: Date.now() },
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!result) {
        yield* sessions.updatePart({
          ...part,
          state: {
            status: "error",
            error: error ? `Tool execution failed: ${error.message}` : "Tool execution failed",
            time: {
              start: part.state.status === "running" ? part.state.time.start : Date.now(),
              end: Date.now(),
            },
            metadata: part.state.status === "pending" ? undefined : part.state.metadata,
            input: part.state.input,
          },
        } satisfies SessionV1.ToolPart)
      }

      if (!task.command) return

      const summaryUserMsg: SessionV1.User = {
        id: MessageID.ascending(),
        sessionID,
        role: "user",
        time: { created: Date.now() },
        agent: lastUser.agent,
        model: lastUser.model,
        editorContext: lastUser.editorContext, // kilocode_change — preserve editor context
      }
      yield* sessions.updateMessage(summaryUserMsg)
      yield* sessions.updatePart({
        id: PartID.ascending(),
        messageID: summaryUserMsg.id,
        sessionID,
        type: "text",
        text: "Summarize the task tool output above and continue with your task.",
        synthetic: true,
      } satisfies SessionV1.TextPart)
    })

    const shellImpl = Effect.fn("SessionPrompt.shellImpl")(function* (input: ShellInput, ready?: Latch.Latch) {
      return yield* Effect.uninterruptibleMask((restore) =>
        Effect.gen(function* () {
          const markReady = ready ? ready.open.pipe(Effect.asVoid) : Effect.void
          const { msg, part, cwd } = yield* Effect.gen(function* () {
            const ctx = yield* InstanceState.context
            const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
            if (session.revert) {
              yield* revert.cleanup(session)
            }
            const agent = yield* agents.get(input.agent)
            if (!agent) {
              const message = yield* agentNotFoundMessage(input.agent)
              const error = new NamedError.Unknown({ message })
              yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
              throw error
            }
            const model = input.model ?? agent.model ?? (yield* currentModel(input.sessionID))
            const userMsg: SessionV1.User = {
              id: input.messageID ?? MessageID.ascending(),
              sessionID: input.sessionID,
              time: { created: Date.now() },
              role: "user",
              agent: input.agent,
              model: { providerID: model.providerID, modelID: model.modelID },
            }
            yield* sessions.updateMessage(userMsg)
            const userPart: SessionV1.Part = {
              type: "text",
              id: PartID.ascending(),
              messageID: userMsg.id,
              sessionID: input.sessionID,
              text: "The following tool was executed by the user",
              synthetic: true,
            }
            yield* sessions.updatePart(userPart)

            const msg: SessionV1.Assistant = {
              id: MessageID.ascending(),
              sessionID: input.sessionID,
              parentID: userMsg.id,
              mode: input.agent,
              agent: input.agent,
              cost: 0,
              path: { cwd: ctx.directory, root: ctx.worktree },
              time: { created: Date.now() },
              role: "assistant",
              tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
              modelID: model.modelID,
              providerID: model.providerID,
            }
            yield* sessions.updateMessage(msg)
            const callID = ulid() // kilocode_change - correlate v2 shell events with the persisted tool part
            const started = Date.now()
            const part: SessionV1.ToolPart = {
              type: "tool",
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: input.sessionID,
              tool: ShellID.ToolID,
              callID, // kilocode_change
              state: {
                status: "running",
                time: { start: started },
                input: { command: input.command },
              },
            }
            yield* sessions.updatePart(part)
            if (flags.experimentalEventSystem) {
              yield* events.publish(SessionEvent.Shell.Started, {
                sessionID: input.sessionID,
                messageID: SessionMessage.ID.create(),
                timestamp: DateTime.makeUnsafe(started),
                callID: part.callID,
                command: input.command,
              })
            }
            return { msg, part, cwd: ctx.directory }
          }).pipe(Effect.ensuring(markReady))

          const cfg = yield* config.get()
          const sh = Shell.preferred(cfg.shell)
          const args = Shell.args(sh, input.command, cwd)
          let output = ""
          let aborted = false
          let timeout: string | undefined // kilocode_change

          const finish = Effect.uninterruptible(
            Effect.gen(function* () {
              if (aborted) {
                output += "\n\n" + ["<metadata>", "User aborted the command", "</metadata>"].join("\n")
              }
              if (timeout) output += "\n\n" + ["<metadata>", timeout, "</metadata>"].join("\n") // kilocode_change
              const completed = Date.now()
              if (flags.experimentalEventSystem) {
                yield* events.publish(SessionEvent.Shell.Ended, {
                  sessionID: input.sessionID,
                  timestamp: DateTime.makeUnsafe(completed),
                  callID: part.callID,
                  output,
                })
              }
              if (!msg.time.completed) {
                msg.time.completed = completed
                yield* sessions.updateMessage(msg)
              }
              if (part.state.status === "running") {
                part.state = {
                  status: "completed",
                  time: { ...part.state.time, end: completed },
                  input: part.state.input,
                  title: "",
                  metadata: { output, description: "" },
                  output,
                }
                yield* sessions.updatePart(part)
              }
            }),
          )

          const exit = yield* restore(
            Effect.gen(function* () {
              const shellEnv = yield* plugin.trigger(
                "shell.env",
                { cwd, sessionID: input.sessionID, callID: part.callID },
                { env: {} },
              )
              const cmd = ChildProcess.make(sh, args, {
                cwd,
                extendEnv: true,
                env: { ...shellEnv.env, TERM: "dumb" },
                stdin: "ignore",
                forceKillAfter: "3 seconds",
              })
              const handle = yield* spawner.spawn(cmd)
              // kilocode_change start
              timeout = yield* CommandTimeout.drain(
                handle,
                Stream.runForEach(Stream.decodeText(handle.all), (chunk) =>
                  Effect.gen(function* () {
                    output += chunk
                    if (part.state.status === "running") {
                      part.state.metadata = { output, description: "" }
                      yield* sessions.updatePart(part)
                    }
                  }),
                ),
                "shell command terminated",
              )
              // kilocode_change end
            }).pipe(Effect.scoped, Effect.orDie),
          ).pipe(Effect.exit)

          if (Exit.isFailure(exit) && Cause.hasInterrupts(exit.cause) && !Cause.hasDies(exit.cause)) {
            aborted = true
          }
          yield* finish

          if (Exit.isFailure(exit) && !aborted && !Cause.hasInterruptsOnly(exit.cause)) {
            return yield* Effect.failCause(exit.cause)
          }

          return { info: msg, parts: [part] }
        }),
      )
    })

    const getModel = Effect.fn("SessionPrompt.getModel")(function* (
      providerID: ProviderV2.ID,
      modelID: ModelV2.ID,
      sessionID: SessionID,
    ) {
      const exit = yield* provider.getModel(providerID, modelID).pipe(Effect.exit)
      if (Exit.isSuccess(exit)) return exit.value
      if (isInterrupted(exit.cause)) return yield* Effect.interrupt // kilocode_change
      const err = Cause.squash(exit.cause)
      if (Provider.ModelNotFoundError.isInstance(err)) {
        const hint = err.suggestions?.length ? ` Did you mean: ${err.suggestions.join(", ")}?` : ""
        const empty = err.modelsEmpty ? " No models are currently available." : "" // kilocode_change
        yield* events.publish(Session.Event.Error, {
          sessionID,
          error: new NamedError.Unknown({
            message: `Model not found: ${err.providerID}/${err.modelID}.${hint}${empty}`, // kilocode_change
          }).toObject(),
        })
      }
      return yield* Effect.die(err)
    })

    const currentModel = Effect.fnUntraced(function* (sessionID: SessionID) {
      const current = yield* db
        .select({ model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, sessionID))
        .get()
        .pipe(Effect.orDie)
      if (current?.model) {
        return {
          providerID: ProviderV2.ID.make(current.model.providerID),
          modelID: ModelV2.ID.make(current.model.id),
          ...(current.model.variant && current.model.variant !== "default" ? { variant: current.model.variant } : {}),
        }
      }
      const match = yield* sessions
        .findMessage(sessionID, (m) => m.info.role === "user" && !!m.info.model)
        .pipe(Effect.orDie)
      if (Option.isSome(match) && match.value.info.role === "user") return match.value.info.model
      return yield* provider.defaultModel().pipe(Effect.orDie)
    })

    const createUserMessage = Effect.fn("SessionPrompt.createUserMessage")(function* (input: PromptInput) {
      const agentName = input.agent
      const ag = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo() // kilocode_change
      if (!ag) {
        const message = yield* agentNotFoundMessage(agentName ?? "(none)") // kilocode_change
        const error = new NamedError.Unknown({ message }) // kilocode_change
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() }) // kilocode_change
        throw error // kilocode_change
      }
      yield* agents.guardRequirements(ag) // kilocode_change - enforce requirements before creating a turn

      const current = yield* db
        .select({ agent: SessionTable.agent, model: SessionTable.model })
        .from(SessionTable)
        .where(eq(SessionTable.id, input.sessionID))
        .get()
        .pipe(Effect.orDie)
      const model = input.model ?? ag.model ?? (yield* currentModel(input.sessionID))
      // kilocode_change start - retain the source session variant across Agent Manager's model-less fork handoff
      const stored = !input.model && !ag.model ? model : undefined
      const same = ag.model && model.providerID === ag.model.providerID && model.modelID === ag.model.modelID
      const full =
        !input.variant && ag.variant && same
          ? yield* provider
              .getModel(model.providerID, model.modelID)
              .pipe(Effect.catchIf(Provider.ModelNotFoundError.isInstance, () => Effect.succeed(undefined)))
          : undefined
      const variant =
        input.variant ??
        (stored && "variant" in stored && typeof stored.variant === "string" ? stored.variant : undefined) ??
        (ag.variant && full?.variants?.[ag.variant] ? ag.variant : undefined)
      // kilocode_change end

      const info: SessionV1.User = {
        id: input.messageID ?? MessageID.ascending(),
        role: "user",
        sessionID: input.sessionID,
        time: { created: Date.now() },
        tools: { ...input.tools, ...input.ephemeralTools }, // kilocode_change - apply non-persistent remote tool restrictions
        agent: ag.name,
        model: {
          providerID: model.providerID,
          modelID: model.modelID,
          variant,
        },
        system: input.system,
        format: input.format,
        editorContext: input.editorContext, // kilocode_change
      }

      if (current?.agent !== info.agent) {
        yield* events.publish(SessionEvent.AgentSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(info.time.created),
          agent: info.agent,
        })
      }
      if (
        current?.model?.providerID !== info.model.providerID ||
        current.model.id !== info.model.modelID ||
        (current.model.variant === "default" ? undefined : current.model.variant) !== info.model.variant
      ) {
        yield* events.publish(SessionEvent.ModelSwitched, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(info.time.created),
          model: {
            id: ModelV2.ID.make(info.model.modelID),
            providerID: ProviderV2.ID.make(info.model.providerID),
            variant: ModelV2.VariantID.make(info.model.variant ?? "default"),
          },
        })
      }

      yield* Effect.addFinalizer(() => instruction.clear(info.id))

      type Draft<T> = T extends SessionV1.Part ? Omit<T, "id"> & { id?: string } : never
      const assign = (part: Draft<SessionV1.Part>): SessionV1.Part => ({
        ...part,
        id: part.id ? PartID.make(part.id) : PartID.ascending(),
      })

      const referenceContextFromFilePart = Effect.fnUntraced(function* (
        part: Extract<PromptInput["parts"][number], { type: "file" }>,
        filepath: string,
      ) {
        const name = part.filename?.replace(/#\d+(?:-\d*)?$/, "")
        if (!name) return
        const slash = name.indexOf("/")
        if (slash === -1) return

        const reference = yield* references.get(name.slice(0, slash))
        if (!reference || reference.kind === "invalid") return
        if (!FSUtil.contains(reference.path, filepath)) return

        const target = path.relative(reference.path, filepath).split(path.sep).join("/")
        if (!target || target.startsWith("../") || target === "..") return

        // kilocode_change start - carry the reference root for bound-target authorization
        return {
          root: reference.path,
          part: referenceTextPart({
            reference,
            source: part.source?.text ?? { value: `@${name}`, start: 0, end: name.length + 1 },
            target,
            targetPath: filepath,
          }),
        }
        // kilocode_change end
      })

      // kilocode_change start
      const networkRestricted = yield* SandboxPolicy.networkRestricted(input.sessionID).pipe(
        Effect.provideService(Config.Service, config),
        Effect.provideService(Database.Service, database),
        Effect.provideService(InstanceRef, Instance.current),
      )
      // kilocode_change end
      const resolvePart: (part: PromptInput["parts"][number]) => Effect.Effect<Draft<SessionV1.Part>[]> = Effect.fn(
        "SessionPrompt.resolveUserPart",
      )(function* (part) {
        if (part.type === "file") {
          if (part.source?.type === "resource") {
            const { clientName, uri } = part.source
            log.info("mcp resource", { clientName, uri, mime: part.mime })
            const pieces: Draft<SessionV1.Part>[] = [
              {
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Reading MCP resource: ${part.filename} (${uri})`,
              },
            ]
            // kilocode_change start
            const exit = yield* (
              networkRestricted
                ? Effect.fail(new Error("Sandbox denied MCP resource access"))
                : mcp.readResource(clientName, uri)
            ).pipe(Effect.exit)
            // kilocode_change end
            if (Exit.isSuccess(exit)) {
              const content = exit.value
              if (!content) throw new Error(`Resource not found: ${clientName}/${uri}`)
              const items = Array.isArray(content.contents) ? content.contents : [content.contents]
              for (const c of items) {
                if ("text" in c && c.text) {
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: c.text,
                  })
                } else if ("blob" in c && c.blob) {
                  const mime = "mimeType" in c ? c.mimeType : part.mime
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `[Binary content: ${mime}]`,
                  })
                }
              }
              pieces.push({ ...part, messageID: info.id, sessionID: input.sessionID })
            } else {
              const error = Cause.squash(exit.cause)
              log.error("failed to read MCP resource", { error, clientName, uri })
              const message = error instanceof Error ? error.message : String(error)
              pieces.push({
                messageID: info.id,
                sessionID: input.sessionID,
                type: "text",
                synthetic: true,
                text: `Failed to read MCP resource ${part.filename}: ${message}`,
              })
            }
            return pieces
          }
          const url = new URL(part.url)
          switch (url.protocol) {
            case "data:":
              if (part.mime === "text/plain") {
                return [
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify({ filePath: part.filename })}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: decodeDataUrl(part.url),
                  },
                  { ...part, messageID: info.id, sessionID: input.sessionID },
                ]
              }
              // kilocode_change start - normalize user image data before persistence
              if (part.mime.startsWith("image/")) {
                const file: MessageV2.FilePart = {
                  ...part,
                  id: part.id ? PartID.make(part.id) : PartID.ascending(),
                  messageID: info.id,
                  sessionID: input.sessionID,
                }
                return [yield* image.normalize(file).pipe(Effect.orDie)]
              }
              // kilocode_change end
              break
            case "file:": {
              log.info("file", { mime: part.mime })
              const filepath = fileURLToPath(part.url)
              // kilocode_change start
              const reference = yield* referenceContextFromFilePart(part, filepath)
              const referenceContext = reference?.part
              // kilocode_change end
              const mime = (yield* fsys.isDir(filepath)) ? "application/x-directory" : part.mime

              const { read } = yield* registry.named()
              // kilocode_change start - authorize prompt attachments like model-issued read calls
              const controller = new AbortController()
              const ask: Tool.Context["ask"] = (request) =>
                Effect.gen(function* () {
                  const session = yield* sessions.get(input.sessionID)
                  yield* KiloSessionPrompt.askPermission({
                    permission,
                    agents,
                    sessions,
                    agent: ag,
                    session,
                    request: {
                      ...request,
                      sessionID: input.sessionID,
                    },
                  })
                }).pipe(Effect.orDie)
              const ctx = (extra?: Tool.Context["extra"]): Tool.Context => ({
                sessionID: input.sessionID,
                abort: controller.signal,
                agent: ag.name,
                messageID: info.id,
                extra: { ...extra, referenceRoot: reference?.root, includeInstructions: false, denyDirectory: true },
                messages: [],
                metadata: () => Effect.void,
                ask,
              })
              // kilocode_change end
              const execRead = (args: Parameters<typeof read.execute>[0], extra?: Tool.Context["extra"]) => {
                return read
                  .execute(args, ctx(extra)) // kilocode_change - enforce read and external_directory permissions
                  .pipe(Effect.onInterrupt(() => Effect.sync(() => controller.abort())))
              }

              if (mime === "text/plain") {
                let offset: number | undefined
                let limit: number | undefined
                const range = { start: url.searchParams.get("start"), end: url.searchParams.get("end") }
                if (range.start != null) {
                  const filePathURI = part.url.split("?")[0]
                  let start = parseInt(range.start)
                  let end = range.end ? parseInt(range.end) : undefined
                  if (start === end) {
                    const symbols = yield* lsp.documentSymbol(filePathURI).pipe(Effect.catch(() => Effect.succeed([])))
                    for (const symbol of symbols) {
                      let r: LSP.Range | undefined
                      if ("range" in symbol) r = symbol.range
                      else if ("location" in symbol) r = symbol.location.range
                      if (r?.start?.line && r?.start?.line === start) {
                        start = r.start.line
                        end = r?.end?.line ?? start
                        break
                      }
                    }
                  }
                  offset = Math.max(start, 1)
                  if (end) limit = end - (offset - 1)
                }
                const args = { filePath: filepath, offset, limit }
                const pieces: Draft<SessionV1.Part>[] = [
                  ...(referenceContext
                    ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                    : []),
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                ]
                const exit = yield* provider.getModel(info.model.providerID, info.model.modelID).pipe(
                  Effect.flatMap((mdl) => execRead(args, { model: mdl })),
                  Effect.exit,
                )
                if (Exit.isSuccess(exit)) {
                  const result = exit.value
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: result.output,
                  })
                  if (result.attachments?.length) {
                    pieces.push(
                      ...result.attachments.map((a) => ({
                        ...a,
                        synthetic: true,
                        filename: a.filename ?? part.filename,
                        messageID: info.id,
                        sessionID: input.sessionID,
                      })),
                    )
                  } else {
                    pieces.push({ ...part, mime, messageID: info.id, sessionID: input.sessionID })
                  }
                } else {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read file", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  pieces.push({
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  })
                }
                return pieces
              }

              if (mime === "application/x-directory") {
                const args = { filePath: filepath }
                const exit = yield* execRead(args).pipe(Effect.exit) // kilocode_change - list only; child bytes need separate reads
                if (Exit.isFailure(exit)) {
                  const error = Cause.squash(exit.cause)
                  log.error("failed to read directory", { error })
                  const message = error instanceof Error ? error.message : String(error)
                  yield* events.publish(Session.Event.Error, {
                    sessionID: input.sessionID,
                    error: new NamedError.Unknown({ message }).toObject(),
                  })
                  return [
                    ...(referenceContext
                      ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                      : []),
                    {
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "text",
                      synthetic: true,
                      text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                    },
                  ]
                }
                return [
                  ...(referenceContext
                    ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                    : []),
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Called the Read tool with the following input: ${JSON.stringify(args)}`,
                  },
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: exit.value.output,
                  },
                  { ...part, mime, messageID: info.id, sessionID: input.sessionID },
                ]
              }

              // kilocode_change start - authorize metadata, then reopen and verify before consuming bytes
              const access = yield* Effect.gen(function* () {
                const file = yield* KiloReadObject.file(filepath)
                const instance = yield* InstanceState.context
                const context = ctx()
                const explicit = reference ? yield* KiloReference.path(fsys, reference.root, file.target) : false
                const referenced =
                  explicit ||
                  ((yield* references.contains(filepath)) &&
                    (yield* KiloReference.contains({ fs: fsys, references, target: file.target })))
                yield* assertExternalDirectoryEffect(context, file.target, { bypass: referenced, kind: "file" })
                yield* context.ask({
                  permission: "read",
                  patterns: [...new Set([filepath, file.target].map((item) => path.relative(instance.worktree, item)))],
                  always: ["*"],
                  metadata: {},
                })

                return yield* KiloReadObject.use(file, (bound) =>
                  Effect.gen(function* () {
                    const limit = mime.startsWith("image/")
                      ? ((yield* config.get()).attachment?.image?.max_base64_bytes ?? Image.MAX_BASE64_BYTES)
                      : undefined
                    const raw = limit === undefined ? undefined : Math.floor(limit / 4) * 3 + 1
                    const bytes = yield* Effect.tryPromise({
                      try: (signal) => bound.read(raw, AbortSignal.any([context.abort, signal])),
                      catch: (err) => (err instanceof Error ? err : new Error(String(err))),
                    })
                    if (limit !== undefined) {
                      const encoded = Math.ceil(bytes.byteLength / 3) * 4
                      if (encoded > limit) {
                        return yield* Effect.fail(
                          new Image.SizeError({
                            bytes: encoded,
                            max: limit,
                            width: 0,
                            height: 0,
                            max_width: 0,
                            max_height: 0,
                          }),
                        )
                      }
                    }
                    const file: MessageV2.FilePart = {
                      id: part.id ? PartID.make(part.id) : PartID.ascending(),
                      messageID: info.id,
                      sessionID: input.sessionID,
                      type: "file",
                      url: `data:${mime};base64,${bytes.toString("base64")}`,
                      mime,
                      filename: part.filename!,
                      source: part.source,
                    }
                    return mime.startsWith("image/") ? yield* image.normalize(file) : file
                  }),
                )
              }).pipe(Effect.exit)
              if (Exit.isFailure(access)) {
                const error = Cause.squash(access.cause)
                if (
                  error instanceof Image.InvalidDataUrlError ||
                  error instanceof Image.DecodeError ||
                  error instanceof Image.SizeError
                )
                  return yield* Effect.die(error)
                log.error("failed to read file", { error })
                const message = error instanceof Error ? error.message : String(error)
                yield* events.publish(Session.Event.Error, {
                  sessionID: input.sessionID,
                  error: new NamedError.Unknown({ message }).toObject(),
                })
                return [
                  ...(referenceContext
                    ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }]
                    : []),
                  {
                    messageID: info.id,
                    sessionID: input.sessionID,
                    type: "text",
                    synthetic: true,
                    text: `Read tool failed to read ${filepath} with the following error: ${message}`,
                  },
                ]
              }
              // kilocode_change end
              return [
                ...(referenceContext ? [{ ...referenceContext, messageID: info.id, sessionID: input.sessionID }] : []),
                {
                  messageID: info.id,
                  sessionID: input.sessionID,
                  type: "text",
                  synthetic: true,
                  text: `Called the Read tool with the following input: {"filePath":"${filepath}"}`,
                },
                access.value, // kilocode_change - retain the attachment read through the authorized object
              ]
            }
          }
        }

        if (part.type === "agent") {
          const perm = Permission.evaluate("task", part.name, ag.permission)
          const hint = perm.action === "deny" ? " . Invoked by user; guaranteed to exist." : ""
          return [
            { ...part, messageID: info.id, sessionID: input.sessionID },
            {
              messageID: info.id,
              sessionID: input.sessionID,
              type: "text",
              synthetic: true,
              text:
                " Use the above message and context to generate a prompt and call the task tool with subagent: " +
                part.name +
                hint,
            },
          ]
        }

        return [{ ...part, messageID: info.id, sessionID: input.sessionID }]
      })

      const submittedParts: Types.DeepMutable<PromptInput["parts"]> = [...input.parts]
      const attachedReferences = new Set(
        input.parts.flatMap((part) =>
          part.type === "file" && part.mime === "application/x-directory" ? [part.url] : [],
        ),
      )
      for (const part of input.parts) {
        if (part.type !== "text" || part.synthetic) continue
        for (const reference of yield* resolveReferenceParts(part.text)) {
          if (reference.type === "file" && attachedReferences.has(reference.url)) continue
          if (reference.type === "file") attachedReferences.add(reference.url)
          submittedParts.push(reference)
        }
      }

      const resolvedParts = yield* Effect.forEach(submittedParts, resolvePart, { concurrency: "unbounded" }).pipe(
        Effect.map((x) => x.flat().map(assign)),
      )

      yield* plugin.trigger(
        "chat.message",
        {
          sessionID: input.sessionID,
          agent: input.agent,
          model: input.model,
          messageID: input.messageID,
          variant: input.variant,
        },
        { message: info, parts: resolvedParts },
      )

      // kilocode_change - kilo normalizes images inside resolvePart, so there is no separate normalization pass here (unlike upstream)
      const parts = resolvedParts

      const parsed = decodeMessageInfo(info, { errors: "all", propertyOrder: "original" })
      if (Exit.isFailure(parsed)) {
        log.error("invalid user message before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          agent: info.agent,
          model: info.model,
          cause: Cause.pretty(parsed.cause),
        })
      }
      parts.forEach((part, index) => {
        const p = decodeMessagePart(part, { errors: "all", propertyOrder: "original" })
        if (Exit.isSuccess(p)) return
        log.error("invalid user part before save", {
          sessionID: input.sessionID,
          messageID: info.id,
          partID: part.id,
          partType: part.type,
          index,
          cause: Cause.pretty(p.cause),
          part,
        })
      })

      yield* sessions.updateMessage(info)
      for (const part of parts) yield* sessions.updatePart(part)
      const nextPrompt = parts.reduce(
        (result, part) => {
          if (part.type === "text") {
            if (part.synthetic) result.synthetic.push(part.text)
            else result.text.push(part.text)
            const reference = referencePromptMetadata(part.metadata?.reference)
            if (reference) {
              result.references.push(
                new ReferenceAttachment({
                  name: reference.name,
                  kind: reference.kind,
                  uri: reference.path ? pathToFileURL(reference.path).href : undefined,
                  repository: reference.repository,
                  branch: reference.branch,
                  target: reference.target,
                  targetUri: reference.targetPath ? pathToFileURL(reference.targetPath).href : undefined,
                  problem: reference.problem,
                  source: new Source({
                    start: reference.source.start,
                    end: reference.source.end,
                    text: reference.source.value,
                  }),
                }),
              )
            }
          }
          if (part.type === "file") {
            result.files.push(
              new FileAttachment({
                uri: part.url,
                mime: part.mime,
                name: part.filename,
                source: part.source
                  ? new Source({
                      start: part.source.text.start,
                      end: part.source.text.end,
                      text: part.source.text.value,
                    })
                  : undefined,
              }),
            )
          }
          if (part.type === "agent") {
            result.agents.push(
              new AgentAttachment({
                name: part.name,
                source: part.source
                  ? new Source({
                      start: part.source.start,
                      end: part.source.end,
                      text: part.source.value,
                    })
                  : undefined,
              }),
            )
          }
          return result
        },
        {
          text: [] as string[],
          files: [] as FileAttachment[],
          agents: [] as AgentAttachment[],
          references: [] as ReferenceAttachment[],
          synthetic: [] as string[],
        },
      )
      // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
      if (flags.experimentalEventSystem) {
        yield* events.publish(SessionEvent.Prompted, {
          sessionID: input.sessionID,
          messageID: SessionMessage.ID.create(),
          timestamp: DateTime.makeUnsafe(info.time.created),
          delivery: "steer",
          prompt: new Prompt({
            text: nextPrompt.text.join("\n"),
            files: nextPrompt.files,
            agents: nextPrompt.agents,
            references: nextPrompt.references,
          }),
        })
      }
      for (const text of nextPrompt.synthetic) {
        // TODO(v2): Temporary dual-write while migrating session messages to v2 events.
        if (flags.experimentalEventSystem) {
          yield* events.publish(SessionEvent.Synthetic, {
            sessionID: input.sessionID,
            messageID: SessionMessage.ID.create(),
            timestamp: DateTime.makeUnsafe(info.time.created),
            text,
          })
        }
      }

      return { info, parts }
    }, Effect.scoped)

    const prompt: Interface["prompt"] = Effect.fn("SessionPrompt.prompt")(
      function* (input: PromptInput) {
        const session = yield* sessions.get(input.sessionID).pipe(Effect.orDie)
        yield* revert.cleanup(session)
        // kilocode_change start - recover interrupted Kilo turns before accepting a follow-up
        yield* KiloSessionPrompt.recoverDanglingAssistant({ sessionID: input.sessionID, status, sessions })
        yield* KiloSessionPrompt.recoverProviderFinishError({ sessionID: input.sessionID, status, sessions })
        // kilocode_change end
        const message = yield* KiloSessionPrompt.intake(input.sessionID, createUserMessage(input)) // kilocode_change
        yield* sessions.touch(input.sessionID)

        const permissions: PermissionV1.Rule[] = []
        for (const [t, enabled] of Object.entries(input.tools ?? {})) {
          permissions.push({ permission: t, action: enabled ? "allow" : "deny", pattern: "*" })
        }
        if (permissions.length > 0) {
          // kilocode_change start - preserve inherited task restrictions while refreshing prompt tool toggles
          const merged = KiloSessionPrompt.mergeToolPermissions({
            existing: session.permission ?? [],
            toggles: permissions,
          })
          session.permission = merged
          yield* sessions.setPermission({ sessionID: session.id, permission: merged })
          // kilocode_change end
        }

        // kilocode_change start — unblock tools waiting on user input so any in-flight
        // handle.process can return. Adding a new user message is the signal that any
        // pending tool prompt is superseded, so we dismiss even on the noReply path.
        // Critically we never cancel the in-flight fiber here — that would abort the
        // streamText call mid-tokens and cut off the assistant reply. The enqueue call
        // below serializes this prompt after the current turn's current LLM step, and
        // runLoop checks hasFollowup between steps to break out once it has been
        // enqueued during the turn.
        yield* Effect.promise(() => Suggestion.dismissAll(input.sessionID))
        yield* question.dismissAll(input.sessionID)
        if (input.noReply === true) return message
        // Queue tails and runner fibers can resume outside the HTTP request's
        // ambient instance context; bridge both Effect refs and legacy ALS.
        const bridge = yield* EffectBridge.make()
        return yield* KiloSessionPromptQueue.enqueue(
          input.sessionID,
          message.info.id,
          bridge.run(
            loop({ sessionID: input.sessionID, snapshotInitialization: input.snapshotInitialization }).pipe(
              Effect.orDie,
            ),
          ), // kilocode_change
          bridge.run(lastAssistant(input.sessionID)),
        )
        // kilocode_change end
      },
      Effect.catchTag("NotFoundError", Effect.die),
    )

    const lastAssistant = Effect.fnUntraced(function* (sessionID: SessionID) {
      // kilocode_change start - retry when cancel races before shellImpl writes messages
      for (let attempt = 0; attempt < 10; attempt++) {
        const match = yield* sessions.findMessage(sessionID, (m) => m.info.role !== "user")
        if (Option.isSome(match)) return match.value
        const msgs = yield* sessions.messages({ sessionID, limit: 1 })
        if (msgs.length > 0) return msgs[0]
        yield* Effect.sleep("50 millis")
      }
      // kilocode_change end
      throw new Error("Impossible")
    })

    // kilocode_change — mutable close-reason per session, set by runLoop and read by loop
    const closeReasons = new Map<string, KiloSession.CloseReason>()

    // kilocode_change start - retain request-scoped snapshot initialization policy
    const runLoop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts, NotFoundError> = Effect.fn(
      "SessionPrompt.run",
    )(function* (input: LoopInput) {
      const sessionID = input.sessionID
      // kilocode_change end
      // kilocode_change — cache environment details per turn (prompt caching)
      const envCache: KiloSessionPrompt.EnvCache = {}
      const memoryCache = KiloSessionPrompt.memoryCache() // kilocode_change
      closeReasons.delete(sessionID) // kilocode_change
      let compactionAttempts = 0 // kilocode_change - cap compaction attempts per turn to avoid infinite loops
      const ctx = yield* InstanceState.context
      const slog = elog.with({ sessionID })
      let structured: unknown
      let step = 0
      const session = yield* sessions.get(sessionID).pipe(Effect.orDie)

      while (true) {
        yield* status.set(sessionID, { type: "busy" })
        yield* slog.info("loop", { step })

        // kilocode_change start - provide the upstream Effect database to Kilo's retained prompt loop
        let msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
          Effect.provideService(Database.Service, database),
        )
        // kilocode_change end
        msgs = KiloSessionPromptQueue.scope(sessionID, msgs) // kilocode_change - hide later queued prompts
        msgs = KiloSessionPrompt.trimBeforeLastSummary(msgs) // kilocode_change - trim on any completed summary (e.g. manual /compact against a text user)

        // kilocode_change start - select loop state by chronology after retained-tail projection
        const latest = KiloSessionMessageOrder.latest(msgs)
        const { user: lastUser, assistant: lastAssistant, finished: lastFinished, tasks } = latest
        // kilocode_change end

        if (!lastUser) throw new Error("No user message found in stream. This should never happen.")

        const lastAssistantMsg = msgs.findLast(
          (msg) => msg.info.role === "assistant" && msg.info.id === lastAssistant?.id,
        )
        // kilocode_change start - compare chronology, not generated IDs
        const userBeforeAssistant =
          latest.userMessage &&
          latest.assistantMessage &&
          KiloSessionMessageOrder.compare(latest.userMessage, latest.assistantMessage) < 0
        // kilocode_change end
        // kilocode_change start - carry local review command marker into LLM telemetry
        const telemetry =
          KiloSessionProcessor.extractReviewTelemetry(
            msgs.findLast((m) => m.info.role === "user" && m.info.id === lastUser.id)?.parts ?? [],
          ) ?? KiloSessionProcessor.extractSuggestionReviewTelemetry(lastAssistantMsg?.parts ?? [])
        // kilocode_change end

        // Some providers return "stop" even when the assistant message contains
        // tool calls. Keep the loop running so tool results can be sent back to
        // the model, but ignore cleanup-marked interrupted orphans.
        const hasToolCalls =
          lastAssistantMsg?.parts.some(
            (part) => part.type === "tool" && !part.metadata?.providerExecuted && !isOrphanedInterruptedTool(part),
          ) ?? false

        // kilocode_change start - plan_exit is a hard stop before another model call
        if (
          lastAssistant?.finish &&
          hasToolCalls &&
          lastAssistant.parentID === lastUser.id &&
          userBeforeAssistant &&
          KiloSessionPrompt.shouldAskPlanFollowup({ messages: msgs, abort: AbortSignal.any([]) })
        ) {
          const action = yield* Effect.promise((signal) =>
            KiloSessionPrompt.askPlanFollowup({ sessionID, messages: msgs, abort: signal, question }),
          )
          if (action === "continue") continue
          yield* slog.info("exiting loop")
          break
        }
        // kilocode_change end

        if (
          lastAssistant?.finish &&
          !["tool-calls"].includes(lastAssistant.finish) &&
          !hasToolCalls &&
          lastAssistant.parentID === lastUser.id && // kilocode_change - unrelated later assistants do not answer this turn
          userBeforeAssistant // kilocode_change - compare chronology, not generated IDs
        ) {
          const orphan = lastAssistantMsg?.parts.find(
            (part): part is MessageV2.ToolPart => part.type === "tool" && isOrphanedInterruptedTool(part),
          )
          if (orphan) {
            yield* slog.warn("loop exit with orphaned interrupted tool", {
              messageID: lastAssistant.id,
              tool: orphan.tool,
              callID: orphan.callID,
            })
          }
          yield* slog.info("exiting loop")
          break
        }

        step++
        if (step === 1)
          yield* title({
            session,
            modelID: lastUser.model.modelID,
            providerID: lastUser.model.providerID,
            history: msgs,
          }).pipe(Effect.ignore, Effect.forkIn(scope))

        const model = yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID)
        const task = tasks.pop()

        if (task?.type === "subtask") {
          yield* handleSubtask({ task, model, lastUser, sessionID, session, msgs })
          continue
        }

        if (task?.type === "compaction") {
          const result = yield* compaction.process({
            messages: msgs,
            parentID: lastUser.id,
            sessionID,
            auto: task.auto,
            overflow: task.overflow,
          })
          // kilocode_change start - compaction.process only returns "stop" after
          // setting ContextOverflowError on the summary message; surface as turn error
          if (result === "stop") {
            closeReasons.set(sessionID, "error")
            break
          }
          // kilocode_change end
          continue
        }

        if (
          lastFinished &&
          lastFinished.summary !== true &&
          (yield* compaction.isOverflow({ tokens: lastFinished.tokens, model }))
        ) {
          // kilocode_change start
          const guard = KiloSessionPrompt.guardCompactionAttempt({
            sessionID,
            attempts: compactionAttempts,
            closeReasons,
            message: lastFinished,
          })
          if (guard.exhausted) {
            // lastFinished is a prior turn's assistant — record exhaustion on the
            // message whose size tipped us past the compaction cap.
            yield* sessions.updateMessage(lastFinished)
            yield* events.publish(Session.Event.Error, { sessionID, error: guard.error })
            break
          }
          compactionAttempts++
          // kilocode_change end
          yield* compaction.create({ sessionID, agent: lastUser.agent, model: lastUser.model, auto: true })
          continue
        }

        const agent = yield* agents.get(lastUser.agent)
        if (!agent) {
          const message = yield* agentNotFoundMessage(lastUser.agent)
          const error = new NamedError.Unknown({ message })
          yield* events.publish(Session.Event.Error, { sessionID, error: error.toObject() })
          throw error
        }
        const maxSteps = agent.steps ?? Infinity
        const isLastStep = step >= maxSteps
        msgs = yield* SessionReminders.apply({ messages: msgs, agent, session }).pipe(
          Effect.provideService(RuntimeFlags.Service, flags),
          Effect.provideService(FSUtil.Service, fsys),
          Effect.provideService(Session.Service, sessions),
        )

        const msg: MessageV2.Assistant = {
          id: MessageID.ascending(),
          parentID: lastUser.id,
          role: "assistant",
          mode: agent.name,
          agent: agent.name,
          variant: lastUser.model.variant,
          path: { cwd: ctx.directory, root: ctx.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: model.id,
          providerID: model.providerID,
          time: { created: Date.now() },
          sessionID,
        }
        yield* sessions.updateMessage(msg)
        const finalize = Effect.gen(function* () {
          if (msg.time.completed) return
          msg.error ??= MessageV2.fromError(new DOMException("Aborted", "AbortError"), {
            providerID: msg.providerID,
            aborted: true,
          })
          msg.time.completed = Date.now()
          yield* sessions.updateMessage(msg)
        })
        const handle = yield* processor
          .create({
            assistantMessage: msg,
            sessionID,
            model,
            telemetry, // kilocode_change
            snapshotInitialization: input.snapshotInitialization, // kilocode_change
          })
          .pipe(Effect.onInterrupt(() => finalize))

        const outcome: "break" | "continue" = yield* Effect.gen(function* () {
          const lastUserMsg = msgs.findLast((m) => m.info.role === "user")
          const bypassAgentCheck = lastUserMsg?.parts.some((p) => p.type === "agent") ?? false
          const promptOps = yield* ops()

          const tools = yield* SessionTools.resolve({
            agent,
            session,
            model,
            processor: handle,
            bypassAgentCheck,
            messages: msgs,
            promptOps,
            memoryCache, // kilocode_change
          }).pipe(
            Effect.provideService(Plugin.Service, plugin),
            Effect.provideService(Permission.Service, permission),
            Effect.provideService(Agent.Service, agents), // kilocode_change
            Effect.provideService(Session.Service, sessions), // kilocode_change
            Effect.provideService(ToolRegistry.Service, registry),
            Effect.provideService(MCP.Service, mcp),
            Effect.provideService(Truncate.Service, truncate),
            // kilocode_change start - SWE-Pruner (experimental)
            Effect.provideService(Config.Service, config),
            Effect.provideService(Provider.Service, provider),
            Effect.provideService(Database.Service, database),
            // kilocode_change end
          )

          if (lastUser.format?.type === "json_schema") {
            tools["StructuredOutput"] = createStructuredOutputTool({
              schema: lastUser.format.schema,
              onSuccess(output) {
                structured = output
              },
            })
          }

          if (step === 1)
            yield* summary.summarize({ sessionID, messageID: lastUser.id }).pipe(Effect.ignore, Effect.forkIn(scope))

          if (step > 1 && lastFinished) {
            for (const m of msgs) {
              // kilocode_change start - compare chronology, not generated IDs
              const finishedBeforeMessage =
                latest.finishedMessage && KiloSessionMessageOrder.compare(latest.finishedMessage, m) < 0
              if (m.info.role !== "user" || !finishedBeforeMessage) continue
              // kilocode_change end
              for (const p of m.parts) {
                if (p.type !== "text" || p.ignored || p.synthetic) continue
                if (!p.text.trim()) continue
                p.text = [
                  "<system-reminder>",
                  "The user sent the following message:",
                  p.text,
                  "",
                  "Please address this message and continue with your tasks.",
                  "</system-reminder>",
                ].join("\n")
              }
            }
          }

          yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })

          // kilocode_change start — ephemeral context injection + post-summary
          // media strip (keeps outgoing body under the gateway body-size limit
          // even when filterCompacted couldn't trim the pre-summary history).
          KiloSessionPrompt.injectEditorContext({ msgs, lastUser, sessionID, cache: envCache })
          msgs = KiloSessionPrompt.maybeStripHistoricalMedia(msgs)
          // kilocode_change end

          // kilocode_change start - persistently prune stale tool outputs when payload is already large
          const [skills, env, mem, instructions] = yield* Effect.all([
            sys.skills(agent),
            sys.environment(model, lastUser.editorContext), // kilocode_change
            KiloSessionPrompt.memoryInject({ ctx, sessionID, record: step === 1, cache: memoryCache }), // kilocode_change
            instruction.system().pipe(Effect.orDie),
          ])
          let modelMsgs = yield* MessageV2.toModelMessagesEffect(msgs, model).pipe(
            Effect.provideService(Database.Service, database),
          )
          const size = Buffer.byteLength(JSON.stringify(modelMsgs))
          if (size > REQUEST_PRUNE_BYTES) {
            yield* compaction.prune({ sessionID, reason: "payload-limit" })
            msgs = yield* MessageV2.filterCompactedEffect(sessionID).pipe(
              Effect.provideService(Database.Service, database),
            )
            msgs = KiloSessionPromptQueue.scope(sessionID, msgs)
            msgs = KiloSessionPrompt.trimBeforeLastSummary(msgs)
            yield* plugin.trigger("experimental.chat.messages.transform", {}, { messages: msgs })
            KiloSessionPrompt.injectEditorContext({ msgs, lastUser, sessionID, cache: envCache })
            msgs = KiloSessionPrompt.maybeStripHistoricalMedia(msgs)
            modelMsgs = yield* MessageV2.toModelMessagesEffect(msgs, model).pipe(
              Effect.provideService(Database.Service, database),
            )
            const nextSize = Buffer.byteLength(JSON.stringify(modelMsgs))
            if (nextSize > REQUEST_PRUNE_BYTES) log.warn("payload still large after pruning", { size: nextSize })
          }
          // kilocode_change end
          const system = [...env, ...mem, ...instructions, ...(skills ? [skills] : [])] // kilocode_change
          const format = lastUser.format ?? { type: "text" as const }
          if (format.type === "json_schema") system.push(STRUCTURED_OUTPUT_SYSTEM_PROMPT)
          const result = yield* handle.process({
            // kilocode_change start - keep Ask/Plan tool filtering hardened against session allows
            user: lastUser,
            agent,
            permission: KiloSessionPrompt.guardPermissions({ agent, session }),
            // kilocode_change end
            sessionID,
            parentSessionID: session.parentID,
            system,
            messages: [...modelMsgs, ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS }] : [])],
            tools,
            model,
            toolChoice: format.type === "json_schema" ? "required" : undefined,
            // kilocode_change start - feed the provider-reported context size from the last finished
            // turn into the output-token cap, so image/vision input is measured by the provider
            // rather than by encoded payload bytes (see KiloLLM.capOutputTokens). Summary messages
            // are skipped like in the isOverflow check above: their reported input reflects the
            // pre-compaction history, not the trimmed context of the next request.
            reportedContextTokens:
              lastFinished && lastFinished.summary !== true
                ? KiloSessionOverflow.count(lastFinished.tokens)
                : undefined,
            // kilocode_change end
          })

          // kilocode_change start - persist a lightweight marker when this assistant step had memory context
          const marker = KiloSessionPrompt.memoryPart({ sessionID, message: handle.message, cache: memoryCache })
          if (marker) yield* sessions.updatePart(marker)
          // kilocode_change end

          if (structured !== undefined) {
            handle.message.structured = structured
            handle.message.finish = handle.message.finish ?? "stop"
            yield* sessions.updateMessage(handle.message)
            return "break" as const
          }

          const finished = handle.message.finish && !["tool-calls", "unknown"].includes(handle.message.finish)
          if (finished && !handle.message.error) {
            if (format.type === "json_schema") {
              handle.message.error = new MessageV2.StructuredOutputError({
                message: "Model did not produce structured output",
                retries: 0,
              }).toObject()
              yield* sessions.updateMessage(handle.message)
              return "break" as const
            }
            // kilocode_change start
            if (handle.message.finish === "error") {
              KiloSessionProcessor.providerFinishError(handle.message)
              yield* sessions.updateMessage(handle.message)
              closeReasons.set(sessionID, "error")
              return "break" as const
            }
            // kilocode_change end
          }

          // kilocode_change start
          if (result === "stop") {
            if (handle.message.error) closeReasons.set(sessionID, "error")
            return "break" as const
          }
          // kilocode_change end
          if (result === "compact") {
            // kilocode_change start
            const guard = KiloSessionPrompt.guardCompactionAttempt({
              sessionID,
              attempts: compactionAttempts,
              closeReasons,
              message: handle.message,
            })
            if (guard.exhausted) {
              yield* sessions.updateMessage(handle.message)
              yield* events.publish(Session.Event.Error, { sessionID, error: guard.error })
              return "break" as const
            }
            compactionAttempts++
            // kilocode_change end
            yield* compaction.create({
              sessionID,
              agent: lastUser.agent,
              model: lastUser.model,
              auto: true,
              // kilocode_change - preflight compaction replays the pending turn without treating media as provider overflow
              overflow: !handle.message.finish && handle.compactError?.() !== undefined, // kilocode_change
            })
          }
          // kilocode_change start — break out so a newer queued prompt can take over
          // instead of starting another LLM step for the now-superseded turn. The
          // current handle.process has fully drained (tokens + inline tool calls) by
          // the time we get here, so nothing is cut off.
          if (KiloSessionPromptQueue.hasFollowup(sessionID)) {
            closeReasons.set(sessionID, "interrupted")
            return "break" as const
          }
          // kilocode_change end
          // kilocode_change start - guard against providers that end the stream
          // without a terminal stop_reason (e.g. an Anthropic-style message_delta
          // with stop_reason: null followed immediately by message_stop). Without
          // a finishReason, the loop-exit check at the top of the next iteration
          // sees a falsy `finish` (loaded from storage via filterCompactedEffect)
          // and keeps stepping forever. Default to "unknown" and persist so the
          // regular break condition fires when there are no tool calls. Skipped
          // for the compact path so guardCompactionAttempt can still fill in
          // "error" on exhaustion. Tool-call turns already get "tool-calls" from
          // the AI SDK; even without it, !hasToolCalls keeps the break gated.
          if (result !== "compact" && !handle.message.finish) {
            handle.message.finish = "unknown"
            yield* sessions.updateMessage(handle.message)
          }
          // kilocode_change end
          return "continue" as const
        }).pipe(
          Effect.ensuring(instruction.clear(handle.message.id)),
          Effect.onInterrupt(() => finalize),
        )
        if (outcome === "break") break
        continue
      }

      yield* compaction.prune({ sessionID, reason: "normal" }).pipe(Effect.ignore, Effect.forkIn(scope))
      return yield* lastAssistant(sessionID)
    })

    const loop: (input: LoopInput) => Effect.Effect<MessageV2.WithParts, NotFoundError> = Effect.fn(
      "SessionPrompt.loop",
    )(function* (input: LoopInput) {
      // kilocode_change start
      const session = yield* sessions.get(input.sessionID)
      yield* KiloSessionPrompt.recoverDanglingAssistant({ sessionID: input.sessionID, status, sessions })
      yield* KiloSessionPrompt.recoverProviderFinishError({ sessionID: input.sessionID, status, sessions })
      yield* KiloSession.publishTurnOpen({ sessionID: input.sessionID })
      return yield* Effect.onExit(
        state.ensureRunning(
          input.sessionID,
          lastAssistant(input.sessionID).pipe(Effect.orDie),
          runLoop(input).pipe(Effect.orDie),
        ), // kilocode_change
        Effect.fnUntraced(function* (exit) {
          yield* KiloSession.publishTurnClose({
            sessionID: input.sessionID,
            parentID: session.parentID,
            reason: KiloSessionPrompt.resolveCloseReason({
              sessionID: input.sessionID,
              closeReasons,
              exit,
            }),
          })
        }),
      )
      // kilocode_change end
    })

    const shell: (input: ShellInput) => Effect.Effect<SessionV1.WithParts, Session.BusyError> = Effect.fn(
      "SessionPrompt.shell",
    )(function* (input: ShellInput) {
      const ready = yield* Latch.make()
      return yield* state.startShell(
        input.sessionID,
        lastAssistant(input.sessionID).pipe(Effect.orDie),
        shellImpl(input, ready),
        ready,
      )
    })

    const command = Effect.fn("SessionPrompt.command")(function* (input: CommandInput) {
      yield* elog.info("command", { sessionID: input.sessionID, command: input.command, agent: input.agent })
      const cmd = yield* commands.get(input.command)
      if (!cmd) {
        const available = (yield* commands.list()).map((c) => c.name)
        available.push(...BUILTIN_COMMANDS) // kilocode_change - surface built-in session commands in error hint
        available.sort() // kilocode_change - alphabetical for stable, easy-to-scan output
        const hint = available.length ? ` Available commands: ${available.join(", ")}` : ""
        const error = new NamedError.Unknown({ message: `Command not found: "${input.command}".${hint}` })
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
        throw error
      }
      const agentName = cmd.agent ?? input.agent
      // kilocode_change start - deprecated review aliases should display a static notice without an LLM turn
      const legacy = legacyReviewMessage(input.command)
      if (legacy) {
        const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo()
        if (!agent) {
          const message = yield* agentNotFoundMessage(agentName ?? "(none)")
          const error = new NamedError.Unknown({ message })
          yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() })
          throw error
        }
        const model = yield* Effect.gen(function* () {
          if (cmd.model) return Provider.parseModel(cmd.model)
          if (cmd.agent && agent.model) return agent.model
          if (input.model) return Provider.parseModel(input.model)
          return yield* currentModel(input.sessionID)
        })
        yield* getModel(model.providerID, model.modelID, input.sessionID)
        const text = `/${input.command}${input.arguments ? ` ${input.arguments}` : ""}`
        const user = yield* KiloSessionPrompt.intake(
          input.sessionID,
          createUserMessage({
            sessionID: input.sessionID,
            messageID: input.messageID,
            model,
            agent: agent.name,
            variant: input.variant,
            parts: [{ type: "text", text }, ...(input.parts ?? [])],
          }),
        )
        yield* sessions.touch(input.sessionID)
        const ctx = yield* InstanceState.context
        const completed = Date.now()
        const info: MessageV2.Assistant = yield* sessions.updateMessage({
          id: MessageID.ascending(),
          role: "assistant",
          parentID: user.info.id,
          sessionID: input.sessionID,
          mode: agent.name,
          agent: agent.name,
          variant: user.info.model.variant,
          path: { cwd: ctx.directory, root: ctx.worktree },
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          modelID: user.info.model.modelID,
          providerID: user.info.model.providerID,
          time: { created: completed, completed },
          finish: "stop",
        })
        const part: MessageV2.TextPart = yield* sessions.updatePart({
          id: PartID.ascending(),
          messageID: info.id,
          sessionID: input.sessionID,
          type: "text",
          text: legacy,
        })
        const result = { info, parts: [part] }
        yield* events.publish(Command.Event.Executed, {
          name: input.command,
          sessionID: input.sessionID,
          arguments: input.arguments,
          messageID: result.info.id,
        })
        return result
      }
      // kilocode_change end

      const raw = input.arguments.match(argsRegex) ?? []
      const args = raw.map((arg) => arg.replace(quoteTrimRegex, ""))
      const templateCommand = yield* Effect.promise(async () => cmd.template)

      const placeholders = templateCommand.match(placeholderRegex) ?? []
      let last = 0
      for (const item of placeholders) {
        const value = Number(item.slice(1))
        if (value > last) last = value
      }

      const withArgs = templateCommand.replaceAll(placeholderRegex, (_, index) => {
        const position = Number(index)
        const argIndex = position - 1
        if (argIndex >= args.length) return ""
        if (position === last) return args.slice(argIndex).join(" ")
        return args[argIndex]
      })
      const usesArgumentsPlaceholder = templateCommand.includes("$ARGUMENTS")
      let template = withArgs.replaceAll("$ARGUMENTS", input.arguments)

      if (placeholders.length === 0 && !usesArgumentsPlaceholder && input.arguments.trim()) {
        template = template + "\n\n" + input.arguments
      }

      const shellMatches = ConfigMarkdown.shell(template)
      if (shellMatches.length > 0) {
        const cfg = yield* config.get()
        const sh = Shell.preferred(cfg.shell)
        // kilocode_change start
        const results = yield* CommandTimeout.texts(
          shellMatches.map(([, cmd]) => cmd),
          sh,
        ).pipe(Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner))
        // kilocode_change end
        let index = 0
        template = template.replace(bashRegex, () => results[index++])
      }
      template = template.trim()

      const taskModel = yield* Effect.gen(function* () {
        if (cmd.model) return Provider.parseModel(cmd.model)
        if (cmd.agent) {
          const cmdAgent = yield* agents.get(cmd.agent)
          if (cmdAgent?.model) return cmdAgent.model
        }
        if (input.model) return Provider.parseModel(input.model)
        return yield* currentModel(input.sessionID)
      })

      yield* getModel(taskModel.providerID, taskModel.modelID, input.sessionID)

      const agent = agentName ? yield* agents.get(agentName) : yield* agents.defaultInfo() // kilocode_change
      if (!agent) {
        const message = yield* agentNotFoundMessage(agentName ?? "(none)") // kilocode_change
        const error = new NamedError.Unknown({ message }) // kilocode_change
        yield* events.publish(Session.Event.Error, { sessionID: input.sessionID, error: error.toObject() }) // kilocode_change
        throw error // kilocode_change
      }
      yield* agents.guardRequirements(agent) // kilocode_change - command agent overrides must satisfy requirements

      const templateParts = yield* resolvePromptParts(template)
      KiloSessionProcessor.markReviewTelemetry(templateParts, input.command) // kilocode_change - mark review commands for completion telemetry
      const isSubtask = (agent.mode === "subagent" && cmd.subtask !== false) || cmd.subtask === true
      const parts = isSubtask
        ? [
            {
              type: "subtask" as const,
              agent: agent.name,
              description: cmd.description ?? "",
              command: input.command,
              model: { providerID: taskModel.providerID, modelID: taskModel.modelID },
              prompt: templateParts.find((y) => y.type === "text")?.text ?? "",
            },
          ]
        : [...templateParts, ...(input.parts ?? [])]

      const userAgent = isSubtask ? (input.agent ?? (yield* agents.defaultInfo()).name) : agent.name
      const userModel = isSubtask
        ? input.model
          ? Provider.parseModel(input.model)
          : yield* currentModel(input.sessionID)
        : taskModel

      yield* plugin.trigger(
        "command.execute.before",
        { command: input.command, sessionID: input.sessionID, arguments: input.arguments },
        { parts },
      )

      const result = yield* prompt({
        sessionID: input.sessionID,
        messageID: input.messageID,
        model: userModel,
        agent: userAgent,
        parts,
        variant: input.variant,
        snapshotInitialization: input.snapshotInitialization, // kilocode_change
      })
      yield* events.publish(Command.Event.Executed, {
        name: input.command,
        sessionID: input.sessionID,
        arguments: input.arguments,
        messageID: result.info.id,
      })
      return result
    })

    return Service.of({
      cancel,
      prompt,
      loop: (input) => loop(input).pipe(Effect.orDie),
      shell,
      command,
      resolvePromptParts,
    })
  }),
)

// kilocode_change start - keep prompt runtime requirements type-checked
export const defaultLayer: Layer.Layer<Service> = Layer.suspend(() =>
  // kilocode_change end
  layer
    .pipe(
      Layer.provide(SessionRunState.defaultLayer),
      Layer.provide(SessionStatus.defaultLayer),
      Layer.provide(SessionCompaction.defaultLayer),
      Layer.provide(SessionProcessor.defaultLayer),
      Layer.provide(Command.defaultLayer),
      Layer.provide(Permission.defaultLayer),
      Layer.provide(Question.defaultLayer), // kilocode_change - provide pending question dismissal dependency
      Layer.provide(MCP.defaultLayer),
      Layer.provide(LSP.defaultLayer),
      Layer.provide(ToolRegistry.defaultLayer),
      Layer.provide(Truncate.defaultLayer),
    )
    .pipe(
      Layer.provide(Provider.defaultLayer),
      Layer.provide(Config.defaultLayer),
      Layer.provide(Instruction.defaultLayer),
      Layer.provide(Database.defaultLayer),
      Layer.provide(FSUtil.defaultLayer),
      Layer.provide(Plugin.defaultLayer),
      Layer.provide(Session.defaultLayer),
      Layer.provide(SessionRevert.defaultLayer),
      Layer.provide(SessionSummary.defaultLayer),
      Layer.provide(Image.defaultLayer), // kilocode_change - provide user image normalization service
      Layer.provide(
        Layer.mergeAll(
          EventV2Bridge.defaultLayer,
          Agent.defaultLayer,
          SystemPrompt.defaultLayer,
          LLM.defaultLayer,
          Reference.defaultLayer,
          CrossSpawnSpawner.defaultLayer,
          RuntimeFlags.defaultLayer,
        ),
      ),
    ),
)
const ModelRef = Schema.Struct({
  providerID: ProviderV2.ID,
  modelID: ModelV2.ID,
})

export const PromptInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  model: Schema.optional(ModelRef),
  agent: Schema.optional(Schema.String),
  noReply: Schema.optional(Schema.Boolean),
  tools: Schema.optional(Schema.Record(Schema.String, Schema.Boolean)).annotate({
    description:
      "@deprecated tools and permissions have been merged, you can set permissions on the session itself now",
  }),
  // kilocode_change start - keep internal ephemeral tool controls out of the public prompt schema
  format: Schema.optional(SessionV1.Format),
  system: Schema.optional(Schema.String),
  variant: Schema.optional(Schema.String),
  // kilocode_change end
  // kilocode_change start - managed product slow-snapshot policy
  snapshotInitialization: Schema.optional(Schema.Literal("wait")).annotate({
    description: "Wait silently if snapshot initialization is slow instead of asking the user.",
  }),
  // kilocode_change end
  // kilocode_change start - reuse shared editor context schema
  editorContext: Schema.optional(MessageV2.EditorContext),
  // kilocode_change end
  parts: Schema.Array(
    Schema.Union([
      SessionV1.TextPartInput,
      SessionV1.FilePartInput,
      SessionV1.AgentPartInput,
      SessionV1.SubtaskPartInput,
    ]).annotate({ discriminator: "type" }),
  ),
}).pipe(withStatics((s) => ({ zod: zod(s) })))
// kilocode_change start - retain precise prompt input types for Kilo callers
// `z.discriminatedUnion` erases the discriminated members' shapes back to
// `{}` when walked from the generic `z.ZodType` input. Restore the precise
// `parts` type from the exported Schema input types so callers see a proper
// tagged union.
type PartInputUnion =
  | MessageV2.TextPartInput
  | MessageV2.FilePartInput
  | MessageV2.AgentPartInput
  | MessageV2.SubtaskPartInput
export type PromptInput = Omit<Schema.Schema.Type<typeof PromptInput>, "parts" | "editorContext"> & {
  parts: PartInputUnion[]
  editorContext?: MessageV2.EditorContext
  ephemeralTools?: Record<string, boolean>
}
// kilocode_change end

export class LoopInput extends Schema.Class<LoopInput>("SessionPrompt.LoopInput")({
  sessionID: SessionID,
  snapshotInitialization: Schema.optional(Schema.Literal("wait")), // kilocode_change
}) {
  static readonly zod = zod(this)
}

export const ShellInput = Schema.Struct({
  sessionID: SessionID,
  messageID: Schema.optional(MessageID),
  agent: Schema.String,
  model: Schema.optional(ModelRef),
  command: Schema.String,
})
export type ShellInput = Schema.Schema.Type<typeof ShellInput>

export const CommandInput = Schema.Struct({
  messageID: Schema.optional(MessageID),
  sessionID: SessionID,
  agent: Schema.optional(Schema.String),
  model: Schema.optional(Schema.String),
  arguments: Schema.String,
  command: Schema.String,
  variant: Schema.optional(Schema.String),
  // kilocode_change start - managed product slow-snapshot policy
  snapshotInitialization: Schema.optional(Schema.Literal("wait")).annotate({
    description: "Wait silently if snapshot initialization is slow instead of asking the user.",
  }),
  // kilocode_change end
  // Inlined (no identifier annotation) to keep the original SDK output — the
  // PromptInput call site below references FilePartInput by ref via the
  // Schema export in message-v2.ts.
  parts: Schema.optional(
    Schema.Array(
      Schema.Union([
        Schema.Struct({
          id: Schema.optional(PartID),
          type: Schema.Literal("file"),
          mime: Schema.String,
          filename: Schema.optional(Schema.String),
          url: Schema.String,
          source: Schema.optional(SessionV1.FilePartSource),
        }),
      ]).annotate({ discriminator: "type" }),
    ),
  ),
})
export type CommandInput = Schema.Schema.Type<typeof CommandInput>

/** @internal Exported for testing */
export function createStructuredOutputTool(input: {
  schema: Record<string, any>
  onSuccess: (output: unknown) => void
}): AITool {
  // Remove $schema property if present (not needed for tool input)
  const { $schema: _, ...toolSchema } = input.schema

  return tool({
    description: STRUCTURED_OUTPUT_DESCRIPTION,
    inputSchema: jsonSchema(toolSchema as JSONSchema7),
    async execute(args) {
      // AI SDK validates args against inputSchema before calling execute()
      input.onSuccess(args)
      return {
        output: "Structured output captured successfully.",
        title: "Structured Output",
        metadata: { valid: true },
      }
    },
    toModelOutput({ output }) {
      return {
        type: "text",
        value: output.output,
      }
    },
  })
}
const bashRegex = /!`([^`]+)`/g
// Match [Image N] as single token, quoted strings, or non-space sequences
const argsRegex = /(?:\[Image\s+\d+\]|"[^"]*"|'[^']*'|[^\s"']+)/gi
const placeholderRegex = /\$(\d+)/g
const quoteTrimRegex = /^["']|["']$/g

export * as SessionPrompt from "./prompt"
