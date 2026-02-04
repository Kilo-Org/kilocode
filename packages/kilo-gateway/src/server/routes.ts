// kilocode_change - Kilo Gateway server routes
/**
 * Kilo Gateway specific routes
 * Handles profile fetching and organization management for Kilo Gateway provider
 *
 * This factory function accepts OpenCode dependencies to create Kilo-specific routes
 */

import { fetchProfile, fetchBalance } from "../api/profile.js"
import { fetchKilocodeNotifications, KilocodeNotificationSchema } from "../api/notifications.js"

// Type definitions for OpenCode dependencies (injected at runtime)
type Hono = any
type DescribeRoute = any
type Validator = any
type Resolver = any
type Errors = any
type Auth = any
type Z = any

interface KiloRoutesDeps {
  Hono: new () => Hono
  describeRoute: DescribeRoute
  validator: Validator
  resolver: Resolver
  errors: Errors
  Auth: Auth
  z: Z
  Telemetry?: {
    updateIdentity: (token: string | null, accountId?: string, options?: { disableForOrg?: boolean }) => Promise<void>
  }
  getGlobalConfig?: () => Promise<{ experimental?: { openTelemetry?: boolean } }>
}

/**
 * Create Kilo Gateway routes with OpenCode dependencies injected
 *
 * @example
 * ```typescript
 * import { createKiloRoutes } from "@kilocode/kilo-gateway"
 * import { Hono } from "hono"
 * import { describeRoute, validator, resolver } from "hono-openapi"
 * import z from "zod"
 * import { errors } from "../error"
 * import { Auth } from "../../auth"
 *
 * export const KiloRoutes = createKiloRoutes({
 *   Hono,
 *   describeRoute,
 *   validator,
 *   resolver,
 *   errors,
 *   Auth,
 *   z,
 * })
 * ```
 */
export function createKiloRoutes(deps: KiloRoutesDeps) {
  const { Hono, describeRoute, validator, resolver, errors, Auth, z, Telemetry, getGlobalConfig } = deps

  const Organization = z.object({
    id: z.string(),
    name: z.string(),
    role: z.string(),
  })

  const Profile = z.object({
    email: z.string(),
    name: z.string().optional(),
    organizations: z.array(Organization).optional(),
  })

  const Balance = z.object({
    balance: z.number(),
  })

  const ProfileWithBalance = z.object({
    profile: Profile,
    balance: Balance.nullable(),
    currentOrgId: z.string().nullable(),
  })

  return new Hono()
    .get(
      "/profile",
      describeRoute({
        summary: "Get Kilo Gateway profile",
        description: "Fetch user profile and organizations from Kilo Gateway",
        operationId: "kilo.profile",
        responses: {
          200: {
            description: "Profile data",
            content: {
              "application/json": {
                schema: resolver(ProfileWithBalance),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      async (c: any) => {
        // Get Kilo auth
        const auth = await Auth.get("kilo")

        if (!auth || auth.type !== "oauth") {
          return c.json({ error: "Not authenticated with Kilo Gateway" }, 401)
        }

        const token = auth.access
        const currentOrgId = auth.accountId ?? null

        // Fetch profile and balance in parallel
        // Pass organizationId to fetchBalance to get team balance when in org context
        const [profile, balance] = await Promise.all([
          fetchProfile(token),
          fetchBalance(token, currentOrgId ?? undefined),
        ])

        return c.json({ profile, balance, currentOrgId })
      },
    )
    .post(
      "/organization",
      describeRoute({
        summary: "Update Kilo Gateway organization",
        description: "Switch to a different Kilo Gateway organization",
        operationId: "kilo.organization.set",
        responses: {
          200: {
            description: "Organization updated successfully",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      validator(
        "json",
        z.object({
          organizationId: z.string().nullable(),
        }),
      ),
      async (c: any) => {
        const { organizationId } = c.req.valid("json")

        // Get current Kilo auth
        const auth = await Auth.get("kilo")

        if (!auth || auth.type !== "oauth") {
          return c.json({ error: "Not authenticated with Kilo Gateway" }, 401)
        }

        // Update auth with new organization ID (explicitly set accountId to clear it when null)
        await Auth.set("kilo", {
          type: "oauth",
          refresh: auth.refresh,
          access: auth.access,
          expires: auth.expires,
          accountId: organizationId && organizationId.length > 0 ? organizationId : undefined,
        })

        // Update telemetry identity to disable for org users
        if (Telemetry && getGlobalConfig) {
          const globalCfg = await getGlobalConfig()
          const userExplicitlyEnabledTelemetry = globalCfg.experimental?.openTelemetry === true
          // Only apply disableForOrg when switching INTO an org context
          const isOrgContext = organizationId !== null && organizationId.length > 0
          await Telemetry.updateIdentity(auth.access, organizationId ?? undefined, {
            disableForOrg: isOrgContext && !userExplicitlyEnabledTelemetry,
          })
        }

        return c.json(true)
      },
    )
    .get(
      "/notifications",
      describeRoute({
        summary: "Get Kilo notifications",
        description: "Fetch notifications from Kilo Gateway for CLI display",
        operationId: "kilo.notifications",
        responses: {
          200: {
            description: "Notifications list",
            content: {
              "application/json": {
                schema: resolver(z.array(KilocodeNotificationSchema)),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      async (c: any) => {
        const auth = await Auth.get("kilo")
        if (!auth) return c.json([])

        const token = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
        if (!token) return c.json([])

        const organizationId = auth.type === "oauth" ? auth.accountId : undefined
        const notifications = await fetchKilocodeNotifications({
          kilocodeToken: token,
          kilocodeOrganizationId: organizationId,
        })

        return c.json(notifications)
      },
    )
}
