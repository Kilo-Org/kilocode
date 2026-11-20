import type { Auth } from "@/auth"
import type { Config } from "@/config/config"
import { InstanceRef } from "@/effect/instance-ref"
import { ProfileIdentity } from "@/kilocode/cloud/profile-identity"
import { resolveKiloApiOrigin } from "@/kilocode/cloud/origin"
import { capture } from "@/kilocode/instance"
import { token } from "@/kilocode/provider/catalog"
import {
  DEFAULT_KILO_AI_GATEWAY_URL,
  ENV_FEATURE,
  ENV_VERSION,
  HEADER_ORGANIZATIONID,
  getKiloUrlFromToken,
} from "@kilocode/kilo-gateway"
import { admitted, createPolicyClient, unrestricted, type MemberPolicy } from "@kilocode/kilo-gateway/permission-policy"
import { Global } from "@opencode-ai/core/global"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { Effect, Redacted } from "effect"
import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import z from "zod"

type Reason = "unavailable" | "unauthorized" | "invalid" | "update-required" | "client-denied"
type Unavailable = { status: "unavailable"; organization: string; reason: Reason }
type Personal = { status: "personal" }
export type PolicyState =
  | Personal
  | Unavailable
  | {
      status: "disabled" | "active"
      organization: string
      policy: MemberPolicy
      scope: string
      stamp: string
      unrestricted: boolean
    }

type Selection =
  | Personal
  | Unavailable
  | {
      status: "selected"
      organization: string
      origin: string
      bearer: string
      incumbent?: string
      key: string
    }

const uuid = z.guid()
const gateway = new URL(DEFAULT_KILO_AI_GATEWAY_URL).origin
const root = path.join(Global.Path.data, "managed-permissions-v1")
const hash = (...values: unknown[]) => createHash("sha256").update(JSON.stringify(values)).digest("hex")
const unavailable = (organization: string, reason: Reason): Unavailable => ({
  status: "unavailable",
  organization,
  reason,
})

async function read(key: string, max: number): Promise<unknown> {
  const file = await fs.open(path.join(root, `${key}.json`), "r")
  try {
    if ((await file.stat()).size > max) return undefined
    return JSON.parse(await file.readFile("utf8"))
  } finally {
    await file.close()
  }
}

async function write(key: string, value: unknown) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 })
  const temp = path.join(root, `.${randomUUID()}.tmp`)
  try {
    await fs.writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: "wx" })
    await fs.rename(temp, path.join(root, `${key}.json`))
  } finally {
    await fs.rm(temp, { force: true })
  }
}

const client = createPolicyClient({ storage: { read: (key) => read(key, 300 * 1024), write } })

const proofs = new Map<string, ReturnType<typeof prove>>()
function prove(origin: string, org: string, bearer: string, key: string) {
  return Effect.runPromise(
    Effect.gen(function* () {
      const cached = yield* Effect.promise(() => read(key, 4096).catch(() => undefined))
      if (typeof cached === "string" && cached.trim() && cached.length <= 1024) return { account: cached } as const
      const profile = yield* ProfileIdentity.readWithBearer(
        { KILO_API_URL: origin },
        Redacted.make(bearer),
        10_000,
      ).pipe(Effect.result)
      if (profile._tag === "Failure") {
        const kind = profile.failure.kind
        return unavailable(org, kind === "signed_out" ? "unauthorized" : kind)
      }
      if (!profile.success.trim() || profile.success.length > 1024) return unavailable(org, "invalid")
      yield* Effect.promise(() => write(key, profile.success).catch(() => undefined))
      return { account: profile.success } as const
    }),
  )
}

function account(origin: string, org: string, bearer: string) {
  const key = hash("profile", origin, org, bearer)
  const pending = proofs.get(key)
  if (pending) return pending
  const flight = prove(origin, org, bearer, key).finally(() => proofs.delete(key))
  proofs.set(key, flight)
  return flight
}

function scoped(url?: URL | null) {
  const match = url?.pathname.match(/\/api\/(?:(?:gateway\/)?v1\/)?organizations(?:\/([^/]+))?(?:\/|$)/)
  return match ? (match.at(1) ?? "") : undefined
}

function header(headers: unknown) {
  if (!headers || typeof headers !== "object") return []
  return Object.entries(headers)
    .filter(([key]) => key.toLowerCase() === HEADER_ORGANIZATIONID.toLowerCase())
    .map(([, value]): unknown => value)
}

const select = Effect.fnUntraced(function* (
  auth: Auth.Interface,
  config: Config.Interface,
): Effect.fn.Return<Selection> {
  const provider = (yield* config.get()).provider?.kilo
  const saved = yield* auth.get("kilo").pipe(Effect.result)
  const env = process.env.KILO_ORG_ID || undefined
  if (saved._tag === "Failure") return unavailable(uuid.safeParse(env).data ?? "unknown", "unavailable")
  const info = saved.success
  const opts = provider?.options
  const value: unknown = token(opts, info)
  const bearer = typeof value === "string" ? value : undefined
  const stored = info?.type === "oauth" ? info.access : info?.type === "api" ? info.key : undefined
  const embedded = URL.parse(getKiloUrlFromToken("", bearer ?? ""))
  const previous = URL.parse(getKiloUrlFromToken("", stored ?? ""))
  const base = opts?.baseURL || provider?.api
  const url = base
    ? URL.parse(base.replace(/\$\{([^}]+)\}/g, (value, name: string) => process.env[name] ?? value))
    : undefined
  const option: unknown = opts?.kilocodeOrganizationId
  const hints = [
    env,
    info?.type === "oauth" ? info.accountId : undefined,
    option,
    scoped(embedded),
    scoped(previous),
    scoped(url),
  ].filter((value) => value !== undefined)
  const headers = [
    ...header(opts?.headers),
    ...Object.values(provider?.models ?? {}).flatMap((model) => header(model?.headers)),
  ]
  if (!hints.length && !headers.length) return { status: "personal" }
  const org = hints.flatMap((value) => uuid.safeParse(value).data?.toLowerCase() ?? []).at(0)
  if (!org || [...hints, ...headers].some((value) => uuid.safeParse(value).data?.toLowerCase() !== org)) {
    return unavailable(org ?? "unknown", "invalid")
  }

  const origin = yield* Effect.try({ try: () => resolveKiloApiOrigin(), catch: () => undefined }).pipe(Effect.result)
  if (origin._tag === "Failure") return unavailable(org, "invalid")
  const trusted = (url: URL) =>
    !url.username && !url.password && (url.origin === origin.success || url.origin === gateway)
  if ((embedded && !trusted(embedded)) || (previous && scoped(previous) !== undefined && !trusted(previous))) {
    return unavailable(org, "invalid")
  }
  if (
    (url && !trusted(url) && scoped(url) !== undefined) ||
    (!process.env.KILO_API_KEY && !stored && base && (!url || !trusted(url)))
  ) {
    return unavailable(org, "invalid")
  }
  if (typeof bearer !== "string" || !bearer.trim() || bearer === "anonymous") return unavailable(org, "unauthorized")
  if (/\s|\p{Cc}/u.test(bearer)) return unavailable(org, "invalid")

  // Inference gives an environment bearer precedence. If it overrides a stored
  // org selection, the new bearer must still belong to that selected account.
  const incumbent =
    stored !== bearer && ((info?.type === "oauth" && info.accountId) || scoped(previous)) ? stored : undefined
  return {
    status: "selected",
    organization: org,
    bearer,
    incumbent,
    origin: origin.success,
    key: hash(origin.success, org, bearer, incumbent),
  }
})

type Observation = { key: string; epoch: string; representation?: string; stamp?: string }
const observations = new WeakMap<Config.Interface, Map<string, Observation>>()

export const resolve = Effect.fn("ManagedPermission.resolve")(function* (
  auth: Auth.Interface,
  config: Config.Interface,
): Effect.fn.Return<PolicyState> {
  const dir = ((yield* InstanceRef) ?? capture())?.directory ?? ""
  const existing = observations.get(config)
  const states = existing ?? new Map<string, Observation>()
  if (!existing) observations.set(config, states)
  const observe = (selection: Selection) => {
    const key = selection.status === "selected" ? selection.key : hash(selection)
    const prior = states.get(dir)
    if (prior?.key === key) return prior
    const next: Observation = { key, epoch: randomUUID() }
    states.set(dir, next)
    return next
  }
  const selection = yield* select(auth, config)
  const state = observe(selection)
  if (selection.status !== "selected") return selection
  const { organization: org, origin, bearer, incumbent } = selection
  const invalidate = (reason: Reason) => {
    delete state.stamp
    return unavailable(org, reason)
  }
  const use = yield* Effect.promise(() => account(origin, org, bearer))
  if (!("account" in use)) return invalidate(use.reason)
  if (incumbent) {
    const saved = yield* Effect.promise(() => account(origin, org, incumbent))
    if (!("account" in saved)) return invalidate(saved.reason)
    if (saved.account !== use.account) return invalidate("unauthorized")
  }
  const result = yield* Effect.promise(() =>
    client.get({ origin, organization: org, account: use.account, token: bearer }),
  )
  if (observe(yield* select(auth, config)) !== state) return invalidate("unavailable")
  if (result.status === "unavailable") {
    const reason = result.reason
    return invalidate(
      reason === "authorization"
        ? "unauthorized"
        : reason === "unsupported-version"
          ? "update-required"
          : reason === "invalid-response"
            ? "invalid"
            : "unavailable",
    )
  }
  const { policy, etag } = result.entry
  const feature = process.env[ENV_FEATURE]
  const version = process.env[ENV_VERSION] ?? InstallationVersion
  if (!admitted(policy, feature, version)) return invalidate("client-denied")
  const scope = hash(state.epoch, state.key, use.account)
  const representation = hash(scope, etag, policy, feature, version)
  // Revalidation of the same representation preserves pending requests; an
  // observed outage, scope switch, or superseded representation does not.
  if (!state.stamp || state.representation !== representation) {
    state.representation = representation
    state.stamp = hash(representation, randomUUID())
  }
  return {
    status: policy.managed ? "active" : "disabled",
    organization: org,
    policy,
    scope,
    stamp: state.stamp,
    unrestricted: unrestricted(policy),
  }
})
