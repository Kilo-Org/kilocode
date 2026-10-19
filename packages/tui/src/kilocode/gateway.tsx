// Kilo account choice in the TUI: the personal account or a team, as in v1. The `kilocode.gateway` core
// plugin stores the choice and sends it as the team header.
import type { LocationRef } from "@opencode/client"
import { KiloGatewayRpc } from "@opencode/core/kilocode/gateway-rpc"
import { Plugin } from "@opencode/plugin/tui"
import { createSignal, onMount, Show } from "solid-js"
import { useClient } from "../context/client"
import { useTheme } from "../context/theme"
import type { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { useToast } from "../ui/toast"

type Profile = typeof KiloGatewayRpc.Definition.methods.profile.output.Type

/**
 * After a Kilo login, asks which account requests use. Same flow as v1 `KiloAutoMethod`: no picker
 * without teams, the first team preselected, and the personal account when the profile request fails.
 * Resolves `false` when the user closes the dialog.
 */
export function chooseKiloAccount(dialog: ReturnType<typeof useDialog>, location: LocationRef) {
  return new Promise<boolean>((resolve) => {
    dialog.replace(() => <DialogKiloAccount location={location} onDone={resolve} />, () => resolve(false))
  })
}

function DialogKiloAccount(props: { location: LocationRef; onDone: (proceed: boolean) => void }) {
  const client = useClient()
  const toast = useToast()
  const theme = useTheme().surface("dialog")
  const rpc = client.api.rpc(KiloGatewayRpc.Definition)
  const options = { location: { directory: props.location.directory } }
  const [profile, setProfile] = createSignal<Profile>()

  onMount(() => {
    rpc.profile({}, options).then(
      (result) => (result.organizations.length > 0 ? setProfile(result) : props.onDone(true)),
      () => {
        toast.show({ variant: "warning", message: "Couldn't fetch organizations, using personal account" })
        props.onDone(true)
      },
    )
  })

  // The root must be an element, not <Show>. A function root makes the dialog run this component again
  // whenever `profile` changes.
  return (
    <box>
      <Show
        when={profile()}
        fallback={
          <box paddingLeft={2} paddingRight={2} paddingBottom={1}>
            <text fg={theme.text.muted}>Fetching organizations...</text>
          </box>
        }
      >
        {(profile) => (
          <DialogSelect
            title={`Select Account (${profile().email})`}
            options={accountOptions(profile(), profile().organizationID)}
            current={profile().organizationID ?? profile().organizations[0]?.id ?? null}
            onSelect={(option) =>
              void rpc["organization.set"]({ organizationID: option.value }, options).then(
                () => props.onDone(true),
                () => {
                  toast.show({
                    variant: "warning",
                    message: "Failed to set organization; continuing with current account",
                  })
                  props.onDone(true)
                },
              )
            }
          />
        )}
      </Show>
    </box>
  )
}

// Same options as v1 `getOrganizationOptions`. `current` marks the account that requests use now.
export function accountOptions(profile: Profile, current: string | null) {
  return [
    ...(profile.hasPersonalAccount || profile.organizations.length === 0
      ? [
          {
            title: "Personal Account",
            value: null,
            description: current === null ? "→ (current)" : undefined,
            category: "Accounts",
          },
        ]
      : []),
    ...profile.organizations.map((organization) => ({
      title: organization.name,
      value: organization.id as string | null,
      description:
        organization.id === current ? ["→ (current)", organization.role].filter(Boolean).join(" ") : organization.role,
      category: "Teams",
    })),
  ]
}

// `/teams`, as in v1: switch between the personal account and the teams of the signed-in account.
export default Plugin.define({
  id: "kilocode.teams",
  setup(context) {
    context.ui.slot({
      append: "app",
      render() {
        context.keymap.layer(() => ({
          mode: "global",
          commands: [
            {
              id: "kilo.teams",
              title: "Teams",
              description: "Switch between Kilo Gateway teams",
              group: "Kilo",
              palette: true,
              slash: { name: "teams", aliases: ["team", "org", "orgs"] },
              enabled: () =>
                (context.data.location.integration.list() ?? []).some(
                  (integration) => integration.id === "kilo" && integration.connections.length > 0,
                ),
              run: () => teams(context),
            },
            {
              id: "kilo.profile",
              title: "Profile",
              description: "View your Kilo Gateway profile, balance, and Kilo Pass status",
              group: "Kilo",
              palette: true,
              slash: { name: "profile", aliases: ["me", "whoami", "kilo-account", "balance", "kilo-pass"] },
              run: () => accountStatus(context),
            },
          ],
        }))
        return null
      },
    })
  },
})

async function accountStatus(context: Plugin.Context) {
  const rpc = context.client.rpc(KiloGatewayRpc.Definition)
  const options = { location: { directory: (context.location ?? context.data.location.default()).directory } }
  const status = await rpc.authStatus({}, options).catch(() => undefined)
  if (!status?.authenticated) {
    return context.ui.dialog.alert({
      title: "Kilo Gateway (Signed Out)",
      message: `Server: ${status?.server ?? "https://api.kilo.ai"}\nUse /connect to sign in to Kilo Gateway.`,
    })
  }
  const [profile, balance, pass, modes] = await Promise.all([
    rpc.profile({}, options).catch(() => undefined),
    rpc.balance({}, options).catch(() => undefined),
    rpc.kiloPass({}, options).catch(() => null),
    rpc.modes({}, options).catch(() => []),
  ])
  const orgName = profile?.organizationID
    ? (profile.organizations.find((o) => o.id === profile.organizationID)?.name ?? profile.organizationID)
    : "Personal Account"
  const lines = [
    profile?.name ? `Name: ${profile.name}` : undefined,
    profile?.email ? `Account: ${profile.email}` : undefined,
    `Scope: ${orgName}`,
    balance?.balance != null ? `Balance: $${balance.balance.toFixed(2)}` : undefined,
    pass
      ? `Kilo Pass: $${pass.currentPeriodUsageUsd.toFixed(2)} / $${pass.currentPeriodBaseCreditsUsd.toFixed(2)} used`
      : undefined,
    modes.length > 0 ? `Team Modes: ${modes.map((m) => m.name).join(", ")}` : undefined,
  ].filter(Boolean)
  return context.ui.dialog.alert({
    title: "Kilo Gateway Account",
    message: lines.join("\n"),
  })
}

async function teams(context: Plugin.Context) {
  const rpc = context.client.rpc(KiloGatewayRpc.Definition)
  const options = { location: { directory: (context.location ?? context.data.location.default()).directory } }
  const profile = await rpc.profile({}, options).catch(() => undefined)
  if (!profile)
    return context.ui.dialog.alert({
      title: "Error",
      message: "Failed to fetch teams. Please ensure you're authenticated with Kilo Gateway.",
    })
  if (profile.organizations.length === 0)
    return context.ui.dialog.alert({
      title: "No Teams Available",
      message: "You're not a member of any teams.\nVisit https://app.kilo.ai to create or join a team.",
    })
  const choice = await context.ui.dialog.select({
    title: "Select Team",
    options: accountOptions(profile, profile.organizationID),
    current: profile.organizationID,
  })
  if (choice === undefined) return
  const switched = await rpc["organization.set"]({ organizationID: choice }, options).then(
    () => true,
    () => false,
  )
  if (!switched) return context.ui.toast.show({ variant: "error", message: "Failed to switch team" })
  const name = choice ? profile.organizations.find((organization) => organization.id === choice)?.name : "Personal"
  context.ui.toast.show({ variant: "success", message: `Switched to: ${name}` })
}
