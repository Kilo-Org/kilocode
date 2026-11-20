import { createHash } from "node:crypto"
import { z } from "zod"

// Cloud wire contract: 946127976b0146dd8e77b430884253d728541f80,
// packages/web-shared/src/lib/organizations/group-policies/permission-policy/permission-policy.schema.ts.
const AGE = 300
const BYTES = 256 * 1024
const LAYERS = 100 + 1 // Organization groups plus the default layer.
const utf8 = new TextEncoder()
const size = (value: unknown) => utf8.encode(JSON.stringify(value)).length

const action = z.enum(["allow", "ask", "deny"])
const rules = z
  .array(
    z.strictObject({
      pattern: z
        .string()
        .min(1)
        .max(512)
        .regex(/\S/)
        .refine((pattern) => !/\p{Cc}/u.test(pattern)),
      action,
    }),
  )
  .max(100)
const profile = z.strictObject({ fallback: z.enum(["ask", "deny"]), rules })
const permissions = z
  .strictObject({
    schema_version: z.literal(1),
    unrestricted_mode: z.enum(["allow", "deny"]).optional(),
    tools: z
      .record(
        z
          .string()
          .min(1)
          .max(128)
          .refine((key) => !/[^A-Za-z0-9_.*:-]/.test(key)),
        z.union([action, z.strictObject({ rules, fallback: action.optional() })]),
      )
      .refine((tools) => Object.keys(tools).length <= 100)
      .refine((tools) => tools.bash === undefined || typeof tools.bash === "string")
      .optional(),
    shell: z.strictObject({ bash: profile.optional(), powershell: profile.optional() }).optional(),
  })
  .refine((data) => size(data) <= 32 * 1024)

// FEATURE_VALUES in packages/web-shared/src/lib/feature-detection.ts at the same merge.
const features = [
  "vscode-extension",
  "jetbrains-extension",
  "jetbrains-plugin",
  "autocomplete",
  "parallel-agent",
  "managed-indexing",
  "cli",
  "desktop",
  "daemon",
  "cloud-agent",
  "cloud-agent-web",
  "code-review",
  "code-review-memory",
  "agent-manager",
  "security-agent",
  "security-remediation",
  "slack",
  "discord",
  "github",
  "linear",
  "bot",
  "webhook",
  "scheduled",
  "kiloclaw",
  "openclaw",
  "direct-gateway",
  "quick-chat",
  "mobile-chat",
  "embeddings",
  "kiloclaw-embedding",
  "openclaw-embedding",
  "gastown",
  "mobile-voice-input",
  "tool-summary-translation",
] as const
const feature = z.enum(features)
const version = z
  .string()
  .max(100)
  .regex(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/,
  )
  .refine((value) => value === value.trim())
const access = z
  .discriminatedUnion("mode", [
    z.strictObject({
      schema_version: z.literal(1),
      mode: z.literal("allowlist"),
      clients: z.array(z.strictObject({ feature, min_version: version.optional() })).max(features.length),
    }),
    z.strictObject({
      schema_version: z.literal(1),
      mode: z.literal("blocklist"),
      clients: z.array(z.strictObject({ feature })).max(features.length),
    }),
  ])
  .refine(({ clients }) => new Set(clients.map((client) => client.feature)).size === clients.length)
const organization = z.guid()
const envelope = z.strictObject({
  schema_version: z.literal(1),
  organization_id: organization,
  revision: z.int().nonnegative(),
  max_age_seconds: z.int().positive().max(AGE),
})

export const MemberPolicySchema = z
  .discriminatedUnion("managed", [
    envelope.extend({ managed: z.literal(false), policy: z.strictObject({}) }),
    envelope.extend({
      managed: z.literal(true),
      policy: z.strictObject({
        agent_permissions: z.strictObject({ layers: z.array(permissions).min(1).max(LAYERS) }).optional(),
        client_access: z.strictObject({ layers: z.array(access).min(1).max(LAYERS) }).optional(),
      }),
    }),
  ])
  .refine((data) => size(data) <= BYTES)

export type MemberPolicy = z.infer<typeof MemberPolicySchema>
export type PolicyAction = z.infer<typeof action>
export type PolicyShell = {
  kind: "bash" | "powershell" | "unsupported"
  commands: readonly string[]
  uncertain: boolean
}

type Match = (input: string, pattern: string) => boolean
type Rule = z.infer<typeof rules>[number]

function restrict(a: PolicyAction | undefined, b: PolicyAction | undefined): PolicyAction | undefined {
  if (a === "deny" || b === "deny") return "deny"
  if (a === "ask" || b === "ask") return "ask"
  return a ?? b
}

function evaluate(rules: Rule[], input: string, match: Match, fallback?: PolicyAction) {
  return rules.findLast((rule) => match(input, rule.pattern))?.action ?? fallback
}

function resource(tool: string, input: string) {
  if (tool !== "webfetch" || !/^https?:\/\//i.test(input)) return input
  const url = URL.parse(input)
  return url ? `${url.host}${url.pathname}${url.search}` : input
}

function powershell(input: string, pattern: string, match: Match) {
  // Cmdlet lookup is case-insensitive even on Unix. Do not fold paths or arguments.
  const name = input.match(/^\S+/)?.at(0)
  if (!name || /[\\/:.]/.test(name)) return match(input, pattern)
  return match(
    name.toLowerCase() + input.slice(name.length),
    pattern.replace(/^\S+/, (name) => name.toLowerCase()),
  )
}

export function decide(
  policy: MemberPolicy,
  input: { tool: string; resources?: readonly string[]; shell?: PolicyShell },
  match: Match,
): PolicyAction | undefined {
  if (!policy.managed) return undefined
  const resources = input.resources?.map((value) => resource(input.tool, value)) ?? []
  let decision: PolicyAction | undefined
  for (const layer of policy.policy.agent_permissions?.layers ?? []) {
    const tool = layer.tools && Object.hasOwn(layer.tools, input.tool) ? layer.tools[input.tool] : undefined
    if (typeof tool === "string") decision = restrict(decision, tool)
    if (typeof tool === "object") {
      if (!resources.length) decision = restrict(decision, tool.fallback)
      for (const path of resources) decision = restrict(decision, evaluate(tool.rules, path, match, tool.fallback))
    }
    if (input.tool === "bash" && layer.shell) {
      const shell = input.shell
      if (!shell || shell.kind === "unsupported") return "deny"
      const profile = layer.shell[shell.kind]
      if (!profile) return "deny"
      const matcher: Match = shell.kind === "powershell" ? (input, pattern) => powershell(input, pattern, match) : match
      if (shell.uncertain || !shell.commands.length) decision = restrict(decision, profile.fallback)
      for (const cmd of shell.commands)
        decision = restrict(decision, evaluate(profile.rules, cmd, matcher, profile.fallback))
    }
    if (decision === "deny") return decision
  }
  return decision
}

export function unrestricted(policy: MemberPolicy): boolean {
  return !policy.managed || !policy.policy.agent_permissions?.layers.some((layer) => layer.unrestricted_mode === "deny")
}

function compare(a: string, b: string) {
  if (a.length !== b.length) return a.length < b.length ? -1 : 1
  return a === b ? 0 : a < b ? -1 : 1
}

function meets(actual: string | undefined, minimum: string) {
  const parsed = version.safeParse(actual)
  if (!parsed.success) return false
  // Compare numeric identifiers as digit strings: the Cloud SemVer schema does not cap them at MAX_SAFE_INTEGER.
  const split = (value: string) => {
    const core = value.split("+", 1).at(0) ?? ""
    const dash = core.indexOf("-")
    return dash === -1
      ? { numbers: core.split(".") }
      : { numbers: core.slice(0, dash).split("."), pre: core.slice(dash + 1).split(".") }
  }
  const a = split(parsed.data)
  const b = split(minimum)
  for (const [index, part] of a.numbers.entries()) {
    const order = compare(part, b.numbers.at(index) ?? "")
    if (order) return order > 0
  }
  if (!a.pre || !b.pre) return !a.pre
  for (const [index, part] of a.pre.entries()) {
    const other = b.pre.at(index)
    if (other === undefined) return true
    if (part === other) continue
    const numeric = /^\d+$/.test(part)
    if (numeric !== /^\d+$/.test(other)) return !numeric
    return numeric ? compare(part, other) > 0 : part > other
  }
  return a.pre.length === b.pre.length
}

export function admitted(policy: MemberPolicy, feature: string | undefined, version: string | undefined): boolean {
  if (!policy.managed) return true
  return (
    policy.policy.client_access?.layers.every((layer) => {
      if (layer.mode === "blocklist") return !layer.clients.some((client) => client.feature === feature)
      const client = layer.clients.find((client) => client.feature === feature)
      return !!client && (client.min_version === undefined || meets(version, client.min_version))
    }) ?? true
  )
}

// A single strong quoted HTTP entity-tag. Treat the opaque value as uninterpreted.
const etag = z.string().regex(/^"[\x21\x23-\x7e\u0080-\u00ff]*"$/)
const entry = z.strictObject({ policy: MemberPolicySchema, etag, validatedAt: z.int().nonnegative() })

export type PolicyEntry = z.infer<typeof entry>
/** The caller must prove that this exact bearer belongs to the selected account. */
export type PolicyScope = { origin: string; organization: string; account: string; token: string }
export type PolicyResult =
  | { status: "ok"; entry: PolicyEntry }
  | { status: "unavailable"; reason: "unsupported-version" | "authorization" | "invalid-response" | "transport" }

type Options = {
  /** Trusted persistence for opaque scope keys. Write each complete entry atomically. */
  storage?: { read(key: string): Promise<unknown>; write(key: string, entry: PolicyEntry): Promise<void> }
  fetch?: typeof globalThis.fetch
  now?: () => number
  /** Optional lower freshness ceiling in milliseconds. */
  maxAge?: number
  timeout?: number
}

const unavailable = (reason: Extract<PolicyResult, { status: "unavailable" }>["reason"]): PolicyResult => ({
  status: "unavailable",
  reason,
})

async function body(response: Response) {
  if (!response.body || Number(response.headers.get("content-length")) > BYTES) {
    void response.body?.cancel().catch(() => undefined)
    return undefined
  }
  const reader = response.body.getReader()
  try {
    const bytes = new Uint8Array(BYTES)
    let length = 0
    for (;;) {
      const chunk = await reader.read()
      if (chunk.done) break
      if (length + chunk.value.byteLength > BYTES) return undefined
      bytes.set(chunk.value, length)
      length += chunk.value.byteLength
    }
    try {
      return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes.subarray(0, length))) as unknown
    } catch {
      return undefined
    }
  } finally {
    void reader.cancel().catch(() => undefined)
  }
}

function future(value: unknown, path: PropertyKey[]) {
  const version = path.reduce(
    (value, key) => (typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined),
    value,
  )
  return typeof version === "number" && Number.isInteger(version) && version > 1
}

export function createPolicyClient(opts: Options = {}) {
  const fetcher = opts.fetch ?? globalThis.fetch
  const now = opts.now ?? Date.now
  const age = Math.max(0, opts.maxAge ?? AGE * 1000)
  const cells = new Map<string, PolicyEntry>()
  const flights = new Map<string, Promise<PolicyResult>>()

  async function load(key: string, org: string, url: URL, token: string): Promise<PolicyResult> {
    const disk = async () => {
      const value = await opts.storage?.read(key).catch(() => undefined)
      const parsed = entry.safeParse(value)
      return parsed.success && parsed.data.policy.organization_id.toLowerCase() === org ? parsed.data : undefined
    }
    try {
      const saved = cells.get(key) ?? (await disk())
      const time = now()
      const prior = saved && saved.validatedAt <= time ? saved : undefined
      if (prior) {
        cells.set(key, prior)
        if (time - prior.validatedAt < Math.min(age, prior.policy.max_age_seconds * 1000)) {
          return { status: "ok", entry: prior }
        }
      }
      const headers = new Headers({ authorization: `Bearer ${token}` })
      if (prior) headers.set("if-none-match", prior.etag)
      const response = await fetcher(url, {
        method: "GET",
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(opts.timeout ?? 10_000),
      })
      const tag = response.headers.get("etag")
      if (response.redirected || (response.status !== 200 && response.status !== 304)) {
        void response.body?.cancel().catch(() => undefined)
        if (response.redirected) return unavailable("invalid-response")
        if (response.status === 401 || response.status === 403) return unavailable("authorization")
        return unavailable(response.status >= 500 ? "transport" : "invalid-response")
      }

      const policy = await (async () => {
        if (response.status === 304) {
          void response.body?.cancel().catch(() => undefined)
          return prior && tag === prior.etag && !response.body ? prior.policy : undefined
        }
        if (!etag.safeParse(tag).success) {
          void response.body?.cancel().catch(() => undefined)
          return undefined
        }
        const data = await body(response)
        if (future(data, ["schema_version"])) return "unsupported-version"
        const parsed = MemberPolicySchema.safeParse(data)
        if (!parsed.success) {
          if (parsed.error.issues.some(({ path }) => path.at(-1) === "schema_version" && future(data, path))) {
            return "unsupported-version"
          }
          return undefined
        }
        return parsed.data.organization_id.toLowerCase() === org ? parsed.data : undefined
      })()
      if (policy === "unsupported-version") return unavailable(policy)
      if (!policy || tag === null) return unavailable("invalid-response")
      const fresh = { policy, etag: tag, validatedAt: now() }
      cells.set(key, fresh)
      await opts.storage?.write(key, fresh).catch(() => undefined)
      return { status: "ok", entry: fresh }
    } catch {
      return unavailable("transport")
    }
  }

  return {
    async get(scope: PolicyScope): Promise<PolicyResult> {
      const origin = URL.parse(scope.origin)
      if (
        !origin ||
        !["http:", "https:"].includes(origin.protocol) ||
        origin.username ||
        origin.password ||
        origin.pathname !== "/" ||
        origin.search ||
        origin.hash ||
        !organization.safeParse(scope.organization).success ||
        !scope.account ||
        !scope.token
      ) {
        return unavailable("invalid-response")
      }
      const org = scope.organization.toLowerCase()
      const url = new URL(`/api/organizations/${org}/policy/permission`, origin)
      const key = createHash("sha256")
        .update(JSON.stringify([origin.origin, org, scope.account, scope.token]))
        .digest("hex")
      const pending = flights.get(key)
      if (pending) return pending
      const flight = load(key, org, url, scope.token).finally(() => flights.delete(key))
      flights.set(key, flight)
      return flight
    },
  }
}
