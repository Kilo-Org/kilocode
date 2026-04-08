/**
 * Devil Gateway Team Selection Dialog
 *
 * Allows switching between organizations and personal account.
 * Marks the current team with "→ (current)" indicator.
 */

import { DialogSelect } from "@tui/ui/dialog-select"
import type { Organization } from "@devilcode/kilo-gateway"
import { getOrganizationOptions } from "@devilcode/kilo-gateway/tui"

interface DialogDevilTeamSelectProps {
  organizations: Organization[]
  currentOrgId?: string | null
  onSelect: (orgId: string | null) => Promise<void>
}

export function DialogDevilTeamSelect(props: DialogDevilTeamSelectProps) {
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
