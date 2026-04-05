// kilocode_change - new file

/**
 * KiloClaw Upgrade Dialog
 *
 * Shown when the user has an active KiloClaw instance but no chat credentials,
 * indicating the instance was provisioned before chat was enabled and needs
 * an upgrade to the latest version.
 */

import { useKeyboard } from "@opentui/solid"
import { useTheme } from "@tui/context/theme"
import { useDialog } from "@tui/ui/dialog"
import { Link } from "@tui/ui/link"

export function DialogClawUpgrade(props: { orgId?: string | null }) {
  const { theme } = useTheme()
  const dialog = useDialog()

  const url = props.orgId ? `https://app.kilo.ai/organizations/${props.orgId}/claw` : "https://app.kilo.ai/claw"

  useKeyboard((evt: any) => {
    if (evt.name === "return") {
      dialog.clear()
    }
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text}>
          <span style={{ bold: true }}>KiloClaw Chat requires an upgrade</span>
        </text>
        <text fg={theme.textMuted}>esc</text>
      </box>

      <box paddingBottom={1} gap={1}>
        <text fg={theme.textMuted} wrapMode="word">
          This instance was provisioned before chat was enabled.
        </text>
        <text fg={theme.textMuted} wrapMode="word">
          Use the <span style={{ fg: theme.warning, bold: true }}>↻ Upgrade to Latest</span> button on the KiloClaw
          dashboard to activate real-time chat with your bot.
        </text>
      </box>

      <box flexDirection="row" justifyContent="flex-end" paddingBottom={1}>
        <box paddingLeft={3} paddingRight={3} backgroundColor={theme.primary}>
          <Link href={url} fg={theme.selectedListItemText}>
            Dashboard
          </Link>
        </box>
      </box>
    </box>
  )
}
