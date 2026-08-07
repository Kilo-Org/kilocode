import { describe, expect, it } from "bun:test"
import { CaffeinationService, type CaffeinationDriver } from "../../src/services/caffeination"

class Driver implements CaffeinationDriver {
  constructor(
    public readonly available = true,
    public readonly reason?: string,
  ) {}

  starts = 0
  stops = 0
  private held = false
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

function wait(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

function setup() {
  const driver = new Driver()
  return { driver, service: new CaffeinationService(driver) }
}

describe("CaffeinationService", () => {
  it("starts immediately and stays active until disabled", async () => {
    const { driver, service } = setup()
    await service.setEnabled(true)
    expect(driver.starts).toBe(1)
    expect(service.getState()).toMatchObject({ enabled: true, active: true })

    await service.setEnabled(false)
    expect(driver.stops).toBe(1)
    expect(service.getState().active).toBe(false)
    service.dispose()
  })

  it("releases the inhibitor when disabled", async () => {
    const { driver, service } = setup()
    await service.setEnabled(true)
    await service.setEnabled(false)
    expect(driver.stops).toBe(1)
    expect(service.getState().active).toBe(false)
    service.dispose()
  })

  it("retries even before an agent status arrives", async () => {
    const { driver, service } = setup()
    await service.setEnabled(true)

    driver.die()
    await wait()
    expect(driver.starts).toBe(2)
    expect(service.getState().active).toBe(true)
    service.dispose()
  })

  it("retries once when the inhibitor exits unexpectedly", async () => {
    const { driver, service } = setup()
    await service.setEnabled(true)

    driver.die()
    await wait()
    expect(driver.starts).toBe(2)
    expect(service.getState().active).toBe(true)

    driver.die()
    await wait()
    expect(service.getState()).toMatchObject({ active: false, available: false })
    service.dispose()
  })

  it("does not start an unavailable driver", async () => {
    const driver = new Driver(false, "The test driver is unavailable")
    const service = new CaffeinationService(driver)

    await service.setEnabled(true)
    expect(driver.starts).toBe(0)
    expect(service.getState().available).toBe(false)
    service.dispose()
  })
})
