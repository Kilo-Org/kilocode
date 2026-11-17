import { BrowserPermission } from "./permission"

type Item = BrowserPermission.Item

/**
 * Which (class, origin) pairs a browser call needs. The Playwright backend resolves snapshot refs to frames first and
 * passes them in; the computation itself is pure so the rules stay testable without a browser.
 */
export namespace BrowserItems {
  /** The frame a targeted element lives in. `frame` is false for the main frame. */
  export type Element = { ref: string; origin: string; frame: boolean }

  /** Every snapshot ref a tool argument targets. */
  export function refs(args: Record<string, unknown>): string[] {
    const result: string[] = []
    if (typeof args.target === "string") result.push(args.target)
    if (typeof args.startTarget === "string") result.push(args.startTarget)
    if (typeof args.endTarget === "string") result.push(args.endTarget)
    if (Array.isArray(args.fields)) {
      for (const field of args.fields) {
        if (typeof field === "object" && field !== null && "target" in field && typeof field.target === "string") {
          result.push(field.target)
        }
      }
    }
    return result
  }

  /** The URLs a call would open: a navigation, or a new tab. */
  export function targets(tool: string, args: Record<string, unknown>): string[] {
    if (tool === "browser_navigate" && typeof args.url === "string") return [args.url]
    if (tool === "browser_tabs" && args.action === "new" && typeof args.url === "string") return [args.url]
    return []
  }

  export function plan(input: {
    tool: string
    args: Record<string, unknown>
    /** The current page origin, when a page is open. */
    page?: string
    /** Frames resolved from the call's refs. */
    elements: readonly Element[]
    authorized: readonly string[]
  }): Item[] {
    const opened = targets(input.tool, input.args).flatMap((url) => {
      const origin = BrowserPermission.origin(url)
      return origin ? [{ class: "navigate" as const, origin }] : []
    })
    if (opened.length) return BrowserPermission.unique(opened)
    if (!input.page) return []
    const cls = BrowserPermission.classOf(input.tool)
    const items: Item[] = []
    for (const element of input.elements) {
      if (!element.frame) continue
      // Acting inside a frame needs the frame's own act grant; reading it needs read.
      if (!input.authorized.includes(`read:${element.origin}`)) {
        items.push({ class: "read", origin: element.origin, frame: true })
      }
      if (cls !== "read") items.push({ class: cls, origin: element.origin, frame: true })
    }
    // A mixed call (a fill_form with main-page and frame fields) needs the page's own grant as well.
    const mixed = input.elements.some((element) => !element.frame)
    if (items.length) {
      return BrowserPermission.unique(mixed ? [...items, { class: cls, origin: input.page }] : items)
    }
    return [{ class: cls, origin: input.page }]
  }
}
