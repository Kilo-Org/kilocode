import { describe, expect, test } from "bun:test"
import { Window } from "happy-dom"
import { post, protect, trusted } from "../../webview-ui/src/utils/webview-message"

describe("webview message trust", () => {
  const origin = "vscode-webview://trusted-view"

  test("accepts browser-generated extension and same-window messages from the exact webview origin", () => {
    expect(trusted({ origin, isTrusted: true }, origin)).toBe(true)
    expect(trusted({ origin: "https://webview.example", isTrusted: true }, "https://webview.example")).toBe(true)
  })

  test("rejects preview, DevTools, forged, and opaque-origin messages", () => {
    for (const value of ["http://localhost:3000", "http://127.0.0.1:3000", `${origin}.invalid`, "", "null"]) {
      expect(trusted({ origin: value, isTrusted: true }, origin)).toBe(false)
    }
    expect(trusted({ origin, isTrusted: false }, origin)).toBe(false)
    expect(trusted({ origin: "", isTrusted: false }, origin)).toBe(false)
    expect(trusted({ origin: "null", isTrusted: true }, "null")).toBe(false)
  })

  test("blocks all application listeners before dispatch and removes its capture guard on cleanup", async () => {
    const window = new Window({ url: "https://webview.example" })
    Object.defineProperty(window, "origin", { value: window.location.origin })
    const target = window as unknown as globalThis.Window
    let received = 0
    window.addEventListener("message", () => received++)
    const release = protect(target)
    window.addEventListener("message", () => received++)
    const event = () =>
      new window.MessageEvent("message", {
        origin: "http://localhost:3000",
        data: { type: "action", action: "runScript" },
      })
    window.dispatchEvent(event())
    expect(received).toBe(0)
    release()
    window.dispatchEvent(event())
    expect(received).toBe(2)
    await window.happyDOM.close()
  })

  test("keeps internal messages synchronous and authorizes only their local dispatch", () => {
    const sent: MessageEvent[] = []
    const target = {
      origin,
      dispatchEvent: (event: Event) => {
        const message = event as MessageEvent
        sent.push(message)
        expect(trusted(message, origin)).toBe(true)
        return true
      },
    }
    const message = { type: "appendChatBoxMessage", text: "Selected element" }
    post(message, target)
    expect(sent).toHaveLength(1)
    expect(sent[0]?.data).toEqual(message)
    expect(sent[0]?.origin).toBe(origin)
    expect(trusted(sent[0]!, origin)).toBe(false)
  })
})
