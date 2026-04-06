import type { ReviewFinding } from "./types"
import type { TeamConfig } from "../team/config"

const SENIOR_CATEGORIES = new Set(["security", "architecture"])

export function routeFix(finding: ReviewFinding, teamConfig: TeamConfig): string {
  if (SENIOR_CATEGORIES.has(finding.category)) return "senior"
  if (finding.suggestedRole && teamConfig.roles[finding.suggestedRole]) return finding.suggestedRole
  if (finding.category === "correctness" && finding.severity === "blocker") return "senior"
  return teamConfig.routing.defaultRole
}

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
