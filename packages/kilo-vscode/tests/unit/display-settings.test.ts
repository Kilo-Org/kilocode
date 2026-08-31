import { describe, expect, it } from "bun:test"
import { Window } from "happy-dom"
import { applyDisplaySettings } from "../../webview-ui/src/font-size"

describe("display settings", () => {
  it("rebuilds diffs only when the syntax theme changes", async () => {
    const browser = new Window()
    const original = {
      CustomEvent: Object.getOwnPropertyDescriptor(globalThis, "CustomEvent"),
      document: Object.getOwnPropertyDescriptor(globalThis, "document"),
      getComputedStyle: Object.getOwnPropertyDescriptor(globalThis, "getComputedStyle"),
      window: Object.getOwnPropertyDescriptor(globalThis, "window"),
    }
    Object.assign(globalThis, {
      CustomEvent: browser.CustomEvent,
      document: browser.document,
      getComputedStyle: browser.getComputedStyle.bind(browser),
      window: browser,
    })

    const root = browser.document.documentElement
    root.style.setProperty("--kilo-diff-shiki-theme", "Kilo")
    let updates = 0
    browser.addEventListener("kilo-display-settings-changed", () => updates++)

    try {
      applyDisplaySettings({ diffFontSize: 18, diffSyntaxTheme: "kilo" })
      expect(root.style.getPropertyValue("--kilo-diff-font-size")).toBe("18px")
      expect(updates).toBe(0)

      applyDisplaySettings({ diffFontSize: 14, diffSyntaxTheme: "kilo" })
      expect(updates).toBe(0)

      applyDisplaySettings({ diffFontSize: 14, diffSyntaxTheme: "dracula" })
      expect(updates).toBe(1)

      applyDisplaySettings({ diffFontSize: 16, diffSyntaxTheme: "dracula" })
      expect(updates).toBe(1)
    } finally {
      for (const [key, descriptor] of Object.entries(original)) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor)
        else Reflect.deleteProperty(globalThis, key)
      }
      await browser.happyDOM.close()
    }
  })
})
