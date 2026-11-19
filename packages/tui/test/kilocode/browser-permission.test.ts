import { describe, expect, test } from "bun:test"
import { permissionPresentation } from "../../src/util/permission"

// The requests the browser tools raise: `BrowserPermission.request` in packages/kilo-plugin/src/browser/permission.ts.
const grant = (kind: string, origin: string, extra: Record<string, unknown> = {}) => ({
  action: "browser",
  resources: [`${kind}:${origin}`],
  metadata: { rules: [`${kind}:${origin}`], class: kind, origin, ...extra },
})

describe("browser permission prompt", () => {
  test("names the class and the origin, so a navigate and a read never look alike", () => {
    const navigate = permissionPresentation(grant("navigate", "https://example.com"))
    const read = permissionPresentation(grant("read", "https://example.com"))
    const act = permissionPresentation(grant("act", "https://shop.example"))
    expect(navigate).toEqual({
      icon: "◎",
      title: "Open pages on https://example.com",
      lines: ["The agent can open pages on this origin."],
    })
    expect(read).toEqual({
      icon: "◎",
      title: "Read pages on https://example.com",
      lines: ["The agent can read page text, snapshots and screenshots from this origin."],
    })
    expect(act).toEqual({
      icon: "◎",
      title: "Click and type on https://shop.example",
      lines: ["The agent can click, type and run page scripts on this origin."],
    })
  })

  test("says when the origin is a frame inside the page", () => {
    expect(permissionPresentation(grant("read", "https://ads.example", { frame: true })).lines).toEqual([
      "The agent can read page text, snapshots and screenshots from this origin.",
      "This origin is a frame inside the page, not the page itself.",
    ])
  })

  test("reads the class and origin from the resource when the metadata is missing", () => {
    expect(permissionPresentation({ action: "browser", resources: ["navigate:http://127.0.0.2:8080"] }).title).toBe(
      "Open pages on http://127.0.0.2:8080",
    )
  })

  test("a sensitive step names its origin and the browser's reason", () => {
    expect(
      permissionPresentation({
        action: "browser_sensitive",
        resources: ["http://localhost:3000"],
        metadata: { origin: "http://localhost:3000", reason: "typing a password", browserSensitive: true },
      }),
    ).toEqual({
      icon: "◎",
      title: "Sensitive browser step on http://localhost:3000",
      lines: ["Reason: typing a password", "Only a person can approve this step. The approval covers this one step."],
    })
  })

  test("a request it cannot read keeps the upstream fallback", () => {
    expect(permissionPresentation({ action: "browser", resources: ["*"] })).toEqual({
      icon: "⚙",
      title: "Call tool browser",
      lines: ["Tool: browser"],
    })
  })
})
