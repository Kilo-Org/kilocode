import { describe, expect, test } from "bun:test"
import { createGate, writeScope } from "../webview-ui/src/v2/settings-scope"

const loaded = () => Promise.resolve()

describe("createGate", () => {
  test("holds every waiter until open, then releases them all", async () => {
    const gate = createGate()
    const order: string[] = []
    const first = gate.wait().then(() => order.push("first"))
    const second = gate.wait().then(() => order.push("second"))
    await Promise.resolve()
    expect(order).toEqual([])
    gate.open()
    await Promise.all([first, second])
    expect(order).toEqual(["first", "second"])
  })

  test("releases a waiter registered after open immediately", async () => {
    const gate = createGate()
    gate.open()
    await gate.wait()
  })

  test("a repeated open does not disturb released or later waiters", async () => {
    const gate = createGate()
    gate.open()
    gate.open()
    await gate.wait()
  })
})

describe("writeScope", () => {
  test("keeps an explicit scope without waiting", async () => {
    let waited = false
    const scope = await writeScope(
      "global",
      async () => {
        waited = true
      },
      () => "project",
    )
    expect(scope).toBe("global")
    expect(waited).toBe(false)
  })

  test("waits for the raw files before using the owning scope", async () => {
    const order: string[] = []
    const scope = await writeScope(
      undefined,
      async () => {
        order.push("wait")
      },
      () => {
        order.push("owner")
        return "project"
      },
    )
    expect(scope).toBe("project")
    expect(order).toEqual(["wait", "owner"])
  })

  test("uses the global owner once the files are loaded", async () => {
    expect(await writeScope(undefined, loaded, () => "global")).toBe("global")
  })

  test("falls back to global when no file owns the path", async () => {
    expect(await writeScope(undefined, loaded, () => undefined)).toBe("global")
  })
})
