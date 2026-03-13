import type { DeviceAuthInitiateResponse, DeviceAuthPollResponse } from "../types.js"
import { KILO_API_BASE } from "../api/constants.js"
import { buildKiloHeaders, DEFAULT_HEADERS } from "../headers.js"

export async function initiateDeviceAuth(): Promise<DeviceAuthInitiateResponse> {
  const response = await fetch(`${KILO_API_BASE}/api/device-auth/codes`, {
    method: "POST",
    headers: {
      ...DEFAULT_HEADERS,
      ...buildKiloHeaders(),
    },
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => "")
    if (response.status === 429) {
      throw new Error("Too many pending authorization requests. Please try again later.")
    }
    throw new Error(
      detail
        ? `Failed to initiate device authorization: ${response.status} ${detail}`
        : `Failed to initiate device authorization: ${response.status}`,
    )
  }

  return (await response.json()) as DeviceAuthInitiateResponse
}

export async function pollDeviceAuth(code: string): Promise<DeviceAuthPollResponse> {
  const response = await fetch(`${KILO_API_BASE}/api/device-auth/codes/${code}`, {
    headers: {
      ...DEFAULT_HEADERS,
      ...buildKiloHeaders(),
    },
  })

  if (response.status === 202) return { status: "pending" }
  if (response.status === 403) return { status: "denied" }
  if (response.status === 410) return { status: "expired" }

  if (!response.ok) {
    throw new Error(`Failed to poll device authorization: ${response.status}`)
  }

  return (await response.json()) as DeviceAuthPollResponse
}
