import { describe, expect, test } from "bun:test"
import { apply } from "../../../src/kilocode/command/override"

const hints = (template: string) => (template ? [template] : [])

describe("command overrides", () => {
  test("updates an existing command without replacing its template", () => {
    const commands = {
      review: {
        name: "review",
        template: "Review the changes",
        hints: ["existing"],
      },
    }

    apply(commands, "review", { model: "anthropic/claude-sonnet", variant: "high" }, hints)

    expect(commands.review).toMatchObject({
      template: "Review the changes",
      model: "anthropic/claude-sonnet",
      variant: "high",
      hints: ["existing"],
    })
  })

  test("ignores a partial override for an unknown command", () => {
    const commands = {}

    expect(apply(commands, "missing", { model: "anthropic/claude-sonnet" }, hints)).toBe(false)

    expect(commands).toEqual({})
  })

  test("preserves a lazy template while applying a partial override", () => {
    let reads = 0
    const commands = {
      review: {
        name: "review",
        get template() {
          reads++
          return "Review the changes"
        },
        hints: ["existing"],
      },
    }

    apply(commands, "review", { variant: "high" }, hints)

    expect(reads).toBe(0)
    expect((commands.review as { variant?: string }).variant).toBe("high")
  })
})
