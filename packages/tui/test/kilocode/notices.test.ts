import { describe, expect, test } from "bun:test"
import type { ToastOptions } from "../../src/ui/toast"
import { collector, combine, type Notice } from "../../src/kilocode/notices"

const commands: Notice = { title: "Commands Unavailable", message: "kilo server GET /command → 500" }
const config: Notice = { title: "Config Warning", message: "Configuration is invalid at kilo.json" }

function record() {
  const shown: ToastOptions[] = []
  return { shown, notify: collector((notice) => shown.push(notice)) }
}

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
    const notice = combine([commands, config])

    expect(notice?.title).toBe("Startup Warnings")
    expect(notice?.message).toContain("Commands Unavailable: kilo server GET /command → 500")
    expect(notice?.message).toContain("Config Warning: Configuration is invalid at kilo.json")
    expect(notice?.duration).toBe(0)
  })

  test("does not drop a notice regardless of which fetch settles first", () => {
    for (const order of [
      [commands, config],
      [config, commands],
    ]) {
      const notice = combine(order)
      for (const item of order) expect(notice?.message).toContain(item.message)
    }
  })

  test("raises each notice as its own fetch reports it", () => {
    // Each notice has to surface on its own fetch: collecting them for the aggregate
    // completion handler would lose every one of them if a sibling fetch rejected.
    const { shown, notify } = record()

    notify(commands)

    expect(shown).toHaveLength(1)
    expect(shown.at(0)?.title).toBe("Commands Unavailable")
  })

  test("a later notice re-shows the earlier one instead of replacing it", () => {
    // The store holds a single toast, so the second show() has to carry both notices.
    const { shown, notify } = record()

    notify(commands)
    notify(config)

    expect(shown).toHaveLength(2)
    const last = shown.at(-1)
    expect(last?.title).toBe("Startup Warnings")
    expect(last?.message).toContain(commands.message)
    expect(last?.message).toContain(config.message)
  })

  test("keeps notices separate across bootstraps", () => {
    const first = record()
    const second = record()

    first.notify(commands)
    second.notify(config)

    expect(second.shown.at(-1)?.title).toBe("Config Warning")
    expect(second.shown.at(-1)?.message).not.toContain(commands.message)
  })
})
