/**
 * Kilo-specific overrides for the provider dialog.
 *
 * Exports constants and renderers consumed by the shared upstream
 * `dialog-provider.tsx` so the upstream diff stays minimal.
 */

import type { JSX } from "solid-js"
import type { RGBA } from "@opentui/core"
import type { ProviderAuthAuthorization } from "@kilocode/sdk/v2"
import { KiloAutoMethod } from "@/kilocode/components/dialog-kilo-auto-method"
import { DialogSelect } from "@tui/ui/dialog-select"
import { DialogModel } from "@tui/component/dialog-model"
import { launchCustomProvider, removeCustomProvider } from "./dialog-custom-provider"
import { isCustomProvider } from "./custom-provider"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
export { selectProvider } from "@/kilocode/anaconda-desktop/tui/setup"

// ---------------------------------------------------------------------------
// Failed-state gutter/description helpers
// ---------------------------------------------------------------------------

/**
 * Returns a red `!` gutter element when the provider is in a failed auth state,
 * or `undefined` if not failed and not connected (falls through to default check).
 */
export function renderGutter(
  providerID: string,
  failed: string[],
  theme: { error: RGBA },
): (() => JSX.Element) | undefined {
  if (!failed.includes(providerID)) return undefined
  return () => <text fg={theme.error}>!</text>
}

/**
 * Returns a description suffix when the provider has encountered an error,
 * or `undefined` to leave the default description unchanged.
 *
 * NOTE: The sync state only carries failed provider IDs, not the error kind.
 * A generic message is used so it remains accurate for auth, network, and
 * schema failure types alike.
 */
export function failedDescription(providerID: string, failed: string[]): string | undefined {
  if (!failed.includes(providerID)) return undefined
  return "(connection error — click to reconnect)"
}

// ---------------------------------------------------------------------------
// Provider priority (replaces upstream map entirely)
// ---------------------------------------------------------------------------

export const PROVIDER_PRIORITY: Record<string, number> = {
  kilo: -1,
  anthropic: 0,
  "github-copilot": 1,
  openai: 2,
  google: 3,
  "anaconda-desktop": 4,
}

// ---------------------------------------------------------------------------
// Provider descriptions shown next to the name in the selection list
// ---------------------------------------------------------------------------

export const PROVIDER_DESCRIPTIONS: Record<string, string> = {
  kilo: "(Recommended)",
  anthropic: "(Claude Max or API key)",
  openai: "(ChatGPT login or API key)",
  "anaconda-desktop": "(Local models)",
}

export const PROVIDER_TITLES: Record<string, string> = {
  openai: "OpenAI / Codex",
}

/** Local OpenAI-compatible providers where API key is optional (localhost). */
export const LOCAL_OPTIONAL_API_KEY = new Set(["atomic-chat", "lmstudio"])

export function isLocalOptionalApiKey(providerID: string) {
  return LOCAL_OPTIONAL_API_KEY.has(providerID)
}

export const LOCAL_API_KEY_PLACEHOLDER = "local"

// ---------------------------------------------------------------------------
// Auto-method renderer
// ---------------------------------------------------------------------------

/**
 * If the provider is Kilo Gateway, renders the custom `KiloAutoMethod`
 * component that handles device-auth + org selection.
 *
 * Returns `undefined` for every other provider so the caller can fall
 * through to the default `AutoMethod`.
 */
export function renderAutoMethod(opts: {
  providerID: string
  title: string
  index: number
  authorization: ProviderAuthAuthorization
  useSDK: () => any
  useTheme: () => any
  DialogModel: any
}): (() => JSX.Element) | undefined {
  if (opts.providerID !== "kilo") return undefined
  return () => (
    <KiloAutoMethod
      providerID={opts.providerID}
      title={opts.title}
      index={opts.index}
      authorization={opts.authorization}
      useSDK={opts.useSDK}
      useTheme={opts.useTheme}
      DialogModel={opts.DialogModel}
    />
  )
}

// ---------------------------------------------------------------------------
// API-key dialog description
// ---------------------------------------------------------------------------

/**
 * Returns a custom description element for the API-key dialog when the
 * provider is Kilo Gateway. Returns `undefined` otherwise.
 */
export function renderApiDescription(
  providerID: string,
  theme: { textMuted: RGBA; text: RGBA; primary: RGBA },
): (() => JSX.Element) | undefined {
  if (providerID === "atomic-chat") {
    return () => (
      <text fg={theme.textMuted}>
        Connect to Atomic Chat on this machine (default http://127.0.0.1:1337). Leave API key empty for local server.
      </text>
    )
  }
  if (providerID !== "kilo") return undefined
  return () => (
    <box gap={1}>
      <text fg={theme.textMuted}>
        Kilo Gateway gives you access to all the best coding models at the cheapest prices with a single API key.
      </text>
      <text fg={theme.text}>
        Go to <span style={{ fg: theme.primary }}>https://kilo.ai/gateway</span> to get a key
      </text>
    </box>
  )
}

export function apiKeyPlaceholder(providerID: string) {
  return isLocalOptionalApiKey(providerID) ? "Optional for localhost" : "API key"
}

// ---------------------------------------------------------------------------
// Custom provider wizard integration
// ---------------------------------------------------------------------------

/** Launch the add wizard when the user picks "Other". */
export function launchAddCustomProvider(replace: (el: () => JSX.Element) => void) {
  launchCustomProvider({ mode: "add", replace })
}

/**
 * If `providerID` is a config-defined custom provider, show a small menu
 * (Select model / Edit / Delete) and return true. Otherwise return false so
 * the caller falls through to the default auth-method flow.
 */
export function onConfiguredCustomProvider(providerID: string, replace: (el: () => JSX.Element) => void): boolean {
  const sync = useSync()
  const existing = sync.data.globalConfig?.provider?.[providerID]
  if (!existing || !isCustomProvider(existing)) return false
  const sdk = useSDK()
  const toast = useToast()
  const dialog = useDialog()
  const closeAnd = (fn: () => void) => {
    dialog.clear()
    fn()
  }
  replace(() => (
    <DialogSelect
      title={providerID}
      options={[
        {
          title: "Select model",
          value: "select",
          onSelect: () => closeAnd(() => replace(() => <DialogModel providerID={providerID} />)),
        },
        {
          title: "Edit provider",
          value: "edit",
          onSelect: () =>
            closeAnd(() => launchCustomProvider({ mode: "edit", providerID, replace })),
        },
        {
          title: "Delete provider",
          value: "delete",
          onSelect: () =>
            closeAnd(() =>
              void removeCustomProvider(providerID, { sdk, sync, toast, dialog }),
            ),
        },
      ]}
    />
  ))
  return true
}
