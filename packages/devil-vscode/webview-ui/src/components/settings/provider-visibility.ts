import type { ProviderAuthState } from "../../types/messages"
import { DEVIL_PROVIDER_ID } from "../../../../src/shared/provider-model"

export function visibleConnectedIds(connected: string[], authStates: Record<string, ProviderAuthState>) {
  return connected.filter((id) => id !== DEVIL_PROVIDER_ID || authStates[DEVIL_PROVIDER_ID] !== undefined)
}
