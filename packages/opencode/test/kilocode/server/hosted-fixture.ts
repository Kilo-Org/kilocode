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
  options: { attach?: Provider["attach"]; membership?: Provider["membership"]; route?: Provider["route"] } = {},
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
    listWorkspaceProfiles: () => Effect.succeed({ items: [] }),
    getWorkspace: () => Effect.fail(new HostedFailure({ code: "not_found", message: "not found", retryable: false })),
    getWorkspaceStatus: () =>
      Effect.fail(new HostedFailure({ code: "not_found", message: "not found", retryable: false })),
    deleteWorkspace: (input) => Effect.succeed({ workspace: input.id, success: true }),
    createWorkspace: () =>
      Effect.fail(
        new HostedFailure({ code: "invalid_request", message: "createWorkspace is not supported", retryable: false }),
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
