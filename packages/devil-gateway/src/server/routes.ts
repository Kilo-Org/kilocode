/**
 * Devil Gateway specific routes
 * Handles profile fetching and organization management for Devil Gateway provider
 *
 * This factory function accepts OpenCode dependencies to create Devil-specific routes
 */

import { fetchProfile, fetchBalanceResult } from "../api/profile.js"
import { fetchDevilcodeNotifications, DevilcodeNotificationSchema } from "../api/notifications.js"
import { fetchOrganizationModesResult, clearModesCache } from "../api/modes.js"
import { DEVIL_API_BASE, HEADER_FEATURE, HEADER_ORGANIZATIONID } from "../api/constants.js"
import { buildDevilHeaders } from "../headers.js"
import type { ImportDeps, DrizzleDb } from "../cloud-sessions.js"
import { fetchCloudSession, fetchCloudSessionForImport, importSessionToDb } from "../cloud-sessions.js"

// Type definitions for OpenCode dependencies (injected at runtime)
// devilcode_change - audit N10: these `any` shims are intentional. Devil Gateway is published
// as a standalone package and cannot import `hono`/`zod` directly without inverting the
// dependency graph (opencode would then own the gateway types). When/if we colocate the
// gateway with opencode, replace these with concrete `import type { Hono, Context } from "hono"`.
type Hono = any
type DescribeRoute = any
type Validator = any
type Resolver = any
type Errors = any
type Auth = any
type ModelCache = { clear: (providerID: string) => void }
type Z = any

interface DevilRoutesDeps extends ImportDeps {
  Hono: new () => Hono
  describeRoute: DescribeRoute
  validator: Validator
  resolver: Resolver
  errors: Errors
  Auth: Auth
  ModelCache: ModelCache
  z: Z
}

/**
 * Create Devil Gateway routes with OpenCode dependencies injected
 *
 * @example
 * ```typescript
 * import { createDevilRoutes } from "@devilcode/kilo-gateway"
 * import { Hono } from "hono"
 * import { describeRoute, validator, resolver } from "hono-openapi"
 * import z from "zod"
 * import { errors } from "../error"
 * import { Auth } from "../../auth"
 *
 * export const DevilRoutes = createDevilRoutes({
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
export function createDevilRoutes(deps: DevilRoutesDeps) {
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
    ModelCache,
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
  const SimpleError = z.object({
    error: z.string(),
  })

  const ProfileWithBalance = z.object({
    profile: Profile,
    balance: Balance.nullable(),
    // devilcode_change - audit OB4: surface upstream balance failures so the UI can show a toast
    // instead of silently rendering "no balance".
    balanceError: z
      .object({
        status: z.number().optional(),
        error: z.string(),
      })
      .nullable()
      .optional(),
    currentOrgId: z.string().nullable(),
  })

  const FimStreamChunk = z.object({
    choices: z
      .array(
        z.object({
          delta: z
            .object({
              content: z.string().optional(),
            })
            .optional(),
        }),
      )
      .optional(),
    usage: z
      .object({
        prompt_tokens: z.number().optional(),
        completion_tokens: z.number().optional(),
      })
      .optional(),
    cost: z.number().optional(),
  })

  return new Hono()
    .get(
      "/profile",
      describeRoute({
        summary: "Get Devil Gateway profile",
        description: "Fetch user profile and organizations from Devil Gateway",
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
        // Get Devil auth
        const auth = await Auth.get("kilo")

        if (!auth || auth.type !== "oauth") {
          return c.json({ error: "Not authenticated with Devil Gateway" }, 401)
        }

        const token = auth.access
        const currentOrgId = auth.accountId ?? null

        // Fetch profile and balance in parallel
        // devilcode_change - audit OB4: include balanceError so UI can disambiguate failure vs zero balance.
        const [profile, balanceResult] = await Promise.all([
          fetchProfile(token),
          fetchBalanceResult(token, currentOrgId ?? undefined),
        ])

        return c.json({
          profile,
          balance: balanceResult.ok ? balanceResult.balance : null,
          balanceError: balanceResult.ok ? null : { status: balanceResult.status, error: balanceResult.error },
          currentOrgId,
        })
      },
    )
    .post(
      "/organization",
      describeRoute({
        summary: "Update Devil Gateway organization",
        description: "Switch to a different Devil Gateway organization",
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

        // Get current Devil auth
        const auth = await Auth.get("kilo")

        if (!auth || auth.type !== "oauth") {
          return c.json({ error: "Not authenticated with Devil Gateway" }, 401)
        }

        // Update auth with new organization ID
        await Auth.set("kilo", {
          type: "oauth",
          refresh: auth.refresh,
          access: auth.access,
          expires: auth.expires,
          ...(organizationId && { accountId: organizationId }),
        })

        ModelCache.clear("kilo")
        clearModesCache()

        return c.json(true)
      },
    )
    .get(
      "/modes",
      describeRoute({
        summary: "Get organization custom modes",
        description: "Fetch custom modes defined for the current organization",
        operationId: "kilo.modes",
        responses: {
          200: {
            description: "Organization modes list",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    modes: z.array(
                      z.object({
                        id: z.string(),
                        organization_id: z.string(),
                        name: z.string(),
                        slug: z.string(),
                        created_by: z.string(),
                        created_at: z.string(),
                        updated_at: z.string(),
                        config: z.object({
                          roleDefinition: z.string().optional(),
                          whenToUse: z.string().optional(),
                          description: z.string().optional(),
                          customInstructions: z.string().optional(),
                          groups: z
                            .array(
                              z.union([
                                z.string(),
                                z.tuple([
                                  z.string(),
                                  z.object({ fileRegex: z.string().optional(), description: z.string().optional() }),
                                ]),
                              ]),
                            )
                            .optional(),
                        }),
                      }),
                    ),
                  }),
                ),
              },
            },
          },
          400: {
            description: "No organization selected",
            content: {
              "application/json": {
                schema: resolver(SimpleError),
              },
            },
          },
          401: {
            description: "Missing or invalid Devil Gateway credentials",
            content: {
              "application/json": {
                schema: resolver(SimpleError),
              },
            },
          },
          502: {
            description: "Devil Gateway modes lookup failed",
            content: {
              "application/json": {
                schema: resolver(SimpleError),
              },
            },
          },
        },
      }),
      async (c: any) => {
        // devilcode_change start - audit OB2: forward upstream auth/transport status to caller.
        const auth = await Auth.get("kilo")
        if (!auth || auth.type !== "oauth") {
          return c.json({ error: "not authenticated" }, 401)
        }
        const token = auth.access
        if (!token) {
          return c.json({ error: "missing access token" }, 401)
        }
        const orgId = auth.accountId
        if (!orgId) {
          return c.json({ error: "no organization selected" }, 400)
        }

        const result = await fetchOrganizationModesResult(token, orgId)
        if (!result.ok) {
          const status = result.status && result.status >= 400 && result.status < 600 ? result.status : 502
          return c.json({ error: result.error }, status as any)
        }
        return c.json({ modes: result.modes })
        // devilcode_change end
      },
    )
    .post(
      "/fim",
      describeRoute({
        summary: "FIM completion",
        description: "Proxy a Fill-in-the-Middle completion request to the Devil Gateway",
        operationId: "kilo.fim",
        responses: {
          200: {
            description: "Streaming FIM completion response",
            content: {
              "text/event-stream": {
                schema: resolver(FimStreamChunk),
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
          return c.json({ error: "Not authenticated with Devil Gateway" }, 401)
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

        const baseApiUrl = DEVIL_API_BASE + "/api/"
        const endpoint = new URL("fim/completions", baseApiUrl)

        const headers = {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          ...buildDevilHeaders(undefined, { devilcodeOrganizationId: organizationId }),
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
        summary: "Get Devil notifications",
        description: "Fetch notifications from Devil Gateway for CLI display",
        operationId: "kilo.notifications",
        responses: {
          200: {
            description: "Notifications list",
            content: {
              "application/json": {
                schema: resolver(z.array(DevilcodeNotificationSchema)),
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
        const notifications = await fetchDevilcodeNotifications({
          devilcodeToken: token,
          devilcodeOrganizationId: organizationId,
        })

        return c.json(notifications)
      },
    )
    .get(
      "/cloud/session/:id",
      describeRoute({
        summary: "Get cloud session",
        description: "Fetch full session data from the Devil cloud for preview",
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
          if (!auth) return c.json({ error: "Not authenticated with Devil Gateway" }, 401)
          const token = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
          if (!token) return c.json({ error: "No valid token found" }, 401)

          const { id } = c.req.valid("param")
          const result = await fetchCloudSession(token, id)
          if (!result.ok) return c.json({ error: result.error }, result.status)
          return c.json(result.data)
        } catch (err: any) {
          console.error("[Devil Gateway] cloud/session/get: unhandled error", err?.message ?? err)
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
          if (!auth) return c.json({ error: "Not authenticated with Devil" }, 401)
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
          console.error("[Devil Gateway] cloud/session/import: unhandled error", err?.message ?? err)
          return c.json({ error: "Internal error" }, 500)
        }
      },
    )
    .get(
      "/claw/status",
      describeRoute({
        summary: "Get DevilClaw instance status",
        description: "Fetch the user's DevilClaw instance status via the DevilClaw worker",
        operationId: "kilo.claw.status",
        responses: {
          200: {
            description: "Instance status",
            content: {
              "application/json": {
                schema: resolver(
                  z.object({
                    status: z
                      .enum(["provisioned", "starting", "restarting", "running", "stopped", "destroying"])
                      .nullable(),
                    sandboxId: z.string().optional(),
                    flyRegion: z.string().optional(),
                    machineSize: z.object({ cpus: z.number(), memory_mb: z.number() }).optional(),
                    openclawVersion: z.string().nullable().optional(),
                    lastStartedAt: z.string().nullable().optional(),
                    lastStoppedAt: z.string().nullable().optional(),
                    channelCount: z.number().optional(),
                    secretCount: z.number().optional(),
                    userId: z.string().optional(),
                  }),
                ),
              },
            },
          },
          ...errors(401, 502),
        },
      }),
      async (c: any) => {
        try {
          const auth = await Auth.get("kilo")
          if (!auth) return c.json({ error: "Not authenticated with Devil Gateway" }, 401)
          const token = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
          if (!token) return c.json({ error: "No valid token found" }, 401)

          const organizationId = auth.type === "oauth" ? auth.accountId : undefined
          const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          }
          if (organizationId) {
            headers[HEADER_ORGANIZATIONID] = organizationId
          }

          const response = await fetch(`${DEVIL_API_BASE}/api/kiloclaw/status`, { headers })

          if (!response.ok) {
            const text = await response.text()
            return c.json({ error: `DevilClaw request failed: ${response.status} ${text}` }, response.status as any)
          }

          return c.json(await response.json())
        } catch (err: any) {
          console.error("[Devil Gateway] claw/status: error", err?.message ?? err)
          return c.json({ error: "Failed to reach DevilClaw" }, 502)
        }
      },
    )
    .get(
      "/claw/chat-credentials",
      describeRoute({
        summary: "Get DevilClaw chat credentials",
        description: "Fetch Stream Chat credentials for the user's DevilClaw instance",
        operationId: "kilo.claw.chatCredentials",
        responses: {
          200: {
            description: "Stream Chat credentials or null",
            content: {
              "application/json": {
                schema: resolver(
                  z
                    .object({
                      apiKey: z.string(),
                      userId: z.string(),
                      userToken: z.string(),
                      channelId: z.string(),
                    })
                    .nullable(),
                ),
              },
            },
          },
          ...errors(401, 502),
        },
      }),
      async (c: any) => {
        try {
          const auth = await Auth.get("kilo")
          if (!auth) return c.json({ error: "Not authenticated with Devil Gateway" }, 401)
          const token = auth.type === "api" ? auth.key : auth.type === "oauth" ? auth.access : undefined
          if (!token) return c.json({ error: "No valid token found" }, 401)

          const organizationId = auth.type === "oauth" ? auth.accountId : undefined
          const headers: Record<string, string> = {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          }
          if (organizationId) {
            headers[HEADER_ORGANIZATIONID] = organizationId
          }

          const response = await fetch(`${DEVIL_API_BASE}/api/kiloclaw/chat-credentials`, { headers })

          if (!response.ok) {
            const text = await response.text()
            return c.json({ error: `DevilClaw request failed: ${response.status} ${text}` }, response.status as any)
          }

          return c.json(await response.json())
        } catch (err: any) {
          console.error("[Devil Gateway] claw/chat-credentials: error", err?.message ?? err)
          return c.json({ error: "Failed to reach DevilClaw" }, 502)
        }
      },
    )
    .get(
      "/cloud-sessions",
      describeRoute({
        summary: "Get cloud sessions",
        description: "Fetch cloud CLI sessions from Devil API",
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
          if (!auth) return c.json({ error: "Not authenticated with Devil Gateway" }, 401)

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

          const url = `${DEVIL_API_BASE}/api/trpc/cliSessionsV2.list?${params.toString()}`

          const response = await fetch(url, {
            headers: {
              Authorization: `Bearer ${token}`,
              "Content-Type": "application/json",
              ...buildDevilHeaders(),
            },
          })

          if (!response.ok) {
            const text = await response.text()
            console.error("[Devil Gateway] cloud-sessions: tRPC request failed", {
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
          console.error("[Devil Gateway] cloud-sessions: unhandled error", err?.message ?? err)
          return c.json({ error: "Internal error" }, 500)
        }
      },
    )
}
