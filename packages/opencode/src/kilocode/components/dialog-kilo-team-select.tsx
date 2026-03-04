/**
 * Kilo Gateway Team Selection Dialog
 *
 * Allows switching between organizations and personal account.
 * Marks the current team with "→ (current)" indicator.
 */

import { DialogSelect } from "@tui/ui/dialog-select"
import type { Organization } from "@kilocode/kilo-gateway"
import { getOrganizationOptions } from "@kilocode/kilo-gateway/tui"

interface DialogKiloTeamSelectProps {
  organizations: Organization[]
  currentOrgId?: string | null
  onSelect: (orgId: string | null) => Promise<void>
}

export function DialogKiloTeamSelect(props: DialogKiloTeamSelectProps) {
  // Get formatted options with current markers
  const options = getOrganizationOptions(props.organizations, props.currentOrgId || undefined)

  return (
    <DialogSelect
      title="Select Team"
      options={options}
      current={props.currentOrgId || null}
      onSelect={async (option: any) => {
        await props.onSelect(option.value)
      }}
    />
  )
}
