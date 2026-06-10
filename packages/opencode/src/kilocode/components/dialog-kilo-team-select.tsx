/**
 * Kilo Gateway Team Selection Dialog
 *
 * Allows switching between organizations and personal account.
 * Marks the current team with "→ (current)" indicator.
 */

import { DialogSelect } from "@tui/ui/dialog-select"
import type { Organization } from "@kilocode/kilo-gateway"
// kilocode_change start - lazy import guarded by Bedrock-only mode
let _getOrganizationOptions: any
const getOrganizationOptions = (...args: any[]) => {
  if (process.env.BEDROCK_ONLY === "true" || process.env.BEDROCK_ONLY === "1") return []
  if (!_getOrganizationOptions) {
    try { _getOrganizationOptions = require("@kilocode/kilo-gateway/tui").getOrganizationOptions } catch { return [] }
  }
  return _getOrganizationOptions(...args)
}
// kilocode_change end

interface DialogKiloTeamSelectProps {
  organizations: Organization[]
  currentOrgId?: string | null
  onSelect: (orgId: string | null) => Promise<void>
}

export function DialogKiloTeamSelect(props: DialogKiloTeamSelectProps) {
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
