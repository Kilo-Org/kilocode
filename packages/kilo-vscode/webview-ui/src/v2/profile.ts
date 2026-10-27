// The Kilo account for main's ProfileView, on native v2 APIs: the `kilocode.gateway` RPC reads the account and
// switches the team, the `kilo` integration's OAuth method signs in (device authorization, as the TUI connect
// dialog), and removing the Kilo credentials signs out. createData reloads models and providers on the
// integration and model events these cause, so the prompt's model selector follows without extra work here.
import { KiloGatewayRpc } from "@opencode/schema/kilocode/gateway"
import { ProviderUsage } from "@opencode/schema/kilocode/provider-usage"
import { createSignal, onCleanup } from "solid-js"
import { useV2 } from "./client"

const KILO = "kilo"
const POLL = 1000

export type ProfileData = {
  profile: KiloGatewayRpc.Profile
  balance: KiloGatewayRpc.Balance | null
  kiloPass: KiloGatewayRpc.KiloPass
}

export type DeviceAuthStatus = "idle" | "initiating" | "pending" | "success" | "error" | "cancelled"

export type DeviceAuthState = {
  status: DeviceAuthStatus
  code?: string
  verificationUrl?: string
  expiresIn?: number
  error?: string
}

export function createProfile() {
  const v2 = useV2()
  const location = { directory: v2.directory }
  const rpc = v2.api.rpc(KiloGatewayRpc.Definition)
  const usageRpc = v2.api.rpc(ProviderUsage.Definition)
  /** `undefined` while loading, `null` when signed out. */
  const [data, setData] = createSignal<ProfileData | null>()
  const [auth, setAuth] = createSignal<DeviceAuthState>({ status: "idle" })
  const [usage, setUsage] = createSignal<ProviderUsage.Info>()
  const [usageLoading, setUsageLoading] = createSignal(false)
  const [usageError, setUsageError] = createSignal<string>()
  const state: { attempt?: string; timer?: ReturnType<typeof setTimeout> } = {}

  const refresh = async () => {
    // Only the contract's `unauthorized` error means signed out; other failures are real errors.
    const status = await rpc.authStatus({}, { location }).catch((error: { type?: string }) => {
      if (error?.type === "unauthorized") return undefined
      throw error
    })
    if (!status?.authenticated) return void setData(null)
    const [profile, balance, kiloPass] = await Promise.all([
      rpc.profile({}, { location }),
      rpc.balance({}, { location }).catch(() => null),
      rpc.kiloPass({}, { location }).catch(() => null),
    ])
    setData({ profile, balance, kiloPass })
  }

  const stop = () => {
    clearTimeout(state.timer)
    const attempt = state.attempt
    state.attempt = undefined
    return attempt
  }

  const poll = (attempt: string) => {
    void v2.api.integration.oauth
      .status({ integrationID: KILO, attemptID: attempt, location })
      .then((result) => {
        if (state.attempt !== attempt) return
        if (result.data.status === "pending") {
          state.timer = setTimeout(() => poll(attempt), POLL)
          return
        }
        state.attempt = undefined
        if (result.data.status !== "complete") {
          const error = result.data.status === "failed" ? result.data.message : "Authorization expired"
          return void setAuth({ status: "error", error })
        }
        setAuth({ status: "success" })
        // As v1: a new account invalidates the cached usage.
        loadUsage(true)
        return refresh().then(() => setAuth({ status: "idle" }))
      })
      .catch((error: unknown) => {
        if (state.attempt !== attempt) return
        state.attempt = undefined
        setAuth({ status: "error", error: text(error) })
      })
  }

  const loadUsage = (force: boolean) => {
    setUsageLoading(true)
    setUsageError(undefined)
    void (force ? usageRpc.refresh({}, { location }) : usageRpc.get({}, { location }))
      .then(setUsage)
      .catch((error: unknown) => setUsageError(text(error)))
      .finally(() => setUsageLoading(false))
  }

  const cancel = () => {
    const attempt = stop()
    if (!attempt) return
    setAuth({ status: "cancelled" })
    void v2.api.integration.oauth.cancel({ integrationID: KILO, attemptID: attempt, location }).catch(() => undefined)
  }
  onCleanup(cancel)

  return {
    data,
    auth,
    refresh: () => void refresh().catch(v2.report),
    usage,
    usageLoading,
    usageError,
    requestUsage: () => loadUsage(false),
    refreshUsage: () => loadUsage(true),
    login() {
      cancel()
      setAuth({ status: "initiating" })
      void (async () => {
        await v2.data.location.integration.sync()
        const method = v2.data.location.integration
          .list()
          ?.find((item) => item.id === KILO)
          ?.methods.find((item) => item.type === "oauth")
        if (!method) throw new Error("Kilo Gateway sign-in is not available on this server.")
        const result = await v2.api.integration.oauth.connect({ integrationID: KILO, location, methodID: method.id })
        state.attempt = result.data.attemptID
        setAuth({
          status: "pending",
          code: userCode(result.data.url, result.data.instructions),
          verificationUrl: result.data.url,
          expiresIn: Math.max(0, Math.round((result.data.time.expires - Date.now()) / 1000)),
        })
        poll(result.data.attemptID)
      })().catch((error: unknown) => setAuth({ status: "error", error: text(error) }))
    },
    cancel,
    logout() {
      // Environment connections (KILO_API_KEY) are not credentials and stay signed in, as on v1.
      void (async () => {
        await v2.data.location.integration.sync()
        const credentials =
          v2.data.location.integration
            .list()
            ?.find((item) => item.id === KILO)
            ?.connections.flatMap((item) => (item.type === "credential" ? [item.id] : [])) ?? []
        await Promise.all(credentials.map((id) => v2.api.credential.remove({ credentialID: id })))
        loadUsage(true)
        await refresh()
      })().catch(v2.report)
    },
    setOrganization(organizationID: string | null) {
      // A failure still refreshes, so the selector shows the account that requests use.
      void rpc["organization.set"]({ organizationID }, { location })
        .catch(v2.report)
        .then(() => {
          loadUsage(true)
          return refresh()
        })
        .catch(v2.report)
    },
  }
}

export type Profile = ReturnType<typeof createProfile>

// The code a person types: the verification URL carries it (`?code=ABCD-1234`). The instructions name the device
// code that the server polls with, so they are only the fallback, parsed as v1 did.
function userCode(url: string, instructions: string) {
  const code = URL.canParse(url) ? new URL(url).searchParams.get("code") : null
  return code ?? instructions.match(/code:\s*(\S+)/i)?.[1]
}

function text(error: unknown) {
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error && "message" in error && typeof error.message === "string")
    return error.message
  return String(error)
}
