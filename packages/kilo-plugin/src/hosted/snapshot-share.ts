import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Schema } from "effect"
import { HostedError, invalid } from "./error"
import type { Authorize, Issuer } from "./fork-share"

const Page = Schema.Struct({
  kind: Schema.Literal("success"),
  info: Schema.Struct({ id: Schema.String }),
  messages: Schema.Array(Schema.Unknown),
  source: Schema.optional(Schema.Struct({ version: Schema.Literals(["v1", "v2"]) })),
  nextCursor: Schema.NullOr(Schema.String),
  updateCursor: Schema.Int,
  omittedItemCount: Schema.Int,
})
const LegacyRows = Schema.Array(Schema.Struct({ info: Schema.Unknown, parts: Schema.Array(Schema.Unknown) }))
const Share = Schema.Struct({
  public_id: Schema.String.check(Schema.isUUID()),
  share_token: Schema.String.check(Schema.isMaxLength(4096), Schema.isPattern(/^[\w-]+\.[\w-]+\.[\w-]+$/)),
})
const Snapshot = Schema.Struct({
  sub: Schema.String,
  jti: Schema.String,
  version: Schema.Literal(2),
  iss: Schema.Literal("kilo-session-ingest"),
  aud: Schema.Literal("kilo-session-share"),
  duration: Schema.Literal("7d"),
  include_new_messages: Schema.Literal(false),
  iat: Schema.Int,
  exp: Schema.Int,
})

function snapshotURL(data: unknown, session: string, issuer: string) {
  if (!Schema.is(Share)(data)) return invalid()
  // The trusted issuer authenticates the response. Check it actually issued the consented scope before offering a copy.
  const claims = Schema.decodeUnknownOption(Schema.fromJsonString(Snapshot))(
    Buffer.from(data.share_token.split(".")[1]!, "base64url").toString("utf8"),
  )
  if (
    claims._tag === "None" ||
    claims.value.jti !== data.public_id ||
    claims.value.sub !== session ||
    claims.value.exp - claims.value.iat !== 7 * 86400 ||
    claims.value.exp * 1000 <= Date.now()
  )
    return invalid()
  return { url: new URL(`/s/${data.share_token}`, issuer).href }
}

export function createSnapshotShare(org: string | null, issuer: string, authorize: Authorize, call: Issuer) {
  // One unconsumed confirmation per selected source. No link capability is retained here.
  const offers = new Map<string, { key: string; until: number }>()
  const id = (t: KiloHostedRpc.Target) => JSON.stringify([t.scope, t.workspaceID, t.sessionID])
  async function available(target: KiloHostedRpc.Target, signal: AbortSignal) {
    const control = await authorize(target, signal)
    if (!control.startsWith("workspace_")) return false
    const history = await call(
      `${org ? "organizations." : ""}cloudAgentNext.getSessionMessagesPage`,
      { sessionId: control, kiloSessionId: target.sessionID, limit: 1, ...(org && { organizationId: org }) },
      signal,
    )
    // A successful explicit null is the documented legacy unregistered page. An absent or malformed result isn't.
    if (history === null) return true
    if (!Schema.is(Page)(history) || history.info.id !== target.sessionID) return invalid()
    if (history.source?.version === "v2") return false
    if (!Schema.is(LegacyRows)(history.messages)) return invalid()
    return true
  }
  return {
    async snapshotOptions(target: KiloHostedRpc.Target, signal: AbortSignal) {
      const source = id(target)
      offers.delete(source)
      for (const [key, offer] of offers) if (offer.until <= Date.now()) offers.delete(key)
      if (!(await available(target, signal))) return { available: false as const }
      const confirmation = crypto.randomUUID()
      if (offers.size >= 128) offers.delete(offers.keys().next().value!)
      offers.set(source, { key: confirmation, until: Date.now() + 10 * 60_000 })
      return { available: true as const, confirmation }
    },
    async publishSnapshot(target: KiloHostedRpc.Target, confirmation: string, signal: AbortSignal) {
      const source = id(target)
      const offer = offers.get(source)
      if (offer?.key !== confirmation || offer.until <= Date.now())
        throw new HostedError("Reopen sharing to confirm publication.")
      offers.delete(source)
      if (!(await available(target, signal))) throw new HostedError("Sharing is unavailable for this session.")
      const result = await call(
        "cliSessionsV2.share",
        { session_id: target.sessionID, duration: "7d", include_new_messages: false },
        signal,
        true,
      )
      return snapshotURL(result, target.sessionID, issuer)
    },
  }
}
