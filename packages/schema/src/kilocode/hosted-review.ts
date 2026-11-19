export * as HostedReview from "./hosted-review.js"

import { Schema } from "effect"
import { optional } from "../schema.js"

const path = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4096),
  Schema.makeFilter(
    (s) =>
      (!/[\x00-\x1f\x7f\\]/.test(s) &&
        !/^[A-Za-z]:/.test(s) &&
        s.split("/").every((p) => p !== "" && p !== "." && p !== "..")) ||
      "Expected a repository-relative path",
  ),
)
const revision = Schema.Int.check(Schema.isGreaterThan(0))
const scope = optional(Schema.Literals(["uncommitted", "against-base-branch"]))
const commit = Schema.String.check(Schema.isPattern(/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/))
const ref = Schema.String.check(Schema.isPattern(/^(?!-)[^\0]{1,1024}$/))
export const Comparison = Schema.Struct({
  baseRef: ref,
  head: commit,
  mergeBase: commit,
  baseRefFallback: optional(Schema.Struct({ requested: ref, used: ref })),
})
export const Selection = Schema.Struct({ path, scope, revision })
export interface Selection extends Schema.Schema.Type<typeof Selection> {}
const count = Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))
export const Entry = Schema.Struct({
  ...Selection.fields,
  status: Schema.Literals(["added", "modified", "deleted"]),
  additions: count,
  deletions: count,
  binary: Schema.Boolean,
  countsComplete: Schema.Boolean,
})
export interface Entry extends Schema.Schema.Type<typeof Entry> {}
export const Snapshot = Schema.Struct({
  comparison: optional(Comparison),
  revision,
  capturedAt: Schema.String.check(Schema.isMaxLength(64)),
  truncated: Schema.Boolean,
  files: Schema.Array(Entry).check(Schema.isMaxLength(1000)),
})
export const Changes = Schema.Struct({
  snapshot: Schema.NullOr(Snapshot),
  refresh: optional(Schema.Literals(["refreshed", "offline", "failed"])),
})
export interface Changes extends Schema.Schema.Type<typeof Changes> {}
const reason = Schema.Literals([
  "binary",
  "unsupported",
  "invalid_utf8",
  "too_large",
  "line_limit",
  "budget_exhausted",
  "inconsistent",
  "capture_failed",
])
export const Record = Schema.Struct({
  ...Selection.fields,
  patchHash: optional(Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/))),
  diff: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("available"),
      patch: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(512 * 1024)),
    }),
    Schema.Struct({ status: Schema.Literal("omitted"), reason }),
  ]),
  content: Schema.Union([
    Schema.Struct({
      status: Schema.Literal("available"),
      source: Schema.Literals(["current", "deleted-original"]),
      text: Schema.String.check(Schema.isMaxLength(100 * 1024)),
    }),
    Schema.Struct({ status: Schema.Literal("unavailable"), reason }),
  ]),
})
export const File = Schema.Union([
  Schema.Struct({ status: Schema.Literals(["available", "omitted"]), file: Record }),
  Schema.Struct({ status: Schema.Literals(["stale", "no_longer_listed"]), currentRevision: revision }),
  Schema.Struct({ status: Schema.Literal("not_captured") }),
])
export type File = typeof File.Type

const feedback = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(4000),
  Schema.makeFilter((s) => !!s.trim()),
)
export const Comment = Schema.Struct({
  ...Selection.fields,
  id: Schema.String.check(Schema.isUUID()),
  comparison: Comparison,
  patchHash: Schema.String.check(Schema.isPattern(/^[a-f0-9]{64}$/)),
  side: Schema.Literals(["deletions", "additions"]),
  start: revision,
  end: revision,
  text: feedback,
})
export interface Comment extends Schema.Schema.Type<typeof Comment> {}
export const Draft = Schema.Struct({
  comments: Schema.Array(Comment).check(Schema.isMinLength(1), Schema.isMaxLength(50)),
  overall: optional(feedback),
})
export interface Draft extends Schema.Schema.Type<typeof Draft> {}
export const Delivery = Schema.Struct({ status: Schema.Literals(["accepted", "unverified", "rejected", "unknown"]) })
export interface Delivery extends Schema.Schema.Type<typeof Delivery> {}
const saved = Schema.Struct({
  comments: Schema.Array(Comment).check(Schema.isMaxLength(50)),
  overall: Schema.String.check(Schema.isMaxLength(4000)),
  destinationID: Schema.String.check(Schema.isMaxLength(255)),
  messageID: optional(Schema.String.check(Schema.isPattern(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/))),
  status: optional(Delivery.fields.status),
})
export const readSavedDraft = Schema.decodeUnknownOption(Schema.fromJsonString(saved))
