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

  const [data, { refetch }] = createResource(async () => {
    const result = await sdk.client.kilocode.marketplaceSkills()
    // Surface server-side errors (e.g. upstream marketplace outage) as a
    // top-level error so the dialog can show it instead of a silent empty list.
    if (result.error) {
      const err = result.error as { message?: string }
      throw new Error(err.message ?? "Failed to fetch marketplace skills")
    }
    return result.data
  })

  const options = createMemo<DialogSelectOption<string>[]>(() => {
    const items = data()?.items ?? []
    return items.map((item) => {
      const isInstalled = props.installed.has(item.id)
      const isBusy = busy() === item.id
      // Title-case the id and category on the client (the API returns them
      // in their raw kebab/snake form).
      const displayName = kebabToTitleCase(item.id)
      const displayCategory = kebabToTitleCase(item.category)
      return {
        title: displayName,
        description: item.description?.replace(/\s+/g, " ").trim(),
        value: item.id,
        category: displayCategory || "Skills",
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

  // Loading state — shown while the resource is pending or during retry.
  // Error state — replaces the list when the fetch failed; user can retry.
  // Empty state — explicit "no skills" message (the marketplace API always
  // returns 40, so an empty list is a server-side bug worth showing).
  const loading = data.loading
  const fetchError = data.error
  const items = data()?.items ?? []

  return (
    <DialogSelect
      title="Marketplace Skills"
      placeholder={
        loading
          ? "Loading marketplace..."
          : fetchError
            ? "Failed to load marketplace (press ctrl+r to retry)"
            : "Search marketplace..."
      }
      options={options()}
      onSelect={(_option) => {
        // Don't close on select; install action handles its own close.
      }}
      footerHints={
        fetchError
          ? [{ title: "error", label: String((fetchError as Error).message ?? fetchError), side: "right" }]
          : error()
            ? [{ title: "error", label: error()!, side: "right" }]
            : loading
              ? [{ title: "loading", label: "fetching skills...", side: "right" }]
              : items.length === 0
                ? [{ title: "empty", label: "marketplace returned 0 skills", side: "right" }]
                : undefined
      }
    />
  )
}

function kebabToTitleCase(str: string): string {
  return str
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ")
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
