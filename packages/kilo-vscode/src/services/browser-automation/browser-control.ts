import {
  BrowserLaunchError,
  diagnostic,
  type BrowserBroker,
  type BrowserInspection,
  type BrowserState,
} from "./browser-broker"
import type { BrowserInteraction, BrowserViewIdentity, BrowserViewport } from "../../shared/browser-stream"

/**
 * A browser command in a surface-neutral shape. Each surface strips its own
 * message prefix (for example `agentManager.browser.` or `browserTab.`) to
 * produce `kind`, so the Agent Manager panel and the editor-tab browser share
 * one implementation of the command handling in {@link controlBrowser}.
 */
export type BrowserControlKind =
  | "state"
  | "viewport"
  | "acknowledge"
  | "interact"
  | "devtools"
  | "open"
  | "back"
  | "forward"
  | "refresh"
  | "inspect"
  | "input"
  | "close"

export interface BrowserControlFields {
  browserId?: string
  navigation?: number
  viewport?: BrowserViewport
  identity?: BrowserViewIdentity
  event?: BrowserInteraction
  sequence?: number
  url?: string
  requestId?: string
  x?: number
  y?: number
  width?: number
  height?: number
  hover?: boolean
  click?: boolean
  theme?: "dark" | "light"
}

export interface BrowserControlMessage extends BrowserControlFields {
  kind: BrowserControlKind
}

/** Builds a neutral control message from a surface message that shares these fields. */
export function browserControlMessage(kind: BrowserControlKind, fields: BrowserControlFields): BrowserControlMessage {
  return { ...fields, kind }
}

/**
 * Surface-specific output and environment for {@link controlBrowser}. `state`,
 * `inspection`, and `devtools` format neutral results into the surface's own
 * out-messages; `readClipboard`/`writeClipboard` are host capabilities.
 */
export interface BrowserControlSurface {
  sessionId: string
  projectId?: string
  /** Resolved lazily because only the `open` command needs the session directory. */
  openDirectory?: () => string | undefined
  readClipboard?: () => Promise<string>
  writeClipboard: (text: string) => Promise<void> | void
  state: (state: BrowserState | undefined, error?: string, missing?: BrowserState["missing"]) => void
  inspection: (input: { requestId: string; hover?: boolean; value?: BrowserInspection; error?: string }) => void
  devtools: (tools: { browserId: string; url: string }) => void
  log: (...args: unknown[]) => void
}

function position(message: BrowserControlMessage): { x: number; y: number; width: number; height: number } | undefined {
  if (
    typeof message.x !== "number" ||
    typeof message.y !== "number" ||
    typeof message.width !== "number" ||
    typeof message.height !== "number"
  ) {
    return
  }
  return { x: message.x, y: message.y, width: message.width, height: message.height }
}

/**
 * Shared `BrowserState` to out-message field list. Both the Agent Manager and
 * the editor-tab browser spread this so a new state field reaches both surfaces.
 */
export function browserStatePayload(state: BrowserState) {
  return {
    browserId: state.browserId,
    projectId: state.projectId,
    sessionId: state.sessionId,
    navigation: state.navigation,
    status: state.status,
    inspecting: state.inspecting,
    url: state.url,
    title: state.title,
    errors: state.errors,
    logs: state.logs,
    error: state.error,
    missing: state.missing,
    frameError: state.frameError,
    back: state.back,
    forward: state.forward,
  }
}

function failure(
  surface: BrowserControlSurface,
  message: BrowserControlMessage,
  error: string,
  state?: BrowserState,
  missing?: BrowserState["missing"],
): void {
  if (message.kind === "inspect") {
    surface.inspection({ requestId: message.requestId ?? "", hover: message.hover, error })
    return
  }
  surface.state(state, error, missing)
}

function streaming(message: BrowserControlMessage, browser: BrowserBroker, surface: BrowserControlSurface): boolean {
  const { sessionId, projectId } = surface
  if (message.kind === "viewport") {
    if (
      !message.browserId ||
      typeof message.navigation !== "number" ||
      !Number.isInteger(message.navigation) ||
      !message.viewport
    ) {
      return true
    }
    void browser
      .viewport(sessionId, projectId, message.browserId, message.navigation, message.viewport)
      .catch((error: unknown) => {
        surface.log("Browser stream failed:", error)
        failure(surface, message, diagnostic(error), browser.get(sessionId, projectId))
      })
    return true
  }
  if (message.kind === "acknowledge") {
    if (message.identity && typeof message.sequence === "number") {
      browser.acknowledge(sessionId, projectId, message.identity, message.sequence)
    }
    return true
  }
  if (message.kind !== "interact") return false
  const identity = message.identity
  const event = message.event
  if (!identity || !event) return true
  void (async () => {
    if (!browser.accepts(sessionId, projectId, identity)) return
    if (event.kind === "clipboard") {
      await browser.interact(sessionId, projectId, identity, event, surface.readClipboard, (text) =>
        surface.writeClipboard(text),
      )
      return
    }
    await browser.interact(sessionId, projectId, identity, event)
  })().catch((error: unknown) => {
    surface.log("Browser input failed:", error)
    failure(surface, message, diagnostic(error), browser.get(sessionId, projectId))
  })
  return true
}

function action(message: BrowserControlMessage, browser: BrowserBroker, surface: BrowserControlSurface): boolean {
  const { sessionId, projectId } = surface
  if (message.kind === "state") {
    const current = browser.get(sessionId, projectId)
    if (current) surface.state(current)
    return true
  }
  if (streaming(message, browser, surface)) return true
  if (message.kind === "devtools") {
    void browser
      .devtools(sessionId, projectId, message.theme === "light" ? "light" : "dark")
      .then((tools) => surface.devtools(tools))
      .catch((error: unknown) => {
        surface.log("Browser developer tools failed:", error)
        failure(surface, message, diagnostic(error), browser.get(sessionId, projectId))
      })
    return true
  }
  if (message.kind === "open") {
    if (!message.url) return true
    const directory = surface.openDirectory?.()
    if (!directory) {
      failure(surface, message, "Browser session is not available in the selected project.")
      return true
    }
    void browser.open({ projectId, sessionId, directory }, message.url, false).catch((error: unknown) => {
      surface.log("Browser open failed:", error)
      failure(
        surface,
        message,
        diagnostic(error, message.url),
        browser.get(sessionId, projectId),
        error instanceof BrowserLaunchError ? error.missing : undefined,
      )
    })
    return true
  }
  if (message.kind === "back" || message.kind === "forward") {
    void browser.history(sessionId, projectId, message.kind).catch((error: unknown) => {
      surface.log("Browser history navigation failed:", error)
      const current = browser.get(sessionId, projectId)
      if (current) surface.state(current)
    })
    return true
  }
  if (message.kind === "refresh") {
    void browser.refresh(sessionId, projectId, false).catch((error: unknown) => {
      surface.log("Browser refresh failed:", error)
      const current = browser.get(sessionId, projectId)
      if (current) surface.state(current)
    })
    return true
  }
  if (message.kind === "inspect" || message.kind === "input") {
    const point = position(message)
    if (!point) {
      failure(surface, message, "Browser element coordinates are required.", browser.get(sessionId, projectId))
      return true
    }
    if (message.kind === "input") {
      void browser.input(sessionId, projectId, point, message.click === true).catch((error: unknown) => {
        surface.log("Browser developer tools input failed:", error)
        failure(surface, message, diagnostic(error), browser.get(sessionId, projectId))
      })
      return true
    }
    void browser
      .inspect(sessionId, projectId, point, message.hover !== true)
      .then((value) => surface.inspection({ requestId: message.requestId ?? "", hover: message.hover, value }))
      .catch((error: unknown) => {
        surface.log("Browser element inspection failed:", error)
        failure(surface, message, diagnostic(error))
      })
    return true
  }
  if (message.kind !== "close") return false
  void browser.close(sessionId, projectId).catch((error: unknown) => surface.log("Browser close failed:", error))
  return true
}

/** Runs one neutralized browser command against the shared broker. */
export function controlBrowser(
  message: BrowserControlMessage,
  browser: BrowserBroker,
  surface: BrowserControlSurface,
): boolean {
  return action(message, browser, surface)
}

/** Formats a pre-route failure (trust, feature flag, or missing session) through `surface`. */
export function controlBrowserFailure(
  message: BrowserControlMessage,
  surface: BrowserControlSurface,
  error: string,
  state?: BrowserState,
  missing?: BrowserState["missing"],
): void {
  failure(surface, message, error, state, missing)
}
