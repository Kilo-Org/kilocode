/**
 * Kilo Gateway Commands for TUI
 *
 * Provides /profile and /teams commands that are only visible when connected to Kilo Gateway.
 */

import { createMemo } from "solid-js"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useSync } from "@tui/context/sync"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogAlert } from "@tui/ui/dialog-alert"
import type { Organization } from "@kilocode/kilo-gateway"
import { DialogKiloTeamSelect } from "./components/dialog-kilo-team-select.js"
import { DialogKiloProfile } from "./components/dialog-kilo-profile.js"

// These types are OpenCode-internal and imported at runtime
type UseSDK = any
type SDK = any

/**
 * Register all Kilo Gateway commands
 * Call this from a component inside the TUI app
 *
 * @param useSDK - OpenCode's useSDK hook (passed from TUI context)
 */
export function registerKiloCommands(useSDK: () => UseSDK) {
  const command = useCommandDialog()
  const sync = useSync()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  // Only show Kilo commands when connected to Kilo Gateway
  const isKiloConnected = createMemo(() => {
    return sync.data.provider_next.connected.includes("kilo")
  })

  command.register(() => [
    // /profile command
    {
      value: "kilo.profile",
      title: "Profile",
      description: "View your Kilo Gateway profile",
      category: "Kilo",
      slash: { name: "profile", aliases: ["me", "whoami"] },
      enabled: isKiloConnected(),
      hidden: !isKiloConnected(),
      onSelect: async () => {
        try {
          // Fetch profile and balance using server endpoint
          const response = await sdk.client.kilo.profile()

          if (response.error || !response.data) {
            dialog.replace(() => (
              <DialogAlert
                title="Error"
                message="Failed to fetch profile. Please ensure you're authenticated with Kilo Gateway."
              />
            ))
            return
          }

          const { profile, balance, currentOrgId } = response.data

          // Show profile dialog with clickable usage link
          dialog.replace(() => <DialogKiloProfile profile={profile} balance={balance} currentOrgId={currentOrgId} />)
        } catch (error) {
          dialog.replace(() => <DialogAlert title="Error" message={`Failed to fetch profile: ${error}`} />)
        }
      },
    },

    // /teams command
    {
      value: "kilo.teams",
      title: "Teams",
      description: "Switch between Kilo Gateway teams",
      category: "Kilo",
      slash: { name: "teams", aliases: ["team", "org", "orgs"] },
      enabled: isKiloConnected(),
      hidden: !isKiloConnected(),
      onSelect: async () => {
        try {
          // Fetch profile to get organizations
          const response = await sdk.client.kilo.profile()

          if (response.error || !response.data) {
            dialog.replace(() => (
              <DialogAlert
                title="Error"
                message="Failed to fetch teams. Please ensure you're authenticated with Kilo Gateway."
              />
            ))
            return
          }

          const { profile, currentOrgId } = response.data

          if (!profile.organizations || profile.organizations.length === 0) {
            dialog.replace(() => (
              <DialogAlert
                title="No Teams Available"
                message="You're not a member of any teams.\nVisit https://app.kilo.ai to create or join a team."
              />
            ))
            return
          }

          // Show team selection dialog
          dialog.replace(() => (
            <DialogKiloTeamSelect
              organizations={profile.organizations!}
              currentOrgId={currentOrgId}
              onSelect={async (orgId) => {
                try {
                  // Switch to team immediately using server endpoint
                  await sdk.client.kilo.organization.set({
                    organizationId: orgId,
                  })

                  // Refresh provider state to reload models with new organization context
                  await sdk.client.instance.dispose()
                  await sync.bootstrap()

                  // Show success toast
                  const teamName = orgId
                    ? profile.organizations!.find((o: Organization) => o.id === orgId)?.name
                    : "Personal"

                  toast.show({
                    message: `Switched to: ${teamName}`,
                    variant: "success",
                  })

                  // Close dialog
                  dialog.clear()
                } catch (error) {
                  if (error instanceof DOMException && error.name === "AbortError") return
                  toast.show({
                    message: "Failed to switch team",
                    variant: "error",
                  })
                  dialog.clear()
                }
              }}
            />
          ))
        } catch (error) {
          dialog.replace(() => <DialogAlert title="Error" message={`Failed to fetch teams: ${error}`} />)
        }
      },
    },
  ])
}
