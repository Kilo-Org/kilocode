import type { Info as CommandInfo } from "@/command"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import type { MessageV2 } from "@/session/message-v2"
import type { SessionPrompt } from "@/session/prompt"
import type { Info as SessionInfo } from "@/session/session"
import { MessageID, type SessionID } from "@/session/schema"
import z from "zod"

export namespace RemoteCommand {
  export const MAX_COMMANDS = 256
  export const MAX_STRING_LENGTH = 2_000
  export const MAX_ARGUMENTS_LENGTH = 32_768
  export const MAX_HINTS = 32
  export const MAX_RESULT_BYTES = 512 * 1024

  export const ListRequest = z
    .object({
      protocolVersion: z.literal(1),
    })
    .strict()

  export const SendRequest = z
    .object({
      protocolVersion: z.literal(1),
      command: z.string().min(1).max(MAX_STRING_LENGTH),
      arguments: z.string().max(MAX_ARGUMENTS_LENGTH),
      messageID: z.string().startsWith("msg").max(MAX_STRING_LENGTH).optional(),
      model: z
        .object({
          providerID: z.string().min(1).max(MAX_STRING_LENGTH),
          modelID: z.string().min(1).max(MAX_STRING_LENGTH),
        })
        .strict()
        .optional(),
      variant: z.string().max(MAX_STRING_LENGTH).optional(),
    })
    .strict()
  export type SendRequest = z.infer<typeof SendRequest>

  export const Info = z
    .object({
      name: z.string().min(1).max(MAX_STRING_LENGTH),
      description: z.string().max(MAX_STRING_LENGTH).optional(),
      agent: z.string().max(MAX_STRING_LENGTH).optional(),
      model: z.string().max(MAX_STRING_LENGTH).optional(),
      source: z.enum(["command", "mcp", "skill"]).optional(),
      hints: z.array(z.string().max(MAX_STRING_LENGTH)).max(MAX_HINTS),
      subtask: z.boolean().optional(),
    })
    .strict()
  export type Info = z.infer<typeof Info>

  export const Response = z
    .object({
      protocolVersion: z.literal(1),
      commands: z.array(Info).max(MAX_COMMANDS),
    })
    .strict()
  export type Response = z.infer<typeof Response>

  // The only entry from BUILTIN_COMMANDS (kilocode/session/builtin-commands) exposed
  // remotely: `summarize` is a local alias for the same compaction flow, so listing
  // both would just duplicate the suggestion.
  const compact: Info = {
    name: "compact",
    description: "compact the current session context",
    hints: [],
  }

  function compare(a: Info, b: Info) {
    if (a.name < b.name) return -1
    if (a.name > b.name) return 1
    return 0
  }

  // Truncates the alphabetical tail to stay within the count and byte caps.
  // The `compact` entry is seeded first so truncation can never take remote
  // compaction away; sizes are accumulated per entry to keep this a single pass.
  function truncate(commands: Info[]): Info[] {
    const encoder = new TextEncoder()
    const measure = (value: unknown) => encoder.encode(JSON.stringify(value)).byteLength
    const required = commands.find((item) => item.name === compact.name) ?? compact
    const selected: Info[] = [required]
    let budget = MAX_RESULT_BYTES - measure({ protocolVersion: 1, commands: [] }) - measure(required)
    for (const item of commands) {
      if (item === required) continue
      if (selected.length >= MAX_COMMANDS) break
      const bytes = measure(item) + 1 // +1 for the separating comma
      if (bytes > budget) break
      budget -= bytes
      selected.push(item)
    }
    return selected.sort(compare)
  }

  // Validates a single source against the catalog caps, dropping skills and
  // entries whose fields exceed the per-field limits. Shared by build() and
  // the compact shadow check so discovery and execution apply the same rules.
  function parse(source: CommandInfo): Info | undefined {
    if (source.source === "skill") return
    const item = Info.safeParse({
      name: source.name,
      ...(source.description !== undefined ? { description: source.description } : {}),
      ...(source.agent !== undefined ? { agent: source.agent } : {}),
      ...(source.model !== undefined ? { model: source.model } : {}),
      ...(source.source !== undefined ? { source: source.source } : {}),
      hints: source.hints,
      ...(source.subtask !== undefined ? { subtask: source.subtask } : {}),
    })
    return item.success ? item.data : undefined
  }

  export function build(items: ReadonlyArray<CommandInfo>): Response {
    const names = new Set<string>()
    const commands: Info[] = []

    for (const source of items) {
      const item = parse(source)
      if (!item || names.has(item.name)) continue
      names.add(item.name)
      commands.push(item)
    }

    if (!names.has(compact.name)) commands.push(compact)
    commands.sort(compare)
    return Response.parse({ protocolVersion: 1, commands: truncate(commands) })
  }

  export type ExecuteInput = SendRequest & { sessionID: SessionID }

  export type Services = {
    list: () => Promise<CommandInfo[]>
    command: (input: SessionPrompt.CommandInput) => Promise<void>
    session: {
      get: (sessionID: SessionID) => Promise<SessionInfo>
      messages: (sessionID: SessionID) => Promise<MessageV2.WithParts[]>
    }
    agent: { default: () => Promise<string> }
    provider: { default: () => Promise<{ providerID: string; modelID: string }> }
    revert: { cleanup: (session: SessionInfo) => Promise<void> }
    compaction: {
      create: (input: {
        sessionID: SessionID
        agent: string
        model: { providerID: ProviderV2.ID; modelID: ModelV2.ID }
        auto: boolean
      }) => Promise<void>
    }
    prompt: { loop: (sessionID: SessionID) => Promise<void> }
  }

  export type Interface = {
    list: () => Promise<Response>
    execute: (input: ExecuteInput) => Promise<void>
  }

  export function create(services: Services): Interface {
    return {
      list: async () => build(await services.list()),
      execute: async (input) => {
        // A registered command named `compact` shadows the built-in only when it
        // passes the same catalog validation as build(), so a malformed entry
        // hidden from discovery cannot take over execution.
        const shadowed =
          input.command === compact.name &&
          (await services.list()).some((item) => parse(item)?.name === compact.name)
        if (input.command === compact.name && !shadowed) {
          const session = await services.session.get(input.sessionID)
          await services.revert.cleanup(session)
          const messages = await services.session.messages(input.sessionID)
          const user = messages.findLast((message) => message.info.role === "user")
          const agent =
            (user?.info.role === "user" ? user.info.agent : undefined) ??
            session.agent ??
            (await services.agent.default())
          const model =
            input.model ??
            (session.model ? { providerID: session.model.providerID, modelID: session.model.id } : undefined) ??
            (user?.info.role === "user"
              ? { providerID: user.info.model.providerID, modelID: user.info.model.modelID }
              : undefined) ??
            (await services.provider.default())
          await services.compaction.create({
            sessionID: input.sessionID,
            agent,
            model: {
              providerID: ProviderV2.ID.make(model.providerID),
              modelID: ModelV2.ID.make(model.modelID),
            },
            auto: false,
          })
          await services.prompt.loop(input.sessionID)
          return
        }
        await services.command({
          sessionID: input.sessionID,
          command: input.command,
          arguments: input.arguments,
          ...(input.messageID ? { messageID: MessageID.make(input.messageID) } : {}),
          ...(input.model ? { model: `${input.model.providerID}/${input.model.modelID}` } : {}),
          ...(input.variant !== undefined ? { variant: input.variant } : {}),
        })
      },
    }
  }

  export function live(): Interface {
    return create({
      list: async () => {
        const [{ AppRuntime }, { Command }] = await Promise.all([import("@/effect/app-runtime"), import("@/command")])
        return AppRuntime.runPromise(Command.Service.use((service) => service.list()))
      },
      command: async (input) => {
        const [{ AppRuntime }, { SessionPrompt }] = await Promise.all([
          import("@/effect/app-runtime"),
          import("@/session/prompt"),
        ])
        await AppRuntime.runPromise(SessionPrompt.Service.use((service) => service.command(input)))
      },
      session: {
        get: async (sessionID) => {
          const [{ AppRuntime }, { Session }] = await Promise.all([
            import("@/effect/app-runtime"),
            import("@/session/session"),
          ])
          return AppRuntime.runPromise(Session.Service.use((service) => service.get(sessionID)))
        },
        messages: async (sessionID) => {
          const [{ AppRuntime }, { Session }] = await Promise.all([
            import("@/effect/app-runtime"),
            import("@/session/session"),
          ])
          return AppRuntime.runPromise(Session.Service.use((service) => service.messages({ sessionID })))
        },
      },
      agent: {
        default: async () => {
          const [{ AppRuntime }, { Agent }] = await Promise.all([
            import("@/effect/app-runtime"),
            import("@/agent/agent"),
          ])
          return AppRuntime.runPromise(Agent.Service.use((service) => service.defaultAgent()))
        },
      },
      provider: {
        default: async () => {
          const [{ AppRuntime }, { Provider }] = await Promise.all([
            import("@/effect/app-runtime"),
            import("@/provider/provider"),
          ])
          return AppRuntime.runPromise(Provider.Service.use((service) => service.defaultModel()))
        },
      },
      revert: {
        cleanup: async (session) => {
          const [{ AppRuntime }, { SessionRevert }] = await Promise.all([
            import("@/effect/app-runtime"),
            import("@/session/revert"),
          ])
          await AppRuntime.runPromise(SessionRevert.Service.use((service) => service.cleanup(session)))
        },
      },
      compaction: {
        create: async (input) => {
          const [{ AppRuntime }, { SessionCompaction }] = await Promise.all([
            import("@/effect/app-runtime"),
            import("@/session/compaction"),
          ])
          await AppRuntime.runPromise(SessionCompaction.Service.use((service) => service.create(input)))
        },
      },
      prompt: {
        loop: async (sessionID) => {
          const [{ AppRuntime }, { SessionPrompt }] = await Promise.all([
            import("@/effect/app-runtime"),
            import("@/session/prompt"),
          ])
          await AppRuntime.runPromise(SessionPrompt.Service.use((service) => service.loop({ sessionID })))
        },
      },
    })
  }
}
