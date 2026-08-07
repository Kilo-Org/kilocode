export * as ConfigErrorV1 from "./error"

import { Schema } from "effect"
import { NamedError } from "../../util/error"

const Issue = Schema.StructWithRest(
  Schema.Struct({
    message: Schema.String,
    path: Schema.Array(Schema.String),
  }),
  [Schema.Record(Schema.String, Schema.Unknown)],
)

export const JsonError = NamedError.create("ConfigJsonError", {
  path: Schema.String,
  message: Schema.optional(Schema.String),
})

export const InvalidError = NamedError.create("ConfigInvalidError", {
  path: Schema.String,
  issues: Schema.optional(Schema.Array(Issue)),
  message: Schema.optional(Schema.String),
})

export const FrontmatterError = NamedError.create("ConfigFrontmatterError", {
  path: Schema.String,
  message: Schema.String,
  // kilocode_change start - carry parse position to editor diagnostics
  line: Schema.optional(Schema.Number),
  column: Schema.optional(Schema.Number),
  // kilocode_change end
})

export const DirectoryTypoError = NamedError.create("ConfigDirectoryTypoError", {
  path: Schema.String,
  dir: Schema.String,
  suggestion: Schema.String,
})

export const RemoteAuthError = NamedError.create("ConfigRemoteAuthError", {
  url: Schema.String,
  remote: Schema.String,
})
