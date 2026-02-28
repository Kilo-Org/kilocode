// kilocode_change - new file
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
})

export type KilocodeNotification = z.infer<typeof KilocodeNotificationSchema>

const NotificationsResponseSchema = z.object({
  notifications: z.array(KilocodeNotificationSchema),
})

const NOTIFICATIONS_TIMEOUT_MS = 5000

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

  const url = `${KILO_API_BASE}/api/users/notifications`

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
