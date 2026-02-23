// kilocode_change - Kilo Gateway server routes
/**
 * Kilo Gateway specific routes
 * Handles profile fetching and organization management for Kilo Gateway provider
 *
 * This factory function accepts OpenCode dependencies to create Kilo-specific routes
 */

import { randomBytes } from "crypto"
import { fetchProfile, fetchBalance } from "../api/profile.js"
import { fetchKilocodeNotifications, KilocodeNotificationSchema } from "../api/notifications.js"
import { KILO_API_BASE, HEADER_FEATURE } from "../api/constants.js" // kilocode_change - added HEADER_FEATURE
import { buildKiloHeaders } from "../headers.js" // kilocode_change

// Type definitions for OpenCode dependencies (injected at runtime)
type Hono = any
type DescribeRoute = any
type Validator = any
type Resolver = any
type Errors = any
type Auth = any
type Z = any
type Storage = any
type Instance = any

interface KiloRoutesDeps {
  Hono: new () => Hono
  describeRoute: DescribeRoute
  validator: Validator
  resolver: Resolver
  errors: Errors
  Auth: Auth
  z: Z
  Storage: Storage
  Instance: Instance
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
// Lightweight ID generator matching opencode's Identifier format (prefix + hex timestamp + random)
function generateId(prefix: string, descending: boolean): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
  const bytes = randomBytes(14)
  let rand = ""
  for (let i = 0; i < 14; i++) rand += chars[bytes[i] % 62]
  let now = BigInt(Date.now()) * BigInt(0x1000) + BigInt(1)
  if (descending) now = ~now
  const buf = Buffer.alloc(6)
  for (let i = 0; i < 6; i++) buf[i] = Number((now >> BigInt(40 - 8 * i)) & BigInt(0xff))
  return prefix + "_" + buf.toString("hex") + rand
}

export function createKiloRoutes(deps: KiloRoutesDeps) {
  const { Hono, describeRoute, validator, resolver, errors, Auth, z, Storage, Instance } = deps

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

  const CloudSession = z.object({
    session_id: z.string(),
    title: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })

  const CloudSessionsResponse = z.object({
    sessions: z.array(CloudSession),
    nextCursor: z.string().nullable(),
  })

  return new Hono()
    .get(
      "/cloud/sessions",
      describeRoute({
        summary: "List cloud sessions",
        description: "Fetch the list of sessions synced to the Kilo cloud for the current user",
        operationId: "kilo.cloud.sessions.list",
        responses: {
          200: {
            description: "Cloud sessions list",
            content: {
              "application/json": {
                schema: resolver(CloudSessionsResponse),
              },
            },
          },
          ...errors(400, 401),
        },
      }),
      async (c: any) => {
        const auth = await Auth.get("kilo")
        if (!auth) return c.json({ error: "Not authenticated with Kilo" }, 401)

        const token =
          auth.type === "api"
            ? auth.key
            : auth.type === "oauth"
              ? auth.access
              : auth.type === "wellknown"
                ? auth.token
                : undefined
        if (!token) return c.json({ error: "No valid token found" }, 401)

        const cursor = c.req.query("cursor")
        const limit = c.req.query("limit")

        const input: Record<string, unknown> = {}
        if (cursor) input.cursor = cursor
        if (limit) input.limit = Number(limit)

        const params = new URLSearchParams({
          batch: "1",
          input: JSON.stringify({ "0": input }),
        })

        const response = await fetch(`${KILO_API_BASE}/api/trpc/cliSessionsV2.list?${params.toString()}`, {
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
        })

        if (!response.ok) {
          const text = await response.text()
          return c.json({ error: `Cloud sessions fetch failed: ${response.status} ${text}` }, response.status as any)
        }

        const json = await response.json()
        const data = Array.isArray(json) ? json[0]?.result?.data : null
        const result = data?.json ?? data
        if (!result) return c.json({ sessions: [], nextCursor: null })

        const sessions = (result.cliSessions ?? []).map((s: any) => ({
          session_id: s.session_id,
          title: s.title ?? null,
          created_at: typeof s.created_at === "string" ? s.created_at : new Date(s.created_at).toISOString(),
          updated_at: typeof s.updated_at === "string" ? s.updated_at : new Date(s.updated_at).toISOString(),
        }))

        return c.json({ sessions, nextCursor: result.nextCursor ?? null })
      },
    )
    .post(
      "/cloud/session/import",
      describeRoute({
        summary: "Import session from cloud",
        description: "Download a cloud-synced session and write it to local storage.",
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
          sessionId: z.string().startsWith("ses_").length(30),
        }),
      ),
      async (c: any) => {
        const { sessionId } = c.req.valid("json")

        const auth = await Auth.get("kilo")
        if (!auth) return c.json({ error: "Not authenticated with Kilo" }, 401)

        const token =
          auth.type === "api"
            ? auth.key
            : auth.type === "oauth"
              ? auth.access
              : auth.type === "wellknown"
                ? auth.token
                : undefined
        if (!token) return c.json({ error: "No valid token found" }, 401)

        const ingestBase = process.env["KILO_SESSION_INGEST_URL"] ?? "https://ingest.kilosessions.ai"
        const response = await fetch(`${ingestBase}/api/session/${sessionId}/export`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (response.status === 404) return c.json({ error: "Session not found in cloud" }, 404)
        if (!response.ok) {
          const text = await response.text()
          console.error("[Kilo Gateway] cloud/session/import export failed:", {
            status: response.status,
            body: text.slice(0, 500),
          })
          return c.json(
            { error: `This session cannot be imported (export failed: ${response.status})` },
            response.status as any,
          )
        }

        const data = (await response.json()) as any
        if (!data?.info?.id) return c.json({ error: "Invalid export data" }, 400)

        // Generate fresh local IDs so repeated imports don't collide
        const sessionID = generateId("ses", true)
        const msgMap = new Map<string, string>()

        const projectID = Instance.project.id
        data.info.id = sessionID
        data.info.projectID = projectID
        await Storage.write(["session", projectID, sessionID], data.info)

        for (const msg of data.messages ?? []) {
          const msgID = generateId("msg", false)
          msgMap.set(msg.info.id, msgID)
          msg.info.id = msgID
          msg.info.sessionID = sessionID
          if (msg.info.parentID) msg.info.parentID = msgMap.get(msg.info.parentID) ?? msg.info.parentID
          await Storage.write(["message", sessionID, msgID], msg.info)
          for (const part of msg.parts ?? []) {
            part.id = generateId("prt", false)
            part.messageID = msgID
            part.sessionID = sessionID
            await Storage.write(["part", msgID, part.id], part)
          }
        }

        return c.json(data.info)
      },
    )
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

        const { prefix, suffix, model, maxTokens, temperature } = c.req.valid("json")
        const fimModel = model ?? "mistralai/codestral-2501"
        const fimMaxTokens = maxTokens ?? 256
        const fimTemperature = temperature ?? 0.2

        const baseApiUrl = KILO_API_BASE + "/api/"
        const endpoint = new URL("fim/completions", baseApiUrl)

        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            // kilocode_change start - include kilo headers with autocomplete feature override
            ...buildKiloHeaders(),
            [HEADER_FEATURE]: "autocomplete",
            // kilocode_change end
          },
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
}
