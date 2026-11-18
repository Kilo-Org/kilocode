import { describe, expect, test } from "bun:test"
import { BrowserItems } from "../../src/browser/items"

const page = "https://shop.example.com"

describe("browser call items", () => {
  test("navigate needs the target origin", () => {
    expect(
      BrowserItems.plan({
        tool: "browser_navigate",
        args: { url: "https://example.com/login?next=/a" },
        elements: [],
        authorized: [],
      }),
    ).toEqual([{ class: "navigate", origin: "https://example.com" }])
  })

  test("a new tab asks for the origin it would open", () => {
    expect(
      BrowserItems.plan({
        tool: "browser_tabs",
        args: { action: "new", url: "https://example.com/" },
        elements: [],
        authorized: [],
      }),
    ).toEqual([{ class: "navigate", origin: "https://example.com" }])
    expect(BrowserItems.targets("browser_tabs", { action: "new", url: "file:///etc/passwd" })).toEqual([
      "file:///etc/passwd",
    ])
  })

  test("a mixed fill_form asks for the page origin as well as the frame's", () => {
    expect(
      BrowserItems.plan({
        tool: "browser_fill_form",
        args: { fields: [{ target: "f2e7" }, { target: "e2" }] },
        page,
        elements: [
          { ref: "f2e7", origin: "https://pay.example.net", frame: true },
          { ref: "e2", origin: page, frame: false },
        ],
        authorized: [],
      }),
    ).toEqual(
      expect.arrayContaining([
        { class: "read", origin: "https://pay.example.net", frame: true },
        { class: "act", origin: "https://pay.example.net", frame: true },
        { class: "act", origin: page },
      ]),
    )
  })

  test("a read tool needs read on the current page", () => {
    expect(BrowserItems.plan({ tool: "browser_snapshot", args: {}, page, elements: [], authorized: [] })).toEqual([
      { class: "read", origin: page },
    ])
  })

  test("an act tool needs act on the current page", () => {
    expect(
      BrowserItems.plan({
        tool: "browser_click",
        args: { target: "e4", element: "Pay now" },
        page,
        elements: [{ ref: "e4", origin: page, frame: false }],
        authorized: [],
      }),
    ).toEqual([{ class: "act", origin: page }])
  })

  test("acting inside an iframe needs that frame's origin, and reading it needs read", () => {
    expect(
      BrowserItems.plan({
        tool: "browser_click",
        args: { target: "f2e7" },
        page,
        elements: [{ ref: "f2e7", origin: "https://pay.example.net", frame: true }],
        authorized: [],
      }),
    ).toEqual([
      { class: "read", origin: "https://pay.example.net", frame: true },
      { class: "act", origin: "https://pay.example.net", frame: true },
    ])
  })

  test("a frame that is already readable only needs the act grant", () => {
    expect(
      BrowserItems.plan({
        tool: "browser_click",
        args: { target: "f2e7" },
        page,
        elements: [{ ref: "f2e7", origin: "https://pay.example.net", frame: true }],
        authorized: ["read:https://pay.example.net"],
      }),
    ).toEqual([{ class: "act", origin: "https://pay.example.net", frame: true }])
  })

  test("snapshotting a frame needs read on the frame", () => {
    expect(
      BrowserItems.plan({
        tool: "browser_snapshot",
        args: { target: "f2e1" },
        page,
        elements: [{ ref: "f2e1", origin: "https://pay.example.net", frame: true }],
        authorized: [],
      }),
    ).toEqual([{ class: "read", origin: "https://pay.example.net", frame: true }])
  })

  test("fill_form targets every field's frame", () => {
    expect(
      BrowserItems.plan({
        tool: "browser_fill_form",
        args: {
          fields: [
            { name: "Card", type: "textbox", target: "f3e1", value: "4242" },
            { name: "Name", type: "textbox", target: "e2", value: "Ada" },
          ],
        },
        page,
        elements: [
          { ref: "f3e1", origin: "https://pay.example.net", frame: true },
          { ref: "e2", origin: page, frame: false },
        ],
        authorized: [],
      }),
    ).toEqual([
      { class: "read", origin: "https://pay.example.net", frame: true },
      { class: "act", origin: "https://pay.example.net", frame: true },
      // The main-page field needs the page's own act grant.
      { class: "act", origin: page },
    ])
  })

  test("the refs of a drag pair are both considered", () => {
    expect(BrowserItems.refs({ startTarget: "e1", endTarget: "f2e3" })).toEqual(["e1", "f2e3"])
  })

  test("evaluate needs act, and the page asks when nothing is open yet", () => {
    expect(BrowserItems.plan({ tool: "browser_evaluate", args: {}, elements: [], authorized: [] })).toEqual([])
    expect(BrowserItems.plan({ tool: "browser_evaluate", args: {}, page, elements: [], authorized: [] })).toEqual([
      { class: "act", origin: page },
    ])
  })
})
