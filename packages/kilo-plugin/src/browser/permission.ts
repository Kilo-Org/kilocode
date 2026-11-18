/**
 * Browser permissions. Every grant is one class on one origin, written as `<class>:<origin>`:
 * `read:https://example.com`, `act:http://localhost:3000`, `navigate:https://example.com`. Sensitive steps are a
 * separate permission (`browser_sensitive`) because they need a human, not a rule.
 */
export namespace BrowserPermission {
  /** Permission key for class grants. */
  export const permission = "browser"
  /** Permission key for sensitive steps, which only an interactive human approves. */
  export const sensitive = "browser_sensitive"

  export type Class = "read" | "act" | "navigate"
  export type SensitiveClass = Class | "sensitive"

  export const CLASSES: readonly Class[] = ["read", "act", "navigate"]

  /** One (class, origin) pair a call needs. `frame` marks a grant for an iframe, not the page. */
  export type Item = {
    class: SensitiveClass
    origin: string
    frame?: true
    reason?: string
  }

  const LOCALHOST: Record<string, true> = { localhost: true, "127.0.0.1": true, "[::1]": true, "::1": true }

  /** The localhost family: `localhost`, `127.0.0.1` and `*.localhost`, with or without a port. */
  export function localhost(origin: string): boolean {
    const host = hostOf(origin)
    if (!host) return false
    return LOCALHOST[host] === true || host.endsWith(".localhost")
  }

  function hostOf(origin: string) {
    try {
      return new URL(origin).hostname.toLowerCase()
    } catch {
      return undefined
    }
  }

  /** The origin of a URL, exactly as grants and patterns spell it. */
  export function origin(url: string): string | undefined {
    if (!url) return undefined
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return undefined
      return parsed.origin
    } catch {
      return undefined
    }
  }

  /**
   * The key a decision binds to for a document: its origin, or — for a document the browser gives no origin
   * (`about:blank`, a `data:` document) — a scheme-qualified key. A blob URL belongs to the origin it embeds.
   * Returns undefined only for a URL that cannot be parsed at all.
   */
  export function site(url: string): string | undefined {
    if (!url) return undefined
    const known = origin(url)
    if (known) return known
    try {
      const parsed = new URL(url)
      if (parsed.protocol === "blob:") {
        const inner = origin(url.slice("blob:".length))
        if (inner) return inner
      }
      // An opaque document has no origin to name; the scheme is the narrowest key left.
      return parsed.protocol === "about:" && parsed.pathname === "blank" ? "about:blank" : parsed.protocol
    } catch {
      return undefined
    }
  }

  export function pattern(item: Item): string {
    return `${item.class}:${item.origin}`
  }

  /** Parse `<class>:<origin>`; used by the allowlist editors and by saved rules. */
  export function parse(value: string): Item | undefined {
    const index = value.indexOf(":")
    if (index < 1) return undefined
    const cls = value.slice(0, index)
    const rest = value.slice(index + 1)
    if (cls !== "read" && cls !== "act" && cls !== "navigate" && cls !== "sensitive") return undefined
    // Only a normalized origin is a grant: a string `URL` rejects would never match a real call site.
    const parsed = origin(rest)
    if (!parsed) return undefined
    return { class: cls, origin: parsed }
  }

  /**
   * The built-in default grants: the localhost family is allowed for every class, every other origin asks. Sensitive
   * steps are never in it — they need a person or `browser.allow_sensitive`.
   */
  export function defaultGrant(item: Item): boolean {
    return item.class !== "sensitive" && localhost(item.origin)
  }

  const ACT: Record<string, true> = {
    browser_close: true,
    browser_resize: true,
    browser_handle_dialog: true,
    browser_evaluate: true,
    browser_file_upload: true,
    browser_drop: true,
    browser_fill_form: true,
    browser_press_key: true,
    browser_type: true,
    browser_navigate_back: true,
    browser_run_code_unsafe: true,
    browser_click: true,
    browser_drag: true,
    browser_hover: true,
    browser_select_option: true,
    browser_tabs: true,
    browser_webmcp_call: true,
  }

  const READ: Record<string, true> = {
    browser_console_messages: true,
    browser_find: true,
    browser_network_requests: true,
    browser_network_request: true,
    browser_take_screenshot: true,
    browser_snapshot: true,
    browser_wait_for: true,
    browser_webmcp_list: true,
  }

  /**
   * The class a tool's call needs. `browser_evaluate` and `browser_run_code_unsafe` are `act` (D11). An unknown tool
   * needs `act`: the strictest class of the three.
   */
  export function classOf(tool: string): Class {
    if (tool === "browser_navigate") return "navigate"
    if (ACT[tool]) return "act"
    if (READ[tool]) return "read"
    return "act"
  }

  /**
   * The request one item becomes. A class grant is saved as `<class>:<origin>`; a sensitive step is approved for one
   * step, so its `save` stays empty and `browserSensitive` marks it for an interactive human unless
   * `browser.allow_sensitive` turned it into an ordinary ask.
   */
  export function request(item: Item, allowSensitive: boolean) {
    if (item.class === "sensitive") {
      return {
        action: sensitive,
        resources: [item.origin],
        save: [] as string[],
        metadata: {
          rules: [item.origin],
          origin: item.origin,
          reason: item.reason ?? "",
          browserSensitive: !allowSensitive,
          // `interactive`: a headless run (`run --auto`) rejects the request instead of approving it.
          interactive: true,
        },
      }
    }
    const value = pattern(item)
    return {
      action: permission,
      resources: [value],
      save: [value],
      metadata: {
        rules: [value],
        class: item.class,
        origin: item.origin,
        ...(item.frame ? { frame: true } : {}),
      },
    }
  }

  /** Deduplicate items that differ only by their frame flag; a frame grant wins. */
  export function unique(items: readonly Item[]): Item[] {
    const seen = new Map<string, Item>()
    for (const item of items) {
      const key = pattern(item)
      const existing = seen.get(key)
      if (!existing || (item.frame && !existing.frame)) seen.set(key, item)
    }
    return [...seen.values()]
  }
}
