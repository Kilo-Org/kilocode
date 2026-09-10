import type { OpenCodeClient, SessionCreateInput } from "@opencode-ai/client/promise"
import type { TextPartInput, FilePartInput, AgentPartInput, SubtaskPartInput } from "./view-types"
import { messageViews, sessionView } from "./projection"
import { result, type AdapterOptions } from "./result"

type Scope = { directory?: string; workspace?: string }
type Identity = Scope & { sessionID: string }
type Selection = { agent?: string; model?: { providerID: string; modelID: string }; variant?: string }
type Prompt = Identity &
  Selection & {
    messageID?: string
    parts?: Array<TextPartInput | FilePartInput | AgentPartInput | SubtaskPartInput>
    noReply?: boolean
    editorContext?: {
      directory?: string
      worktree?: string
      visibleFiles?: string[]
      openTabs?: string[]
      activeFile?: string
      shell?: string
    }
  }

export function createSessionMethods(client: OpenCodeClient, defaultDirectory: string) {
  async function select(input: Identity & Selection, options?: AdapterOptions) {
    const current = await client.session.get({ sessionID: input.sessionID }, options)
    if (input.agent && input.agent !== current.agent)
      await client.session.switchAgent({ sessionID: input.sessionID, agent: input.agent }, options)
    if (
      input.model &&
      (input.model.providerID !== current.model?.providerID ||
        input.model.modelID !== current.model?.id ||
        input.variant !== current.model?.variant)
    )
      await client.session.switchModel(
        {
          sessionID: input.sessionID,
          model: { providerID: input.model.providerID, id: input.model.modelID, variant: input.variant },
        },
        options,
      )
  }
  async function messages(input: Identity, options?: AdapterOptions) {
    const session = await client.session.get(input, options)
    const first = await client.message.list({ sessionID: input.sessionID, order: "asc", limit: 100 }, options)
    const history = [...first.data]
    let cursor = first.cursor.next
    while (cursor) {
      const page = await client.message.list({ sessionID: input.sessionID, cursor }, options)
      history.push(...page.data)
      cursor = page.cursor.next
    }
    return messageViews(session, history)
  }
  return {
    create: <Throw extends boolean = false>(
      input: Scope & {
        title?: string
        agent?: string
        model?: SessionCreateInput["model"]
        metadata?: SessionCreateInput["metadata"]
        platform?: string
      } = {},
      options?: AdapterOptions<Throw>,
    ) =>
      result(
        async () =>
          sessionView(
            await client.session.create(
              {
                title: input.title,
                agent: input.agent,
                model: input.model,
                location: { directory: input.directory ?? defaultDirectory, workspaceID: input.workspace },
                metadata: input.metadata,
              },
              options,
            ),
          ),
        options,
      ),
    get: <Throw extends boolean = false>(input: Identity, options?: AdapterOptions<Throw>) =>
      result(async () => sessionView(await client.session.get(input, options)), options),
    list: <Throw extends boolean = false>(
      input: Scope & { roots?: boolean; limit?: number; search?: string } = {},
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        const sessions = await client.session.list(
          {
            directory: input.directory ?? defaultDirectory,
            workspace: input.workspace,
            limit: input.limit,
            search: input.search,
          },
          options,
        )
        return sessions.data.filter((session) => !input.roots || !session.parentID).map(sessionView)
      }, options),
    status: <Throw extends boolean = false>(_input: Scope = {}, options?: AdapterOptions<Throw>) =>
      result(
        async () =>
          Object.fromEntries(
            Object.keys(await client.session.active(options)).map((id) => [id, { type: "busy" as const }]),
          ),
        options,
      ),
    messages: <Throw extends boolean = false>(input: Identity & { limit?: number }, options?: AdapterOptions<Throw>) =>
      result(async () => {
        const rows = await messages(input, options)
        return input.limit ? rows.slice(-input.limit) : rows
      }, options),
    page: <Throw extends boolean = false>(
      input: Identity & { limit: number; before?: string },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        if (input.limit === 0) return { items: await messages(input, options), cursor: undefined }
        const session = await client.session.get(input, options)
        const page = await client.message.list(
          input.before
            ? { sessionID: input.sessionID, cursor: input.before }
            : { sessionID: input.sessionID, order: "desc", limit: input.limit },
          options,
        )
        return { items: messageViews(session, [...page.data].reverse()), cursor: page.cursor.next }
      }, options),
    message: <Throw extends boolean = false>(
      input: Identity & { messageID: string },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        const found = (await messages(input, options)).find((message) => message.info.id === input.messageID)
        if (!found) throw new Error("Message not found")
        return found
      }, options),
    promptAsync: <Throw extends boolean = false>(input: Prompt, options?: AdapterOptions<Throw>) =>
      result(async () => {
        if (input.parts?.some((part) => part.type === "subtask"))
          throw new Error("Subtask prompt parts require the v2 delegation adapter")
        await select(input, options)
        await client.session.prompt(
          {
            sessionID: input.sessionID,
            id: input.messageID,
            text: (input.parts ?? [])
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n"),
            files: (input.parts ?? [])
              .filter((part) => part.type === "file")
              .map((part) => ({ uri: part.url, name: part.filename })),
            agents: (input.parts ?? []).filter((part) => part.type === "agent").map((part) => ({
              name: part.name,
              mention: part.source
                ? { text: part.source.value, start: part.source.start, end: part.source.end }
                : undefined,
            })),
            resume: input.noReply ? false : undefined,
            metadata: input.editorContext ? { editorContext: input.editorContext } : undefined,
          },
          options,
        )
      }, options),
    abort: <Throw extends boolean = false>(input: Identity, options?: AdapterOptions<Throw>) =>
      result(() => client.session.interrupt(input, options), options),
    summarize: <Throw extends boolean = false>(
      input: Identity & { providerID: string; modelID: string },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        await select({ ...input, model: { providerID: input.providerID, modelID: input.modelID } }, options)
        await client.session.compact({ sessionID: input.sessionID }, options)
      }, options),
    revert: <Throw extends boolean = false>(
      input: Identity & { messageID: string; partID?: string },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        if (input.partID) throw new Error("The v2 backend supports reverting whole messages, not individual parts")
        await client.session.revert.stage({ sessionID: input.sessionID, messageID: input.messageID }, options)
        return sessionView(await client.session.get(input, options))
      }, options),
    unrevert: <Throw extends boolean = false>(input: Identity, options?: AdapterOptions<Throw>) =>
      result(async () => {
        await client.session.revert.clear({ sessionID: input.sessionID }, options)
        return sessionView(await client.session.get(input, options))
      }, options),
    delete: <Throw extends boolean = false>(input: Identity, options?: AdapterOptions<Throw>) =>
      result(() => client.session.remove(input, options), options),
    fork: <Throw extends boolean = false>(input: Identity & { messageID?: string }, options?: AdapterOptions<Throw>) =>
      result(
        async () =>
          sessionView(
            await client.session.fork(
              {
                sessionID: input.sessionID,
                boundary: input.messageID ? { type: "before", messageID: input.messageID } : { type: "through" },
              },
              options,
            ),
          ),
        options,
      ),
    update: <Throw extends boolean = false>(
      input: Identity & {
        title?: string
        agent?: string
        model?: { id: string; providerID: string; variant?: string }
      },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        if (input.title !== undefined)
          await client.session.rename({ sessionID: input.sessionID, title: input.title }, options)
        await select(
          {
            ...input,
            model: input.model ? { providerID: input.model.providerID, modelID: input.model.id } : undefined,
            variant: input.model?.variant,
          },
          options,
        )
        return sessionView(await client.session.get(input, options))
      }, options),
    command: <Throw extends boolean = false>(
      input: Identity &
        Omit<Selection, "model"> & {
          command: string
          arguments?: string
          messageID?: string
          model?: string
          parts?: FilePartInput[]
        },
      options?: AdapterOptions<Throw>,
    ) =>
      result(async () => {
        const separator = (input.model ?? "").indexOf("/")
        if (input.model && (separator < 1 || separator === input.model.length - 1))
          throw new Error("Command model must contain a provider and model ID")
        await select(
          {
            ...input,
            model: input.model
              ? { providerID: input.model.slice(0, separator), modelID: input.model.slice(separator + 1) }
              : undefined,
          },
          options,
        )
        await client.session.command(
          {
            sessionID: input.sessionID,
            command: input.command,
            text: input.arguments ?? "",
            files: input.parts?.map((part) => ({ uri: part.url, name: part.filename })),
          },
          options,
        )
      }, options),
  }
}
