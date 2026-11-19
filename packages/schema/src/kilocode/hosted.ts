export * as KiloHostedRpc from "./hosted.js"

import { Schema } from "effect"
import { Rpc } from "../rpc.js"
import { optional } from "../schema.js"
import { SessionMessage } from "../session-message.js"
import { HostedReview } from "./hosted-review.js"
import { HostedManagement } from "./hosted-management.js"
import { HostedAttachments } from "./hosted-attachments.js"

const text = (max: number) => Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(max))
const id = text(255).check(Schema.isPattern(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]*$/))
const scope = text(128)
const cursor = text(4096)
const uuid = Schema.String.check(Schema.isUUID())
const messageID = id.check(Schema.isPattern(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/))
const prompt = text(100_000)
const empty = Schema.Struct({})
const portable = Schema.toStandardSchemaV1
const method = <I extends Schema.ConstraintDecoder<unknown>, O extends Schema.ConstraintDecoder<unknown>>(
  input: I,
  output: O,
) => ({
  input: portable(input),
  output: portable(output),
  errors: { HostedError: portable(Schema.Undefined), HostedPreparing: portable(Schema.Undefined) },
})

export interface Status extends Schema.Schema.Type<typeof Status> {}
export const Status = Schema.Struct({
  state: Schema.Literals(["ready", "signed_out", "unsupported", "no_repository", "starting"]),
  restoreKey: optional(Schema.String),
  scope: optional(scope),
  repository: optional(Schema.String),
}).annotate({ identifier: "KiloHosted.Status" })

/** The scope belongs to the server Location, active account, team and repository. Never a native local session ID. */
export interface Target extends Schema.Schema.Type<typeof Target> {}
export const Target = Schema.Struct({
  scope,
  providerID: Schema.Literal("kilo-cloud"),
  workspaceID: id,
  sessionID: id,
}).annotate({ identifier: "KiloHosted.Target" })
export interface Workspace extends Schema.Schema.Type<typeof Workspace> {}
export const Workspace = Schema.Struct({
  workspaceID: id,
  name: optional(Schema.String),
  branch: optional(Schema.String),
  deletionState: Schema.Literals(["active", "deleting", "deleted"]),
  sessions: Schema.Array(Schema.Struct({ sessionID: id, title: optional(Schema.String) })),
  cursor: optional(cursor),
}).annotate({ identifier: "KiloHosted.Workspace" })

const agent = Schema.Struct({ mode: text(50), model: text(255), variant: optional(text(50)) })
const operation = { scope, agent, operationKey: uuid }
export interface Create extends Schema.Schema.Type<typeof Create> {}
export const Create = Schema.Struct({
  ...operation,
  profileID: optional(uuid),
  branch: optional(text(255).check(Schema.isPattern(/^(?!-)[^\s\x00-\x1f\x7f]+$/))),
  messageID: optional(messageID),
  prompt: optional(Schema.String.check(Schema.isMaxLength(100_000))),
  attachments: optional(HostedAttachments.Handles),
})
  .check(
    Schema.makeFilter(
      (input) =>
        ((input.prompt === undefined) === (input.messageID === undefined) &&
          (input.attachments ? input.messageID !== undefined : input.prompt !== "")) ||
        "Supply both prompt and messageID",
    ),
  )
  .annotate({ identifier: "KiloHosted.Create" })
export interface Start extends Schema.Schema.Type<typeof Start> {}
export const Start = Schema.Struct({
  ...operation,
  workspaceID: id,
  messageID,
  prompt,
  attachments: optional(Schema.Never),
}).annotate({
  identifier: "KiloHosted.Start",
})
const created = Schema.Struct({ target: Target, replayed: Schema.Boolean })
const profile = Schema.Struct({ id, name: Schema.String, owner: Schema.Literals(["personal", "organization"]) })

/** The transcript is native session data, with timestamps on the wire in epoch milliseconds. */
export const Message = Schema.toEncoded(
  Schema.Union([SessionMessage.User, SessionMessage.Assistant, SessionMessage.Idle]),
).annotate({ identifier: "KiloHosted.Message" })
export type Message = typeof Message.Type
export const Stage = Schema.Literals([
  "disk_check",
  "workspace_setup",
  "cloning",
  "branch",
  "devcontainer_setup",
  "setup_commands",
  "session_setup_commands",
  "start_commands",
  "sandbox_provision",
  "sandbox_boot",
  "kilo_server",
  "kilo_session",
  "ready",
  "failed",
]).annotate({ identifier: "KiloHosted.Stage" })
export type Stage = typeof Stage.Type
const stepStatus = Schema.Literals(["running", "completed", "failed"])
export interface Progress extends Schema.Schema.Type<typeof Progress> {}
export const Progress = Schema.Struct({
  phase: optional(Schema.Literals(["preparing", "ready", "finalizing", "error"])),
  step: optional(Stage),
  sandbox: optional(Schema.Literals(["active", "sleeping", "starting", "stopping", "error", "unreachable", "unknown"])),
  preparation: optional(stepStatus),
  steps: Schema.Array(Schema.Struct({ step: Stage, status: stepStatus })).check(Schema.isMaxLength(14)),
}).annotate({ identifier: "KiloHosted.Progress" })
export interface Question extends Schema.Schema.Type<typeof Question> {}
export const Question = Schema.Struct({
  id,
  questions: Schema.Array(
    Schema.Struct({
      header: Schema.String,
      question: Schema.String,
      multiple: Schema.Boolean,
      custom: Schema.Boolean,
      options: Schema.Array(Schema.Struct({ label: Schema.String, description: Schema.String })),
    }),
  ),
}).annotate({ identifier: "KiloHosted.Question" })
export interface Permission extends Schema.Schema.Type<typeof Permission> {}
export const Permission = Schema.Struct({
  id,
  permission: Schema.String,
  patterns: Schema.Array(Schema.String),
}).annotate({ identifier: "KiloHosted.Permission" })
export interface Snapshot extends Schema.Schema.Type<typeof Snapshot> {}
export const Snapshot = Schema.Struct({
  connection: Schema.Literals(["connecting", "preparing", "live", "sleeping", "disconnected"]),
  error: optional(Schema.String),
  progress: optional(Progress),
  queued: optional(Schema.Array(messageID)),
  status: Schema.Literals(["idle", "busy", "retry", "unknown"]),
  messages: Schema.Array(Message),
  before: optional(cursor),
  questions: Schema.Array(Question),
  permissions: Schema.Array(Permission),
}).annotate({ identifier: "KiloHosted.Snapshot" })

const terminal = { target: Target, handle: uuid }
const dimensions = {
  cols: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 1000 })),
  rows: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 500 })),
}
const attached = { target: Target, attachmentID: id }
const read = Schema.Struct(attached)
export const CommandCatalog = Schema.Array(
  Schema.Struct({
    name: text(128),
    description: optional(text(4096)),
    hints: optional(Schema.Array(text(256)).check(Schema.isMaxLength(64))),
  }),
).check(Schema.isMaxLength(1024))
const revision = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const Definition = Rpc.define({
  id: "kilocode.hosted",
  methods: {
    forkSession: method(Schema.Struct({ target: Target, operationKey: uuid }), created),
    snapshotOptions: method(
      Schema.Struct({ target: Target }),
      Schema.Union([
        Schema.Struct({ available: Schema.Literal(false) }),
        Schema.Struct({ available: Schema.Literal(true), confirmation: uuid }),
      ]),
    ),
    publishSnapshot: method(Schema.Struct({ target: Target, confirmation: uuid }), Schema.Struct({ url: text(8192) })),
    previewOptions: method(Schema.Struct({ target: Target }), Schema.Struct({ enabled: Schema.Boolean })),
    openPreview: method(
      Schema.Struct({
        target: Target,
        port: Schema.Int.check(Schema.isBetween({ minimum: 1024, maximum: 65535 })),
        path: optional(text(2048)),
      }),
      Schema.Struct({ url: text(8192) }),
    ),
    stageImage: method(
      Schema.Struct({ scope, messageID, image: HostedAttachments.Image }),
      Schema.Struct({ handle: uuid }),
    ),
    sessionInfo: method(Schema.Struct({ target: Target }), HostedManagement.Info),
    renameSession: method(
      Schema.Struct({ target: Target, title: HostedManagement.Title }),
      Schema.Struct({ title: HostedManagement.Title }),
    ),
    deleteSession: method(Schema.Struct({ target: Target, operationKey: uuid }), HostedManagement.Deleted),
    reviewChanges: method(Schema.Struct({ target: Target, refresh: optional(Schema.Boolean) }), HostedReview.Changes),
    reviewFile: method(Schema.Struct({ target: Target, selection: HostedReview.Selection }), HostedReview.File),
    reviewDestinations: method(
      Schema.Struct({ target: Target }),
      Schema.Struct({
        draftKey: optional(Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/))),
        items: Schema.Array(Schema.Struct({ sessionID: id, title: Schema.String })),
      }),
    ),
    sendReview: method(
      Schema.Struct({ target: Target, destinationID: id, messageID, draft: HostedReview.Draft }),
      HostedReview.Delivery,
    ),
    reviewDelivery: method(Schema.Struct({ target: Target, destinationID: id, messageID }), HostedReview.Delivery),
    terminalOpen: method(Schema.Struct({ target: Target, ...dimensions }), Schema.Struct({ handle: uuid })),
    terminalRead: method(
      Schema.Struct(terminal),
      Schema.Struct({
        state: Schema.Literals(["connecting", "open", "closed"]),
        frames: Schema.Array(Schema.Struct({ binary: Schema.Boolean, data: Schema.String })),
      }),
    ),
    terminalWrite: method(Schema.Struct({ ...terminal, data: text(65536) }), empty),
    terminalResize: method(Schema.Struct({ ...terminal, ...dimensions }), empty),
    terminalClose: method(Schema.Struct(terminal), empty),
    status: method(empty, Status),
    list: method(
      Schema.Struct({ scope, cursor: optional(cursor) }),
      Schema.Struct({ items: Schema.Array(Workspace), cursor: optional(cursor) }),
    ),
    workspace: method(Schema.Struct({ scope, workspaceID: id, cursor: optional(cursor) }), Workspace),
    profiles: method(
      Schema.Struct({ scope }),
      Schema.Struct({ items: Schema.Array(profile), effectiveDefaultProfileID: optional(id) }),
    ),
    create: method(Create, created),
    start: method(Start, created),
    attach: method(Schema.Struct({ target: Target }), Schema.Struct({ attachmentID: id })),
    childHistory: method(
      Schema.Struct({ ...attached, childID: id, before: optional(cursor) }),
      Schema.Struct({ messages: Schema.Array(Message), before: optional(cursor) }),
    ),
    read: method(
      Schema.Struct({ ...attached, revision: optional(revision), incremental: optional(Schema.Boolean) }),
      Schema.Struct({ revision, snapshot: optional(Snapshot), order: optional(Schema.Array(id)) }),
    ),
    history: method(
      Schema.Struct({ ...attached, before: cursor }),
      Schema.Struct({ messages: Schema.Array(Message), before: optional(cursor) }),
    ),
    prompt: method(
      Schema.Struct({
        ...attached,
        messageID,
        text: Schema.String.check(Schema.isMaxLength(100_000)),
        agent: optional(text(50)),
        model: optional(text(255)),
        attachments: optional(HostedAttachments.Handles),
      }).check(
        Schema.makeFilter((input) => !!input.text.trim() || !!input.attachments || "A message or image is required"),
      ),
      empty,
    ),
    interrupt: method(read, empty),
    command: method(
      Schema.Struct({
        ...attached,
        messageID,
        command: text(128),
        arguments: Schema.String.check(Schema.isMaxLength(100_000)),
        agent: optional(text(50)),
        model: optional(text(255)),
      }),
      empty,
    ),
    commands: method(Schema.Struct({ target: Target }), Schema.Struct({ commands: CommandCatalog })),
    cancelQueued: method(Schema.Struct({ target: Target, messageID }), Schema.Struct({ dropped: Schema.Boolean })),
    replyQuestion: method(
      Schema.Struct({
        ...attached,
        requestID: id,
        answers: Schema.Array(Schema.Array(text(4096)).check(Schema.isMaxLength(100))).check(Schema.isMaxLength(100)),
      }),
      empty,
    ),
    rejectQuestion: method(Schema.Struct({ ...attached, requestID: id }), empty),
    replyPermission: method(
      Schema.Struct({ ...attached, requestID: id, reply: Schema.Literals(["once", "always", "reject"]) }),
      empty,
    ),
    detach: method(read, empty),
  },
  events: { changed: { schema: portable(empty) } },
})
