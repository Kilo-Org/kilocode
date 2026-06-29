import { describe, expect, test } from "bun:test"
import type { AnacondaDesktopStatus } from "@kilocode/sdk/v2"
import { createSetupController, type ReadyStatus } from "../../../../src/kilocode/anaconda-desktop/tui/model"

const ready = (toolcall: ReadyStatus["toolcall"] = "supported"): ReadyStatus => ({
  type: "ready",
  serverID: "server-1",
  models: [{ id: "model-1", name: "Local Model" }],
  context: 8192,
  toolcall,
})

const waiting: AnacondaDesktopStatus = { type: "no-running-server", downloadedModels: 1 }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

async function flush() {
  for (const _ of Array.from({ length: 4 })) await Promise.resolve()
}

function setup(input: {
  status(signal: AbortSignal): Promise<AnacondaDesktopStatus>
  open?(signal: AbortSignal): Promise<void>
  sync?(acknowledge: boolean, signal: AbortSignal): Promise<ReadyStatus>
}) {
  return createSetupController({
    api: {
      status: input.status,
      open: input.open ?? (async () => {}),
      sync: input.sync ?? (async () => ready()),
    },
    synced: () => {},
  })
}

describe("Anaconda Desktop TUI setup controller", () => {
  test("checks once on start and only checks again on explicit refresh", async () => {
    const calls: Array<ReturnType<typeof deferred<AnacondaDesktopStatus>>> = []
    const controller = setup({
      status: async () => {
        const call = deferred<AnacondaDesktopStatus>()
        calls.push(call)
        return call.promise
      },
    })

    controller.start()
    expect(calls).toHaveLength(1)
    expect(await controller.refresh()).toBe(false)
    calls[0].resolve(waiting)
    await flush()
    expect(calls).toHaveLength(1)

    const refreshed = controller.refresh()
    expect(calls).toHaveLength(2)
    calls[1].resolve(waiting)
    expect(await refreshed).toBe(true)
    controller.stop()
  })

  test("stops an in-flight check without applying its result", async () => {
    const pending = deferred<AnacondaDesktopStatus>()
    let signal: AbortSignal | undefined
    const controller = setup({
      status: (current) => {
        signal = current
        return pending.promise
      },
    })

    controller.start()
    controller.stop()
    expect(signal?.aborted).toBe(true)
    pending.resolve(waiting)
    await flush()
    expect(controller.snapshot().status).toBeUndefined()
  })

  test("opening Desktop does not check status again", async () => {
    let checks = 0
    let opens = 0
    const controller = setup({
      status: async () => {
        checks += 1
        return waiting
      },
      open: async () => {
        opens += 1
      },
    })

    controller.start()
    await flush()
    await controller.open()
    expect({ checks, opens }).toEqual({ checks: 1, opens: 1 })
    controller.stop()
  })

  test("connects explicitly with the correct tool acknowledgement", async () => {
    for (const toolcall of ["supported", "unsupported", "unknown"] as const) {
      const acknowledgements: boolean[] = []
      const controller = setup({
        status: async () => ready(toolcall),
        sync: async (acknowledge) => {
          acknowledgements.push(acknowledge)
          return ready(toolcall)
        },
      })

      controller.start()
      await flush()
      expect(acknowledgements).toEqual([])
      await controller.connect()
      expect(acknowledgements).toEqual([toolcall !== "supported"])
      controller.stop()
    }
  })
})
