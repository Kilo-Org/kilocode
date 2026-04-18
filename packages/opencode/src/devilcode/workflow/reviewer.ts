import type { ReviewFinding } from "./types"
import type { TeamConfig } from "../team/config"

const ESCALATION_CATEGORIES = new Set(["security", "architecture"])

// devilcode_change start - audit MA2: route to configured escalation role instead of hardcoded "senior".
function escalationRole(teamConfig: TeamConfig): string {
  const configured = teamConfig.routing.reviewEscalationRole
  if (configured && teamConfig.roles[configured]) return configured
  // Legacy fallback: prefer "senior" only if it actually exists in the roles map.
  if (teamConfig.roles["senior"]) return "senior"
  return teamConfig.routing.defaultRole
}

export function routeFix(finding: ReviewFinding, teamConfig: TeamConfig): string {
  if (ESCALATION_CATEGORIES.has(finding.category)) return escalationRole(teamConfig)
  if (finding.suggestedRole && teamConfig.roles[finding.suggestedRole]) return finding.suggestedRole
  if (finding.category === "correctness" && finding.severity === "blocker") return escalationRole(teamConfig)
  return teamConfig.routing.defaultRole
}
// devilcode_change end

export function triageFindings(findings: ReviewFinding[]): {
  blockers: ReviewFinding[]
  warnings: ReviewFinding[]
  suggestions: ReviewFinding[]
} {
  const blockers: ReviewFinding[] = []
  const warnings: ReviewFinding[] = []
  const suggestions: ReviewFinding[] = []
  for (const finding of findings) {
    switch (finding.severity) {
      case "blocker":
        blockers.push(finding)
        break
      case "warning":
        warnings.push(finding)
        break
      case "suggestion":
        suggestions.push(finding)
        break
    }
  }
  return { blockers, warnings, suggestions }
}

export const MAX_REVIEW_CYCLES = 3
