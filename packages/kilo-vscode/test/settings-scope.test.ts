import { describe, expect, test } from "bun:test"
import { writeScope } from "../webview-ui/src/v2/settings-scope"

const loaded = () => Promise.resolve()

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
