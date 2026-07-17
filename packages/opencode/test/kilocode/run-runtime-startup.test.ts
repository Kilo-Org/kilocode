import { expect, spyOn, test } from "bun:test"
import { KiloClient } from "@kilocode/sdk/v2"
import { runInteractiveMode } from "@/cli/cmd/run/runtime"
import type { FooterApi, FooterEvent, RunAgent, RunProvider } from "@/cli/cmd/run/types"

const model = { providerID: "openai", modelID: "gpt-5" }

const provider: RunProvider = {
  id: "openai",
  name: "OpenAI",
  source: "api",
  env: [],
  options: {},
  models: {
    "gpt-5": {
      id: "gpt-5",
      providerID: "openai",
      api: {
        id: "openai",
        url: "https://openai.test",
        npm: "@ai-sdk/openai",
      },
      name: "Little Frank",
      capabilities: {
        temperature: true,
        reasoning: true,
        attachment: true,
        toolcall: true,
        input: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        output: {
          text: true,
          audio: false,
          image: false,
          video: false,
          pdf: false,
        },
        interleaved: false,
      },
      cost: {
        input: 0,
        output: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
      limit: {
        context: 128000,
        output: 8192,
      },
      status: "active",
      options: {},
      headers: {},
      release_date: "2026-01-01",
      variants: {
        low: {},
        high: {},
      },
    },
  },
}

function ok<T>(data: T) {
  return Promise.resolve({
    data,
    error: undefined,
    request: new Request("https://opencode.test"),
    response: new Response(),
  })
}

function footer(events: FooterEvent[], release: () => void): FooterApi {
  let closed = false
  let hydrated = false
  let registered = false
  const closes = new Set<() => void>()

  const maybeClose = () => {
    if (hydrated && registered) {
      release()
    }
  }

  const close = () => {
    if (closed) {
      return
    }

    closed = true
    for (const fn of closes) fn()
  }

  return {
    get isClosed() {
      return closed
    },
    onPrompt: () => {
      registered = true
      maybeClose()
      return () => {}
    },
    onQueuedRemove: () => () => {},
    onClose(fn) {
      if (closed) {
        fn()
        return () => {}
      }

      closes.add(fn)
      return () => {
        closes.delete(fn)
      }
    },
    event(next) {
      events.push(next)
      if (next.type === "model") {
        hydrated = true
        maybeClose()
      }
    },
    append() {},
    idle() {
      return Promise.resolve()
    },
    close() {
      close()
    },
    destroy() {
      this.close()
    },
  }
}

test("starts with provisional CLI selection before catalogs hydrate the footer", async () => {
  const agents = Promise.withResolvers<RunAgent[]>()
  const providers = Promise.withResolvers<{ providers: RunProvider[]; default: {} }>()
  const agentsStarted = Promise.withResolvers<void>()
  const providersStarted = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const events: FooterEvent[] = []
  const shell = footer(events, release.resolve)
  const sdk = new KiloClient()
  let lifecycle: { agent: string | undefined; model: typeof model | undefined; variant: string | undefined } | undefined

  spyOn(sdk.app, "agents").mockImplementation(async () => {
    agentsStarted.resolve()
    return ok(await agents.promise)
  })
  spyOn(sdk.config, "providers").mockImplementation(async () => {
    providersStarted.resolve()
    return ok(await providers.promise)
  })
  spyOn(sdk.experimental.resource, "list").mockImplementation(() => ok({}))
  spyOn(sdk.command, "list").mockImplementation(() => ok([]))

  const task = runInteractiveMode(
    {
      sdk,
      directory: "/tmp",
      sessionID: "ses-1",
      resume: false,
      agent: "build",
      model,
      variant: "high",
      files: [],
      thinking: true,
      backgroundSubagents: false,
    },
    {
      createRuntimeLifecycle: async (input) => {
        lifecycle = input
        return {
          footer: shell,
          onResize: () => () => {},
          refreshTheme: () => {},
          resetForReplay: () => Promise.resolve(),
          close: () => Promise.resolve(),
        }
      },
      streamTransport: Promise.resolve({
        createSessionTransport: async (input) => {
          void release.promise.then(() => input.footer.close())
          return {
            runPromptTurn: async () => {},
            selectSubagent: () => {},
            replayOnResize: async () => false,
            close: async () => {},
          }
        },
        formatUnknownError: (error: unknown) => (error instanceof Error ? error.message : String(error)),
      }),
    },
  )

  try {
    await Promise.all([agentsStarted.promise, providersStarted.promise])

    expect(lifecycle).toMatchObject({ agent: "build", model, variant: "high" })

    agents.resolve([{ name: "build", mode: "primary", variant: "low", permission: [], options: {} }])
    providers.resolve({ providers: [provider], default: {} })

    await task

    expect(events).toEqual(
      expect.arrayContaining([
        { type: "models", providers: [provider] },
        { type: "variants", variants: ["low", "high"], current: "high" },
        { type: "model", model: "Little Frank · OpenAI · high" },
      ]),
    )
  } finally {
    agents.resolve([])
    providers.resolve({ providers: [provider], default: {} })
    shell.close()
    await task.catch(() => {})
  }
})
