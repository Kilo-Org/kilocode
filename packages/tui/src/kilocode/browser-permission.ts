// The TUI permission prompt for the browser tools. A `browser` request is one class on one origin
// (`navigate:https://example.com`), a `browser_sensitive` request one step on one origin with the browser's reason; the
// prompt names both in plain words, so a read, a click and a navigation never look alike.
import { browserCopy } from "./browser-copy"

type Source = { action: string; resources: ReadonlyArray<unknown>; metadata?: unknown }

const CLASSES = ["read", "act", "navigate"] as const
type Grant = (typeof CLASSES)[number]

const TITLE = {
  read: "browser.permission.read.title",
  act: "browser.permission.act.title",
  navigate: "browser.permission.navigate.title",
} as const

const DETAIL = {
  read: "browser.permission.read.detail",
  act: "browser.permission.act.detail",
  navigate: "browser.permission.navigate.detail",
} as const

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? { ...value } : {}
}

function text(value: unknown) {
  return typeof value === "string" ? value : ""
}

function grant(value: string): Grant | undefined {
  return CLASSES.find((item) => item === value)
}

/** The class and origin the request names: the metadata the browser tools attach, else the `<class>:<origin>` resource. */
function classOrigin(source: Source) {
  const metadata = record(source.metadata)
  const resource = text(source.resources[0])
  const separator = resource.indexOf(":")
  const fromResource = separator === -1 ? undefined : grant(resource.slice(0, separator))
  const kind = grant(text(metadata.class)) ?? fromResource
  if (!kind) return
  const origin = text(metadata.origin) || (fromResource ? resource.slice(separator + 1) : "")
  if (!origin) return
  return { kind, origin, frame: metadata.frame === true }
}

export function browserPermissionPresentation(source: Source) {
  if (source.action === "browser_sensitive") {
    const metadata = record(source.metadata)
    const origin = text(metadata.origin) || text(source.resources[0])
    const reason = text(metadata.reason)
    return {
      icon: "◎",
      title: browserCopy("browser.permission.sensitive.title", { origin }),
      lines: [
        ...(reason ? [browserCopy("browser.permission.sensitive.reason", { reason })] : []),
        browserCopy("browser.permission.sensitive.once"),
      ],
    }
  }
  if (source.action !== "browser") return
  const named = classOrigin(source)
  if (!named) return
  return {
    icon: "◎",
    title: browserCopy(TITLE[named.kind], { origin: named.origin }),
    lines: [browserCopy(DETAIL[named.kind]), ...(named.frame ? [browserCopy("browser.permission.frame")] : [])],
  }
}
