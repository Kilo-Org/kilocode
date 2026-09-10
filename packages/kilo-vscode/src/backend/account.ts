import { setTimeout as delay } from "node:timers/promises"
import type { OpenCodeClient } from "@opencode-ai/client/promise"
import { KiloGateway, type Account, type AccountBalance } from "@opencode-ai/schema/kilocode/gateway"
import { result, type AdapterOptions } from "./result"

/**
 * Bounded translation of the v1 VS Code extension's account surface
 * (kilo.profile / kilo.authStatus / kilo.organization.set, auth.set/remove,
 * provider.oauth authorize/callback) onto the public `kilocode.gateway` RPC and
 * the native integration/credential flows. The Kilo account is the
 * integration "kilo" registered by the gateway plugin; provider credentials
 * are integration credentials. Secrets never cross the client boundary in
 * either direction, and no v1 runtime or private config file is written.
 */

export type AccountProfile = {
  profile: {
    email?: string
    name?: string
    organizations?: Array<{ id: string; name: string; role?: string }>
    selectedOrganizationId?: string
    hasPersonalAccount?: boolean
  }
  balance: { balance: number } | null
  kiloPass: {
    currentPeriodBaseCreditsUsd: number
    currentPeriodUsageUsd: number
    currentPeriodBonusCreditsUsd: number
    nextBillingAt?: string | null
  } | null
  currentOrgId: string | null
}

export type KiloAuthStatus = { authenticated: boolean; type?: "api" | "oauth" }

export type ProviderAuthMethods = Record<string, Array<{ type: "oauth" | "api"; label: string }>>

export type ProviderAuthAuthorization = { url: string; method: "auto" | "code"; instructions: string }

type Scope = { directory?: string; workspace?: string }

const POLL_INTERVAL_MS = 500
/** The v1 device flow offered 15 minutes; the host attempt expiry bounds it further. */
const CALLBACK_TIMEOUT_MS = 15 * 60 * 1000

function profileView(account: Account, state: AccountBalance): AccountProfile {
  const orgs = account.profile.organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    ...(organization.role === undefined ? {} : { role: organization.role }),
  }))
  return {
    profile: {
      ...(account.profile.email === undefined ? {} : { email: account.profile.email }),
      ...(account.profile.name === undefined || account.profile.name === null ? {} : { name: account.profile.name }),
      organizations: orgs,
      ...(account.profile.selectedOrganizationId === undefined || account.profile.selectedOrganizationId === null
        ? {}
        : { selectedOrganizationId: account.profile.selectedOrganizationId }),
      ...(account.profile.hasPersonalAccount === undefined || account.profile.hasPersonalAccount === null
        ? {}
        : { hasPersonalAccount: account.profile.hasPersonalAccount }),
    },
    balance: state.balance === null ? null : { balance: state.balance.balance },
    kiloPass:
      state.kiloPass === null
        ? null
        : {
            currentPeriodBaseCreditsUsd: state.kiloPass.currentPeriodBaseCreditsUsd,
            currentPeriodUsageUsd: state.kiloPass.currentPeriodUsageUsd,
            currentPeriodBonusCreditsUsd: state.kiloPass.currentPeriodBonusCreditsUsd,
            ...(state.kiloPass.nextBillingAt === null ? {} : { nextBillingAt: state.kiloPass.nextBillingAt }),
          },
    currentOrgId: account.currentOrganizationID ?? state.currentOrganizationID ?? null,
  }
}

export function createAccountMethods(client: OpenCodeClient, defaultDirectory: string) {
  const gateway = client.rpc(KiloGateway.Definition)
  /**
   * Pending OAuth attempts keyed by `${providerID}:${methodIndex}`: the v1
   * callback carries only the provider and the method index, so the adapter
   * remembers which host-side OAuth attempt (attemptID) each authorize
   * started. The host also persists the attempt; this map is the lookup.
   */
  const pending = new Map<
    string,
    { integrationID: string; attemptID: string; mode: "auto" | "code"; expires: number }
  >()

  /** Pending attempts are scoped to the calling location so parallel panels cannot overwrite each other. */
  const attemptKey = (input: { providerID: string; method: number; directory?: string; workspace?: string }) =>
    `${input.providerID}:${input.method}:${input.directory ?? ""}:${input.workspace ?? ""}`

  const location = (input: { directory?: string; workspace?: string } | undefined) => ({
    directory: input?.directory ?? defaultDirectory,
    // Both the public RPC options.location and the raw client input location
    // carry `workspace`; a workspaceID key would be silently dropped.
    ...(input?.workspace === undefined ? {} : { workspace: input.workspace }),
  })

  async function integrationOf(
    providerID: string,
    input: { directory?: string; workspace?: string } | undefined,
    options?: AdapterOptions,
  ) {
    const list = (await client.integration.list({ location: location(input) }, options)).data
    const integration = list.find((item) => item.id === providerID)
    if (!integration) {
      throw new Error(
        `No integration is registered for provider ${providerID}; v2 connects custom providers through configuration instead of stored credentials`,
      )
    }
    return integration
  }

  return {
    kilo: {
      profile: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const at = location(input)
          const [account, state] = await Promise.all([
            gateway.profile({}, { ...options, location: at }),
            gateway.balance({}, { ...options, location: at }),
          ])
          return profileView(account, state)
        }, options),
      authStatus: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          // Auth presence comes from the authoritative kilo integration
          // connections — the same seam auth.remove tears down — so a signed-in
          // account is exactly a stored credential. Transport failures
          // propagate as errors instead of masquerading as signed-out.
          const list = (await client.integration.list({ location: location(input) }, options)).data
          const kilo = list.find((item) => item.id === "kilo")
          return {
            authenticated: (kilo?.connections ?? []).some((connection) => connection.type === "credential"),
          }
        }, options),
      organization: {
        set: <Throw extends boolean = false>(
          input: { organizationId: string | null; directory?: string; workspace?: string },
          options?: AdapterOptions<Throw>,
        ) =>
          result(async () => {
            const at = location(input)
            await gateway["organization.set"]({ organizationID: input.organizationId }, { ...options, location: at })
            const account = await gateway.profile({}, { ...options, location: at })
            const state = await gateway.balance({}, { ...options, location: at })
            return profileView(account, state)
          }, options),
      },
    },
    auth: {
      set: <Throw extends boolean = false>(
        input: {
          providerID: string
          auth: { type: "api"; key: string; metadata?: Record<string, string> }
          directory?: string
          workspace?: string
        },
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          if (input.auth.type !== "api") {
            throw new Error(`Unsupported provider credential type: ${input.auth.type as string}`)
          }
          const at = location(input)
          const integration = await integrationOf(input.providerID, input, options)
          const keyMethod = integration.methods.find((method) => method.type === "key")
          if (!keyMethod) {
            throw new Error(
              `The ${input.providerID} integration does not support API key authentication; use its OAuth authorization flow`,
            )
          }
          const metadata = Object.keys(input.auth.metadata ?? {})
          if (metadata.length > 0) {
            const fields =
              keyMethod.type === "key"
                ? (keyMethod.form ?? []).map((field) => ("key" in field ? field.key : undefined))
                : []
            const unknown = metadata.filter((key) => !fields.includes(key))
            if (unknown.length > 0) {
              throw new Error(
                `The ${input.providerID} integration does not accept credential metadata fields: ${unknown.join(", ")}`,
              )
            }
          }
          await client.integration.connect.key(
            {
              integrationID: integration.id,
              key: input.auth.key,
              ...(input.auth.metadata === undefined ? {} : { answer: input.auth.metadata }),
              location: at,
            },
            options,
          )
        }, options),
      remove: <Throw extends boolean = false>(
        input: { providerID: string; directory?: string; workspace?: string },
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const at = location(input)
          // The Kilo account is the "kilo" integration credential, so removal
          // signs the gateway out. Removal is idempotent: an integration
          // without stored credentials is already signed out.
          const integration = await integrationOf(input.providerID, input, options)
          for (const connection of integration.connections) {
            if (connection.type === "credential") {
              await client.credential.remove({ credentialID: connection.id, location: at }, options)
            }
          }
        }, options),
    },
    provider: {
      oauth: {
        authorize: <Throw extends boolean = false>(
          input: { providerID: string; method: number; directory?: string; workspace?: string },
          options?: AdapterOptions<Throw>,
        ) =>
          result(async () => {
            const at = location(input)
            const integration = await integrationOf(input.providerID, input, options)
            // The v1 method index addresses the full authorable method list the
            // UI displayed (providerAuth.list); authorizing a non-OAuth entry
            // is the v1 ProviderAuthOauthMissing error.
            const authorable = integration.methods.filter((method) => method.type === "oauth" || method.type === "key")
            const method = authorable[input.method]
            if (!method || method.type !== "oauth") {
              throw new Error(
                `Provider method index ${input.method} is not an OAuth method of the ${input.providerID} integration`,
              )
            }
            const attempt = (
              await client.integration.oauth.connect(
                { integrationID: integration.id, methodID: method.id, location: at },
                options,
              )
            ).data
            pending.set(attemptKey(input), {
              integrationID: integration.id,
              attemptID: attempt.attemptID,
              mode: attempt.mode,
              expires: Number(attempt.time.expires),
            })
            return { url: attempt.url, method: attempt.mode, instructions: attempt.instructions }
          }, options),
        callback: <Throw extends boolean = false>(
          input: { providerID: string; method: number; code?: string; directory?: string; workspace?: string },
          options?: AdapterOptions<Throw>,
        ) =>
          result(async () => {
            const key = attemptKey(input)
            const attempt = pending.get(key)
            if (!attempt) throw new Error(`No pending provider authorization for ${input.providerID}`)
            const at = location(input)
            try {
              if (attempt.mode === "code") {
                if (input.code === undefined || input.code === "") {
                  throw new Error("The provider authorization requires a code")
                }
                await client.integration.oauth.complete(
                  {
                    integrationID: attempt.integrationID,
                    attemptID: attempt.attemptID,
                    code: input.code,
                    location: at,
                  },
                  options,
                )
                return
              }
              const deadline = Date.now() + Math.min(CALLBACK_TIMEOUT_MS, Math.max(attempt.expires - Date.now(), 0))
              while (Date.now() < deadline) {
                const status = (
                  await client.integration.oauth.status(
                    { integrationID: attempt.integrationID, attemptID: attempt.attemptID, location: at },
                    options,
                  )
                ).data
                if (status.status === "complete") return
                if (status.status === "failed") throw new Error(status.message)
                if (status.status === "expired") throw new Error("The provider authorization expired")
                await delay(Math.min(POLL_INTERVAL_MS, deadline - Date.now()), undefined, { signal: options?.signal })
              }
              throw new Error("The provider authorization timed out")
            } finally {
              pending.delete(key)
            }
          }, options),
      },
    },
    providerAuth: {
      /** The v1 GET /provider/auth shape, restricted to authorable methods. */
      list: <Throw extends boolean = false>(
        input: { directory?: string; workspace?: string } = {},
        options?: AdapterOptions<Throw>,
      ) =>
        result(async () => {
          const list = (await client.integration.list({ location: location(input) }, options)).data
          const methods: ProviderAuthMethods = {}
          for (const integration of list) {
            const authorable = integration.methods.flatMap(
              (method): Array<{ type: "oauth" | "api"; label: string }> => {
                if (method.type === "oauth") return [{ type: "oauth", label: method.label }]
                if (method.type === "key") return [{ type: "api", label: method.label ?? integration.name }]
                // env and command methods are not authorable through stored credentials.
                return []
              },
            )
            if (authorable.length > 0) methods[integration.id] = authorable
          }
          return methods
        }, options),
    },
  }
}
