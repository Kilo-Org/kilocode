import { z } from "zod"
import { KILO_API_BASE, MODELS_FETCH_TIMEOUT_MS } from "./constants.js"
import { getDefaultHeaders } from "../headers.js"

/**
 * Group entry in an organization mode config.
 * Either a simple group name or a tuple for edit with file restrictions.
 */
const EditGroupConfigSchema = z.object({
  fileRegex: z.string().optional(),
  description: z.string().optional(),
})

const GroupEntrySchema = z.union([z.string(), z.tuple([z.string(), EditGroupConfigSchema])])

const OrganizationModeConfigSchema = z.object({
  roleDefinition: z.string().optional(),
  whenToUse: z.string().optional(),
  description: z.string().optional(),
  customInstructions: z.string().optional(),
  groups: z.array(GroupEntrySchema).optional(),
})

const OrganizationModeSchema = z.object({
  id: z.string(),
  organization_id: z.string(),
  name: z.string(),
  slug: z.string(),
  created_by: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
  config: OrganizationModeConfigSchema,
})

const ResponseSchema = z.object({
  modes: z.array(OrganizationModeSchema),
})

export type OrganizationModeConfig = z.infer<typeof OrganizationModeConfigSchema>
export type OrganizationMode = z.infer<typeof OrganizationModeSchema>

/**
 * In-memory cache for organization modes, keyed by organizationId.
 */
const cache = new Map<string, { modes: OrganizationMode[]; timestamp: number }>()
const TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Clear the organization modes cache.
 * Should be called when switching organizations.
 */
export function clearModesCache() {
  cache.clear()
}

/**
 * Fetch custom modes for an organization from the Kilo Cloud API.
 *
 * @param token - Bearer authentication token
 * @param organizationId - Organization UUID
 * @returns Array of organization modes, or empty array on error
 */
export async function fetchOrganizationModes(token: string, organizationId: string): Promise<OrganizationMode[]> {
  const cached = cache.get(organizationId)
  if (cached && Date.now() - cached.timestamp < TTL) {
    return cached.modes
  }

  try {
    const url = `${KILO_API_BASE}/api/organizations/${encodeURIComponent(organizationId)}/modes`
    const response = await fetch(url, {
      headers: {
        ...getDefaultHeaders(),
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.warn(`[Kilo Gateway] Failed to fetch organization modes: ${response.status}`)
      return []
    }

    const json = await response.json()
    const parsed = ResponseSchema.safeParse(json)

    if (!parsed.success) {
      console.warn("[Kilo Gateway] Organization modes response validation failed:", parsed.error.format())
      return []
    }

    const modes = parsed.data.modes
    cache.set(organizationId, { modes, timestamp: Date.now() })
    return modes
  } catch (err) {
    console.warn("[Kilo Gateway] Error fetching organization modes:", err)
    return []
  }
}
