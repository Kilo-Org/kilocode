import { z } from "zod"
import { KILO_API_BASE } from "./constants.js"

/**
 * Kilo notification schema
 */
export const KilocodeNotificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  message: z.string(),
  action: z
    .object({
      actionText: z.string(),
      actionURL: z.string(),
    })
    .optional(),
  showIn: z.array(z.string()).optional(),
  suggestModelId: z.string().optional(),
})

export type KilocodeNotification = z.infer<typeof KilocodeNotificationSchema>

const NotificationsResponseSchema = z.object({
  notifications: z.array(KilocodeNotificationSchema),
})

const NOTIFICATIONS_TIMEOUT_MS = 5000

/**
 * Derive the `client` identifier sent to the cloud notifications API.
 *
 * The gateway endpoint is shared across multiple clients (VS Code extension,
 * JetBrains plugin, CLI TUI). Each host process sets `KILO_PLATFORM` when
 * spawning `kilo serve`, so we use it to tag outgoing requests accurately.
 */
function clientFromPlatform(): string {
  const platform = process.env["KILO_PLATFORM"]
  if (platform === "vscode") return "kilocode-vscode-extension"
  if (platform === "jetbrains") return "kilocode-jetbrains-plugin"
  return "cli"
}

/**
 * Fetch notifications from Kilo API
 *
 * @param options - Configuration with token and optional organization ID
 * @returns Array of notifications from the Kilo API (clients filter by showIn)
 */
export async function fetchKilocodeNotifications(options: {
  kilocodeToken?: string
  kilocodeOrganizationId?: string
}): Promise<KilocodeNotification[]> {
  const token = options.kilocodeToken
  if (!token) return []

  const url = `${KILO_API_BASE}/api/users/notifications?client=${clientFromPlatform()}`

  try {
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(NOTIFICATIONS_TIMEOUT_MS),
    })

    if (!response.ok) return []

    const json = await response.json()
    const result = NotificationsResponseSchema.safeParse(json)

    if (!result.success) return []

    return result.data.notifications
  } catch {
    return []
  }
}
