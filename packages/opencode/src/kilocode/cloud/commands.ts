import { CliError, fail } from "@/cli/effect-cmd"
import { Effect, Layer, Redacted } from "effect"
import { CloudAuth } from "./auth"
import { CloudCatalog } from "./catalog"
import {
  CloudAgentSessionIdSchema,
  MessageIdSchema,
  PromptSchema,
  projectStatus,
  resultExitCode,
  type AgentResultExitCode,
  type AgentStartRequest,
  type AgentStartResponse,
  type GetMessageResultInput,
} from "./contracts"
import { CloudDefaults } from "./defaults"
import { CloudError } from "./errors"
import { resolveCloudAgentOrigin, resolveWebAppOrigin, type ServiceOrigin } from "./origin"
import { CloudRepository } from "./repository"
import { createStreamTicketClient, type StreamTicketClient } from "./stream-ticket"
import { createCloudAgentClient, type AgentClient } from "./trpc"
import { streamAgentEvents, type StreamAgentEventsOptions } from "./websocket-stream"

export namespace CloudCommands {
  export interface StartInput {
    readonly cwd?: string
    readonly prompt: string
    readonly repo?: string
    readonly repoType?: CloudRepository.RepositoryType
    readonly branch?: string
    readonly model?: string
    readonly mode?: string
    readonly orgID?: string
    readonly stream?: boolean
  }

  export interface SendInput {
    readonly sessionID: string
    readonly prompt: string
  }

  export interface LookupInput {
    readonly sessionID: string
    readonly messageID: string
  }

  export interface ClientOptions {
    readonly origin: ServiceOrigin
    readonly apiKey: string
  }

  export type ClientFactory = (options: ClientOptions) => AgentClient

  export interface Deps {
    readonly env?: CloudAuth.Environment
    readonly make?: ClientFactory
    readonly write?: (text: string) => unknown
    readonly exit?: (code: AgentResultExitCode) => unknown
    readonly createStreamTicketClient?: (options: {
      readonly origin: ServiceOrigin
      readonly apiKey: string
    }) => StreamTicketClient
    readonly streamAgentEvents?: (options: StreamAgentEventsOptions) => Promise<void>
  }

  const factory: ClientFactory = (options) => createCloudAgentClient(options)

  function diagnostic(error: unknown) {
    if (error instanceof CliError) return error.message
    if (error instanceof CloudError) return error.message
    if (error instanceof CloudAuth.ResolutionError) return error.message
    if (error instanceof CloudCatalog.CatalogError) return error.message
    if (error instanceof CloudDefaults.ResolutionError) return error.message
    if (error instanceof CloudRepository.InvalidRepositoryError) return error.message
    if (error instanceof CloudRepository.InvalidBranchError) return error.message
    if (error instanceof CloudRepository.NotWorktreeError) return error.message
    if (error instanceof CloudRepository.NoRemoteError) return error.message
    if (error instanceof CloudRepository.AmbiguousRemoteError) return error.message
    if (error instanceof CloudRepository.DiscoveryError) return error.message
    return "Cloud Agent command failed"
  }

  function clean<A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, CliError, R> {
    return effect.pipe(Effect.catch((error) => fail(diagnostic(error))))
  }

  function print(value: unknown, deps: Deps, admission?: "start" | "send") {
    const text = JSON.stringify(value) + "\n"
    const message = admission
      ? `Cloud Agent ${admission} was admitted but output could not be written; do not retry automatically`
      : "Unable to write Cloud Agent output"
    const write = deps.write
    if (write) {
      return Effect.tryPromise({
        try: async () => {
          await write(text)
        },
        catch: () => new CloudError(message),
      })
    }
    return Effect.tryPromise({
      try: () =>
        new Promise<void>((resolve, reject) => {
          process.stdout.write(text, (error) => (error ? reject(error) : resolve()))
        }),
      catch: () => new CloudError(message),
    })
  }

  function writeLine(text: string, deps: Deps) {
    const line = `${text}\n`
    const write = deps.write
    if (write) {
      write(line)
      return
    }
    process.stdout.write(line)
  }

  function notice(error: unknown, deps: Deps) {
    return print({ streamEventType: "error", data: { message: diagnostic(error) } }, deps).pipe(
      Effect.catch(() => Effect.void),
    )
  }

  function attempt<A>(run: () => Promise<A>) {
    return Effect.tryPromise({
      try: run,
      catch: (error) => (error instanceof CloudError ? error : new CloudError("Cloud Agent request failed")),
    })
  }

  const auth = Effect.fn("CloudCommands.auth")(function* (deps: Deps) {
    const env = deps.env ?? process.env
    return yield* CloudAuth.token({ KILO_API_KEY: env.KILO_API_KEY })
  })

  function client(token: CloudAuth.Resolved["token"], deps: Deps) {
    return Effect.try({
      try: () => {
        const env = deps.env ?? process.env
        const origin = resolveCloudAgentOrigin(env)
        return (deps.make ?? factory)({ origin, apiKey: Redacted.value(token) })
      },
      catch: (error) => (error instanceof CloudError ? error : new CloudError("Cloud Agent client setup failed")),
    })
  }

  const lookup = Effect.fn("CloudCommands.lookup")(function* (input: LookupInput, deps: Deps) {
    if (!CloudAgentSessionIdSchema.safeParse(input.sessionID).success) {
      return yield* fail("Cloud Agent session ID is invalid")
    }
    if (!MessageIdSchema.safeParse(input.messageID).success) {
      return yield* fail("Cloud Agent message ID is invalid")
    }

    const token = yield* auth(deps)
    const agent = yield* client(token, deps)
    const request = {
      cloudAgentSessionId: input.sessionID,
      messageId: input.messageID,
    } satisfies GetMessageResultInput
    return yield* attempt(() => agent.getMessageResult(request))
  })

  export const start = Effect.fn("CloudCommands.start")(function* (input: StartInput, deps: Deps = {}) {
    return yield* clean(
      Effect.gen(function* () {
        if (!PromptSchema.safeParse(input.prompt).success) return yield* fail("Cloud Agent prompt is invalid")

        const env = deps.env ?? process.env
        const defaults = yield* CloudDefaults.resolve({
          env,
          ...(input.mode === undefined ? {} : { mode: input.mode }),
          ...(input.model === undefined ? {} : { model: input.model }),
          ...(input.orgID === undefined ? {} : { orgID: input.orgID }),
        }).pipe(Effect.provide(Layer.mergeAll(CloudDefaults.modelStateLayer, CloudCatalog.layer({ env }))))
        const repository = yield* CloudRepository.resolve({
          cwd: input.cwd ?? process.cwd(),
          ...(input.repo === undefined ? {} : { repo: input.repo }),
          ...(input.repoType === undefined ? {} : { type: input.repoType }),
          ...(input.branch === undefined ? {} : { branch: input.branch }),
        })
        const agent = yield* client(defaults.token, deps)
        const request = {
          message: { prompt: input.prompt },
          agent: { mode: defaults.mode, model: defaults.model },
          repository,
          options: {
            createdOnPlatform: "kilo-cli",
            ...(defaults.organizationID ? { kilocodeOrganizationId: defaults.organizationID } : {}),
          },
        } satisfies AgentStartRequest
        const result = yield* attempt(() => agent.start(request))
        yield* print({ ...result, streamUrl: undefined }, deps, "start")
        if (input.stream) {
          yield* Effect.gen(function* () {
            const streamUrl = yield* resolveStreamUrl(result, defaults, env, deps)
            yield* Effect.tryPromise({
              try: () =>
                (deps.streamAgentEvents ?? streamAgentEvents)({
                  streamUrl,
                  origin: resolveCloudAgentOrigin(env),
                  writeLine: (line) => writeLine(line, deps),
                  WebSocket: globalThis.WebSocket,
                }),
              catch: (error) => (error instanceof CloudError ? error : new CloudError("Cloud Agent stream failed")),
            })
          }).pipe(Effect.catch((error) => notice(error, deps)))
        }
        return result
      }),
    )
  })

  export const send = Effect.fn("CloudCommands.send")(function* (input: SendInput, deps: Deps = {}) {
    return yield* clean(
      Effect.gen(function* () {
        if (!CloudAgentSessionIdSchema.safeParse(input.sessionID).success) {
          return yield* fail("Cloud Agent session ID is invalid")
        }
        if (!PromptSchema.safeParse(input.prompt).success) return yield* fail("Cloud Agent prompt is invalid")

        const token = yield* auth(deps)
        const agent = yield* client(token, deps)
        const result = yield* attempt(() =>
          agent.send({
            cloudAgentSessionId: input.sessionID,
            message: { prompt: input.prompt },
          }),
        )
        yield* print({ ...result, streamUrl: undefined }, deps, "send")
        return result
      }),
    )
  })

  export const status = Effect.fn("CloudCommands.status")(function* (input: LookupInput, deps: Deps = {}) {
    return yield* clean(
      Effect.gen(function* () {
        const result = projectStatus(yield* lookup(input, deps))
        yield* print(result, deps)
        return result
      }),
    )
  })

  export const result = Effect.fn("CloudCommands.result")(function* (input: LookupInput, deps: Deps = {}) {
    return yield* clean(
      Effect.gen(function* () {
        const result = yield* lookup(input, deps)
        const code = resultExitCode(result.status)
        yield* print(result, deps)
        yield* Effect.sync(() => (deps.exit ?? ((value: AgentResultExitCode) => (process.exitCode = value)))(code))
        return result
      }),
    )
  })

  function resolveStreamUrl(
    response: AgentStartResponse,
    defaults: CloudDefaults.Resolved,
    env: CloudAuth.Environment,
    deps: Deps,
  ): Effect.Effect<string, CloudError> {
    if (response.streamUrl !== undefined) {
      return Effect.succeed(response.streamUrl)
    }

    const origin = resolveWebAppOrigin(env)
    const ticketClient = (deps.createStreamTicketClient ?? createStreamTicketClient)({
      origin,
      apiKey: Redacted.value(defaults.token),
    })

    return Effect.tryPromise({
      try: () =>
        ticketClient.fetchTicket({
          cloudAgentSessionId: response.cloudAgentSessionId,
          ...(defaults.organizationID ? { organizationId: defaults.organizationID } : {}),
        }),
      catch: (error) => (error instanceof CloudError ? error : new CloudError("Unable to obtain stream ticket")),
    }).pipe(
      Effect.map((ticket) => {
        const params = new URLSearchParams({
          cloudAgentSessionId: response.cloudAgentSessionId,
          ticket: ticket.ticket,
        })
        return `/stream?${params.toString()}`
      }),
    )
  }
}
