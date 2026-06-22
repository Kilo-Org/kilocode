// kilocode_change - new file
// TUI dialog for browsing the Kilo Marketplace. Opened from the skills
// dialog's "browse" action. Lists marketplace skills grouped by category,
// marks already-installed skills with a checkmark, and installs a selected
// skill into the user's global skills directory.

import { createMemo, createResource, createSignal, For, Show } from "solid-js"
import { DialogSelect, type DialogSelectOption } from "@tui/ui/dialog-select"
import { useDialog } from "@tui/ui/dialog"
import { useSDK } from "@tui/context/sdk"
import { useTheme } from "@tui/context/theme"
import { TextAttributes } from "@opentui/core"

export function DialogSkillMarketplace(props: { installed: Set<string>; onInstalled: () => void }) {
  const dialog = useDialog()
  const sdk = useSDK()
  const { theme } = useTheme()
  const [busy, setBusy] = createSignal<string | null>(null)
  const [error, setError] = createSignal<string | undefined>()

  const [data] = createResource(async () => {
    const result = await sdk.client.kilocode.marketplaceSkills()
    return result.data
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const items = data()?.items ?? []
    return items.map((item) => {
      const isInstalled = props.installed.has(item.id)
      const isBusy = busy() === item.id
      return {
        title: item.displayName,
        description: item.description?.replace(/\s+/g, " ").trim(),
        value: item.id,
        category: item.displayCategory || "Skills",
        gutter: isInstalled ? () => <InstalledMark /> : undefined,
        footer: isBusy ? <BusyMark /> : isInstalled ? <InstalledBadge /> : undefined,
        disabled: isBusy,
        onSelect: async () => {
          if (isInstalled) {
            // Already installed — just close the marketplace view.
            dialog.clear()
            return
          }
          setBusy(item.id)
          setError(undefined)
          try {
            const result = await sdk.client.kilocode.installSkill({
              id: item.id,
              url: item.content,
              scope: "global",
            })
            if (!result.data?.success) {
              setError(result.data?.error ?? "Install failed")
              return
            }
            props.onInstalled()
            dialog.clear()
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err))
          } finally {
            setBusy(null)
          }
        },
      }
    })
  })

  return (
    <DialogSelect
      title="Marketplace Skills"
      placeholder="Search marketplace..."
      options={options()}
      onSelect={(_option) => {
        // Don't close on select; install action handles its own close.
      }}
      footerHints={error() ? [{ title: "error", label: error()!, side: "right" }] : undefined}
    />
  )
}

function InstalledMark() {
  return (
    <text fg="#7dba65" attributes={TextAttributes.BOLD}>
      ✓
    </text>
  )
}

function InstalledBadge() {
  const { theme } = useTheme()
  return (
    <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
      installed
    </text>
  )
}

function BusyMark() {
  const { theme } = useTheme()
  return (
    <text fg={theme.textMuted} attributes={TextAttributes.DIM}>
      installing…
    </text>
  )
}
