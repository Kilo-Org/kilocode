import { ID as AttachmentID } from "@/kilocode/server/hosted-attachments"
import {
  Availability,
  HostedSession,
  HostedSessionID,
  HostedSessionPage,
  HostedTranscriptPage,
  HostedWorkspaceID,
  HostedWorkspaceSessionID,
  OrganizationID,
  ProviderID,
  RemoteSessionID,
  StartInput,
  StartResult,
  Transport,
  OperationKey,
  Workspace,
  WorkspaceAgent,
  WorkspaceCreateInput,
  WorkspaceCreateResult,
  WorkspaceDeleteResult,
  WorkspaceID,
  WorkspacePage,
  WorkspaceProfilePage,
  WorkspaceSessionCreateResult,
  WorkspaceSessionPage,
  WorkspaceStatus,
} from "@/kilocode/session-hosting/types"
import { described } from "@/server/routes/instance/httpapi/groups/metadata"
import {
  ApiNotFoundError,
  ConflictError,
  InvalidRequestError,
  ServiceUnavailableError,
  UnauthorizedError,
  UpstreamError,
} from "@/server/routes/instance/httpapi/errors"
import { Authorization } from "@/server/routes/instance/httpapi/middleware/authorization"
import { Schema } from "effect"
import { HttpApi, HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

const root = "/kilocode/session-host"

export const SessionHostPaths = {
  provider: `${root}/provider`,
  session: `${root}/session`,
  sessionDetail: `${root}/session/:providerID/:sessionID`,
  message: `${root}/session/:providerID/:sessionID/message`,
  attach: `${root}/session/:providerID/:sessionID/attach`,
  attachment: `${root}/attachment/:attachmentID`,
  workspace: `${root}/workspace`,
  workspaceProfiles: `${root}/workspace/profiles`,
  workspaceDetail: `${root}/workspace/:providerID/:workspaceID`,
  workspaceStatus: `${root}/workspace/:providerID/:workspaceID/status`,
  workspaceSessions: `${root}/workspace/:providerID/:workspaceID/session`,
  workspaceSessionAttach: `${root}/workspace/:providerID/:workspaceID/session/:remoteSessionID/attach`,
} as const

export class SessionHostPaymentRequiredError extends Schema.ErrorClass<SessionHostPaymentRequiredError>(
  "SessionHostPaymentRequiredError",
)({ code: Schema.String, message: Schema.String }, { httpApiStatus: 402 }) {}

export class SessionHostGoneError extends Schema.ErrorClass<SessionHostGoneError>("SessionHostGoneError")(
  { code: Schema.String, message: Schema.String },
  { httpApiStatus: 410 },
) {}

export const SessionHostProviderStatus = Schema.Struct({
  id: ProviderID,
  default: Schema.Boolean,
  availability: Availability,
  transport: Transport,
}).annotate({ identifier: "SessionHostProviderStatus" })

export const SessionHostProviders = Schema.Struct({
  providers: Schema.Array(SessionHostProviderStatus),
}).annotate({ identifier: "SessionHostProviders" })

export const SessionHostAttached = Schema.Struct({
  attachmentID: AttachmentID,
  session: HostedSessionID,
  expiresAt: Schema.Finite,
}).annotate({ identifier: "SessionHostAttached" })

export const SessionHostWorkspaceAttached = Schema.Struct({
  attachmentID: AttachmentID,
  workspace: HostedWorkspaceID,
  session: HostedWorkspaceSessionID,
  expiresAt: Schema.Finite,
}).annotate({ identifier: "SessionHostWorkspaceAttached" })

export const SessionHostDetached = Schema.Struct({ detached: Schema.Boolean }).annotate({
  identifier: "SessionHostDetached",
})

const SessionErrors = [
  InvalidRequestError,
  ApiNotFoundError,
  UnauthorizedError,
  ConflictError,
  UpstreamError,
  ServiceUnavailableError,
  SessionHostPaymentRequiredError,
] as const

const ListQuery = Schema.Struct({
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
})

const TranscriptQuery = Schema.Struct({
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
  before: Schema.optional(Schema.String),
})

const AttachQuery = Schema.Struct({ organizationID: Schema.optional(OrganizationID) })

const WorkspaceListQuery = Schema.Struct({
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 50 })),
  ),
  sessionLimit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  repositoryUrl: Schema.optional(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(2048))),
  organizationID: Schema.optional(OrganizationID),
})

const WorkspaceDetailQuery = Schema.Struct({
  sessionLimit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
  sessionCursor: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  organizationID: Schema.optional(OrganizationID),
})

const WorkspaceStatusQuery = Schema.Struct({ organizationID: Schema.optional(OrganizationID) })

const WorkspaceSessionListQuery = Schema.Struct({
  limit: Schema.optional(
    Schema.NumberFromString.check(Schema.isInt(), Schema.isBetween({ minimum: 1, maximum: 100 })),
  ),
  cursor: Schema.optional(Schema.String.check(Schema.isMaxLength(256))),
  organizationID: Schema.optional(OrganizationID),
})

const WorkspaceAttachQuery = Schema.Struct({ organizationID: Schema.optional(OrganizationID) })

const WorkspaceProfilesQuery = Schema.Struct({ organizationID: Schema.optional(OrganizationID) })

const WorkspaceSessionCreateBody = Schema.Struct({
  prompt: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(100_000)),
  agent: WorkspaceAgent,
  organizationID: Schema.optional(OrganizationID),
  operationKey: OperationKey,
  messageID: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(255)),
}).annotate({ identifier: "SessionHostWorkspaceSessionCreateBody" })

const Params = {
  providerID: ProviderID,
  sessionID: RemoteSessionID,
}

const WorkspaceParams = {
  providerID: ProviderID,
  workspaceID: WorkspaceID,
}

const WorkspaceSessionParams = {
  ...WorkspaceParams,
  remoteSessionID: RemoteSessionID,
}

/**
 * Local control-plane surface for hosted sessions.
 *
 * These endpoints intentionally carry only the Authorization middleware: they
 * are local hosting/transcript operations and must never be classified as a
 * routed attachment, even when the client has an attachment selector
 * configured globally.
 */
export const SessionHostApi = HttpApi.make("session-host")
  .add(
    HttpApiGroup.make("session-host")
      .add(
        HttpApiEndpoint.get("providers", SessionHostPaths.provider, {
          success: described(SessionHostProviders, "Registered session host providers"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.providers",
            summary: "List session host providers",
            description: "Report every registered session host provider with its availability and transport state.",
          }),
        ),
        HttpApiEndpoint.get("list", SessionHostPaths.session, {
          query: ListQuery,
          success: described(HostedSessionPage, "Hosted sessions"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.list",
            summary: "List hosted sessions",
            description: "List sessions from the authenticated default session host provider.",
          }),
        ),
        HttpApiEndpoint.post("start", SessionHostPaths.session, {
          payload: StartInput,
          success: described(StartResult, "Hosted session started"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.start",
            summary: "Start a hosted session",
            description:
              "Start a hosted session and deliver the initial message. Reuse the same operation key and message ID to retry safely.",
          }),
        ),
        HttpApiEndpoint.get("get", SessionHostPaths.sessionDetail, {
          params: Params,
          success: described(HostedSession, "Hosted session"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.get",
            summary: "Get a hosted session",
            description: "Read a hosted session's normalized native detail without waking compute.",
          }),
        ),
        HttpApiEndpoint.get("transcript", SessionHostPaths.message, {
          params: Params,
          query: TranscriptQuery,
          success: described(HostedTranscriptPage, "Hosted transcript page"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.transcript",
            summary: "Read a hosted transcript",
            description: "Read a bounded page of a hosted session transcript without waking compute.",
          }),
        ),
        HttpApiEndpoint.post("attach", SessionHostPaths.attach, {
          params: Params,
          query: AttachQuery,
          success: described(SessionHostAttached, "Hosted session attached"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.attach",
            summary: "Attach to a hosted session",
            description:
              "Mint an opaque local attachment that routes the proven native API for one hosted session. No provider origin, credential, or selector is exposed.",
          }),
        ),
        HttpApiEndpoint.delete("detach", SessionHostPaths.attachment, {
          params: { attachmentID: Schema.String },
          success: described(SessionHostDetached, "Attachment disposed"),
          error: [...SessionErrors, SessionHostGoneError],
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.detach",
            summary: "Detach a hosted session",
            description: "Dispose a local attachment. This never changes Cloud lifecycle.",
          }),
        ),
        HttpApiEndpoint.get("workspaces", SessionHostPaths.workspace, {
          query: WorkspaceListQuery,
          success: described(WorkspacePage, "Hosted workspaces"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.workspaces",
            summary: "List hosted workspaces",
            description: "List durable hosted workspaces with their nested root sessions without waking compute.",
          }),
        ),
        HttpApiEndpoint.get("workspaceProfiles", SessionHostPaths.workspaceProfiles, {
          query: WorkspaceProfilesQuery,
          success: described(WorkspaceProfilePage, "Authorized workspace profiles"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.workspaceProfiles",
            summary: "List workspace creation profiles",
            description:
              "List authorized profile summaries for workspace creation. Secret and environment values are never returned.",
          }),
        ),
        HttpApiEndpoint.get("workspace", SessionHostPaths.workspaceDetail, {
          params: WorkspaceParams,
          query: WorkspaceDetailQuery,
          success: described(Workspace, "Hosted workspace"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.workspace",
            summary: "Get a hosted workspace",
            description: "Read one hosted workspace, its metadata, and a page of its nested root sessions.",
          }),
        ),
        HttpApiEndpoint.get("workspaceStatus", SessionHostPaths.workspaceStatus, {
          params: WorkspaceParams,
          query: WorkspaceStatusQuery,
          success: described(WorkspaceStatus, "Hosted workspace status"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.workspaceStatus",
            summary: "Read hosted workspace status",
            description:
              "Read passive compute, activity, wake, billing, and deletion progress without waking compute.",
          }),
        ),
        HttpApiEndpoint.get("workspaceSessions", SessionHostPaths.workspaceSessions, {
          params: WorkspaceParams,
          query: WorkspaceSessionListQuery,
          success: described(WorkspaceSessionPage, "Hosted workspace sessions"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.workspaceSessions",
            summary: "List hosted workspace sessions",
            description: "List a page of root sessions in one hosted workspace.",
          }),
        ),
        HttpApiEndpoint.post("createWorkspace", SessionHostPaths.workspace, {
          payload: WorkspaceCreateInput,
          success: described(WorkspaceCreateResult, "Hosted workspace created"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.createWorkspace",
            summary: "Create a hosted workspace",
            description:
              "Create a hosted workspace and its first root session. Reuse the same operation key and message ID to retry safely.",
          }),
        ),
        HttpApiEndpoint.delete("deleteWorkspace", SessionHostPaths.workspaceDetail, {
          params: WorkspaceParams,
          query: WorkspaceStatusQuery,
          success: described(WorkspaceDeleteResult, "Hosted workspace deleted"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.deleteWorkspace",
            summary: "Delete a hosted workspace",
            description:
              "Destructively delete a hosted workspace and every remaining root session. Progress is available from the workspace status route.",
          }),
        ),
        HttpApiEndpoint.post("createWorkspaceSession", SessionHostPaths.workspaceSessions, {
          params: WorkspaceParams,
          payload: WorkspaceSessionCreateBody,
          success: described(WorkspaceSessionCreateResult, "Hosted workspace session created"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.createWorkspaceSession",
            summary: "Create a session in a hosted workspace",
            description:
              "Create a root session in an existing hosted workspace, inheriting its repository, ref, profile, and environment.",
          }),
        ),
        HttpApiEndpoint.post("attachWorkspaceSession", SessionHostPaths.workspaceSessionAttach, {
          params: WorkspaceSessionParams,
          query: WorkspaceAttachQuery,
          success: described(SessionHostWorkspaceAttached, "Hosted workspace session attached"),
          error: SessionErrors,
        }).annotateMerge(
          OpenApi.annotations({
            identifier: "sessionHost.attachWorkspaceSession",
            summary: "Attach to a hosted workspace session",
            description:
              "Mint an opaque local attachment scoped to one hosted workspace session. No provider origin, credential, or selector is exposed.",
          }),
        ),
      )
      .annotateMerge(
        OpenApi.annotations({
          title: "session-host",
          description: "Kilo hosted session control routes.",
        }),
      )
      .middleware(Authorization),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "kilo HttpApi",
      version: "0.0.1",
      description: "Kilo HttpApi surface.",
    }),
  )
