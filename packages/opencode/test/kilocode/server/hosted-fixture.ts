import {
  HostedFailure,
  ProviderID,
  type Attachment,
  type AttachInput,
  type NativeRequest,
  type Provider,
} from "../../../src/kilocode/session-hosting/types"
import { Effect, Schema } from "effect"

export function provider(
  id: string,
  options: {
    attach?: Provider["attach"]
    membership?: Provider["membership"]
    route?: Provider["route"]
    getWorkspacePullRequest?: Provider["getWorkspacePullRequest"]
    refreshWorkspacePullRequest?: Provider["refreshWorkspacePullRequest"]
  } = {},
) {
  const calls: NativeRequest[] = []
  const value: Provider = {
    id: Schema.decodeUnknownSync(ProviderID)(id),
    availability: Effect.succeed({ state: "available" }),
    transport: Effect.succeed({ state: "unknown" }),
    list: () => Effect.succeed({ items: [] }),
    get: () => Effect.fail(new HostedFailure({ code: "not_found", message: "not found", retryable: false })),
    transcript: () => Effect.succeed({ items: [] }),
    start: () =>
      Effect.fail(new HostedFailure({ code: "invalid_request", message: "start is not supported", retryable: false })),
    listWorkspaces: () => Effect.succeed({ items: [] }),
    listWorkspaceProfiles: () =>
      Effect.succeed({
        personalProfiles: [],
        organizationProfiles: [],
        personalDefaultProfileID: null,
        organizationDefaultProfileID: null,
        effectiveDefaultProfileID: null,
      }),
    setWorkspacePersonalDefaultProfile: () => Effect.succeed({ success: true }),
    clearWorkspacePersonalDefaultProfile: () => Effect.succeed({ success: true }),
    getWorkspace: () => Effect.fail(new HostedFailure({ code: "not_found", message: "not found", retryable: false })),
    getWorkspaceStatus: () =>
      Effect.fail(new HostedFailure({ code: "not_found", message: "not found", retryable: false })),
    ...(options.getWorkspacePullRequest ? { getWorkspacePullRequest: options.getWorkspacePullRequest } : {}),
    ...(options.refreshWorkspacePullRequest
      ? { refreshWorkspacePullRequest: options.refreshWorkspacePullRequest }
      : {}),
    getWorkspaceChanges: (input) =>
      Effect.succeed({
        id: input.id,
        status: "not_captured",
        revision: null,
        capturedAt: null,
        truncated: false,
        comparisons: null,
      }),
    refreshWorkspaceChanges: (input) =>
      Effect.succeed({
        status: "failed",
        changes: {
          id: input.id,
          status: "not_captured",
          revision: null,
          capturedAt: null,
          truncated: false,
          comparisons: null,
        },
      }),
    getWorkspaceChangeFile: () =>
      Effect.succeed({
        status: "not_captured",
        file: null,
        capturedAt: null,
        comparison: null,
        currentRevision: null,
      }),
    getWorkspacePullRequestDiff: (input) =>
      Effect.succeed({
        id: input.id,
        status: "not_linked",
        reason: "no_pull_request",
        pullRequest: null,
        truncated: false,
        files: [],
      }),
    getWorkspacePullRequestDiffFile: (input) =>
      Effect.succeed({
        status: "not_linked",
        path: input.path,
        reason: "no_pull_request",
        omissionReason: null,
        headSha: null,
        patch: null,
      }),
    deleteWorkspace: (input) => Effect.succeed({ workspace: input.id, success: true }),
    createWorkspace: () =>
      Effect.fail(
        new HostedFailure({ code: "invalid_request", message: "createWorkspace is not supported", retryable: false }),
      ),
    continueWorkspace: () =>
      Effect.fail(
        new HostedFailure({ code: "invalid_request", message: "continueWorkspace is not supported", retryable: false }),
      ),
    startWorkspaceSession: () =>
      Effect.fail(
        new HostedFailure({
          code: "invalid_request",
          message: "startWorkspaceSession is not supported",
          retryable: false,
        }),
      ),
    attach:
      options.attach ??
      ((input: AttachInput): Effect.Effect<Attachment> =>
        Effect.succeed({ session: input.id, expiresAt: Date.now() + 60_000 })),
    ...(options.membership === undefined ? {} : { membership: options.membership }),
    ...(options.route === undefined
      ? {
          route: (input: NativeRequest) => {
            calls.push(input)
            return Effect.succeed(
              Response.json(
                { ok: true, path: input.path },
                { status: 200, headers: { "content-type": "application/json" } },
              ),
            )
          },
        }
      : { route: options.route }),
  }
  return { value, calls }
}

export function hosted(providerID: string, sessionID: string) {
  return { providerID: Schema.decodeUnknownSync(ProviderID)(providerID), sessionID }
}
