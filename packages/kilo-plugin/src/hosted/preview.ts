import type { KiloAccount } from "@kilocode/gateway-core"
import type { KiloHostedRpc } from "@opencode/schema/kilocode/hosted"
import { Schema } from "effect"
import { HostedError, invalid } from "./error"
import { json, responseError } from "./transport"

const Envelope = Schema.Struct({ result: Schema.Struct({ data: Schema.Unknown }) })
const Options = Schema.Union([
  Schema.Struct({ enabled: Schema.Literal(false) }),
  Schema.Struct({ enabled: Schema.Literal(true), urlTemplate: Schema.String.check(Schema.isMinLength(1)) }),
])
const Grant = Schema.Struct({ url: Schema.String.check(Schema.isMaxLength(8192)), expiresAt: Schema.Int })

export function createPreview(
  account: KiloAccount.Info,
  origins: { issuer: string; worker: string },
  authorize: (target: KiloHostedRpc.Target, signal: AbortSignal) => Promise<string>,
) {
  async function call(
    method: "getPreviewOptions" | "createPreview",
    workspace: string,
    signal: AbortSignal,
    port?: number,
    path?: string,
  ) {
    const org = account.organizationID
    const read = method === "getPreviewOptions"
    // The options query is shared. Ticket issuance uses a separate organization membership mutation.
    const prefix = !read && org ? "organizations.cloudAgentNext" : "cloudAgentNext"
    const url = new URL(`/api/trpc/${prefix}.${method}`, origins.issuer)
    const body = JSON.stringify({
      worktreeId: workspace,
      ...(org && { organizationId: org }),
      ...(port !== undefined && { port }),
      ...(path && { path }),
    })
    if (read) url.searchParams.set("input", body)
    const response = await fetch(url, {
      method: read ? "GET" : "POST",
      ...(read ? {} : { body }),
      headers: { Authorization: `Bearer ${account.token}`, "Content-Type": "application/json" },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    })
    if (!response.ok) return responseError(response)
    const result = await json(response, 64 * 1024)
    if (!Schema.is(Envelope)(result)) return invalid()
    return result.result.data
  }

  async function options(target: KiloHostedRpc.Target, signal: AbortSignal) {
    await authorize(target, signal)
    const result = await call("getPreviewOptions", target.workspaceID, signal)
    if (!Schema.is(Options)(result)) return invalid()
    return { enabled: result.enabled }
  }

  return {
    options,
    async open(target: KiloHostedRpc.Target, port: number, signal: AbortSignal, path?: string) {
      if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new HostedError("Invalid preview port.")
      if (path && (!path.startsWith("/") || path.startsWith("//") || path.includes("\\") || path.length > 2048))
        throw new HostedError("Invalid preview path.")
      if (!(await options(target, signal)).enabled) throw new HostedError("Cloud preview is unavailable.")
      const result = await call("createPreview", target.workspaceID, signal, port, path)
      if (!Schema.is(Grant)(result) || result.expiresAt * 1000 <= Date.now()) return invalid()
      // The display template is not an authorization. Only the trusted Worker's one-use entry URL may leave the plugin.
      const url = URL.parse(result.url)
      const token = url?.searchParams.get("ticket")
      if (!token || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) return invalid()
      const expected = new URL("/preview/open", origins.worker)
      expected.searchParams.set("ticket", token)
      if (path) expected.searchParams.set("path", path)
      if (expected.href !== result.url) return invalid()
      return { url: result.url }
    },
  }
}
