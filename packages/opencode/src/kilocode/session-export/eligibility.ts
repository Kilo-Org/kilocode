import { getAuthOrgId, type OrgSource, type OrgState } from "./org-sources"
import { SecurityReviewer } from "@/kilocode/security-decision/reviewer"
export type { OrgState } from "./org-sources"

let kill = false
let reason: string | undefined
let source: OrgSource = getAuthOrgId

export type EligibilityInput = {
  model: {
    api: { npm: string }
    isFree?: boolean
  }
  org?: OrgState
}

export function isEligible(input: EligibilityInput): boolean {
  if (kill) return false
  if (input.org?.type !== "personal") return false
  if (input.model.isFree !== true) return false
  if (input.model.api.npm !== "@kilocode/kilo-gateway") return false
  return true
}

/**
 * Agents whose traffic is never exported. `title` is a background summariser, and the security
 * reviewer is a service of the policy layer whose prompt carries the command line under review.
 */
const UNEXPORTABLE = new Set<string>(["title", SecurityReviewer.AGENT])

export function exportableAgent(name: string): boolean {
  return !UNEXPORTABLE.has(name)
}

export function setKillSwitch(value: boolean, note?: string): void {
  kill = value
  reason = value ? note : undefined
}

export function getKillSwitchReason(): string | undefined {
  return reason
}

export function resetEligibility(): void {
  kill = false
  reason = undefined
}

export async function getActiveOrg(): Promise<OrgState> {
  const env = process.env.KILO_ORG_ID?.trim()
  if (env) return { type: "org", id: env }
  try {
    return await source()
  } catch (err) {
    console.warn("[session-export] org source failed", err)
    return { type: "unknown" }
  }
}

export function setOrgSource(next: OrgSource): void {
  source = next
}

export function resetOrgSource(): void {
  source = getAuthOrgId
}
