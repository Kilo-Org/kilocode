import { z } from "zod"
import { DEVIL_API_BASE } from "./constants.js"

/**
 * Devil notification schema
 */
export const DevilcodeNotificationSchema = z.object({
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

export type DevilcodeNotification = z.infer<typeof DevilcodeNotificationSchema>

const NotificationsResponseSchema = z.object({
  notifications: z.array(DevilcodeNotificationSchema),
})

const NOTIFICATIONS_TIMEOUT_MS = 5000

/**
 * Fetch notifications from Devil API
 *
 * @param options - Configuration with token and optional organization ID
 * @returns Array of notifications from the Devil API (clients filter by showIn)
 */
export async function fetchDevilcodeNotifications(options: {
  devilcodeToken?: string
  devilcodeOrganizationId?: string
}): Promise<DevilcodeNotification[]> {
  const token = options.devilcodeToken
  if (!token) return []

  const url = `${DEVIL_API_BASE}/api/users/notifications`

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
