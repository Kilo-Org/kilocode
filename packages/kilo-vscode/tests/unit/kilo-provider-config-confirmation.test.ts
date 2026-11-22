import { afterAll, describe, expect, it } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

// The shared preload installs the `vscode` module mock, so the provider's module graph loads
// through a dynamic import after it instead of being hoisted above the preload.
const { KiloProvider } = await import("../../src/KiloProvider")

const directories: string[] = []

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

/**
 * A provider whose connection is up, whose client answers a config write with the given
 * snapshot, and whose posted messages land in `sent` so a case can assert on them.
 */
function makeProvider() {
  const directory = mkdtempSync(join(tmpdir(), "kilo-save-confirmation-"))
  directories.push(directory)
  const client = {
    config: {
      overlayUpdate: async () => ({ data: { effective: {}, targets: { global: globalTarget, project: target } } }),
    },
    experimental: {
      capabilities: { get: async () => ({ data: { backgroundSubagents: false } }) },
    },
  }
  const sent: Message[] = []
  const provider = new KiloProvider(
    {} as never,
    { getClient: () => client, drainPendingPrompts: async () => {} } as never,
    undefined,
    { projectDirectory: directory, rootDirectory: () => directory },
  )
  const internal = provider as unknown as {
    connectionState: string
    bindingsFor: (
      directory: string,
      targets: { global: typeof globalTarget; project: typeof target },
    ) => { project?: { id: string } }
    configSettings: () => Record<string, unknown>
    fetchAndSendProviders: () => Promise<void>
    handleUpdateConfig: (
      config: object,
      project: object,
      globalUnset: string[][],
      projectUnset: string[][],
      globalBindingId?: string,
      projectBindingId?: string,
      requestId?: string,
    ) => Promise<void>
  }
  internal.connectionState = "connected"
  internal.configSettings = () => ({})
  internal.fetchAndSendProviders = async () => {}
  provider.postMessage = (message) => {
    sent.push(message as Message)
  }
  // Issue the save binding the way a read-time refresh does, so the save writes a project.
  const projectBinding = internal.bindingsFor(directory, { global: globalTarget, project: target }).project
  if (!projectBinding) throw new Error("expected a project binding for the temp directory")
  return { internal, projectBinding, sent }
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
})
