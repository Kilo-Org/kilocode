import type { ProviderUsage } from "@kilocode/sdk/v2/client"

export type ProviderUsageData = ProviderUsage

export interface ProviderUsageLoadedMessage {
  type: "providerUsageLoaded"
  data?: ProviderUsageData
  error?: string
  reset?: boolean
}

export interface RequestProviderUsageMessage {
  type: "requestProviderUsage"
}

export interface RefreshProviderUsageMessage {
  type: "refreshProviderUsage"
}

/** Sent when the Profile view unmounts so the extension stops background usage refreshes. */
export interface ReleaseProviderUsageMessage {
  type: "releaseProviderUsage"
}
