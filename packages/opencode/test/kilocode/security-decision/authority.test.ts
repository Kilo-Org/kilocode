import { test, expect, describe } from "bun:test"
import { Effect } from "effect"
import { SecurityAuthority } from "../../../src/kilocode/security-decision/authority"

function floor(xdg: Parameters<typeof SecurityAuthority.floor>[0]["xdg"], effective: "allow" | "ask" | "deny") {
  return SecurityAuthority.floor({ permission: "edit", pattern: "src/a.ts", effective, xdg })
}

describe("SecurityAuthority.floor", () => {
  test("an xdg deny stays deny even when the effective rule allows", () => {
    const out = floor([{ permission: "edit", pattern: "*", action: "deny" }], "allow")
    expect(out.action).toBe("deny")
    expect(out.authority).toBe("xdg_global")
  })

  test("an xdg ask is not weakened by a project, session, default or yolo allow", () => {
    const out = floor([{ permission: "edit", pattern: "*", action: "ask" }], "allow")
    expect(out.action).toBe("ask")
    expect(out.authority).toBe("xdg_global")
  })

  test("an xdg allow does not weaken an effective deny or ask", () => {
    const xdg = [{ permission: "edit", pattern: "*", action: "allow" as const }]
    expect(floor(xdg, "deny").action).toBe("deny")
    expect(floor(xdg, "ask").action).toBe("ask")
  })

  test("an xdg allow that agrees with the effective allow reports the untrusted baseline", () => {
    // The XDG floor never *grants*: an allow only survives because nothing stricter applied,
    // so the core is still free to tighten it.
    const out = floor([{ permission: "edit", pattern: "*", action: "allow" }], "allow")
    expect(out.action).toBe("allow")
    expect(out.authority).toBe("untrusted")
  })

  test("without a matching xdg rule the effective decision carries untrusted authority", () => {
    const out = floor([{ permission: "read", pattern: "*", action: "deny" }], "allow")
    expect(out.action).toBe("allow")
    expect(out.authority).toBe("untrusted")
  })

  test("the last matching xdg rule wins, like the existing evaluator", () => {
    const out = floor(
      [
        { permission: "edit", pattern: "*", action: "deny" },
        { permission: "edit", pattern: "src/*", action: "ask" },
      ],
      "allow",
    )
    expect(out.action).toBe("ask")
  })

  test("a disagreement between the xdg floor and the effective rule is reported as a conflict", () => {
    expect(floor([{ permission: "edit", pattern: "*", action: "ask" }], "allow").conflict).toBe(true)
    expect(floor([{ permission: "edit", pattern: "*", action: "allow" }], "allow").conflict).toBe(false)
  })

  test("an unreadable authority snapshot holds the result at ask unless it was already deny", () => {
    const unknown = SecurityAuthority.floor({
      permission: "edit",
      pattern: "src/a.ts",
      effective: "allow",
      xdg: [],
      failed: true,
    })
    expect(unknown.action).toBe("ask")
    expect(unknown.authority).toBe("unknown")

    const denied = SecurityAuthority.floor({
      permission: "edit",
      pattern: "src/a.ts",
      effective: "deny",
      xdg: [],
      failed: true,
    })
    expect(denied.action).toBe("deny")
  })
})

describe("SecurityAuthority.snapshot", () => {
  test("reads the raw xdg permission block as a ruleset", async () => {
    const out = await Effect.runPromise(
      SecurityAuthority.snapshot({
        getGlobal: () => Effect.succeed({ permission: { edit: { "src/*": "ask" } } } as any),
      }),
    )
    expect(out.failed).toBe(false)
    expect(out.rules).toEqual([{ permission: "edit", pattern: "src/*", action: "ask" }])
  })

  test("an unreadable global config fails closed instead of reporting an empty floor", async () => {
    const out = await Effect.runPromise(
      SecurityAuthority.snapshot({
        getGlobal: () => Effect.fail(new Error("boom")) as any,
      }),
    )
    expect(out.failed).toBe(true)
    expect(out.rules).toEqual([])
  })
})
