import { describe, expect, test } from "bun:test"
import { RemoteExit } from "../../../../src/kilo-sessions/remote-exit"
import { RemoteExitRpc } from "../../../../src/cli/cmd/tui/remote-exit-rpc"
import { createWorkerRemoteExit } from "../../../../src/cli/cmd/tui/remote-exit-worker"

describe("worker remote exit lifecycle", () => {
  test("registers only after tuiReady and emits RPC instead of invoking parent state", async () => {
    const events: Array<{ event: string; data: unknown }> = []
    const lifecycle = createWorkerRemoteExit((event, data) => {
      events.push({ event, data })
    })

    expect(RemoteExit.get()).toBeUndefined()
    lifecycle.ready()
    expect(RemoteExit.get()).toBeDefined()

    await RemoteExit.get()?.()
    expect(events).toEqual([{ event: RemoteExitRpc.Event, data: undefined }])
    lifecycle.shutdown()
    expect(RemoteExit.get()).toBeUndefined()
  })

  test("tuiGone and shutdown remove only their owned registration", () => {
    const lifecycle = createWorkerRemoteExit(() => {})
    lifecycle.ready()
    const replacement = async () => {}
    const unregisterReplacement = RemoteExit.register(replacement)

    lifecycle.gone()
    expect(RemoteExit.get()).toBe(replacement)

    lifecycle.ready()
    lifecycle.shutdown()
    expect(RemoteExit.get()).toBeUndefined()
    unregisterReplacement()
  })
})
