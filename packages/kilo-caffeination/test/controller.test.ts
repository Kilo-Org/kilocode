import { describe, expect, test } from "bun:test"
import { CaffeinationController, type CaffeinationDriver, type CaffeinationState } from "../src"

function fake(options: { available?: boolean; reason?: string; failures?: number } = {}) {
  const starts: number[] = []
  const stops: string[] = []
  let failures = options.failures ?? 0
  let exit: ((error?: Error) => void) | undefined
  const driver: CaffeinationDriver = {
    available: options.available ?? true,
    reason: options.reason,
    start(pid, onExit) {
      if (failures > 0) {
        failures--
        return Promise.reject(new Error("systemd-inhibit is missing"))
      }
      starts.push(pid)
      exit = onExit
      return Promise.resolve()
    },
    stop() {
      stops.push("stop")
      return Promise.resolve()
    },
  }
  return {
    driver,
    starts,
    stops,
    exit: (error?: Error) => exit?.(error),
  }
}

function until(controller: CaffeinationController, predicate: (state: CaffeinationState) => boolean) {
  const settled = Promise.withResolvers<CaffeinationState>()
  const unsubscribe = controller.onChange((state) => {
    if (!predicate(state)) return
    unsubscribe()
    settled.resolve(state)
  })
  return settled.promise
}

describe("caffeination controller", () => {
  test("holds the inhibitor only while enabled, busy, and available", async () => {
    const scene = fake()
    const controller = new CaffeinationController({ driver: scene.driver, pid: 42 })

    await controller.setEnabled(true)
    expect(scene.starts).toEqual([])

    await controller.setBusy(true)
    expect(scene.starts).toEqual([42])
    expect(controller.getState()).toEqual({ enabled: true, active: true, available: true, error: undefined })

    await controller.setBusy(false)
    expect(scene.stops).toHaveLength(1)
    expect(controller.getState().active).toBe(false)
    expect(controller.getState().enabled).toBe(true)
  })

  test("an explicit toggle releases a running inhibitor and re-holds it", async () => {
    const scene = fake()
    const controller = new CaffeinationController({ driver: scene.driver, pid: 42 })

    await controller.setBusy(true)
    await controller.setEnabled(true)
    await controller.setEnabled(false)
    expect(scene.starts).toEqual([42])
    expect(scene.stops).toHaveLength(1)
    expect(controller.getState()).toMatchObject({ enabled: false, active: false })

    await controller.setEnabled(true)
    expect(scene.starts).toEqual([42, 42])
    expect(controller.getState().active).toBe(true)
  })

  test("a repeated busy report keeps one inhibitor", async () => {
    const scene = fake()
    const controller = new CaffeinationController({ driver: scene.driver })

    await controller.setEnabled(true)
    await Promise.all([controller.setBusy(true), controller.setBusy(true)])
    expect(scene.starts).toHaveLength(1)
    await controller.setBusy(true)
    expect(scene.starts).toHaveLength(1)
  })

  test("a failed start reports unavailable and stays quiet until the next enable", async () => {
    const scene = fake({ failures: 1 })
    const controller = new CaffeinationController({ driver: scene.driver })

    await controller.setEnabled(true)
    await controller.setBusy(true)
    expect(controller.getState()).toEqual({
      enabled: true,
      active: false,
      available: false,
      error: "systemd-inhibit is missing",
    })

    await controller.setBusy(false)
    await controller.setBusy(true)
    expect(scene.starts).toEqual([])

    await controller.setEnabled(false)
    await controller.setEnabled(true)
    expect(scene.starts).toEqual([process.pid])
    expect(controller.getState().active).toBe(true)
  })

  test("an unexpected exit while busy reports the failure", async () => {
    const scene = fake()
    const controller = new CaffeinationController({ driver: scene.driver })

    await controller.setEnabled(true)
    await controller.setBusy(true)
    const failed = until(controller, (state) => !state.available)
    scene.exit(new Error("inhibitor died"))
    expect(await failed).toEqual({
      enabled: true,
      active: false,
      available: false,
      error: "inhibitor died",
    })
    expect(scene.stops).toHaveLength(1)
  })

  test("an exit after an idle release is ignored", async () => {
    const scene = fake()
    const controller = new CaffeinationController({ driver: scene.driver })

    await controller.setEnabled(true)
    await controller.setBusy(true)
    await controller.setBusy(false)
    scene.exit(new Error("late"))

    expect(controller.getState()).toMatchObject({ available: true, active: false })
    await controller.setBusy(true)
    expect(controller.getState()).toMatchObject({ available: true, active: true })
    expect(scene.starts).toHaveLength(2)
  })

  test("dispose releases the inhibitor and ignores later changes", async () => {
    const scene = fake()
    const controller = new CaffeinationController({ driver: scene.driver })

    await controller.setEnabled(true)
    await controller.setBusy(true)
    await controller.dispose()
    expect(scene.stops).toHaveLength(1)
    expect(controller.getState()).toEqual({ enabled: false, active: false, available: true })

    await controller.setEnabled(true)
    await controller.setBusy(true)
    expect(scene.starts).toHaveLength(1)
  })

  test("an unavailable driver keeps Keep Awake off", async () => {
    const scene = fake({ available: false, reason: "Caffeination is not supported on freebsd" })
    const controller = new CaffeinationController({ driver: scene.driver })

    expect(controller.getState()).toEqual({
      enabled: false,
      active: false,
      available: false,
      error: "Caffeination is not supported on freebsd",
    })
    await controller.setEnabled(true)
    await controller.setBusy(true)
    expect(scene.starts).toEqual([])
    expect(controller.getState().enabled).toBe(true)
    expect(controller.getState().active).toBe(false)
  })
})
