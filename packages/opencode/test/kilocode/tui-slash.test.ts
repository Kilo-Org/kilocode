import { describe, expect, test } from "bun:test"
import { TuiSlash } from "../../src/kilocode/cli/cmd/tui/slash"

function keymap() {
  const calls: string[] = []
  return {
    calls,
    getCommandEntries() {
      return [
        {
          command: {
            name: "permission.auto_approve_session",
            slashName: "auto-approve",
            slashAliases: ["yolo"],
          },
        },
        {
          command: {
            name: "hidden.command",
            hidden: true,
            slashName: "hidden",
          },
        },
      ]
    },
    dispatchCommand(command: string) {
      calls.push(command)
    },
  }
}

describe("tui slash commands", () => {
  test("dispatches palette slash aliases typed directly", () => {
    const km = keymap()

    expect(TuiSlash.dispatch(km, "/yolo")).toBe(true)

    expect(km.calls).toEqual(["permission.auto_approve_session"])
  })

  test("keeps aliases visible as autocomplete rows", () => {
    const opts = TuiSlash.options([
      {
        display: "/auto-approve",
        aliases: ["/yolo"],
      },
    ])

    expect(opts.map((item) => item.display)).toEqual(["/auto-approve", "/yolo"])
  })

  test("does not dispatch hidden commands", () => {
    const km = keymap()

    expect(TuiSlash.dispatch(km, "/hidden")).toBe(false)

    expect(km.calls).toEqual([])
  })

  test("defers to server command on name collision", () => {
    const km = keymap()

    expect(TuiSlash.dispatch(km, "/auto-approve", [{ name: "auto-approve" }])).toBe(false)

    expect(km.calls).toEqual([])
  })

  test("defers to server skill command on name collision", () => {
    const km = keymap()

    expect(TuiSlash.dispatch(km, "/yolo", [{ name: "yolo", source: "skill" }])).toBe(false)

    expect(km.calls).toEqual([])
  })

  test("dispatches palette slash when no server collision", () => {
    const km = keymap()

    expect(TuiSlash.dispatch(km, "/yolo", [{ name: "unrelated" }])).toBe(true)

    expect(km.calls).toEqual(["permission.auto_approve_session"])
  })
})
