import { describe, expect, test } from "bun:test"
import { alternateClickKey, clickModifier, sendHintRows, sendHintText } from "../webview-ui/src/v2/send-hint-text"

const t = (key: string) => `t:${key}`
const click = "click"

describe("send hint", () => {
  test("names the action, its key, and the delivery an Option-click sends with", () => {
    expect(
      sendHintRows({
        title: "Send all to chat",
        keybind: "⌘Enter",
        click,
        alternateClick: alternateClickKey(t, true),
        alternate: "queue",
        t,
      }),
    ).toEqual([
      { action: "Send all to chat", keys: "⌘Enter" },
      { action: "t:prompt.action.queue", keys: "⌥+t:prompt.action.click" },
    ])
  })

  test("follows the configured delivery", () => {
    expect(
      sendHintRows({
        title: "Fix with Kilo",
        click,
        alternateClick: alternateClickKey(t, false),
        alternate: "steer",
        t,
      }),
    ).toEqual([
      { action: "Fix with Kilo", keys: "click" },
      { action: "t:prompt.action.steer", keys: "Alt+t:prompt.action.click" },
    ])
  })

  test("a target outside the composer has no delivery hint", () => {
    expect(
      sendHintRows({ title: "Send all to terminal", click, alternateClick: alternateClickKey(t, true), t }),
    ).toEqual([{ action: "Send all to terminal", keys: "click" }])
  })

  test("the native title carries the same hint", () => {
    expect(sendHintText({ action: "Send to chat", click: alternateClickKey(t, true), alternate: "queue", t })).toBe(
      "Send to chat (⌥+t:prompt.action.click: t:prompt.action.queue)",
    )
  })

  test("pairs an alternate keybind with Option-click when the field also submits on Enter", () => {
    expect(
      sendHintRows({
        title: "Send to Kilo",
        keybind: "↵",
        alternateKeybind: "⌥↵",
        click,
        alternateClick: alternateClickKey(t, true),
        alternate: "queue",
        t,
      }),
    ).toEqual([
      { action: "Send to Kilo", keys: "↵" },
      { action: "t:prompt.action.queue", keys: "⌥↵ / ⌥+t:prompt.action.click" },
    ])
  })

  test("the modifier follows the platform", () => {
    expect(clickModifier(true)).toBe("⌥")
    expect(clickModifier(false)).toBe("Alt")
  })
})
