let kill = false
let reason: string | undefined

export type EligibilityInput = {
  model: {
    api: { npm: string }
    isFree?: boolean
  }
  org?: string | undefined
}

export function isEligible(input: EligibilityInput): boolean {
  if (kill) return false
  if (input.org) return false
  if (input.model.isFree !== true) return false
  if (input.model.api.npm !== "@kilocode/kilo-gateway") return false
  return true
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
