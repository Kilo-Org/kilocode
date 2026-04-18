import { z } from "zod"
import { DEVIL_API_BASE, MODELS_FETCH_TIMEOUT_MS } from "./constants.js"
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
 * In-memory cache for organization modes, keyed by organization + credential scope.
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

// devilcode_change start - audit OB2: discriminated result so callers can distinguish auth/transport
// errors from "no modes" instead of silently flattening every failure to [].
export type FetchOrganizationModesResult =
  | { ok: true; modes: OrganizationMode[] }
  | { ok: false; status?: number; error: string }

/**
 * Fetch custom modes for an organization from the Devil Cloud API.
 *
 * @param token - Bearer authentication token
 * @param organizationId - Organization UUID
 * @returns Discriminated result: success carries modes; failure carries upstream status + reason.
 */
export async function fetchOrganizationModesResult(
  token: string,
  organizationId: string,
): Promise<FetchOrganizationModesResult> {
  // Skip real HTTP calls in test environment to avoid 401 noise and network dependency
  if (process.env.NODE_ENV === "test") {
    return { ok: true, modes: [] }
  }

  const key = `${organizationId}:${token}`
  const cached = cache.get(key)
  if (cached && Date.now() - cached.timestamp < TTL) {
    return { ok: true, modes: cached.modes }
  }

  try {
    const url = `${DEVIL_API_BASE}/api/organizations/${encodeURIComponent(organizationId)}/modes`
    const response = await fetch(url, {
      headers: {
        ...getDefaultHeaders(),
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(MODELS_FETCH_TIMEOUT_MS),
    })

    if (!response.ok) {
      console.warn(`[Devil Gateway] Failed to fetch organization modes: ${response.status}`)
      return { ok: false, status: response.status, error: `upstream returned ${response.status}` }
    }

    const json = await response.json()
    const parsed = ResponseSchema.safeParse(json)

    if (!parsed.success) {
      console.warn("[Devil Gateway] Organization modes response validation failed:", parsed.error.format())
      return { ok: false, error: "response validation failed" }
    }

    const modes = parsed.data.modes
    cache.set(key, { modes, timestamp: Date.now() })
    return { ok: true, modes }
  } catch (err) {
    console.warn("[Devil Gateway] Error fetching organization modes:", err)
    return { ok: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Backwards-compatible helper that flattens errors to []. Prefer
 * {@link fetchOrganizationModesResult} so callers can act on auth/transport failures.
 */
export async function fetchOrganizationModes(token: string, organizationId: string): Promise<OrganizationMode[]> {
  const r = await fetchOrganizationModesResult(token, organizationId)
  return r.ok ? r.modes : []
}
// devilcode_change end
