/**
 * Devil Gateway Commands for TUI
 *
 * Provides /profile and /teams commands that are only visible when connected to Devil Gateway.
 */

import { createMemo } from "solid-js"
import { useCommandDialog } from "@tui/component/dialog-command"
import { useSync } from "@tui/context/sync"
import { useRoute } from "@tui/context/route"
import { useDialog } from "@tui/ui/dialog"
import { useToast } from "@tui/ui/toast"
import { DialogAlert } from "@tui/ui/dialog-alert"
import type { Organization } from "@devilcode/kilo-gateway"
import type { ClawStatus } from "./claw/types.js"
import { DialogDevilTeamSelect } from "./components/dialog-kilo-team-select.js"
import { DialogDevilProfile } from "./components/dialog-kilo-profile.js"
import { DialogClawSetup } from "./components/dialog-claw-setup.js"
import { DialogClawUpgrade } from "./components/dialog-claw-upgrade.js"
import { Log } from "@/util/log"

// devilcode_change - audit N3: log catch helper so silent failures are still observable.
const log = Log.create({ service: "kilo-commands" })
function logCatch(label: string) {
  return (err: unknown) => {
    log.warn(label, { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

// These types are OpenCode-internal and imported at runtime
type UseSDK = any
type SDK = any

/**
 * Register all Devil Gateway commands
 * Call this from a component inside the TUI app
 *
 * @param useSDK - OpenCode's useSDK hook (passed from TUI context)
 */
export function registerDevilCommands(useSDK: () => UseSDK) {
  const command = useCommandDialog()
  const sync = useSync()
  const route = useRoute()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  // Only show Devil commands when connected to Devil Gateway
  const isDevilConnected = createMemo(() => {
    return sync.data.provider_next.connected.includes("kilo")
  })

  command.register(() => [
    // /kiloclaw command
    {
      value: "kilo.claw",
      title: "DevilClaw",
      description: "Open DevilClaw chat & dashboard",
      category: "Devil",
      slash: { name: "kiloclaw", aliases: ["claw"] },
      enabled: isDevilConnected(),
      hidden: !isDevilConnected(),
      onSelect: async () => {
        // Fetch profile (for org context) and instance status in parallel
        const [profileRes, res] = await Promise.all([
          sdk.client.kilo.profile().catch(logCatch("profile.fetch.failed")),
          sdk.client.kilo.claw.status().catch(logCatch("claw.status.failed")),
        ])
        const orgId = profileRes?.data?.currentOrgId ?? null
        const status = res?.data as ClawStatus | undefined

        // No instance provisioned
        if (!status || !status.userId || res.error) {
          dialog.replace(() => <DialogClawSetup orgId={orgId} />)
          return
        }

        // Instance exists — check for chat credentials
        const creds = await sdk.client.kilo.claw.chatCredentials().catch(logCatch("claw.chatCredentials.failed"))

        if (!creds?.data || creds.error) {
          // Instance exists but no chat credentials — needs upgrade
          dialog.replace(() => <DialogClawUpgrade orgId={orgId} />)
          return
        }

        // Everything ready — navigate to full-screen chat view
        route.navigate({ type: "kiloclaw" })
        dialog.clear()
      },
    },

    // /remote command
    {
      value: "remote.toggle",
      title: "Toggle remote",
      description: "Enable or disable remote session relay",
      category: "Devil",
      slash: { name: "remote" },
      enabled: isDevilConnected(),
      hidden: !isDevilConnected(),
      onSelect: async () => {
        try {
          const current = await sdk.client.remote.status()

          if (current.error || !current.data) {
            dialog.replace(() => <DialogAlert title="Error" message="Failed to fetch remote status." />)
            return
          }

          if (current.data.enabled) {
            await sdk.client.remote.disable()
            toast.show({ message: "Remote disabled", variant: "success" })
          } else {
            const result = await sdk.client.remote.enable()
            if (result.error) {
              const err = result.error as { error?: string }
              const msg = err?.error ?? "Failed to enable remote."
              dialog.replace(() => <DialogAlert title="Error" message={msg} />)
              return
            }
            toast.show({ message: "Remote enabled", variant: "success" })
          }

          dialog.clear()
        } catch (error) {
          dialog.replace(() => <DialogAlert title="Error" message={`Failed to toggle remote: ${error}`} />)
        }
      },
    },

    // /profile command
    {
      value: "kilo.profile",
      title: "Profile",
      description: "View your Devil Gateway profile",
      category: "Devil",
      slash: { name: "profile", aliases: ["me", "whoami"] },
      enabled: isDevilConnected(),
      hidden: !isDevilConnected(),
      onSelect: async () => {
        try {
          // Fetch profile and balance using server endpoint
          const response = await sdk.client.kilo.profile()

          if (response.error || !response.data) {
            dialog.replace(() => (
              <DialogAlert
                title="Error"
                message="Failed to fetch profile. Please ensure you're authenticated with Devil Gateway."
              />
            ))
            return
          }

          const { profile, balance, currentOrgId } = response.data

          // Show profile dialog with clickable usage link
          dialog.replace(() => <DialogDevilProfile profile={profile} balance={balance} currentOrgId={currentOrgId} />)
        } catch (error) {
          dialog.replace(() => <DialogAlert title="Error" message={`Failed to fetch profile: ${error}`} />)
        }
      },
    },

    // /teams command
    {
      value: "kilo.teams",
      title: "Teams",
      description: "Switch between Devil Gateway teams",
      category: "Devil",
      slash: { name: "teams", aliases: ["team", "org", "orgs"] },
      enabled: isDevilConnected(),
      hidden: !isDevilConnected(),
      onSelect: async () => {
        try {
          // Fetch profile to get organizations
          const response = await sdk.client.kilo.profile()

          if (response.error || !response.data) {
            dialog.replace(() => (
              <DialogAlert
                title="Error"
                message="Failed to fetch teams. Please ensure you're authenticated with Devil Gateway."
              />
            ))
            return
          }

          const { profile, currentOrgId } = response.data

          if (!profile.organizations || profile.organizations.length === 0) {
            dialog.replace(() => (
              <DialogAlert
                title="No Teams Available"
                message="You're not a member of any teams.\nVisit https://app.devil.ai to create or join a team."
              />
            ))
            return
          }

          // Show team selection dialog
          dialog.replace(() => (
            <DialogDevilTeamSelect
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
