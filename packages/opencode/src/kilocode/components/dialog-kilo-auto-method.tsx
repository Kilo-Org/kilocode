// kilocode_change - Kilo Gateway TUI component
/**
 * Custom OAuth handler for Kilo Gateway
 *
 * Handles the device authorization flow and organization selection
 * before completing authentication.
 */

import { createSignal, onMount, Show } from "solid-js"
import { TextAttributes } from "@opentui/core"
import { useKeyboard } from "@opentui/solid"
import { useDialog } from "@tui/ui/dialog"
import { useSync } from "@tui/context/sync"
import { useToast } from "@tui/ui/toast"
import { Link } from "@tui/ui/link"
import { Clipboard } from "@tui/util/clipboard"
import { DialogKiloOrganization } from "./dialog-kilo-organization.js"

// These types are OpenCode-internal and imported at runtime
type UseSDK = any
type UseTheme = any
type ProviderAuthAuthorization = any
type DialogModel = any

interface KiloAutoMethodProps {
  index: number
  providerID: string
  title: string
  authorization: ProviderAuthAuthorization
  useSDK: () => UseSDK
  useTheme: () => UseTheme
  DialogModel: DialogModel
}

export function KiloAutoMethod(props: KiloAutoMethodProps) {
  const { theme } = props.useTheme()
  const sdk = props.useSDK()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const [status, setStatus] = createSignal<"waiting" | "fetching" | "error">("waiting")
  const [tokenForOrgSelection, setTokenForOrgSelection] = createSignal<string | null>(null)

  useKeyboard((evt: any) => {
    if (evt.name === "c" && !evt.ctrl && !evt.meta) {
      const code = props.authorization.instructions.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/)?.[0] ?? props.authorization.url
      Clipboard.copy(code)
        .then(() => toast.show({ message: "Copied to clipboard", variant: "info" }))
        .catch(toast.error)
    }
  })

  onMount(async () => {
    try {
      // Step 1: Poll for OAuth completion
      const result = await sdk.client.provider.oauth.callback({
        providerID: props.providerID,
        method: props.index,
      })

      if (result.error) {
        dialog.clear()
        return
      }

      setStatus("fetching")

      // Step 2: Fetch profile using the new server endpoint
      // This endpoint uses the stored auth credentials to fetch profile
      const profileResponse = await sdk.client.kilo.profile()

      if (profileResponse.error || !profileResponse.data) {
        // Couldn't fetch profile - fallback to personal account
        throw new Error("Failed to fetch profile")
      }

      const { profile } = profileResponse.data

      // Step 3: Check if user has organizations
      if (profile.organizations && profile.organizations.length > 0) {
        // Has organizations - show selection dialog
        // Bootstrap first to ensure sync is up to date
        await sdk.client.instance.dispose()
        await sync.bootstrap()

        dialog.replace(() => (
          <DialogKiloOrganization
            organizations={profile.organizations!}
            userEmail={profile.email}
            providerID={props.providerID}
            useSDK={props.useSDK}
            useTheme={props.useTheme}
            DialogModel={props.DialogModel}
          />
        ))
      } else {
        // No organizations - proceed with personal account
        await sdk.client.instance.dispose()
        await sync.bootstrap()
        dialog.replace(() => <props.DialogModel providerID={props.providerID} />)
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return

      // Error fetching profile - fallback to personal account
      console.warn("Failed to fetch Kilo profile, using personal account:", error)
      setStatus("error")

      toast.show({
        message: "Couldn't fetch organizations, using personal account",
        variant: "warning",
      })

      // Small delay to show the warning, then proceed
      await new Promise((resolve) => setTimeout(resolve, 1500))

      try {
        await sdk.client.instance.dispose()
        await sync.bootstrap()
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") return
        console.warn("Failed to reset state during fallback:", e)
      }
      dialog.replace(() => <props.DialogModel providerID={props.providerID} />)
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text attributes={TextAttributes.BOLD} fg={theme.text}>
          {props.title}
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <box gap={1}>
        <Link href={props.authorization.url} fg={theme.primary} />
        <text fg={theme.textMuted}>{props.authorization.instructions}</text>
      </box>

      <Show when={status() === "waiting"}>
        <text fg={theme.textMuted}>Waiting for authorization...</text>
      </Show>

      <Show when={status() === "fetching"}>
        <text fg={theme.textMuted}>Fetching organizations...</text>
      </Show>

      <Show when={status() === "error"}>
        <text fg={theme.warning}>Using personal account</text>
      </Show>

      <text fg={theme.text}>
        c <span style={{ fg: theme.textMuted }}>copy</span>
      </text>
    </box>
  )
}
