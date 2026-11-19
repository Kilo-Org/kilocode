import type { KiloAccount } from "@kilocode/gateway-core"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Schema } from "effect"
import { HostedError, invalid } from "./error"
import { createFork } from "./fork"
import { createSnapshotShare } from "./snapshot-share"
import { json, responseError } from "./transport"

export type Authorize = (target: KiloHostedRpc.Target, signal: AbortSignal) => Promise<string>
export type Issuer = (procedure: string, input: object, signal: AbortSignal, publish?: boolean) => Promise<unknown>
const Envelope = Schema.Struct({ result: Schema.Struct({ data: Schema.Unknown }) })

async function procedureData(response: Response) {
  if (!response.ok) return responseError(response)
  const envelope = await json(response, 2 * 1024 * 1024)
  if (!Schema.is(Envelope)(envelope) || !("data" in envelope.result)) return invalid()
  return envelope.result.data
}

export function createForkShare(
  account: KiloAccount.Info,
  issuer: string,
  remote: string,
  authorize: Authorize,
  worker: (path: string, init: RequestInit) => Promise<Response>,
) {
  const call: Issuer = async (procedure, input, signal, publish) => {
    if (publish && procedure !== "cliSessionsV2.share") throw new HostedError("Invalid Cloud procedure")
    const url = new URL(`/api/trpc/${procedure}`, issuer)
    const body = JSON.stringify(input)
    if (!publish) url.searchParams.set("input", body)
    return procedureData(
      await fetch(url, {
        method: publish ? "POST" : "GET",
        ...(publish && { body }),
        redirect: "error",
        credentials: "omit",
        cache: "no-store",
        headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
        signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
      }),
    )
  }
  return {
    fork: createFork(account.organizationID, remote, authorize, call, async (body, signal) =>
      procedureData(
        await worker("/trpc/continueHostedWorkspace", {
          method: "POST",
          body,
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
        }),
      ),
    ),
    ...createSnapshotShare(account.organizationID, issuer, authorize, call),
  }
}
