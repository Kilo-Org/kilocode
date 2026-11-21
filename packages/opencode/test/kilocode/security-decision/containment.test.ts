import { test, expect, describe, beforeEach } from "bun:test"
import { ContainmentMacos } from "../../../src/kilocode/security-decision/containment-macos"

const mac = process.platform === "darwin" ? test : test.skip

beforeEach(() => ContainmentMacos.reset())

describe("ContainmentMacos", () => {
  test("reports no operational state before the first probe", () => {
    expect(ContainmentMacos.peek()).toBe("unknown")
  })

  test("only supports macOS", () => {
    expect(ContainmentMacos.supported("linux")).toBe(false)
    expect(ContainmentMacos.supported("win32")).toBe(false)
    expect(ContainmentMacos.supported("sunos" as NodeJS.Platform)).toBe(false)
  })

  test("runs one probe for concurrent callers and caches it for the process lifetime", async () => {
    let runs = 0
    const runner = async () => {
      runs++
      await Promise.resolve()
      return "operational" as const
    }
    const [a, b] = await Promise.all([ContainmentMacos.probe(runner), ContainmentMacos.probe(runner)])
    expect(a).toBe("operational")
    expect(b).toBe("operational")
    expect(await ContainmentMacos.probe(runner)).toBe("operational")
    expect(runs).toBe(1)
    expect(ContainmentMacos.peek()).toBe("operational")
  })

  test("caches a failure too, so a broken sandbox is not retried into an allow", async () => {
    let runs = 0
    const runner = async () => {
      runs++
      throw new Error("boom")
    }
    expect(await ContainmentMacos.probe(runner)).toBe("failed")
    expect(await ContainmentMacos.probe(runner)).toBe("failed")
    expect(runs).toBe(1)
    expect(ContainmentMacos.peek()).toBe("failed")
  })

  mac(
    "actually confines a child process on macOS",
    async () => {
      expect(await ContainmentMacos.probe()).toBe("operational")
    },
    30_000,
  )
})

describe("ContainmentMacos.facts", () => {
  test("reports the sandbox as off without probing when it is disabled", async () => {
    const out = await ContainmentMacos.facts({
      enabled: false,
      mode: "deny",
      destinations: [],
      escalated: false,
      widened: false,
    })
    expect(out).toEqual({ sandbox: "off", network: "deny", destinations: [], escalated: false, widened: false })
    expect(ContainmentMacos.peek()).toBe("unknown")
  })

  test("carries the destinations, the escalation flag and the widened profile through", async () => {
    const out = await ContainmentMacos.facts(
      { enabled: true, mode: "proxy", destinations: ["models.dev:443"], escalated: true, widened: true },
      async () => "operational" as const,
    )
    expect(out).toEqual({
      sandbox: "operational",
      network: "proxy",
      destinations: ["models.dev:443"],
      escalated: true,
      widened: true,
    })
  })
})
