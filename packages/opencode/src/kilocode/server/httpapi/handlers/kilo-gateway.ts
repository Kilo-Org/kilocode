import {
  GatewayError,
  fetchCloudSession,
  fetchCloudSessionForImport,
  getCloudSessions,
  getOrganizationId,
  getToken,
  importSessionToDb,
} from "@kilocode/kilo-gateway"
import {
  HEADER_FEATURE,
  HEADER_ORGANIZATIONID,
  KILO_API_BASE,
  KILO_CHAT_URL,
  KILO_EVENT_SERVICE_URL,
  clearModesCache,
  fetchBalance,
  fetchKilocodeNotifications,
  fetchOrganizationModes,
  fetchProfile,
} from "@kilocode/kilo-gateway"
import { buildKiloHeaders } from "@kilocode/kilo-gateway"
import { Effect } from "effect"
import * as Stream from "effect/Stream"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { Auth } from "@/auth"
import { EffectBridge } from "@/effect/bridge"
import { Bus } from "@/bus"
import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { InstanceStore } from "@/project/instance-store"
import { ModelCache } from "@/provider/model-cache"
import { InstanceHttpApi } from "@/server/routes/instance/httpapi/api"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { Session } from "@/session/session"
import { Database } from "@/storage/db"
import { AudioTranscriptionsBody, FimBody } from "../groups/kilo-gateway"

const FIM_TIMEOUT_MS = 30_000

export const kiloGatewayHandlers = HttpApiBuilder.group(InstanceHttpApi, "kilo", (handlers) =>
  Effect.gen(function* () {
    const auth = yield* Auth.Service
    const store = yield* InstanceStore.Service

    const profile = Effect.fn("KiloGatewayHttpApi.profile")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      if (!info || info.type !== "oauth") return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const currentOrgId = info.accountId ?? null
      const [profile, balance] = yield* Effect.tryPromise({
        try: () => Promise.all([fetchProfile(info.access), fetchBalance(info.access, currentOrgId ?? undefined)]),
        catch: () => new HttpApiError.BadRequest({}),
      })
      return { profile, balance, currentOrgId }
    })

    const proxyAuth = Effect.fn("KiloGatewayHttpApi.proxyAuth")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      return {
        auth: info,
        token: getToken(info),
        organizationId: getOrganizationId(info),
      }
    })

    const modes = Effect.fn("KiloGatewayHttpApi.modes")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.catch(() => Effect.succeed(undefined)))
      if (!info || info.type !== "oauth" || !info.access || !info.accountId) return { modes: [] }

      const org = info.accountId
      return yield* Effect.promise(() => fetchOrganizationModes(info.access, org)).pipe(
        Effect.map((modes) => ({ modes })),
        Effect.catch(() => Effect.succeed({ modes: [] })),
      )
    })

    const fim = Effect.fn("KiloGatewayHttpApi.fim")(function* (ctx: { payload: typeof FimBody.Type }) {
      const info = yield* proxyAuth()
      if (!info.auth) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      if (!info.token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const request = yield* HttpServerRequest.HttpServerRequest
      const endpoint = new URL("fim/completions", `${KILO_API_BASE}/api/`)
      const signal =
        request.source instanceof Request
          ? AbortSignal.any([request.source.signal, AbortSignal.timeout(FIM_TIMEOUT_MS)])
          : AbortSignal.timeout(FIM_TIMEOUT_MS)
      const response = yield* Effect.promise(async () => {
        try {
          return await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${info.token}`,
              ...buildKiloHeaders(undefined, { kilocodeOrganizationId: info.organizationId }),
              [HEADER_FEATURE]: "autocomplete",
            },
            signal,
            body: JSON.stringify({
              model: ctx.payload.model ?? "mistralai/codestral-2501",
              prompt: ctx.payload.prefix,
              suffix: ctx.payload.suffix,
              max_tokens: ctx.payload.maxTokens ?? 256,
              temperature: ctx.payload.temperature ?? 0.2,
              stream: true,
            }),
          })
        } catch (err) {
          if (err instanceof DOMException && err.name === "TimeoutError")
            return Response.json({ error: "FIM request timed out" }, { status: 504 })
          if (signal.aborted) return Response.json({ error: "FIM request canceled" }, { status: 499 })
          throw err
        }
      })
      if (!response.ok) {
        const text = yield* Effect.promise(() => response.text())
        return HttpServerResponse.jsonUnsafe(
          { error: `FIM request failed: ${response.status} ${text}` },
          { status: response.status },
        )
      }
      if (!response.body) return HttpServerResponse.raw(null, { status: response.status })

      return HttpServerResponse.stream(
        Stream.fromReadableStream({
          evaluate: () => response.body!,
          onError: (err) => err,
        }),
        {
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
          },
        },
      )
    })

    const audioTranscriptions = Effect.fn("KiloGatewayHttpApi.audioTranscriptions")(function* (ctx: {
      payload: typeof AudioTranscriptionsBody.Type
    }) {
      const info = yield* proxyAuth()
      if (!info.auth) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      if (!info.token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const request = yield* HttpServerRequest.HttpServerRequest
      const response = yield* Effect.tryPromise({
        try: () =>
          fetch(`${KILO_API_BASE}/api/gateway/v1/audio/transcriptions`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${info.token}`,
              ...buildKiloHeaders(undefined, { kilocodeOrganizationId: info.organizationId }),
              [HEADER_FEATURE]: "vscode-extension",
            },
            signal: request.source instanceof Request ? request.source.signal : undefined,
            body: JSON.stringify(ctx.payload),
          }),
        catch: () => new HttpApiError.BadRequest({}),
      })
      const text = yield* Effect.promise(() => response.text())
      return HttpServerResponse.raw(text, {
        status: response.status,
        contentType: response.headers.get("Content-Type") ?? "application/json",
      })
    })

    const notifications = Effect.fn("KiloGatewayHttpApi.notifications")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const token = getToken(info)
      if (!token) return []

      return yield* Effect.promise(() =>
        fetchKilocodeNotifications({
          kilocodeToken: token,
          kilocodeOrganizationId: getOrganizationId(info),
        }),
      )
    })

    const organization = Effect.fn("KiloGatewayHttpApi.organization")(function* (ctx) {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      if (!info || info.type !== "oauth") return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      yield* auth
        .set("kilo", {
          type: "oauth",
          refresh: info.refresh,
          access: info.access,
          expires: info.expires,
          ...(ctx.payload.organizationId && { accountId: ctx.payload.organizationId }),
        })
        .pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))

      ModelCache.clear("kilo")
      clearModesCache()
      yield* store.disposeAll().pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      return true
    })

    const clawStatus = Effect.fn("KiloGatewayHttpApi.clawStatus")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.ServiceUnavailable({})))
      const token = getToken(info)
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      }
      const org = getOrganizationId(info)
      if (org) headers[HEADER_ORGANIZATIONID] = org

      return yield* Effect.tryPromise({
        try: async () => {
          const response = await fetch(`${KILO_API_BASE}/api/kiloclaw/status`, { headers })
          if (!response.ok) throw new GatewayError(await response.text(), response.status)
          return response.json()
        },
        catch: (err) =>
          err instanceof GatewayError && err.status === 401
            ? new HttpApiError.Unauthorized({})
            : new HttpApiError.ServiceUnavailable({}),
      })
    })

    const clawChatCredentials = Effect.fn("KiloGatewayHttpApi.clawChatCredentials")(function* () {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      const token = getToken(info)
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const expires = info?.type === "oauth" ? info.expires : Date.now() + 365 * 24 * 60 * 60 * 1000
      return {
        token,
        expiresAt: new Date(expires).toISOString(),
        kiloChatUrl: KILO_CHAT_URL,
        eventServiceUrl: KILO_EVENT_SERVICE_URL,
      }
    })

    const cloudSessions = Effect.fn("KiloGatewayHttpApi.cloudSessions")(function* (ctx) {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.BadRequest({})))
      const token = getToken(info)
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const query = {
        ...ctx.query,
        limit: ctx.query.limit === undefined ? undefined : Number(ctx.query.limit),
      }

      return yield* Effect.tryPromise({
        try: () => getCloudSessions(token, query),
        catch: (err) =>
          err instanceof GatewayError && err.status === 401
            ? new HttpApiError.Unauthorized({})
            : new HttpApiError.BadRequest({}),
      })
    })

    const cloudSession = Effect.fn("KiloGatewayHttpApi.cloudSession")(function* (ctx) {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      const token = getToken(info)
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const result = yield* Effect.promise(() => fetchCloudSession(token, ctx.params.id))
      if (!result.ok && result.status === 404) return yield* Effect.fail(new HttpApiError.NotFound({}))
      if (!result.ok) return yield* Effect.fail(new HttpApiError.Unauthorized({}))
      return result.data
    })

    const cloudSessionImport = Effect.fn("KiloGatewayHttpApi.cloudSessionImport")(function* (ctx) {
      const info = yield* auth.get("kilo").pipe(Effect.mapError(() => new HttpApiError.Unauthorized({})))
      const token = getToken(info)
      if (!token) return yield* Effect.fail(new HttpApiError.Unauthorized({}))

      const fetched = yield* Effect.promise(() => fetchCloudSessionForImport(token, ctx.payload.sessionId))
      if (!fetched.ok && fetched.status === 404) return yield* Effect.fail(new HttpApiError.NotFound({}))
      if (!fetched.ok) return yield* Effect.fail(new HttpApiError.BadRequest({}))
      if (!fetched.data?.info?.id) return yield* Effect.fail(new HttpApiError.BadRequest({}))

      const bridge = yield* EffectBridge.make()
      return yield* Effect.tryPromise({
        try: () =>
          bridge.promise(
            Effect.sync(() =>
              importSessionToDb(fetched.data, {
                Database,
                Instance,
                SessionTable,
                MessageTable,
                PartTable,
                SessionToRow: Session.toRow,
                Bus,
                SessionCreatedEvent: Session.Event.Created,
                Identifier,
              }),
            ),
          ),
        catch: () => new HttpApiError.BadRequest({}),
      })
    })

    return handlers
      .handle("profile", profile)
      .handle("modes", modes)
      .handle("fim", fim)
      .handle("audioTranscriptions", audioTranscriptions)
      .handle("notifications", notifications)
      .handle("organization", organization)
      .handle("clawStatus", clawStatus)
      .handle("clawChatCredentials", clawChatCredentials)
      .handle("cloudSessions", cloudSessions)
      .handle("cloudSession", cloudSession)
      .handle("cloudSessionImport", cloudSessionImport)
  }),
)
