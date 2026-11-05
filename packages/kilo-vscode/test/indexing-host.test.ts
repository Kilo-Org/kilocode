import { describe, expect, it } from "bun:test"
import type { KiloIndexingRpc } from "@opencode/schema/kilocode/indexing"
import type { ToWebview } from "../src/protocol"
import { IndexingConsentStore } from "../src/indexing/consent"
import { createIndexingHost, type IndexingRpc } from "../src/indexing/host"
import { projectIdFor } from "../src/agent-manager/project/paths"

type Status = KiloIndexingRpc.Status

const initial: Status = {
  state: "In Progress",
  message: "Indexing is initializing.",
  processedFiles: 0,
  totalFiles: 0,
  percent: 0,
}

const complete: Status = {
  state: "Complete",
  message: "Index up-to-date.",
  processedFiles: 100,
  totalFiles: 100,
  percent: 100,
}

const disabled: Status = {
  state: "Disabled",
  message: "Indexing consent is required.",
  processedFiles: 0,
  totalFiles: 0,
  percent: 0,
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

function setup(input: {
  directory?: string
  extras?: Array<{ root: string; label?: string }>
  consent?: (enabled: boolean, directory: string | undefined) => Promise<Status>
  status?: (directory: string | undefined) => Promise<Status>
  stored?: Record<string, boolean>
}) {
  const value: { current: unknown } = {
    current: input.stored ? { version: 1, projects: input.stored } : undefined,
  }
  const store = new IndexingConsentStore(
    {
      read: () => value.current,
      write: (next) => {
        value.current = next
      },
    },
    async (dir) => dir,
  )
  const posts: ToWebview[] = []
  const calls: Array<{ enabled: boolean; directory: string | undefined }> = []
  const statuses: Array<string | undefined> = []
  const rpc: IndexingRpc = {
    status: (directory) => {
      statuses.push(directory)
      return input.status ? input.status(directory) : Promise.resolve(initial)
    },
    consent: (enabled, directory) => {
      calls.push({ enabled, directory })
      return input.consent ? input.consent(enabled, directory) : Promise.resolve(initial)
    },
  }
  const host = createIndexingHost({
    context: {} as never,
    server: {} as never,
    directory: () => input.directory ?? "/repo",
    connect: async () => rpc,
    store,
    extras: () => input.extras ?? [],
  })
  host.attach((message) => posts.push(message))
  return { host, store, posts, calls, statuses, value }
}

const statuses = (posts: ToWebview[]) =>
  posts.flatMap((message) => (message.type === "indexingStatusLoaded" ? [message] : []))

describe("indexing host consent", () => {
  it("re-sends the stored workspace consent when the server starts", async () => {
    const fixture = setup({ stored: { [projectId("/repo")]: true } })

    await fixture.host.sync()

    expect(fixture.calls).toEqual([{ enabled: true, directory: undefined }])
  })

  it("sends consent off for the workspace project when none was granted", async () => {
    const fixture = setup({})

    await fixture.host.sync()

    expect(fixture.calls).toEqual([{ enabled: false, directory: undefined }])
  })

  it("writes consent for a registered project with its exact root", async () => {
    const root = "/repo/100%/%2F/桌面/project"
    const fixture = setup({ extras: [{ root }] })

    await fixture.host.setConsent(projectId(root), true)

    expect(fixture.calls).toEqual([{ enabled: true, directory: root }])
    expect(fixture.store.enabled(projectId(root))).toBe(true)
    expect(statuses(fixture.posts).at(-1)).toMatchObject({ projectId: projectId(root), status: initial })
  })

  it("broadcasts the Disabled status when consent is turned off", async () => {
    const fixture = setup({ consent: async () => disabled })

    await fixture.host.setConsent(projectId("/repo"), false)

    expect(fixture.calls).toEqual([{ enabled: false, directory: undefined }])
    expect(statuses(fixture.posts)).toEqual([
      expect.objectContaining({ projectId: projectId("/repo"), status: disabled }),
    ])
  })

  it("keeps a newer consent status when an older status read arrives", async () => {
    const older = Promise.withResolvers<Status>()
    const fixture = setup({
      status: () => older.promise,
      consent: async () => complete,
    })

    const reading = fixture.host.requestSettings()
    await flush()
    await fixture.host.setConsent(projectId("/repo"), true)
    older.resolve(initial)
    await reading

    expect(statuses(fixture.posts).map((message) => message.status.state)).toEqual(["Complete"])
  })

  it("selects a registered project and reads its status at its root", async () => {
    const fixture = setup({
      extras: [{ root: "/other-repo", label: "Other" }],
      status: async (directory) => (directory === "/other-repo" ? complete : initial),
    })

    await fixture.host.requestSettings(projectId("/other-repo"))

    expect(fixture.statuses).toEqual(["/other-repo"])
    expect(fixture.posts.filter((message) => message.type === "indexingSettingsLoaded").at(-1)).toMatchObject({
      settings: { projectId: projectId("/other-repo") },
    })
    expect(statuses(fixture.posts)).toEqual([
      expect.objectContaining({ projectId: projectId("/other-repo"), status: complete }),
    ])
  })

  it("keeps the current selection when the requested project is gone", async () => {
    const fixture = setup({})

    await fixture.host.requestSettings(projectId("/repo"))
    await fixture.host.requestSettings("missing")

    expect(fixture.statuses).toEqual([undefined, undefined])
    expect(statuses(fixture.posts).at(-1)).toMatchObject({ projectId: projectId("/repo") })
  })

  it("does not throw when the server is not reachable", async () => {
    const errors: string[] = []
    const store = new IndexingConsentStore({ read: () => undefined, write: () => {} }, async (dir) => dir)
    const host = createIndexingHost({
      context: {} as never,
      server: {} as never,
      directory: () => "/repo",
      connect: async () => {
        throw new Error("offline")
      },
      store,
      extras: () => [],
      log: (message) => errors.push(message),
    })

    await host.setConsent(projectId("/repo"), true)

    expect(errors).toEqual(["Failed to set indexing consent on"])
  })
})

const projectId = projectIdFor
