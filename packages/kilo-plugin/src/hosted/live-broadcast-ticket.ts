import type { KiloAccount } from "@kilocode/gateway-core"
import { Schema } from "effect"
import { invalid } from "./error.js"
import { json, responseError } from "./transport.js"

const grant = Schema.Struct({ ticket: Schema.String.check(Schema.isMinLength(1)), expiresAt: Schema.Finite })

/** Only the issuer gets the account credential. The one-use ticket is bound to a server-selected worker. */
export async function streamSocket(
  account: KiloAccount.Info,
  origins: { issuer: string; worker: string },
  control: string,
  eventTypes: string,
  signal: AbortSignal,
) {
  const response = await fetch(new URL("/api/cloud-agent-next/sessions/stream-ticket", origins.issuer), {
    method: "POST",
    headers: { Authorization: `Bearer ${account.token}`, "content-type": "application/json" },
    redirect: "error",
    credentials: "omit",
    signal,
    body: JSON.stringify({
      cloudAgentSessionId: control,
      ...(account.organizationID && { organizationId: account.organizationID }),
    }),
  })
  if (!response.ok) return responseError(response)
  const value = await json(response, 16384)
  if (!Schema.is(grant)(value) || value.expiresAt * 1000 <= Date.now()) return invalid()
  signal.throwIfAborted()
  const url = new URL("/stream", origins.worker)
  url.protocol = url.protocol === "http:" ? "ws:" : "wss:"
  url.search = new URLSearchParams({
    cloudAgentSessionId: control,
    eventTypes,
    replay: "false",
    bootstrap: "true",
    ticket: value.ticket,
  }).toString()
  return new WebSocket(url)
}
