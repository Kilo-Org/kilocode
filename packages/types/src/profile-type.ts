// kilocode_change new file
import { z } from "zod"

/**
 * Profile Type System
 */

export const profileTypes = ["chat", "autocomplete"] as const
export const profileTypeSchema = z.enum(profileTypes)
export type ProfileType = z.infer<typeof profileTypeSchema>

export const DEFAULT_PROFILE_TYPE: ProfileType = "chat"
