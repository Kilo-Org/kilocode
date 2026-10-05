import { describe, expect, test } from "bun:test"
import { combine, type Notice } from "../../src/kilocode/notices"

const commands: Notice = { title: "Commands Unavailable", message: "kilo server GET /command → 500" }
const config: Notice = { title: "Config Warning", message: "Configuration is invalid at kilo.json" }

describe("bootstrap notices", () => {
  test("raises nothing when the fetches report no problem", () => {
    expect(combine([])).toBeUndefined()
  })

  test("keeps a lone notice exactly as reported", () => {
    expect(combine([commands])).toEqual({
      title: "Commands Unavailable",
      message: "kilo server GET /command → 500",
      variant: "warning",
      duration: 0,
    })
  })

  test("keeps both notices when a config warning lands in the same bootstrap", () => {
    // The store holds one toast, so a command-list failure must survive alongside an
    // unrelated config warning instead of whichever resolved last winning.
    const notice = combine([commands, config])

    expect(notice?.message).toContain("Commands Unavailable: kilo server GET /command → 500")
    expect(notice?.message).toContain("Config Warning: Configuration is invalid at kilo.json")
    expect(notice?.title).toBe("Startup Warnings")
    expect(notice?.duration).toBe(0)
  })

  test("does not drop a notice regardless of which fetch settles first", () => {
    const forward = combine([commands, config])
    const reverse = combine([config, commands])

    for (const item of [commands, config]) {
      expect(forward?.message).toContain(item.message)
      expect(reverse?.message).toContain(item.message)
    }
  })
})
