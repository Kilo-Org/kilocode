import { describe, expect, it } from "bun:test"
import type { KiloClient, SessionStatus } from "@kilocode/sdk/v2/client"
import type { ConnectionState } from "../../src/services/cli-backend/connection-service"
import type { SSEPayload } from "../../src/services/cli-backend/sdk-sse-adapter"
import { CaffeinationService, type CaffeinationDriver } from "../../src/services/caffeination"

class Driver implements CaffeinationDriver {
  constructor(
    public readonly available = true,
    public readonly reason?: string,
  ) {}

  starts = 0
  stops = 0
  protected held = false
  private exit: (() => void) | undefined

  start(_pid: number, exit: () => void): Promise<void> {
    this.starts++
    this.held = true
    this.exit = exit
    return Promise.resolve()
  }

  stop(): Promise<void> {
    if (this.held) this.stops++
    this.held = false
    this.exit = undefined
    return Promise.resolve()
  }

  die(): void {
    this.held = false
    this.exit?.()
  }
}

class DeferredDriver extends Driver {
  private release: (() => void) | undefined

  override stop(): Promise<void> {
    if (!this.held) return Promise.resolve()
    this.stops++
    return new Promise((resolve) => {
      this.release = resolve
    })
  }

  resolveStop(): void {
    this.release?.()
  }
}

function wait(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function status(sessionID: string, type: SessionStatus["type"]): SSEPayload {
  return {
    type: "session.status",
    properties: { sessionID, status: { type } as SessionStatus },
  } as SSEPayload
}

function setup(data: Record<string, Record<string, SessionStatus>> = {}, driver: Driver = new Driver()) {
  let event: ((event: SSEPayload, directory?: string) => void) | undefined
  let state: ((state: ConnectionState) => void) | undefined
  let current: ConnectionState = "disconnected"
  const connection = {
    onEvent(listener: (event: SSEPayload, directory?: string) => void) {
      event = listener
      return () => {
        event = undefined
      }
    },
    onStateChange(listener: (next: ConnectionState) => void) {
      state = listener
      return () => {
        state = undefined
      }
    },
    getConnectionState: () => current,
    getKnownDirectories: () => ["/workspace"],
    getClient: () =>
      ({
        session: {
          status: async ({ directory }: { directory: string }) => ({ data: data[directory] ?? {} }),
        },
      }) as unknown as KiloClient,
  }
  return {
    driver,
    service: new CaffeinationService(connection, driver),
    emit: (next: SSEPayload, directory = "/workspace") => event?.(next, directory),
    connect: () => {
      current = "connected"
      state?.("connected")
    },
    setState: (next: ConnectionState) => {
      current = next
      state?.(next)
    },
  }
}

describe("CaffeinationService", () => {
  it("keeps the computer awake only while an agent is active", async () => {
    const { driver, service, emit } = setup()
    await service.setEnabled(true)
    expect(driver.starts).toBe(0)
    expect(service.getState()).toMatchObject({ enabled: true, active: false })

    emit(status("one", "busy"))
    await wait()
    expect(driver.starts).toBe(1)
    expect(service.getState().active).toBe(true)

    emit(status("one", "idle"))
    await wait()
    expect(driver.stops).toBe(1)
    expect(service.getState().active).toBe(false)
    await service.dispose()
  })

  it("keeps the inhibitor while another session remains active", async () => {
    const { driver, service, emit } = setup()
    await service.setEnabled(true)

    emit(status("one", "busy"))
    emit(status("two", "retry"))
    await wait()
    expect(driver.starts).toBe(1)

    emit(status("one", "idle"))
    await wait()
    expect(driver.stops).toBe(0)

    emit(status("two", "idle"))
    await wait()
    expect(driver.stops).toBe(1)
    await service.dispose()
  })

  it("releases the inhibitor when disabled", async () => {
    const { driver, service, emit } = setup()
    await service.setEnabled(true)
    emit(status("one", "busy"))
    await wait()
    await service.setEnabled(false)
    expect(driver.stops).toBe(1)
    expect(service.getState().active).toBe(false)
    await service.dispose()
  })

  it("retries even before an agent status arrives", async () => {
    const { driver, service, emit } = setup()
    await service.setEnabled(true)
    emit(status("one", "busy"))
    await wait()

    driver.die()
    await wait()
    expect(driver.starts).toBe(2)
    expect(service.getState().active).toBe(true)
    await service.dispose()
  })

  it("retries once when the inhibitor exits unexpectedly", async () => {
    const { driver, service, emit } = setup()
    await service.setEnabled(true)
    emit(status("one", "busy"))
    await wait()

    driver.die()
    await wait()
    expect(driver.starts).toBe(2)
    expect(service.getState().active).toBe(true)

    driver.die()
    await wait()
    expect(service.getState()).toMatchObject({ active: false, available: false })
    await service.dispose()
  })

  it("does not start an unavailable driver", async () => {
    const driver = new Driver(false, "The test driver is unavailable")
    const { service } = setup({}, driver)

    await service.setEnabled(true)
    expect(driver.starts).toBe(0)
    expect(service.getState().available).toBe(false)
    await service.dispose()
  })

  it("can be re-enabled after an inhibitor failure", async () => {
    const { driver, service, emit } = setup()
    await service.setEnabled(true)
    emit(status("one", "busy"))
    await wait()

    driver.die()
    await wait()
    driver.die()
    await wait()
    expect(service.getState()).toMatchObject({ available: false, active: false })

    await service.setEnabled(false)
    await service.setEnabled(true)
    emit(status("one", "busy"))
    await wait()
    expect(driver.starts).toBe(3)
    expect(service.getState()).toMatchObject({ available: true, active: true, error: undefined })
    await service.dispose()
  })

  it("waits for driver cleanup and disposes only once", async () => {
    const driver = new DeferredDriver()
    const { service, emit } = setup({}, driver)
    await service.setEnabled(true)
    emit(status("one", "busy"))
    await wait()

    const disposing = service.dispose()
    let settled = false
    void disposing.then(() => {
      settled = true
    })
    await wait()
    expect(settled).toBe(false)

    driver.resolveStop()
    await disposing
    expect(settled).toBe(true)
    await service.dispose()
    expect(driver.stops).toBe(1)
  })

  it("seeds active sessions after reconnect", async () => {
    const { driver, service, connect } = setup({ "/workspace": { one: { type: "busy" } } })
    await service.setEnabled(true)
    connect()
    await wait()

    expect(driver.starts).toBe(1)
    expect(service.getState().active).toBe(true)
    await service.dispose()
  })

  it("releases the inhibitor when the connection is lost", async () => {
    const { driver, service, emit, connect, setState } = setup()
    await service.setEnabled(true)
    connect()
    emit(status("one", "busy"))
    await wait()

    setState("disconnected")
    await wait()
    expect(driver.stops).toBe(1)
    expect(service.getState().active).toBe(false)
    await service.dispose()
  })
})
