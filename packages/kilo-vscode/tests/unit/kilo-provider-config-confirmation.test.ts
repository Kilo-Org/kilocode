import { afterAll, afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The shared preload installs the `vscode` module mock, so the provider's module graph loads
// through a dynamic import after it instead of being hoisted above the preload.
const { KiloProvider } = await import("../../src/KiloProvider")

const directories: string[] = []
/** Every provider this file builds registers process-wide state and listeners, so each is disposed. */
const resources: { dispose(): void }[] = []

afterEach(() => {
  for (const resource of resources.splice(0).reverse()) resource.dispose()
})

afterAll(() => {
  for (const directory of directories) rmSync(directory, { recursive: true, force: true })
})

const target = {
  scope: "project" as const,
  path: "/repo/.kilo/kilo.jsonc",
  revision: "revision",
  exists: false,
  writable: true,
  raw: {},
}
const globalTarget = { ...target, scope: "global" as const }

type Message = { type: string; requestId?: string } & Record<string, unknown>

type UpdateConfig = (
  config: object,
  project: object,
  globalUnset: string[][],
  projectUnset: string[][],
  globalBindingId?: string,
  projectBindingId?: string,
  requestId?: string,
) => Promise<void>

type Internals = {
  connectionState: string
  initConnectionPromise: Promise<void> | null
  bindingsFor: (
    directory: string,
    targets: { global: typeof globalTarget; project: typeof target },
  ) => { project?: { id: string } }
  configSettings: () => Record<string, unknown>
  fetchAndSendProviders: () => Promise<void>
  handleUpdateConfig: UpdateConfig
}

/** The authoritative snapshot a successful write answers with. */
const answer = async () => ({ data: { effective: {}, targets: { global: globalTarget, project: target } } })

/**
 * A provider whose connection is up, whose client answers a config write with the given
 * snapshot, and whose posted messages land in `sent` so a case can assert on them.
 */
function makeProvider(overlayUpdate: () => Promise<unknown> = answer) {
  const directory = mkdtempSync(join(tmpdir(), "kilo-save-confirmation-"))
  directories.push(directory)
  const client = {
    config: { overlayUpdate },
    experimental: {
      capabilities: { get: async () => ({ data: { backgroundSubagents: false } }) },
    },
  }
  const sent: Message[] = []
  const provider = new KiloProvider(
    {} as never,
    // `getClient` and `drainPendingPrompts` drive the write; the rest is what `attachToWebview`
    // and `dispose()` call, so a case can dispatch a message and dispose the provider.
    {
      getClient: () => client,
      drainPendingPrompts: async () => {},
      onSessionAcknowledged: () => () => {},
      unregisterVisible: () => {},
      unregisterAttached: () => {},
    } as never,
    undefined,
    { projectDirectory: directory, rootDirectory: () => directory },
  )
  resources.push(provider)
  const internal = provider as unknown as Internals
  internal.connectionState = "connected"
  internal.configSettings = () => ({})
  internal.fetchAndSendProviders = async () => {}
  provider.postMessage = (message) => {
    sent.push(message as Message)
  }
  // Issue the save binding the way a read-time refresh does, so the save writes a project.
  const projectBinding = internal.bindingsFor(directory, { global: globalTarget, project: target }).project
  if (!projectBinding) throw new Error("expected a project binding for the temp directory")
  return { internal, projectBinding, provider, sent }
}

/**
 * The same provider, driven through the webview message dispatcher instead of a direct call,
 * so a case covers the `case "updateConfig":` arm's field forwarding.
 */
function attachProvider(overlayUpdate?: () => Promise<unknown>) {
  const built = makeProvider(overlayUpdate)
  const pending = Promise.withResolvers<(message: Record<string, unknown>) => Promise<void>>()
  const webview = {
    postMessage: async () => true,
    onDidReceiveMessage: (handler: (message: Record<string, unknown>) => Promise<void>) => {
      pending.resolve(handler)
      return { dispose: () => {} }
    },
  }
  built.internal.initConnectionPromise = Promise.resolve()
  built.provider.attachToWebview(webview as never)
  return { ...built, receive: pending.promise }
}

const posted = (sent: Message[], type: string) => sent.filter((message) => message.type === type)

describe("KiloProvider config write confirmation", () => {
  it("echoes the request id on the configUpdated that answers the write", async () => {
    const { internal, projectBinding, sent } = makeProvider()

    await internal.handleUpdateConfig(
      {},
      { commit_message: { template: "conventional" } },
      [],
      [],
      undefined,
      projectBinding.id,
      "req-1",
    )

    const updated = posted(sent, "configUpdated")
    expect(updated).toHaveLength(1)
    expect(updated[0]?.requestId).toBe("req-1")
    expect(posted(sent, "configUpdateFailed")).toHaveLength(0)
  })

  it("posts a configUpdated with no requestId property when the write carried none", async () => {
    const { internal, projectBinding, sent } = makeProvider()

    await internal.handleUpdateConfig(
      {},
      { commit_message: { template: "conventional" } },
      [],
      [],
      undefined,
      projectBinding.id,
    )

    const updated = posted(sent, "configUpdated")
    expect(updated).toHaveLength(1)
    expect(Object.hasOwn(updated[0]!, "requestId")).toBe(false)
  })

  it("echoes the request id on the early refusal and posts nothing else", async () => {
    const { internal, projectBinding, sent } = makeProvider()
    internal.connectionState = "disconnected"

    await internal.handleUpdateConfig(
      {},
      { commit_message: { template: "conventional" } },
      [],
      [],
      undefined,
      projectBinding.id,
      "req-2",
    )

    const failed = posted(sent, "configUpdateFailed")
    expect(failed).toHaveLength(1)
    expect(failed[0]?.requestId).toBe("req-2")
    expect(posted(sent, "configUpdated")).toHaveLength(0)
    expect(sent).toHaveLength(1)
  })

  it("echoes the request id that arrives through the webview message dispatcher", async () => {
    const { projectBinding, sent, receive } = attachProvider()
    const dispatch = await receive

    await dispatch({
      type: "updateConfig",
      config: {},
      projectConfig: { commit_message: { template: "conventional" } },
      globalBindingId: undefined,
      projectBindingId: projectBinding.id,
      requestId: "req-dispatch",
    })

    const updated = posted(sent, "configUpdated")
    expect(updated).toHaveLength(1)
    expect(updated[0]?.requestId).toBe("req-dispatch")
    expect(posted(sent, "configUpdateFailed")).toHaveLength(0)
  })

  it("echoes the request id on the failure a rejected write posts", async () => {
    const { internal, projectBinding, sent } = makeProvider(async () => {
      throw new Error("write failed")
    })

    await internal.handleUpdateConfig(
      {},
      { commit_message: { template: "conventional" } },
      [],
      [],
      undefined,
      projectBinding.id,
      "req-3",
    )

    const failed = posted(sent, "configUpdateFailed")
    expect(failed).toHaveLength(1)
    expect(failed[0]?.requestId).toBe("req-3")
    expect(failed[0]?.message).toBe("write failed")
    expect(posted(sent, "configUpdated")).toHaveLength(0)
  })
})
