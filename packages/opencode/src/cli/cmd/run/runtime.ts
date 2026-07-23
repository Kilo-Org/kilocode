// Top-level orchestrator for `run --interactive`.
//
// Wires the boot sequence, lifecycle (renderer + footer), stream transport,
// and prompt queue together into a single session loop. Two entry points:
//
//   runInteractiveMode     -- used when an SDK client already exists (attach mode)
//   runInteractiveLocalMode -- used for local in-process mode (no server)
//
// Both delegate to runInteractiveRuntime, which:
//   1. resolves TUI config, model info, and session history,
//   2. creates the split-footer lifecycle (renderer + RunFooter),
//   3. starts the stream transport (SDK event subscription), lazily for fresh
//      local sessions,
//   4. runs the prompt queue until the footer closes.
import { createKiloClient } from "@kilocode/sdk/v2"
import { Flag } from "@opencode-ai/core/flag/flag"
import { MessageID } from "@/session/schema"
import { createRunDemo } from "./demo"
import { resolveModelInfo, resolveRunTuiConfig, resolveSessionInfo } from "./runtime.boot"
import { createRuntimeLifecycle } from "./runtime.lifecycle"
import { trace } from "./trace"
import { formatModelLabel } from "./variant.shared" // kilocode_change
// kilocode_change start
import {
  createRunVariantController,
  createRunVariantGate,
  resolveRunAgent,
  type RunAgentResolution,
} from "@/kilocode/cli/cmd/run/variant-controller"
// kilocode_change end
import type { LocalReplayAnchor, LocalReplayRow, RunInput, RunPrompt, RunProvider, StreamCommit } from "./types"

/** @internal Exported for testing */
export { pickVariant, resolveVariant } from "./variant.shared"

/** @internal Exported for testing */
export { runPromptQueue } from "./runtime.queue"

type BootContext = Pick<
  RunInput,
  "sdk" | "directory" | "sessionID" | "sessionTitle" | "resume" | "agent" | "model" | "variant"
>

type CreateSessionInput = {
  agent: string | undefined
  model: RunInput["model"]
  variant: string | undefined
}

type CreateSession = (sdk: RunInput["sdk"], input: CreateSessionInput) => Promise<{ id: string; title?: string }>

type RunRuntimeInput = {
  boot: () => Promise<BootContext>
  afterPaint?: (ctx: BootContext) => Promise<void> | void
  resolveSession?: (ctx: BootContext) => Promise<ResolvedSession> // kilocode_change
  resolveAgent?: (ctx: BootContext) => Promise<RunAgentResolution> // kilocode_change
  createSession?: (ctx: BootContext, input: CreateSessionInput) => Promise<ResolvedSession>
  files: RunInput["files"]
  initialInput?: string
  thinking: boolean
  backgroundSubagents: boolean
  replay?: boolean
  replayLimit?: number
  demo?: RunInput["demo"]
}

type RunLocalInput = {
  directory: string
  fetch: typeof globalThis.fetch
  resolveAgent: () => Promise<string | undefined>
  session: (sdk: RunInput["sdk"]) => Promise<{ id: string; title?: string } | undefined>
  share: (sdk: RunInput["sdk"], sessionID: string) => Promise<void>
  createSession?: CreateSession
  agent: RunInput["agent"]
  model: RunInput["model"]
  variant: RunInput["variant"]
  files: RunInput["files"]
  initialInput?: string
  thinking: boolean
  backgroundSubagents: boolean
  replay?: boolean
  replayLimit?: number
  demo?: RunInput["demo"]
}

type StreamTransportModule = Pick<
  Awaited<typeof import("./stream.transport")>,
  "createSessionTransport" | "formatUnknownError"
>

export type RunRuntimeDeps = {
  createRuntimeLifecycle?: typeof createRuntimeLifecycle
  streamTransport?: Promise<StreamTransportModule>
}

type StreamState = {
  mod: StreamTransportModule
  handle: Awaited<ReturnType<StreamTransportModule["createSessionTransport"]>>
}

type ResolvedSession = {
  sessionID: string
  sessionTitle?: string
  agent?: string | undefined
}

function createSessionResolver(fn?: CreateSession) {
  if (!fn) {
    return undefined
  }

  return async (ctx: BootContext, input: CreateSessionInput): Promise<ResolvedSession> => {
    const created = await fn(ctx.sdk, input)
    if (!created.id) {
      throw new Error("Failed to create session")
    }

    return {
      sessionID: created.id,
      sessionTitle: created.title,
      agent: input.agent,
    }
  }
}

// kilocode_change start - direct interactive runtime state
type RuntimeState = {
  shown: boolean
  aborting: boolean
  providers: RunProvider[]
  sessionID: string
  history: RunPrompt[]
  localRows: LocalReplayRow[]
  sessionTitle?: string
  demo?: ReturnType<typeof createRunDemo>
  selectSubagent?: (sessionID: string | undefined) => void
  session?: Promise<void>
  stream?: Promise<StreamState>
}
// kilocode_change end

function hasSession(input: RunRuntimeInput, state: RuntimeState) {
  return !input.resolveSession || !!state.sessionID
}

function eagerStream(input: RunRuntimeInput, ctx: BootContext) {
  return ctx.resume === true || !input.resolveSession || !!input.demo
}

function variantsFor(providers: RunProvider[], model: RunInput["model"]) {
  if (!model) {
    return []
  }

  return Object.keys(providers.find((item) => item.id === model.providerID)?.models?.[model.modelID]?.variants ?? {})
}

const RESIZE_DELAY = 250
const LOCAL_REPLAY_ROW_LIMIT = 100

async function resolveExitTitle(
  ctx: BootContext,
  input: RunRuntimeInput,
  state: RuntimeState,
): Promise<string | undefined> {
  if (!state.shown || !hasSession(input, state)) {
    return undefined
  }

  return ctx.sdk.session
    .get({
      sessionID: state.sessionID,
    })
    .then((x) => x.data?.title)
    .catch(() => undefined)
}

// Core runtime loop. Boot resolves the SDK context, then we set up the
// lifecycle (renderer + footer), wire the stream transport for SDK events,
// and feed prompts through the queue until the user exits.
//
// Files only attach on the first prompt turn -- after that, includeFiles
// flips to false so subsequent turns don't re-send attachments.
async function runInteractiveRuntime(input: RunRuntimeInput, deps: RunRuntimeDeps = {}): Promise<void> {
  const start = performance.now()
  const log = trace()
  const tuiConfigTask = resolveRunTuiConfig()
  const ctx = await input.boot()
  const modelTask = resolveModelInfo(ctx.sdk, ctx.directory, ctx.model)
  const sessionTask =
    ctx.resume === true
      ? resolveSessionInfo(ctx.sdk, ctx.sessionID, ctx.model)
      : Promise.resolve({
          first: true,
          history: [],
          variant: undefined,
        })
  const [tuiConfig, session] = await Promise.all([tuiConfigTask, sessionTask]) // kilocode_change
  const state: RuntimeState = {
    shown: !session.first,
    aborting: false,
    providers: [],
    sessionID: ctx.sessionID,
    history: [...session.history],
    localRows: [],
    sessionTitle: ctx.sessionTitle,
  }
  // kilocode_change start - resolve direct-run selections through the Kilo controller
  const agentsTask = ctx.sdk.app
    .agents({ directory: ctx.directory })
    .then((result) => result.data ?? [])
    .catch(() => [])
  const variants = createRunVariantController({
    agent: ctx.agent,
    model: ctx.model,
    cli: ctx.variant,
    session: session.variant,
    agents: agentsTask,
    models: modelTask.then((info) => {
      state.providers = info.providers
      return {
        variants: (model) => variantsFor(info.providers, model),
        label: (model, variant) => formatModelLabel(model, variant, info.providers),
        limits: info.limits,
      }
    }),
    update: (config) => ctx.sdk.global.config.update({ config }, { throwOnError: true }),
  })
  const validate = input.resolveAgent
  const deferred = validate ? () => validate(ctx) : undefined
  const gate = createRunVariantGate({ controller: variants, resolve: deferred })
  const initial = variants.current()
  // kilocode_change end
  // kilocode_change start - defer session creation until agent validation settles
  const ensureSession = async () => {
    await gate.ready
    if (!input.resolveSession || state.sessionID) return

    if (state.session) {
      return state.session
    }

    state.session = input.resolveSession(ctx).then(async (next) => {
      state.sessionID = next.sessionID
      state.sessionTitle = next.sessionTitle ?? state.sessionTitle
      if (next.agent) await variants.switchAgent(next.agent)
    })
    return state.session
  }
  // kilocode_change end

  const shell = await (deps.createRuntimeLifecycle ?? createRuntimeLifecycle)({
    directory: ctx.directory,
    findFiles: (query) =>
      ctx.sdk.find
        .files({ query, directory: ctx.directory })
        .then((x) => x.data ?? [])
        .catch(() => []),
    agents: [],
    resources: [],
    sessionID: state.sessionID,
    sessionTitle: state.sessionTitle,
    getSessionID: () => state.sessionID,
    first: session.first,
    history: session.history,
    // kilocode_change start
    agent: initial.agent,
    model: initial.model,
    variant: initial.display,
    // kilocode_change end
    tuiConfig,
    backgroundSubagents: input.backgroundSubagents,
    onPermissionReply: async (next) => {
      if (state.demo?.permission(next)) {
        return
      }

      log?.write("send.permission.reply", next)
      await ctx.sdk.permission.reply(next)
    },
    onQuestionReply: async (next) => {
      if (state.demo?.questionReply(next)) {
        return
      }

      await ctx.sdk.question.reply(next)
    },
    onQuestionReject: async (next) => {
      if (state.demo?.questionReject(next)) {
        return
      }

      await ctx.sdk.question.reject(next)
    },
    // kilocode_change start - human-driven terminal in direct interactive mode
    onTerminalWrite: async (next) => {
      await ctx.sdk.interactiveTerminal.write({
        terminalID: next.terminalID,
        interactiveTerminalWriteInput: { data: next.data },
      })
    },
    onTerminalResize: async (next) => {
      await ctx.sdk.interactiveTerminal.resize({
        terminalID: next.terminalID,
        interactiveTerminalResizeInput: { cols: next.cols, rows: next.rows },
      })
    },
    onTerminalClose: async (terminalID) => {
      await ctx.sdk.interactiveTerminal.close({ terminalID })
    },
    // kilocode_change end
    // kilocode_change start
    onCycleVariant: () => variants.cycle(),
    onModelSelect: async (model) => {
      const previous = variants.current()
      if (previous.model?.providerID === model.providerID && previous.model.modelID === model.modelID) {
        return
      }

      return variants.switchModel(model)
    },
    onVariantSelect: (variant) => variants.select(variant),
    // kilocode_change end
    onInterrupt: () => {
      if (!hasSession(input, state) || state.aborting) {
        return
      }

      state.aborting = true
      void ctx.sdk.session
        .abort({
          sessionID: state.sessionID,
        })
        .catch(() => {})
        .finally(() => {
          state.aborting = false
        })
    },
    onBackground: () => {
      if (!hasSession(input, state)) return
      void ctx.sdk.experimental.session.background({ sessionID: state.sessionID }).catch(() => {})
    },
    onSubagentSelect: (sessionID) => {
      state.selectSubagent?.(sessionID)
      log?.write("subagent.select", {
        sessionID,
      })
    },
  })
  const footer = shell.footer
  const rememberLocal = (commit: StreamCommit, after?: LocalReplayAnchor) => {
    state.localRows = [...state.localRows, { commit, after }].slice(-LOCAL_REPLAY_ROW_LIMIT)
  }

  const loadCatalog = async (): Promise<void> => {
    if (footer.isClosed) {
      return
    }

    const [agents, resources, commands] = await Promise.all([
      agentsTask, // kilocode_change
      ctx.sdk.experimental.resource
        .list({ directory: ctx.directory })
        .then((x) => Object.values(x.data ?? {}))
        .catch(() => []),
      ctx.sdk.command
        .list({ directory: ctx.directory })
        .then((x) => x.data ?? [])
        .catch(() => []),
    ])
    if (footer.isClosed) {
      return
    }

    footer.event({
      type: "catalog",
      agents,
      resources,
      commands,
    })
  }

  void footer
    .idle()
    .then(loadCatalog)
    .catch(() => {})

  if (Flag.KILO_SHOW_TTFD) {
    footer.append({
      kind: "system",
      text: `startup ${Math.max(0, Math.round(performance.now() - start))}ms`,
      phase: "final",
      source: "system",
    })
  }

  if (input.demo) {
    await ensureSession()
    state.demo = createRunDemo({
      footer,
      sessionID: state.sessionID,
      thinking: input.thinking,
      limits: () => variants.current().limits, // kilocode_change
    })
  }

  if (input.afterPaint) {
    void Promise.resolve(input.afterPaint(ctx)).catch(() => {})
  }

  // kilocode_change start - hydrate the footer after controller and provider readiness
  void Promise.all([gate.ready, modelTask]).then(([, info]) => {
    const current = variants.current()
    if (footer.isClosed) {
      return
    }

    footer.event({ type: "models", providers: info.providers })
    footer.event({ type: "variants", variants: current.variants, current: current.display })
    if (!current.model) {
      return
    }

    footer.event({
      type: "model",
      model: formatModelLabel(current.model, current.display, info.providers),
    })
  })
  // kilocode_change end

  const streamTask = deps.streamTransport ?? import("./stream.transport")
  const ensureStream = () => {
    if (state.stream) {
      return state.stream
    }

    // Share eager prewarm and first-turn boot through one in-flight promise,
    // but clear it if transport creation fails so a later prompt can retry.
    const next = (async () => {
      await ensureSession()
      if (footer.isClosed) {
        throw new Error("runtime closed")
      }

      const mod = await streamTask
      if (footer.isClosed) {
        throw new Error("runtime closed")
      }

      const handle = await mod.createSessionTransport({
        sdk: ctx.sdk,
        directory: ctx.directory,
        sessionID: state.sessionID,
        thinking: input.thinking,
        replay: input.replay,
        replayLimit: input.replayLimit,
        limits: () => variants.current().limits, // kilocode_change
        providers: () => state.providers,
        footer,
        trace: log,
      })
      if (footer.isClosed) {
        await handle.close()
        throw new Error("runtime closed")
      }

      state.selectSubagent = (sessionID) => handle.selectSubagent(sessionID)
      return { mod, handle }
    })()
    state.stream = next
    void next.catch(() => {
      if (state.stream === next) {
        state.stream = undefined
      }
    })
    return next
  }

  let resizeTimer: ReturnType<typeof setTimeout> | undefined
  const offResize = shell.onResize(() => {
    if (resizeTimer) {
      clearTimeout(resizeTimer)
    }

    resizeTimer = setTimeout(() => {
      resizeTimer = undefined
      if (footer.isClosed) {
        return
      }

      shell.refreshTheme()
      if (!input.replay || !state.stream) {
        return
      }

      void state.stream
        .then((item) =>
          item.handle.replayOnResize({
            localRows: () => state.localRows,
            reset: () =>
              shell.resetForReplay({
                sessionTitle: state.sessionTitle,
                sessionID: state.sessionID,
                history: state.history,
              }),
          }),
        )
        .catch(() => {})
    }, RESIZE_DELAY)
  })

  const runQueue = async () => {
    let includeFiles = true
    if (state.demo) {
      await state.demo.start()
    }

    const mod = await import("./runtime.queue")
    const createSession = input.createSession
    await mod.runPromptQueue({
      footer,
      initialInput: input.initialInput,
      trace: log,
      onSend: (prompt) => {
        state.shown = true
        state.history.push(prompt)
        if (prompt.mode !== "shell") {
          rememberLocal({
            kind: "user",
            text: prompt.text,
            phase: "start",
            source: "system",
            messageID: prompt.messageID,
          })
        }
      },
      onNewSession: createSession
        ? async () => {
            try {
              const selection = await gate.prepare() // kilocode_change
              const created = await createSession(ctx, {
                agent: selection.agent, // kilocode_change
                model: selection.model, // kilocode_change
                variant: selection.variant, // kilocode_change
              })
              await footer.idle().catch(() => {})
              await state.stream?.then((item) => item.handle.close()).catch(() => {})
              state.stream = undefined
              state.session = undefined
              state.selectSubagent = undefined
              state.shown = false
              state.sessionID = created.sessionID
              state.sessionTitle = created.sessionTitle
              await variants.switchAgent(created.agent) // kilocode_change
              const current = variants.current() // kilocode_change
              state.history = []
              state.localRows = []
              includeFiles = true
              state.demo = input.demo
                ? createRunDemo({
                    footer,
                    sessionID: state.sessionID,
                    thinking: input.thinking,
                    limits: () => current.limits, // kilocode_change
                  })
                : undefined
              log?.write("session.new", {
                sessionID: state.sessionID,
              })
              footer.event({
                type: "stream.subagent",
                state: {
                  tabs: [],
                  details: {},
                  permissions: [],
                  questions: [],
                },
              })
              footer.event({ type: "stream.view", view: { type: "prompt" } })
              footer.event({
                type: "stream.patch",
                patch: {
                  phase: "idle",
                  duration: "",
                  usage: "",
                  first: true,
                },
              })
              footer.append({
                kind: "system",
                text: `new session ${state.sessionID}`,
                phase: "final",
                source: "system",
              })
              await state.demo?.start()
            } catch (error) {
              footer.event({
                type: "stream.patch",
                patch: {
                  phase: "idle",
                  status: "failed to start new session",
                },
              })
              const commit = {
                kind: "error",
                text: error instanceof Error ? error.message : String(error),
                phase: "start",
                source: "system",
                messageID: MessageID.ascending(),
              } as const
              rememberLocal(commit)
              footer.append(commit)
            }
          }
        : undefined,
      run: async (prompt, signal) => {
        if (state.demo && (await state.demo.prompt(prompt, signal))) {
          return
        }

        await gate.prepare() // kilocode_change

        let outputAnchor: LocalReplayAnchor | undefined
        try {
          const next = await ensureStream()
          const current = variants.current() // kilocode_change
          await next.handle.runPromptTurn({
            agent: current.agent, // kilocode_change
            model: current.model, // kilocode_change
            variant: current.prompt, // kilocode_change
            prompt,
            files: input.files,
            includeFiles,
            onVisibleOutput: (anchor) => {
              outputAnchor = anchor
            },
            signal,
          })
          if (prompt.messageID) {
            state.localRows = state.localRows.filter(
              (row) => row.commit.kind !== "user" || row.commit.messageID !== prompt.messageID,
            )
          }
          includeFiles = false
        } catch (error) {
          if (signal.aborted || footer.isClosed) {
            return
          }

          const text =
            (await state.stream?.then((item) => item.mod).catch(() => undefined))?.formatUnknownError(error) ??
            (error instanceof Error ? error.message : String(error))
          const commit = {
            kind: "error",
            text,
            phase: "start",
            source: "system",
            messageID: prompt.messageID,
          } as const
          rememberLocal(commit, outputAnchor)
          footer.append(commit)
        }
      },
    })
  }

  try {
    const eager = eagerStream(input, ctx)
    if (eager) {
      if (input.replay && state.shown) {
        // Replay commits immutable scrollback rows, so wait for provider names
        // before bootstrapping existing session history.
        await modelTask
      }

      await ensureStream()
    }

    if (!eager && input.resolveSession) {
      queueMicrotask(() => {
        if (footer.isClosed) {
          return
        }

        void ensureStream().catch(() => {})
      })
    }

    try {
      await runQueue()
    } finally {
      if (resizeTimer) {
        clearTimeout(resizeTimer)
      }
      offResize()
      await state.stream?.then((item) => item.handle.close()).catch(() => {})
    }
  } finally {
    const title = await resolveExitTitle(ctx, input, state)

    await shell.close({
      showExit: state.shown && hasSession(input, state),
      sessionTitle: title,
      sessionID: state.sessionID,
      history: state.history,
    })
  }
}

// Local in-process mode. Creates an SDK client backed by a direct fetch to
// the in-process server, so no external HTTP server is needed.
export async function runInteractiveLocalMode(input: RunLocalInput): Promise<void> {
  const sdk = createKiloClient({
    baseUrl: "http://kilo.internal",
    fetch: input.fetch,
    directory: input.directory,
  })
  let session: Promise<ResolvedSession> | undefined
  let validation: Promise<RunAgentResolution> | undefined // kilocode_change

  return runInteractiveRuntime({
    files: input.files,
    initialInput: input.initialInput,
    thinking: input.thinking,
    backgroundSubagents: input.backgroundSubagents,
    replay: input.replay,
    replayLimit: input.replayLimit,
    demo: input.demo,
    // kilocode_change start - validate independently from lazy session lookup
    resolveAgent: (ctx) => {
      if (!validation) validation = input.resolveAgent().then((agent) => resolveRunAgent(ctx.agent, agent))
      return validation
    },
    // kilocode_change end
    resolveSession: () => {
      if (session) {
        return session
      }

      session = input.session(sdk).then((next) => { // kilocode_change
        if (!next?.id) {
          throw new Error("Session not found")
        }

        void input.share(sdk, next.id).catch(() => {})
        return {
          sessionID: next.id,
          sessionTitle: next.title,
        }
      })
      return session
    },
    createSession: createSessionResolver(input.createSession),
    boot: async () => {
      return {
        sdk,
        directory: input.directory,
        sessionID: "",
        sessionTitle: undefined,
        resume: false,
        agent: input.agent,
        model: input.model,
        variant: input.variant,
      }
    },
  })
}

// Attach mode. Uses the caller-provided SDK client directly.
export async function runInteractiveMode(
  input: RunInput & { createSession?: CreateSession },
  deps?: RunRuntimeDeps,
): Promise<void> {
  return runInteractiveRuntime(
    {
      files: input.files,
      initialInput: input.initialInput,
      thinking: input.thinking,
      backgroundSubagents: input.backgroundSubagents,
      replay: input.replay,
      replayLimit: input.replayLimit,
      demo: input.demo,
      boot: async () => ({
        sdk: input.sdk,
        directory: input.directory,
        sessionID: input.sessionID,
        sessionTitle: input.sessionTitle,
        resume: input.resume,
        agent: input.agent,
        model: input.model,
        variant: input.variant,
      }),
      createSession: createSessionResolver(input.createSession),
    },
    deps,
  )
}
