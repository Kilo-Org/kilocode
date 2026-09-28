import { describe, expect, test } from "bun:test"
import * as modifier from "../../webview-ui/agent-manager/modifier"

const fire = (target: EventTarget, type: string, input: { key?: string; meta?: boolean; ctrl?: boolean } = {}) => {
  const event = new Event(type)
  Object.defineProperties(event, {
    key: { value: input.key ?? "" },
    metaKey: { value: input.meta ?? false },
    ctrlKey: { value: input.ctrl ?? false },
  })
  target.dispatchEvent(event)
}

describe("Agent Manager shortcut modifier", () => {
  test.each([
    [true, "Meta", "meta"],
    [false, "Control", "ctrl"],
  ] as const)("recovers a lost %s keyup from pointer state", (mac, name, field) => {
    const target = new EventTarget()
    const values: boolean[] = []
    const stop = modifier.watch(target as Window, mac, (held) => values.push(held))

    fire(target, "keydown", { key: name, [field]: true })
    fire(target, "pointermove", { [field]: true })
    fire(target, "pointermove")

    expect(values).toEqual([true, true, false])
    stop()
    fire(target, "keydown", { key: name, [field]: true })
    expect(values).toEqual([true, true, false])
  })

  test("recovers when a later key event contains the missing modifier state", () => {
    const target = new EventTarget()
    const values: boolean[] = []
    const stop = modifier.watch(target as Window, true, (held) => values.push(held))

    fire(target, "keydown", { key: "1", meta: true })
    fire(target, "keyup", { key: "1" })
    fire(target, "blur")

    expect(values).toEqual([true, false, false])
    stop()
  })
})
