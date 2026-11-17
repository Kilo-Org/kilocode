import { ConfigPermissionV1 } from "@opencode-ai/core/v1/config/permission"

/**
 * Browser permissions. Every grant is one class on one origin, written as
 * `<class>:<origin>`: `read:https://example.com`, `act:http://localhost:3000`,
 * `navigate:https://example.com`. Sensitive steps are a separate permission
 * (`browser_sensitive`) because they need a human, not a rule.
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
    const parsed = origin(rest) ?? (rest.startsWith("http://") || rest.startsWith("https://") ? rest : undefined)
    if (!parsed) return undefined
    return { class: cls, origin: parsed }
  }

  /**
   * Built-in defaults: the localhost family is allowed for every class, every other
   * origin asks. The catch-all comes first because the last matching rule wins;
   * the specific allows must follow it.
   */
  export function defaults(): ConfigPermissionV1.Info {
    return {
      browser: {
        "*": "ask",
        "*:http://localhost:*": "allow",
        "*:http://127.0.0.1:*": "allow",
        "*:http://*.localhost:*": "allow",
        "*:https://localhost:*": "allow",
        // The portless forms cover origins whose port is the scheme default (80/443),
        // which URL.origin drops: `http://localhost` does not match `http://localhost:*`.
        "*:http://localhost": "allow",
        "*:http://127.0.0.1": "allow",
        "*:http://*.localhost": "allow",
        "*:https://localhost": "allow",
        "*:https://127.0.0.1": "allow",
        "*:https://*.localhost": "allow",
      },
      // Every call asks for its own tool key first. These are separate permission keys, so a
      // config rule `browser_click: ask` overrides the default and can block one tool.
      "browser_*": "allow",
    }
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
   * The class a tool's call needs. `browser_evaluate` and `browser_run_code_unsafe`
   * are `act` (D11). An unknown tool needs `act`: the strictest class of the three.
   */
  export function classOf(tool: string): Class {
    if (tool === "browser_navigate") return "navigate"
    if (ACT[tool]) return "act"
    if (READ[tool]) return "read"
    return "act"
  }

  /** What one item asks for. Config rules answer it where they match; the rest prompt. */
  export function request(item: Item, allowSensitive: boolean) {
    if (item.class === "sensitive") {
      return {
        permission: sensitive,
        patterns: [item.origin],
        // A sensitive step is approved for one step; `always` stays empty so no rule is
        // written. `browserSensitive` forces an interactive human reply unless
        // browser.allowSensitive makes it an ordinary ask that config rules can answer.
        always: [] as string[],
        metadata: {
          rules: [item.origin],
          origin: item.origin,
          reason: item.reason ?? "",
          browserSensitive: !allowSensitive,
        },
      }
    }
    const value = pattern(item)
    return {
      permission,
      patterns: [value],
      always: [value],
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
