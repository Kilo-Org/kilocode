/**
 * Kilo-specific TUI app customizations.
 *
 * Everything in this module is called from the shared upstream `app.tsx`
 * via thin integration points so the upstream diff stays minimal.
 */

import { createEffect, on } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import { TextAttributes } from "@opentui/core"
import * as Clipboard from "@tui/util/clipboard"
import { useCommandPalette } from "@tui/context/command-palette"
import { useArgs } from "@tui/context/args"
import { useRoute } from "@tui/context/route"
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
import { TuiAutoApprove } from "@/kilocode/cli/cmd/tui/auto-approve"
import { initializeTUIDependencies } from "@kilocode/kilo-gateway/tui"
import { DialogProcessList } from "@/kilocode/cli/cmd/tui/component/dialog-process-list"
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

// kilocode_change start - global allow-everything helper for persistent config auto-approve
export function isAllowEverything(permission: unknown): boolean {
  if (typeof permission !== "object" || permission === null) return false
  const wildcard = (permission as Record<string, unknown>)["*"]
  if (typeof wildcard === "string") return wildcard === "allow"
  if (typeof wildcard === "object" && wildcard !== null) return (wildcard as Record<string, unknown>)["*"] === "allow"
  return false
}
// kilocode_change end

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
  const state = { prev: "" }

  // Notify server which session the user is viewing
  createEffect(() => {
    const sessionID = deps.route.data.type === "session" ? deps.route.data.sessionID : undefined
    deps.sdk.client.session.viewed({ focused: sessionID ? [sessionID] : [] }).catch(() => {})

    if (!pty) return
    const session = sessionID ? deps.sync.session.get(sessionID) : undefined
    const key = [sessionID ?? "", session?.title ?? ""].join("\n")
    if (key === state.prev) return
    state.prev = key

    deps.sdk.client.pty
      .update({
        ptyID: pty,
        sessionID: sessionID ?? null,
        ...(session?.title ? { title: session.title } : {}),
      })
      .catch(() => {})
  })

  // Evict per-session data from store when navigating away
  createEffect(
    on(
      () => (deps.route.data.type === "session" ? deps.route.data.sessionID : undefined),
      (current, prev) => {
        if (prev && prev !== current) deps.sync.session.evict(prev)
      },
    ),
  )
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
 */
export function init() {
  const route = useRoute()
  const args = useArgs()
  const sync = useSync()
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()

  const enabled = () => {
    if (route.data.type !== "session") return false
    return TuiAutoApprove.enabled(route.data.sessionID)
  }

  useIndexingWarnings()

  // Inject TUI dependencies for kilo-gateway
  initializeTUIDependencies({
    useCommandPalette,
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

  createEffect(() => {
    if (!args.autoApprove) return
    if (route.data.type !== "session") return
    if (!args.sessionID && !args.continue && !args.fork) return
    TuiAutoApprove.boot(route.data.sessionID)
  })

  const reply = async (sid: string, rid: string) => {
    if (!TuiAutoApprove.mark(sid, rid)) return
    if (!TuiAutoApprove.enabled(sid)) return
    const result = await sdk.client.permission.reply({ requestID: rid, reply: "once" })
    if (result.error) TuiAutoApprove.clear(sid)
  }

  createEffect(() => {
    const active = new Set(sync.data.session.map((item) => item.id))
    if (route.data.type === "session") active.add(route.data.sessionID)
    TuiAutoApprove.prune(active)
  })

  createEffect(() => {
    if (route.data.type !== "session") return
    for (const req of sync.data.permission[route.data.sessionID] ?? []) {
      void reply(route.data.sessionID, req.id)
    }
  })

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
      // kilocode_change start - global allow_everything for persistent config-level auto-approve
      {
        namespace: "palette",
        name: "permission.allow_everything",
        get title() {
          return isAllowEverything(sync.data.config.permission)
            ? "Disable global auto-approve mode"
            : "Enable global auto-approve mode"
        },
        desc: "Persist auto-approve for all sessions in config",
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
      // kilocode_change end
      {
        namespace: "palette",
        name: "permission.auto_approve_session",
        get title() {
          return enabled() ? "Disable session auto-approve" : "Enable session auto-approve"
        },
        desc: "Approve permission prompts once for this session",
        category: "Session",
        slashName: "auto-approve",
        slashAliases: ["yolo"],
        enabled: route.data.type === "session",
        run: async () => {
          if (route.data.type !== "session") return
          const sessionID = route.data.sessionID
          const next = !enabled()
          TuiAutoApprove.set(sessionID, next)
          if (next) {
            for (const req of sync.data.permission[sessionID] ?? []) {
              await reply(sessionID, req.id)
            }
            if (!TuiAutoApprove.enabled(sessionID)) {
              toast.show({
                variant: "error",
                message: "Failed to enable auto-approve mode",
              })
              return
            }
          }
          dialog.clear()
        },
      },
    ],
  }))
}
