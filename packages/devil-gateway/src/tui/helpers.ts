/**
 * TUI-specific helper functions for Devil Gateway integration
 *
 * This module provides utilities that are consumed by the TUI layer
 * to implement organization selection, profile display, and team management.
 */

import type { DevilcodeProfile, DevilcodeBalance, Organization } from "../types.js"

/**
 * Format profile information for display
 * Used by TUI to show profile in dialogs
 */
export function formatProfileInfo(
  profile: DevilcodeProfile,
  balance: DevilcodeBalance | null,
  currentOrgId?: string,
): string {
  let content = ""

  if (profile.name) {
    content += `Name: ${profile.name}\n`
  }

  if (profile.email) {
    content += `Email: ${profile.email}\n`
  }

  // Show current organization
  if (currentOrgId && profile.organizations) {
    const currentOrg = profile.organizations.find((org) => org.id === currentOrgId)
    if (currentOrg) {
      content += `Team: ${currentOrg.name} (${currentOrg.role})\n`
    }
  } else {
    content += `Team: Personal\n`
  }

  if (balance && balance.balance !== undefined && balance.balance !== null) {
    content += `Balance: $${balance.balance.toFixed(2)}\n`
  }

  // Add usage details link
  const usageUrl = currentOrgId
    ? `https://app.devil.ai/organizations/${currentOrgId}/usage-details`
    : "https://app.devil.ai/usage"
  content += `\nUsage Details: ${usageUrl}`

  return content
}

/**
 * Get organization options formatted for TUI DialogSelect
 * Pre-selects the first organization by default
 */
export function getOrganizationOptions(
  organizations: Organization[],
  currentOrgId?: string,
): Array<{
  title: string
  value: string | null
  description?: string
  category: string
}> {
  return [
    {
      title: "Personal Account",
      value: null,
      description: !currentOrgId ? "→ (current)" : undefined,
      category: "Accounts",
    },
    ...organizations.map((org) => ({
      title: org.name,
      value: org.id,
      description: org.id === currentOrgId ? `→ (current) ${org.role}` : org.role,
      category: "Teams",
    })),
  ]
}

/**
 * Get the default organization selection (first org if available, otherwise personal)
 */
export function getDefaultOrganizationSelection(organizations: Organization[]): string | null {
  return organizations.length > 0 ? organizations[0].id : null
}
