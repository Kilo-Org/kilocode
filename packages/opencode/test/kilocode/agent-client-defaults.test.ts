import { describe, expect, test } from "bun:test"
import * as KiloAgent from "@/kilocode/agent"
import { Permission } from "@/permission"

const flags = { experimentalSharedAgentBoard: false }

function withClient<T>(client: string, fn: () => T): T {
  const prev = process.env.KILO_CLIENT
  process.env.KILO_CLIENT = client
  try {
    return fn()
  } finally {
    if (prev === undefined) delete process.env.KILO_CLIENT
    else process.env.KILO_CLIENT = prev
  }
}

function editDefault(client: string) {
  return withClient(client, () =>
    KiloAgent.prepare({}, flags).defaultsPatch.findLast((rule) => rule.permission === "edit"),
  )
}

describe("client-keyed agent permission defaults", () => {
  test("jetbrains asks before edits by default", () => {
    expect(editDefault("jetbrains")?.action).toBe("ask")
  })

  test("vscode and cli do not add an edit default", () => {
    expect(editDefault("vscode")).toBeUndefined()
    expect(editDefault("cli")).toBeUndefined()
  })

  test("user edit permission overrides the jetbrains default", () => {
    withClient("jetbrains", () => {
      const defaults = KiloAgent.prepare({}, flags).defaultsPatch

      const allowEdit = Permission.merge(defaults, Permission.fromConfig({ edit: "allow" }))
      expect(Permission.evaluate("edit", "src/x.ts", allowEdit).action).toBe("allow")

      const allowAll = Permission.merge(defaults, Permission.fromConfig({ "*": "allow" }))
      expect(Permission.evaluate("edit", "src/x.ts", allowAll).action).toBe("allow")
    })
  })
})
