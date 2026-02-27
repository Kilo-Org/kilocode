/**
 * Kilo Gateway specific routes
 * Handles profile fetching and organization management for Kilo Gateway provider
 *
 * This factory function accepts OpenCode dependencies to create Kilo-specific routes
 */

import { fetchProfile, fetchBalance } from "../api/profile.js"
import { fetchKilocodeNotifications, KilocodeNotificationSchema } from "../api/notifications.js"
import { KILO_API_BASE, HEADER_FEATURE } from "../api/constants.js"
import { buildKiloHeaders } from "../headers.js"
import type { ImportDeps, DrizzleDb } from "../cloud-sessions.js"
import { fetchCloudSession, fetchCloudSessionForImport, importSessionToDb } from "../cloud-sessions.js"

// Type definitions for OpenCode dependencies (injected at runtime)
type Hono = any
type DescribeRoute = any
type Validator = any
type Resolver = any
type Errors = any
type Auth = any
type Z = any

interface KiloRoutesDeps extends ImportDeps {
  Hono: new () => Hono
  describeRoute: DescribeRoute
  validator: Validator
  resolver: Resolver
  errors: Errors
  Auth: Auth
  z: Z
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
  const {
    Hono,
    describeRoute,
    validator,
    resolver,
    errors,
    Auth,
    z,
    Database,
    Instance,
    SessionTable,
    MessageTable,
    PartTable,
    SessionToRow,
    Bus,
    SessionCreatedEvent,
    Identifier,
  } = deps

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

        // Update auth with new organization ID
        await Auth.set("kilo", {
          type: "oauth",
          refresh: auth.refresh,
          access: auth.access,
          expires: auth.expires,
          ...(organizationId && { accountId: organizationId }),
        })

        return c.json(true)
      },
    )
    .post(
      "/fim",
      describeRoute({
        summary: "FIM completion",
        description: "Proxy a Fill-in-the-Middle completion request to the Kilo Gateway",
        operationId: "kilo.fim",
        responses: {
          200: {
            description: "Streaming FIM completion response",
            content: {
              "text/event-stream": {
                schema: resolver(z.any()),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      validator(
        "json",
        z.object({
          prefix: z.string(),
          suffix: z.string(),
          model: z.string().optional(),
          maxTokens: z.number().optional(),
          temperature: z.number().optional(),
        }),
      ),
      async (c: any) => {
        const auth = await Auth.get("kilo")

        if (!auth) {
          return c.json({ error: "Not authenticated with Kilo Gateway" }, 401)
        }

        const token = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
        if (!token) {
          return c.json({ error: "No valid token found" }, 401)
        }

        const organizationId = auth.type === "oauth" ? auth.accountId : undefined

        const { prefix, suffix, model, maxTokens, temperature } = c.req.valid("json")
        const fimModel = model ?? "mistralai/codestral-2501"
        const fimMaxTokens = maxTokens ?? 256
        const fimTemperature = temperature ?? 0.2

        const baseApiUrl = KILO_API_BASE + "/api/"
        const endpoint = new URL("fim/completions", baseApiUrl)

        const headers = {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            ...buildKiloHeaders(undefined, { kilocodeOrganizationId: organizationId }),
            [HEADER_FEATURE]: "autocomplete",
        }

        const response = await fetch(endpoint, {
          method: "POST",
          headers,
          body: JSON.stringify({
            model: fimModel,
            prompt: prefix,
            suffix,
            max_tokens: fimMaxTokens,
            temperature: fimTemperature,
            stream: true,
          }),
        })

        if (!response.ok) {
          const errorText = await response.text()
          return c.json({ error: `FIM request failed: ${response.status} ${errorText}` }, response.status as any)
        }

        // Stream the response through
        return new Response(response.body, {
          headers: {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        })
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
    .get(
      "/cloud/session/:id",
      describeRoute({
        summary: "Get cloud session",
        description: "Fetch full session data from the Kilo cloud for preview",
        operationId: "kilo.cloud.session.get",
        responses: {
          200: {
            description: "Cloud session data",
            content: {
              "application/json": {
                schema: resolver(z.unknown()),
              },
            },
          },
          ...errors(401, 404),
        },
      }),
      validator("param", z.object({ id: z.string() })),
      async (c: any) => {
        try {
          const auth = await Auth.get("kilo")
          if (!auth) return c.json({ error: "Not authenticated with Kilo Gateway" }, 401)
          const token = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
          if (!token) return c.json({ error: "No valid token found" }, 401)

          const { id } = c.req.valid("param")
          const result = await fetchCloudSession(token, id)
          if (!result.ok) return c.json({ error: result.error }, result.status)
          return c.json(result.data)
        } catch (err: any) {
          console.error("[Kilo Gateway] cloud/session/get: unhandled error", err?.message ?? err)
          return c.json({ error: "Internal error" }, 500)
        }
      },
    )
    .post(
      "/cloud/session/import",
      describeRoute({
        summary: "Import session from cloud",
        description: "Download a cloud-synced session and write it to local storage with fresh IDs.",
        operationId: "kilo.cloud.session.import",
        responses: {
          200: {
            description: "Imported session info",
            content: {
              "application/json": {
                schema: resolver(z.unknown()),
              },
            },
          },
          ...errors(400, 401, 404),
        },
      }),
      validator(
        "json",
        z.object({
          sessionId: z.string(),
        }),
      ),
      async (c: any) => {
        try {
          const { sessionId } = c.req.valid("json")

          const auth = await Auth.get("kilo")
          if (!auth) return c.json({ error: "Not authenticated with Kilo" }, 401)
          const token = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
          if (!token) return c.json({ error: "No valid token found" }, 401)

          const fetched = await fetchCloudSessionForImport(token, sessionId)
          if (!fetched.ok) return c.json({ error: fetched.error }, fetched.status as any)

          const data = fetched.data
          if (!data?.info?.id) return c.json({ error: "Invalid export data" }, 400)

          const info = importSessionToDb(data, {
            Database,
            Instance,
            SessionTable,
            MessageTable,
            PartTable,
            SessionToRow,
            Bus,
            SessionCreatedEvent,
            Identifier,
          })

          return c.json(info)
        } catch (err: any) {
          console.error("[Kilo Gateway] cloud/session/import: unhandled error", err?.message ?? err)
          return c.json({ error: "Internal error" }, 500)
        }
      },
    )
    .get(
      "/cloud-sessions",
      describeRoute({
        summary: "Get cloud sessions",
        description: "Fetch cloud CLI sessions from Kilo API",
        operationId: "kilo.cloudSessions",
        responses: {
          200: {
            description: "Cloud sessions list",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    cliSessions: z.array(
                      z.object({
                        session_id: z.string(),
                        title: z.string().nullable(),
                        created_at: z.string(),
                        updated_at: z.string(),
                        version: z.number(),
                      }),
                    ),
                    nextCursor: z.string().nullable(),
                  }),
                ),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      validator(
        "query",
        z.object({
          cursor: z.string().optional(),
          limit: z.coerce.number().optional(),
          gitUrl: z.string().optional(),
        }),
      ),
      async (c: any) => {
        try {
          const auth = await Auth.get("kilo")
          if (!auth) return c.json({ error: "Not authenticated with Kilo Gateway" }, 401)

          const token = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
          if (!token) return c.json({ error: "No valid token found" }, 401)

          const { cursor, limit, gitUrl } = c.req.valid("query")

          const input: Record<string, unknown> = {}
          if (cursor) input.cursor = cursor
          if (limit) input.limit = limit
          if (gitUrl) input.gitUrl = gitUrl

          const params = new URLSearchParams({
            batch: "1",
            input: JSON.stringify({ "0": input }),
          })

          const url = `${KILO_API_BASE}/api/trpc/cliSessionsV2.list?${params.toString()}`

          const response = await fetch(url, {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              ...buildKiloHeaders(),
            },
          })

          if (!response.ok) {
            const text = await response.text()
            console.error("[Kilo Gateway] cloud-sessions: tRPC request failed", {
              status: response.status,
              body: text.slice(0, 500),
            })
            return c.json({ error: `Cloud sessions fetch failed: ${response.status}` }, response.status as any)
          }

          const raw = await response.text()
          const json = JSON.parse(raw)
          const data = Array.isArray(json) ? json[0]?.result?.data : null
          const result = data?.json ?? data
          if (!result) return c.json({ cliSessions: [], nextCursor: null })

          const sessions = (result.cliSessions ?? []).map((s: any) => ({
            session_id: s.session_id,
            title: s.title ?? null,
            created_at:
              typeof s.created_at === "string"
                ? s.created_at
                : s.created_at
                  ? new Date(s.created_at).toISOString()
                  : new Date().toISOString(),
            updated_at:
              typeof s.updated_at === "string"
                ? s.updated_at
                : s.updated_at
                  ? new Date(s.updated_at).toISOString()
                  : new Date().toISOString(),
            version: s.version ?? 0,
          }))

          return c.json({ cliSessions: sessions, nextCursor: result.nextCursor ?? null })
        } catch (err: any) {
          console.error("[Kilo Gateway] cloud-sessions: unhandled error", err?.message ?? err)
          return c.json({ error: "Internal error" }, 500)
        }
      },
    )
}
