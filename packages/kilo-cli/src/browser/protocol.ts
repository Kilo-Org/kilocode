// Wire contract for the Kilo browser bridge (protocol v1).
// Both sides of the bridge are built from the spec in one place; every frame that
// crosses a process or WebSocket boundary is parsed by a schema in this module.
import z from "zod"

export const HostName = "ai.kilo.browser_host"
export const Protocol = 1
export const StoreExtensionId = "fpihhpdjnlhjpefblefklcegfmnmbmib"
export const FirefoxExtensionId = "browser-agent@kilo.ai"
export const StoreUrl = `https://chromewebstore.google.com/detail/${StoreExtensionId}`
export const DefaultPort = 47917

export const ExtensionId = z.string().regex(/^[a-p]{32}$/)

// The extension's self-description, reused as the `extension` field of hub.ready.
export const ExtensionInfo = z.object({
  protocol: z.array(z.number().int()).min(1),
  extensionVersion: z.string(),
  browser: z.object({ name: z.string(), version: z.string() }),
  profileLabel: z.string(),
  contractSha: z.string(),
  capabilities: z.object({
    trustedInput: z.boolean(),
    console: z.boolean(),
    network: z.boolean(),
    dialogs: z.boolean(),
    fileUpload: z.boolean(),
    tabGroups: z.boolean(),
  }),
})
export type ExtensionInfo = z.infer<typeof ExtensionInfo>

export const ExtHello = ExtensionInfo.extend({ type: z.literal("ext.hello") })
export type ExtHello = z.infer<typeof ExtHello>

const Id = z.union([z.string(), z.number()])

export const ErrorObject = z.object({
  code: z.number().int(),
  message: z.string(),
  data: z.unknown().optional(),
})
export type ErrorObject = z.infer<typeof ErrorObject>

export const Request = z.object({
  jsonrpc: z.literal("2.0"),
  id: Id,
  method: z.string(),
  params: z.unknown().optional(),
})
export type Request = z.infer<typeof Request>

export const Response = z.object({
  jsonrpc: z.literal("2.0"),
  id: Id,
  result: z.unknown().optional(),
  error: ErrorObject.optional(),
})
export type Response = z.infer<typeof Response>

export const Notification = z.object({
  jsonrpc: z.literal("2.0"),
  method: z.string(),
  params: z.unknown().optional(),
})
export type Notification = z.infer<typeof Notification>

export const Rpc = z.union([Request, Response, Notification])
export type Rpc = z.infer<typeof Rpc>

export const HubHello = z.object({
  type: z.literal("hub.hello"),
  protocol: z.array(z.number().int()).min(1),
  hubVersion: z.string(),
  mode: z.enum(["native", "loopback"]),
})
export type HubHello = z.infer<typeof HubHello>

export const ControllerConnected = z.object({
  type: z.literal("controller.connected"),
  controllerId: z.uuid(),
})
export const ControllerDisconnected = z.object({
  type: z.literal("controller.disconnected"),
  controllerId: z.uuid(),
})

// Hub -> extension and extension -> hub share one routed envelope; the direction is
// implied by the transport, not the frame.
export const Routed = z.object({
  type: z.literal("rpc"),
  controllerId: z.uuid(),
  message: Rpc,
})
export type Routed = z.infer<typeof Routed>

export const HubToExtension = z.discriminatedUnion("type", [
  HubHello,
  ControllerConnected,
  ControllerDisconnected,
  Routed,
])
export type HubToExtension = z.infer<typeof HubToExtension>

export const ExtensionToHub = z.discriminatedUnion("type", [ExtHello, Routed])
export type ExtensionToHub = z.infer<typeof ExtensionToHub>

export const HubReady = z.object({ type: z.literal("hub.ready"), extension: ExtensionInfo })
export const HubWaiting = z.object({ type: z.literal("hub.waiting") })
export const HubRouted = z.object({ type: z.literal("rpc"), message: Rpc })
export type HubRouted = z.infer<typeof HubRouted>

export const HubToCli = z.discriminatedUnion("type", [HubReady, HubWaiting, HubRouted])
export type HubToCli = z.infer<typeof HubToCli>

export const CliToHub = HubRouted
export type CliToHub = z.infer<typeof CliToHub>

// Loopback pairing frames (WebSocket text messages, before hub.hello).
export const Challenge = z.object({ type: z.literal("challenge"), nonceH: z.string() })
export type Challenge = z.infer<typeof Challenge>
export const Auth = z.object({
  type: z.literal("auth"),
  hubId: z.uuid(),
  nonceE: z.string(),
  mac: z.string(),
})
export type Auth = z.infer<typeof Auth>
export const AuthOk = z.object({ type: z.literal("auth_ok"), mac: z.string() })
export type AuthOk = z.infer<typeof AuthOk>

// Requests ---------------------------------------------------------------------

export const SessionOpen = z.object({
  sessionId: z.string(),
  title: z.string(),
  cwd: z.string(),
  cliVersion: z.string(),
})
export const SessionOpenResult = z.object({ sessionHandle: z.string(), groupId: z.string().optional() })
export const SessionHandle = z.object({ sessionHandle: z.string() })

export const Authorized = z.object({ class: z.string(), origin: z.string() })

export const ToolCall = z.object({
  sessionHandle: z.string(),
  name: z.string(),
  arguments: z.record(z.string(), z.unknown()),
  authorized: z.array(Authorized),
  sensitive: z.array(z.string()).optional(),
})

export const ToolContent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text"), text: z.string() }).loose(),
  z.object({ type: z.literal("image"), data: z.string(), mimeType: z.string() }).loose(),
  z.object({ type: z.literal("audio"), data: z.string(), mimeType: z.string() }).loose(),
  z.object({ type: z.literal("resource") }).loose(),
])

export const ResultMeta = z.object({
  url: z.string().optional(),
  origin: z.string().optional(),
  withheldFrames: z.array(z.string()).optional(),
  effectsUncertain: z.boolean().optional(),
  // Grants the result needs after the action ran. The CLI asks for them and never repeats the action.
  needs: z
    .array(
      z
        .object({
          class: z.string(),
          origin: z.string(),
          frame: z.boolean().optional(),
          reason: z.string().optional(),
        })
        .loose(),
    )
    .optional(),
})

export const ToolResult = z
  .object({
    content: z.array(ToolContent),
    isError: z.boolean().optional(),
    structuredContent: z.unknown().optional(),
    _meta: ResultMeta.optional(),
  })
  .loose()
export type ToolResult = z.infer<typeof ToolResult>

export const ToolsList = z.object({
  contractSha: z.string(),
  tools: z.array(z.object({ name: z.string(), inputSchema: z.unknown(), readOnly: z.boolean() })),
})
export type ToolsList = z.infer<typeof ToolsList>

export const MaxUploadChunk = 512 * 1024

export const UploadBegin = z.object({
  uploadId: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  mimeType: z.string(),
})
export const UploadChunk = z.object({
  uploadId: z.string(),
  index: z.number().int().nonnegative(),
  data: z.string().max(MaxUploadChunk),
})
export const UploadEnd = z.object({ uploadId: z.string() })
export const UploadResult = z.object({ uploadId: z.string() })

export const Requests = {
  "session.open": { params: SessionOpen, result: SessionOpenResult },
  "session.close": { params: SessionHandle, result: z.unknown() },
  "session.adopt": { params: SessionHandle, result: z.unknown() },
  "session.shareActiveTab": { params: SessionHandle, result: z.unknown() },
  "tools.list": { params: z.object({}).loose(), result: ToolsList },
  "tools.call": { params: ToolCall, result: ToolResult },
  "upload.begin": { params: UploadBegin, result: UploadResult },
  "upload.chunk": { params: UploadChunk, result: UploadResult },
  "upload.end": { params: UploadEnd, result: UploadResult },
} as const

export type Method = keyof typeof Requests
export type Params<M extends Method> = z.infer<(typeof Requests)[M]["params"]>
export type Result<M extends Method> = z.infer<(typeof Requests)[M]["result"]>

// Requests the hub answers itself, over the per-user CLI socket, and never forwards
// to the extension. The pairing URL carries a single-use token rather than the
// durable pairing key, because the opener's argv is visible to every local process;
// only a caller that reached this socket (a 0700 directory) may mint one.
export const HubRequests = {
  "pairing.url": { params: z.object({}).loose(), result: z.object({ url: z.string() }) },
} as const

export type HubMethod = keyof typeof HubRequests
export type HubResult<M extends HubMethod> = z.infer<(typeof HubRequests)[M]["result"]>

export const Notifications = {
  "tab.closed": z.object({ sessionHandle: z.string(), tabId: z.number().int() }),
  "session.revoked": z.object({
    sessionHandle: z.string(),
    reason: z.enum(["user_stop", "switch_off", "disconnect"]),
  }),
  "tab.taken": z.object({ sessionHandle: z.string(), tabId: z.number().int() }),
} as const

export type NotificationMethod = keyof typeof Notifications
export type NotificationParams<M extends NotificationMethod> = z.infer<(typeof Notifications)[M]>

// Errors -----------------------------------------------------------------------

export const ErrorCodes = {
  browser_unavailable: -32001,
  tab_busy: -32002,
  tab_taken: -32003,
  user_stopped: -32004,
  unsupported_in_browser: -32005,
  needs_permission: -32010,
  blocked: -32011,
  origin_changed: -32012,
  protocol_mismatch: -32020,
} as const

export type ErrorName = keyof typeof ErrorCodes

// One cast, at the point where the table's own keys are turned into names.
const names = new Map<number, ErrorName>(
  (Object.keys(ErrorCodes) as ErrorName[]).map((name) => [ErrorCodes[name], name]),
)

const Retryable: Partial<Record<ErrorName, true>> = { tab_busy: true, tab_taken: true }
// These are retried by the caller after it asks for a grant, not by transport backoff.
const AfterAsk: Partial<Record<ErrorName, true>> = { needs_permission: true, origin_changed: true }

export function errorName(code: number) {
  return names.get(code)
}

export function retryable(code: number): boolean {
  const name = errorName(code)
  return name !== undefined && Retryable[name] === true
}

export function afterAsk(code: number): boolean {
  const name = errorName(code)
  return name !== undefined && AfterAsk[name] === true
}

export function failure(id: Request["id"], name: ErrorName, message: string, data?: unknown): Response {
  return { jsonrpc: "2.0", id, error: { code: ErrorCodes[name], message, data } }
}

export function isRequest(message: Rpc): message is Request {
  return "method" in message && "id" in message
}

export function isResponse(message: Rpc): message is Response {
  return "id" in message && !("method" in message)
}

export function isNotification(message: Rpc): message is Notification {
  return "method" in message && !("id" in message)
}

// A JSON-RPC object with no id and no method is malformed for our purposes.
export function valid(message: Rpc): boolean {
  if (isResponse(message)) return message.error !== undefined || "result" in message
  return true
}
