/**
 * Kilo-specific TUI app customizations.
 *
 * Everything in this module is called from the shared upstream `app.tsx`
 * via thin integration points so the upstream diff stays minimal.
 */

import { createEffect, createMemo, on, onCleanup } from "solid-js"
import { useKeyboard, useRenderer } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import * as Clipboard from "@tui/clipboard"
import { useBindings } from "@tui/keymap"
import { useSDK } from "@tui/context/sdk"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { useTheme } from "@tui/context/theme"
import { DialogAlert } from "@tui/ui/dialog-alert"
import { DialogSelect } from "@tui/ui/dialog-select"
import { Link } from "@tui/ui/link"
import { isKiloError, showKiloErrorToast } from "@/kilocode/kilo-errors"
import { registerKiloCommands } from "@/kilocode/kilo-commands"
import { initializeTUIDependencies } from "@kilocode/kilo-gateway/tui"
import { DialogProcessList } from "@/kilocode/cli/cmd/tui/component/dialog-process-list"
import { createSettingsDialog } from "@/kilocode/cli/cmd/tui/component/dialog-settings"
import { useIndexingWarnings } from "@/kilocode/cli/cmd/tui/indexing-warning"
import { KiloTerminalTitle } from "./terminal-title"
import type { KiloTitleIcon } from "./title-icon"
import { Session as SessionApi } from "@/session/session"

// Re-export so upstream can render the route without importing directly
export { KiloClawView } from "@/kilocode/claw/view"
export { KiloTerminalTitle } from "./terminal-title"

// Hot reload TUI-local settings (keybinds/theme/ui) when changed from the Kilo Console.
// Called from the App body (below SDKProvider and the TuiConfig provider).
export { useTuiConfigHotReload } from "@/kilocode/cli/cmd/tui/context/tui-config-hot-reload"
export { KiloTuiConfig } from "@/kilocode/cli/cmd/tui/context/tui-config"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default terminal window title. */
export const APP_TITLE = "Kilo CLI"

/** Public docs URL shown in the command palette. */
export const DOCS_URL = "https://kilo.ai/docs"

/** Human-readable product name used in user-facing messages. */
export const APP_NAME = "Kilo"

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

export function isAllowEverything(permission: unknown): boolean {
  if (typeof permission !== "object" || permission === null) return false
  const wildcard = (permission as Record<string, unknown>)["*"]
  if (typeof wildcard === "string") return wildcard === "allow"
  if (typeof wildcard === "object" && wildcard !== null) return (wildcard as Record<string, unknown>)["*"] === "allow"
  return false
}

// ---------------------------------------------------------------------------
// Session effects
// ---------------------------------------------------------------------------

/**
 * Reactive effects for session management:
 * - Notify the server which session the user is viewing (live indicators)
 * - Evict per-session data from the store when navigating away
 *
 * Must be called inside the App component body (needs SolidJS owner).
 */
export function useSessionEffects(deps: {
  route: ReturnType<typeof import("@tui/context/route").useRoute>
  sdk: ReturnType<typeof useSDK>
  sync: ReturnType<typeof useSync>
}) {
  const pty = process.env.KILO_PTY_ID
  const viewerId = crypto.randomUUID()
  const renderer = useRenderer()
  const session = createMemo(() => (deps.route.data.type === "session" ? deps.route.data.sessionID : undefined))
  let active = true
  const meta = { prev: "" }

  function send() {
    const id = session()
    const ids = id ? [id] : []
    deps.sdk.client.session.viewed({ viewer: { id: viewerId, active }, attached: ids, visible: ids }).catch(() => {})
  }

  createEffect(() => send())

  const onFocus = () => {
    active = true
    send()
  }
  const onBlur = () => {
    active = false
    send()
  }
  renderer.on("focus", onFocus)
  renderer.on("blur", onBlur)

  // The server prepends `server.connected` to every SSE (re)connect; a restarted
  // backend has an empty viewer map, so resend the snapshot immediately instead
  // of waiting for the 60s check-in.
  const offConnected = deps.sdk.event.on("event", (event) => {
    if (event.payload.type === "server.connected") send()
  })

  const timer = setInterval(send, 60_000)

  createEffect(() => {
    const sessionID = session()
    if (!pty) return
    const s = sessionID ? deps.sync.session.get(sessionID) : undefined
    const key = [sessionID ?? "", s?.title ?? ""].join("\n")
    if (key === meta.prev) return
    meta.prev = key
    deps.sdk.client.pty
      .update({
        ptyID: pty,
        sessionID: sessionID ?? null,
        ...(s?.title ? { title: s.title } : {}),
      })
      .catch(() => {})
  })

  createEffect(
    on(session, (current, prev) => {
      if (prev && prev !== current) deps.sync.session.evict(prev)
    }),
  )

  onCleanup(() => {
    renderer.off("focus", onFocus)
    renderer.off("blur", onBlur)
    offConnected()
    clearInterval(timer)
    active = false
    deps.sdk.client.session
      .viewed({ viewer: { id: viewerId, active: false }, attached: [], visible: [] })
      .catch(() => {})
  })
}

// ---------------------------------------------------------------------------
// Terminal title
// ---------------------------------------------------------------------------

/**
 * Returns the terminal title for supported TUI routes.
 */
export function getTerminalTitle(input: {
  route: ReturnType<typeof import("@tui/context/route").useRoute>
  base: string
  sync: ReturnType<typeof useSync>
  done: Record<string, true>
  icon?: KiloTitleIcon.Value
}): KiloTerminalTitle.Result | undefined {
  if (input.route.data.type === "home") {
    return {
      title: KiloTerminalTitle.format({ base: input.base, indicator: "none", icon: input.icon }),
      active: false,
      indicator: "none",
    }
  }

  if (input.route.data.type === "session") {
    const state = KiloTerminalTitle.session({
      base: input.base,
      id: input.route.data.sessionID,
      data: input.sync.data,
      done: input.done,
      icon: input.icon,
    })
    const session = input.sync.session.get(input.route.data.sessionID)
    const title = !session || SessionApi.isDefaultTitle(session.title) ? undefined : session.title
    return {
      ...state,
      title: KiloTerminalTitle.format({ base: input.base, title, indicator: state.indicator, icon: input.icon }),
    }
  }

  if (input.route.data.type === "plugin") {
    return {
      title: KiloTerminalTitle.format({
        base: input.base,
        title: input.route.data.id,
        indicator: "none",
        icon: input.icon,
      }),
      active: false,
      indicator: "none",
    }
  }

  if (input.route.data.type === "kiloclaw") {
    return {
      title: KiloTerminalTitle.format({ base: input.base, title: "KiloClaw", indicator: "none", icon: input.icon }),
      active: false,
      indicator: "none",
    }
  }
}

// ---------------------------------------------------------------------------
// Session error handling
// ---------------------------------------------------------------------------

/**
 * Intercepts Kilo-specific errors and shows a warning toast.
 * Returns `true` if the error was handled, `false` otherwise.
 */
export function handleSessionError(error: unknown, toast: ReturnType<typeof useToast>): boolean {
  if (error && typeof error === "object" && isKiloError(error as any)) {
    showKiloErrorToast(error as any, toast)
    return true
  }
  return false
}

// ---------------------------------------------------------------------------
// Initialization
// ---------------------------------------------------------------------------

/**
 * One-shot initialiser called from the App component body.
 *
 * - Injects TUI dependencies into kilo-gateway
 * - Registers Kilo Gateway commands (profile, teams, kiloclaw, etc.)
 * - Registers the auto-approve toggle command
 * - Registers the settings dialog
 */
export function init() {
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()
  const settings = createSettingsDialog(dialog)

  useIndexingWarnings()

  // Inject TUI dependencies for kilo-gateway
  initializeTUIDependencies({
    useSync,
    useDialog,
    useToast,
    useTheme,
    useSDK,
    DialogAlert,
    DialogSelect,
    Link,
    Clipboard,
    useKeyboard,
    TextAttributes,
  })

  // Register Kilo Gateway commands (profile, teams, kiloclaw, remote, etc.)
  registerKiloCommands(useSDK)

  // Register auto-approve toggle
  useBindings(() => ({
    commands: [
      {
        namespace: "palette",
        name: "background_process.list",
        title: "Background processes",
        desc: "List and manage tracked background processes",
        category: "Kilo",
        slashName: "process",
        slashAliases: ["processes"],
        run: () => {
          dialog.replace(() => <DialogProcessList />)
        },
      },
      {
        namespace: "palette",
        name: "permission.allow_everything",
        get title() {
          return isAllowEverything(sync.data.config.permission)
            ? "Disable auto-approve mode"
            : "Enable auto-approve mode"
        },
        category: "System",
        run: async () => {
          const enabled = isAllowEverything(sync.data.config.permission)
          const result = await sdk.client.permission.allowEverything({ enable: !enabled })
          if (result.error) {
            toast.show({
              variant: "error",
              message: `Failed to ${!enabled ? "enable" : "disable"} auto-approve mode`,
            })
            return
          }
          dialog.clear()
        },
      },
      {
        namespace: "palette",
        name: "settings.show",
        title: "Settings",
        desc: "Manage providers, models, and TUI preferences without editing config by hand",
        category: "Kilo",
        slashName: "settings",
        slashAliases: ["preferences", "prefs"],
        run: settings,
      },
    ],
    bindings: [{ key: "ctrl+o", desc: "Open settings", group: "Settings", cmd: settings }],
  }))
}
