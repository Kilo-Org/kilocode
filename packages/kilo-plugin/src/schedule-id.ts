import { Automation } from "@opencode/core/automation"

/**
 * v2.3.1 renamed every carried schedule row from `sch_…` to the matching `aut_…` row. Stored Flow and wakeup
 * records still name the old id, so both forms resolve the same automation.
 */
export function automationID(id: string): Automation.ID {
  return Automation.ID.make(id.startsWith("sch_") ? `aut_${id.slice(4)}` : id)
}
